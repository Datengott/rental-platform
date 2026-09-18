"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import NavBar from "@/components/NavBar";
import { api, ApiError, loadSession } from "@/lib/api";
import { Contract, PublicUnit, Tenancy } from "@/lib/types";
import { facilityLabel, PROPERTY_TYPE_LABELS } from "@/lib/facilities";

const BILLING_CYCLE_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, biannual: 6 };

const KNOWN_TENANCIES_KEY = "rental_platform_known_tenancies";

function loadKnownTenancyIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KNOWN_TENANCIES_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function rememberTenancyId(id: string) {
  const ids = new Set(loadKnownTenancyIds());
  ids.add(id);
  localStorage.setItem(KNOWN_TENANCIES_KEY, JSON.stringify([...ids]));
}

// The server's "whole months covered" check (PaymentsService.expectedAmountFor)
// compares periodStart/periodEnd's calendar month *indices*, not a day-count
// span — so a period has to stay within whole calendar months to count as
// "N months" of rent, not just span ~30*N days. periodEnd is therefore
// always the last day of the (monthsSpan - 1)th month after periodStart,
// not "+monthsSpan months -1 day" (which would land on the 1st of the
// following month whenever periodStart isn't itself the 1st, miscounting
// the span by one month).
//
// monthsSpan lets a tenant pay several billing cycles at once (demo
// feedback, 2026-09-18: "tenant can choose to pay multiple months at the
// same time") — it's cyclesToPay * that tenancy's own cycle-month count, so
// a quarterly tenancy paying "2 cycles" still lands on whole-quarter
// boundaries the server's amount check accepts.
function nextBillingPeriod(
  paidThroughDate: string | null,
  tenancyStartDate: string,
  monthsSpan: number,
): { start: string; end: string } {
  const start = new Date((paidThroughDate ?? tenancyStartDate) + "T00:00:00Z");
  if (paidThroughDate) {
    // Already covered through this date — the next period starts the day after.
    start.setUTCDate(start.getUTCDate() + 1);
  }
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + monthsSpan, 0)); // day 0 = last day of that month
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export default function TenantPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState("");

  const [units, setUnits] = useState<PublicUnit[]>([]);
  const [tenancyIdInput, setTenancyIdInput] = useState("");
  const [showLookup, setShowLookup] = useState(false);
  const [tenancies, setTenancies] = useState<Record<string, Tenancy>>({});
  const [contracts, setContracts] = useState<Record<string, Contract>>({});
  const [payCycles, setPayCycles] = useState<Record<string, number>>({});
  const [interestedUnitIds, setInterestedUnitIds] = useState<Set<string>>(new Set());

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);

  useEffect(() => {
    const session = loadSession();
    if (!session) {
      router.replace("/login");
      return;
    }
    // Session hydration + page gating on mount — there's no other
    // lifecycle hook for reading localStorage before the first paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUserId(session.user.id);
    setReady(true);
    void loadUnits();
    void loadMyTenancies();
    // Legacy fallback for tenancies previously added by manual id lookup,
    // before /tenants/me/tenancies existed (2026-09-18) — harmless no-op
    // once a tenancy is already in the auto-loaded set above.
    for (const id of loadKnownTenancyIds()) void loadTenancy(id);
  }, [router]);

  function flash(message: string) {
    setNotice(message);
    setError(null);
    setTimeout(() => setNotice(null), 4000);
  }

  async function loadUnits() {
    try {
      const res = await api<{ results: PublicUnit[] }>("/units");
      setUnits(res.results);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load units.");
    }
  }

  async function loadTenancy(id: string) {
    try {
      const tenancy = await api<Tenancy>(`/tenancies/${id}`);
      setTenancies((prev) => ({ ...prev, [id]: tenancy }));
      rememberTenancyId(id);
    } catch {
      // an id that 404s (not yours, or mistyped) just doesn't get added
    }
  }

  async function loadMyTenancies() {
    try {
      const list = await api<Tenancy[]>("/tenants/me/tenancies");
      setTenancies((prev) => {
        const next = { ...prev };
        for (const t of list) next[t.id] = t;
        return next;
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your tenancies.");
    }
  }

  function lookUpTenancy(e: React.FormEvent) {
    e.preventDefault();
    if (tenancyIdInput.trim()) void loadTenancy(tenancyIdInput.trim());
    setTenancyIdInput("");
  }

  async function requestVisit(unitId: string) {
    const slot = window.prompt("Proposed visit time (ISO 8601, e.g. 2026-08-15T10:00:00Z):", "2026-08-15T10:00:00Z");
    if (!slot) return;
    try {
      await api(`/units/${unitId}/visit-requests`, { method: "POST", body: { requested_slots: [{ start: slot }] } });
      flash("Visit requested — the landlord's response will appear in Notifications.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not request a visit.");
    }
  }

  // Lighter-weight than requesting a visit — no scheduling, just flags
  // interest so the landlord can create a tenancy for this tenant with one
  // click from their own dashboard. Idempotent on the backend, so a second
  // click is harmless even if this optimistic UI state were ever lost.
  async function expressInterest(unitId: string) {
    try {
      await api(`/units/${unitId}/interest`, { method: "POST" });
      setInterestedUnitIds((prev) => new Set(prev).add(unitId));
      flash("Interest sent — the landlord has been notified.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not express interest.");
    }
  }

  async function payRent(tenancy: Tenancy) {
    const cycles = payCycles[tenancy.id] ?? 1;
    const cycleMonths = BILLING_CYCLE_MONTHS[tenancy.billing_cycle] ?? 1;
    const { start, end } = nextBillingPeriod(tenancy.paid_through_date, tenancy.start_date, cycles * cycleMonths);
    const amount = Number(tenancy.rent_amount) * cycles;
    setPayingId(tenancy.id);
    try {
      await api(`/tenancies/${tenancy.id}/payments`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: { amount, currency: tenancy.currency, period_start: start, period_end: end, provider: "campay" },
      });
      flash(
        `Payment for ${start} → ${end} (${cycles} ${tenancy.billing_cycle} cycle${cycles > 1 ? "s" : ""}, ${amount} ${tenancy.currency}) submitted (status: pending). The simulated aggregator confirms in ~4s.`,
      );
      // Poll briefly so the demo shows the balance update live without a manual refresh.
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        await loadTenancy(tenancy.id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not initiate payment.");
    } finally {
      setPayingId(null);
    }
  }

  async function generateContract(tenancyId: string) {
    try {
      const contract = await api<Contract>(`/tenancies/${tenancyId}/contracts`, { method: "POST", body: {} });
      setContracts((prev) => ({ ...prev, [tenancyId]: contract }));
      flash(`Contract generated (status: ${contract.status}). Document: ${contract.document_url}`);
      await loadTenancy(tenancyId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not generate contract.");
    }
  }

  async function fileComplaint(tenancyId: string) {
    const description = window.prompt("Describe the issue:");
    if (!description) return;
    const category = window.prompt("Category (plumbing, electrical, security, noise, other):", "other") ?? "other";
    try {
      await api(`/tenancies/${tenancyId}/complaints`, {
        method: "POST",
        formData: (() => {
          const fd = new FormData();
          fd.append("category", category);
          fd.append("description", description);
          return fd;
        })(),
      });
      flash("Complaint filed — your landlord has been notified.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not file complaint.");
    }
  }

  if (!ready) return null;

  return (
    <>
      <NavBar />
      <div className="page">
        <h1>Tenant tools</h1>
        <ErrorNotice error={error} notice={notice} />

        <div className="card">
          <h2>Your user ID</h2>
          <p className="muted">
            Share this with a landlord so they can create a tenancy for you — this demo has no search-by-phone endpoint.
          </p>
          <input readOnly value={userId} onClick={(e) => (e.target as HTMLInputElement).select()} />
        </div>

        <div className="card">
          <h2>Browse available units</h2>
          {units.length === 0 ? (
            <p className="muted">No vacant units listed yet.</p>
          ) : (
            <ul className="list">
              {units.map((u) => (
                <li key={u.id} className="list-item">
                  <span>
                    <strong>{u.label ?? "Unnamed unit"}</strong> — {u.property.city} — {u.rent_amount} {u.currency}
                    {u.property.verified && <span className="badge active" style={{ marginLeft: 6 }}>verified</span>}
                    {u.property.property_type && (
                      <span className="badge" style={{ marginLeft: 6 }}>{PROPERTY_TYPE_LABELS[u.property.property_type]}</span>
                    )}
                    {(u.bedrooms || u.bathrooms) && (
                      <span className="muted">
                        {" "}
                        · {u.bedrooms ?? "—"} bed / {u.bathrooms ?? "—"} bath
                      </span>
                    )}
                    <div>
                      {[...u.facilities, ...u.property.facilities].map((f) => (
                        <span key={f} className="tag">{facilityLabel(f)}</span>
                      ))}
                    </div>
                  </span>
                  <span className="row">
                    <button className="secondary" onClick={() => requestVisit(u.id)}>
                      Request a visit
                    </button>
                    <button onClick={() => expressInterest(u.id)} disabled={interestedUnitIds.has(u.id)}>
                      {interestedUnitIds.has(u.id) ? "Interested ✓" : "Express interest"}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2>My tenancies</h2>
          <p className="muted">
            Loaded automatically once your landlord creates a tenancy for you.{" "}
            <a onClick={() => setShowLookup((v) => !v)} style={{ cursor: "pointer" }}>
              {showLookup ? "Hide" : "Don't see one? Add by ID"}
            </a>
          </p>
          {showLookup && (
            <form onSubmit={lookUpTenancy} className="row">
              <div className="field" style={{ flex: 1 }}>
                <label>Look up a tenancy by ID</label>
                <input value={tenancyIdInput} onChange={(e) => setTenancyIdInput(e.target.value)} placeholder="tenancy id from your landlord" />
              </div>
              <button type="submit">Add</button>
            </form>
          )}

          {Object.values(tenancies).length === 0 ? (
            <p className="muted">No tenancies yet. Ask your landlord to create one for you using your user ID above.</p>
          ) : (
            <ul className="list">
              {Object.values(tenancies).map((t) => (
                <li key={t.id} className="list-item" style={{ alignItems: "flex-start" }}>
                  <span>
                    Unit <span className="muted">{t.unit_id.slice(0, 8)}</span> — {t.rent_amount} {t.currency}/{t.billing_cycle}{" "}
                    <span className={`badge ${t.status}`}>{t.status}</span>
                    <br />
                    Balance: <strong>{t.current_balance ?? "—"}</strong> · Paid through: <strong>{t.paid_through_date ?? "—"}</strong>
                    {t.months_paid_ahead > 0 && (
                      <span className="badge active" style={{ marginLeft: 6 }}>
                        {t.months_paid_ahead} month{t.months_paid_ahead > 1 ? "s" : ""} ahead
                      </span>
                    )}
                    <br />
                    Contract:{" "}
                    <span className={`badge ${contracts[t.id]?.status ?? t.contract_status ?? ""}`}>
                      {contracts[t.id]?.status ?? t.contract_status ?? "none yet"}
                    </span>
                    {t.recent_ledger_entries && t.recent_ledger_entries.length > 0 && (
                      <div className="muted">
                        Recent ledger: {t.recent_ledger_entries.map((e) => `${e.type} ${e.amount} (bal ${e.running_balance})`).join(", ")}
                      </div>
                    )}
                  </span>
                  <span className="row" style={{ alignItems: "center" }}>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Cycles to pay</label>
                      <select
                        value={payCycles[t.id] ?? 1}
                        onChange={(e) => setPayCycles((prev) => ({ ...prev, [t.id]: Number(e.target.value) }))}
                      >
                        {Array.from({ length: Math.max(1, t.max_advance_months) }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>
                            {n} {t.billing_cycle} cycle{n > 1 ? "s" : ""} ({Number(t.rent_amount) * n} {t.currency})
                          </option>
                        ))}
                      </select>
                    </div>
                    <button onClick={() => payRent(t)} disabled={payingId === t.id}>
                      {payingId === t.id ? "Confirming…" : "Pay rent"}
                    </button>
                    <button className="secondary" onClick={() => generateContract(t.id)}>
                      Generate contract
                    </button>
                    <button className="secondary" onClick={() => fileComplaint(t.id)}>
                      File a complaint
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

function ErrorNotice({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <>
      {error && <div className="error">{error}</div>}
      {notice && <div className="success-box">{notice}</div>}
    </>
  );
}
