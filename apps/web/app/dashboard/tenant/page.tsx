"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconArrowRight, IconImage, IconPin, IconSearch } from "@/components/Icons";
import HomeChanges from "@/components/HomeChanges";
import PaymentHistory from "@/components/PaymentHistory";
import { api, ApiError, loadSession } from "@/lib/api";
import { addDays as addOneDayTo, describeCoveredMonths, dueStatus, formatDate, todayIso } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { Contract, MyInterest, PublicUnitDetail, Tenancy } from "@/lib/types";

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

interface InterestRow {
  interest: MyInterest;
  // null when the unit is no longer publicly listed (rented, or taken down).
  unit: PublicUnitDetail | null;
}

export default function TenantPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState("");

  const [interests, setInterests] = useState<InterestRow[] | null>(null);
  const [tenancyIdInput, setTenancyIdInput] = useState("");
  const [showLookup, setShowLookup] = useState(false);
  const [tenancies, setTenancies] = useState<Record<string, Tenancy>>({});
  const [contracts, setContracts] = useState<Record<string, Contract>>({});
  const [payCycles, setPayCycles] = useState<Record<string, number>>({});

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  // Lazy initialiser: today's date is read once, not on every render.
  const [today] = useState(todayIso);

  useEffect(() => {
    const session = loadSession();
    if (!session) {
      router.replace("/login?next=/dashboard/tenant");
      return;
    }
    // Session hydration + page gating on mount — there's no other
    // lifecycle hook for reading localStorage before the first paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUserId(session.user.id);
    setReady(true);
    void loadInterests();
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

  async function loadInterests() {
    try {
      const res = await api<{ results: MyInterest[] }>("/tenants/me/interests");
      const rows = await Promise.all(
        res.results.map(async (interest): Promise<InterestRow> => {
          try {
            return { interest, unit: await api<PublicUnitDetail>(`/units/${interest.unit_id}`, { auth: false }) };
          } catch {
            return { interest, unit: null };
          }
        }),
      );
      setInterests(rows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your interests.");
      setInterests([]);
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
      const covered = describeCoveredMonths(start, end);
      flash(
        `Payment of ${formatMoney(amount)} ${tenancy.currency} submitted — covers ${covered.label} (${covered.count} month${covered.count === 1 ? "" : "s"}). The next payment will then be due ${formatDate(addOneDayTo(end, 1))}. The simulated aggregator confirms in ~4s.`,
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
    <div className="page">
      <h1>My rentals</h1>
      <p className="muted" style={{ fontSize: 14.5, margin: "0 0 18px" }}>
        Your tenancies, rent and the homes you’ve shown interest in.
      </p>

      {error && <div className="error">{error}</div>}
      {notice && <div className="success-box">{notice}</div>}

      <div className="card">
        <h2>My tenancies</h2>
        <p className="muted" style={{ margin: 0 }}>
          Loaded automatically once your landlord creates a tenancy for you.{" "}
          <a href="#lookup" onClick={(e) => { e.preventDefault(); setShowLookup((v) => !v); }}>
            {showLookup ? "Hide" : "Don’t see one? Add by ID"}
          </a>
        </p>
        {showLookup && (
          <form id="lookup" onSubmit={lookUpTenancy} className="row" style={{ marginTop: 12 }}>
            <div className="field" style={{ flex: 1, margin: 0 }}>
              <label>Look up a tenancy by ID</label>
              <input value={tenancyIdInput} onChange={(e) => setTenancyIdInput(e.target.value)} placeholder="tenancy id from your landlord" />
            </div>
            <button type="submit">Add</button>
          </form>
        )}

        {Object.values(tenancies).length === 0 ? (
          <p className="muted" style={{ marginTop: 14 }}>
            No tenancies yet. Once you’ve shown interest in a home, the landlord can set up your tenancy in one click —
            or share your user ID: <code>{userId}</code>
          </p>
        ) : (
          <ul className="list">
            {Object.values(tenancies).map((t) => (
              <li key={t.id} className="list-item" style={{ alignItems: "flex-start" }}>
                <span>
                  <strong>
                    {formatMoney(t.rent_amount)} {t.currency}
                  </strong>{" "}
                  / {t.billing_cycle} · Unit <span className="muted">{t.unit_id.slice(0, 8)}</span>{" "}
                  <span className={`badge ${t.status}`}>{t.status}</span>
                  <br />
                  <span className="due-line">
                    <span>
                      Billing {t.start_date > today ? "starts" : "started"} <strong>{formatDate(t.start_date)}</strong>
                    </span>
                    {t.next_payment_due_date && (
                      <span>
                        Next payment due <strong>{formatDate(t.next_payment_due_date)}</strong>
                        {dueStatus(t.next_payment_due_date, today) === "overdue" && (
                          <span className="badge failed" style={{ marginLeft: 6 }}>overdue</span>
                        )}
                        {dueStatus(t.next_payment_due_date, today) === "today" && (
                          <span className="badge pending" style={{ marginLeft: 6 }}>due today</span>
                        )}
                      </span>
                    )}
                  </span>
                  Balance: <strong>{t.current_balance ?? "—"}</strong> · Paid through:{" "}
                  <strong>{t.paid_through_date ? formatDate(t.paid_through_date) : "—"}</strong>
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
                    <PaymentHistory
                      entries={t.recent_ledger_entries}
                      currency={t.currency}
                      nextPaymentDue={t.next_payment_due_date}
                      today={today}
                    />
                  )}
                  <HomeChanges tenancyId={t.id} />
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
                          {n} {t.billing_cycle} cycle{n > 1 ? "s" : ""} ({formatMoney(Number(t.rent_amount) * n)} {t.currency})
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

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Homes you’re interested in</h2>
          <Link href="/" className="btn btn-secondary">
            <IconSearch size={16} /> Browse more homes
          </Link>
        </div>
        {interests === null ? (
          <p className="muted" style={{ marginTop: 14 }}>
            Loading…
          </p>
        ) : interests.length === 0 ? (
          <p className="muted" style={{ marginTop: 14 }}>
            You haven’t shown interest in any home yet. Browse the listings and tap “I’m interested” — the landlord is
            notified straight away.
          </p>
        ) : (
          <ul className="list">
            {interests.map(({ interest, unit }) => (
              <li key={interest.id} className="list-item">
                <span className="item-main">
                  {unit?.photos[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="thumb" src={unit.photos[0].url} alt="" loading="lazy" />
                  ) : (
                    <span className="thumb thumb-empty">
                      <IconImage size={22} />
                    </span>
                  )}
                  <span>
                    <strong>{unit?.label ?? "Listing no longer available"}</strong>{" "}
                    <span className={`badge ${interest.status}`}>{interest.status === "converted" ? "tenancy created" : "waiting for landlord"}</span>
                    <br />
                    {unit ? (
                      <span className="muted">
                        <IconPin size={13} /> {[unit.property.name, unit.property.city].filter(Boolean).join(" · ")} ·{" "}
                        {formatMoney(unit.rent_amount)} {unit.currency}/{unit.billing_cycle}
                      </span>
                    ) : (
                      <span className="muted">It may have been rented or taken down.</span>
                    )}
                  </span>
                </span>
                {unit && (
                  <Link href={`/units/${unit.id}`} className="btn btn-secondary">
                    View <IconArrowRight size={15} />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
