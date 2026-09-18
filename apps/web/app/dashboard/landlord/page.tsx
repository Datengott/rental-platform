"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import NavBar from "@/components/NavBar";
import FacilityPicker from "@/components/FacilityPicker";
import { api, ApiError, loadSession } from "@/lib/api";
import { Complaint, Property, Tenancy, Unit, UnitInterest, VisitRequest } from "@/lib/types";
import { PROPERTY_FACILITIES, PROPERTY_TYPE_LABELS, UNIT_FACILITIES, facilityLabel } from "@/lib/facilities";

function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="error">{error}</div>;
}

export default function LandlordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  const [properties, setProperties] = useState<Property[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [tenancies, setTenancies] = useState<Tenancy[]>([]);
  const [visitRequests, setVisitRequests] = useState<VisitRequest[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [interests, setInterests] = useState<UnitInterest[]>([]);
  const [creatingTenancyFor, setCreatingTenancyFor] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [propertyFacilities, setPropertyFacilities] = useState<string[]>([]);
  const [unitFacilities, setUnitFacilities] = useState<string[]>([]);

  useEffect(() => {
    if (!loadSession()) {
      router.replace("/login");
      return;
    }
    // Gates the whole page behind a client-side session check on mount —
    // there's no other lifecycle hook for that here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
    void refreshAll();
  }, [router]);

  async function refreshAll() {
    try {
      const [u, t, v, c, i] = await Promise.all([
        api<Unit[]>("/landlords/me/units"),
        api<Tenancy[]>("/landlords/me/tenancies"),
        api<{ results: VisitRequest[] }>("/landlords/me/visit-requests"),
        api<Complaint[]>("/landlords/me/complaints"),
        api<{ results: UnitInterest[] }>("/landlords/me/interests"),
      ]);
      setUnits(u);
      setTenancies(t);
      setVisitRequests(v.results ?? []);
      setComplaints(c);
      setInterests(i.results ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your data.");
    }
  }

  function flash(message: string) {
    setNotice(message);
    setError(null);
    setTimeout(() => setNotice(null), 4000);
  }

  // --- Properties ---
  async function createProperty(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // React nulls out e.currentTarget once the synchronous part of an
    // event handler returns — capture the element itself now, before the
    // await, rather than reading e.currentTarget again afterwards (that
    // throws, and a demo audience would see a false "could not create"
    // error on a request that actually succeeded).
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    try {
      const prop = await api<Property>("/properties", {
        method: "POST",
        body: {
          address_line: form.get("address_line"),
          city: form.get("city"),
          name: form.get("name") || undefined,
          property_type: form.get("property_type") || undefined,
          facilities: propertyFacilities.length > 0 ? propertyFacilities : undefined,
        },
      });
      setProperties((prev) => [prop, ...prev]);
      formEl.reset();
      setPropertyFacilities([]);
      flash(`Property "${prop.name ?? prop.address_line}" created.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create property.");
    }
  }

  // --- Units ---
  async function createUnit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const propertyId = form.get("property_id") as string;
    if (!propertyId) {
      setError("Create a property first, then add units to it.");
      return;
    }
    const quantity = form.get("quantity") ? Number(form.get("quantity")) : undefined;
    try {
      // Bulk creation (quantity > 1) returns { units: [...] } instead of a
      // single unit object — see CreateUnitDto's comment on the backend.
      const result = await api<Unit | { units: Unit[] }>(`/properties/${propertyId}/units`, {
        method: "POST",
        body: {
          label: form.get("label") || undefined,
          rent_amount: Number(form.get("rent_amount")),
          bedrooms: form.get("bedrooms") ? Number(form.get("bedrooms")) : undefined,
          bathrooms: form.get("bathrooms") ? Number(form.get("bathrooms")) : undefined,
          facilities: unitFacilities.length > 0 ? unitFacilities : undefined,
          quantity,
        },
      });
      formEl.reset();
      setUnitFacilities([]);
      const createdCount = "units" in result ? result.units.length : 1;
      flash(
        createdCount > 1
          ? `${createdCount} units created — upload a photo for each below to list them publicly.`
          : "Unit created — upload a photo below to list it publicly.",
      );
      await refreshAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create unit.");
    }
  }

  async function uploadPhoto(unitId: string, file: File) {
    const formData = new FormData();
    formData.append("file", file);
    try {
      await api(`/units/${unitId}/photos`, { method: "POST", formData });
      flash("Photo uploaded — the unit is now listed as vacant.");
      await refreshAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not upload photo.");
    }
  }

  // --- Tenancies ---
  async function createTenancy(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    try {
      await api("/tenancies", {
        method: "POST",
        body: {
          unit_id: form.get("unit_id"),
          tenant_id: form.get("tenant_id"),
          start_date: form.get("start_date"),
          rent_amount: Number(form.get("rent_amount")),
          max_advance_months: form.get("max_advance_months") ? Number(form.get("max_advance_months")) : undefined,
        },
      });
      formEl.reset();
      flash("Tenancy created.");
      await refreshAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create tenancy.");
    }
  }

  // One-click alternative to the paste-the-tenant-id form above, for a
  // tenant who already expressed interest in a unit — defaults rent to the
  // unit's own listed rent and start_date to today, since the whole point
  // of "click of a button" is skipping a second form; a landlord who wants
  // a different start date/rent still has the form for that.
  async function createTenancyFromInterest(interest: UnitInterest) {
    const unit = units.find((u) => u.id === interest.unit_id);
    if (!unit) {
      setError("Could not find that unit — refresh and try again.");
      return;
    }
    setCreatingTenancyFor(interest.id);
    try {
      await api("/tenancies", {
        method: "POST",
        body: {
          unit_id: interest.unit_id,
          tenant_id: interest.tenant_id,
          start_date: new Date().toISOString().slice(0, 10),
          rent_amount: Number(unit.rent_amount),
        },
      });
      flash(`Tenancy created for ${interest.tenant_name ?? interest.tenant_phone_number}.`);
      await refreshAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create tenancy.");
    } finally {
      setCreatingTenancyFor(null);
    }
  }

  async function issueTerminationNotice(tenancyId: string) {
    const effectiveDate = window.prompt(
      "Effective date for the termination notice (YYYY-MM-DD, must be at least the tenancy's notice period away):",
    );
    if (!effectiveDate) return;
    try {
      await api(`/tenancies/${tenancyId}/termination-notices`, {
        method: "POST",
        body: { reason: "end_of_term", effective_date: effectiveDate },
      });
      flash("Termination notice issued — the tenant has been notified.");
      await refreshAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not issue termination notice.");
    }
  }

  async function generateContract(tenancyId: string) {
    try {
      const contract = await api<{ document_url: string; status: string }>(`/tenancies/${tenancyId}/contracts`, {
        method: "POST",
        body: {},
      });
      flash(`Contract generated (status: ${contract.status}). Document: ${contract.document_url}`);
      await refreshAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not generate contract.");
    }
  }

  // --- Visit requests ---
  async function respondToVisit(id: string, action: "accept" | "decline") {
    try {
      await api(`/visit-requests/${id}/respond`, { method: "PATCH", body: { action } });
      flash(`Visit request ${action}ed.`);
      await refreshAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not respond to visit request.");
    }
  }

  // --- Complaints ---
  async function updateComplaintStatus(id: string, newStatus: string) {
    try {
      await api(`/complaints/${id}/status`, { method: "PATCH", body: { new_status: newStatus } });
      flash(`Complaint marked ${newStatus}.`);
      await refreshAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update complaint.");
    }
  }

  if (!ready) return null;

  return (
    <>
      <NavBar />
      <div className="page">
        <h1>Landlord tools</h1>
        <ErrorBox error={error} />
        {notice && <div className="success-box">{notice}</div>}

        <div className="stat-row">
          <div className="stat-card">
            <div className="stat-value">{units.length}</div>
            <div className="stat-label">Units</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{units.filter((u) => u.status === "occupied").length}</div>
            <div className="stat-label">Occupied</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{visitRequests.filter((v) => v.status === "pending").length}</div>
            <div className="stat-label">Pending visits</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{complaints.filter((c) => c.status !== "closed").length}</div>
            <div className="stat-label">Open complaints</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{interests.filter((i) => i.status === "pending").length}</div>
            <div className="stat-label">Interested tenants</div>
          </div>
        </div>

        <div className="grid-2">
          <div className="card">
            <h2>Add a property</h2>
            <form onSubmit={createProperty}>
              <div className="field">
                <label>Address</label>
                <input name="address_line" required placeholder="12 Avenue Kennedy" />
              </div>
              <div className="field">
                <label>City</label>
                <input name="city" required placeholder="Douala" />
              </div>
              <div className="field">
                <label>Name (optional)</label>
                <input name="name" placeholder="Résidence Kennedy" />
              </div>
              <div className="field">
                <label>Property type (optional)</label>
                <select name="property_type" defaultValue="">
                  <option value="">Not specified</option>
                  {Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Facilities (optional)</label>
                <FacilityPicker
                  name="facilities"
                  options={PROPERTY_FACILITIES}
                  selected={propertyFacilities}
                  onChange={setPropertyFacilities}
                />
              </div>
              <button type="submit">Create property</button>
            </form>
            {properties.length > 0 && (
              <ul className="list" style={{ marginTop: 12 }}>
                {properties.map((p) => (
                  <li key={p.id} className="list-item">
                    <span>
                      {p.name ?? p.address_line} — {p.city}
                      {p.property_type && <span className="badge active" style={{ marginLeft: 6 }}>{PROPERTY_TYPE_LABELS[p.property_type]}</span>}
                      {p.facilities.length > 0 && (
                        <div>
                          {p.facilities.map((f) => (
                            <span key={f} className="tag">{facilityLabel(f)}</span>
                          ))}
                        </div>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <h2>Add a unit</h2>
            <form onSubmit={createUnit}>
              <div className="field">
                <label>Property</label>
                <select name="property_id" required>
                  <option value="">Select a property…</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name ?? p.address_line}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Label (optional)</label>
                <input name="label" placeholder="Studio A" />
              </div>
              <div className="row">
                <div className="field">
                  <label>Rent (XAF/month)</label>
                  <input name="rent_amount" type="number" required min={0} placeholder="150000" />
                </div>
                <div className="field">
                  <label>Bedrooms</label>
                  <input name="bedrooms" type="number" min={0} placeholder="1" />
                </div>
                <div className="field">
                  <label>Bathrooms</label>
                  <input name="bathrooms" type="number" min={0} placeholder="1" />
                </div>
              </div>
              <div className="field">
                <label>Facilities (optional)</label>
                <FacilityPicker
                  name="facilities"
                  options={UNIT_FACILITIES}
                  selected={unitFacilities}
                  onChange={setUnitFacilities}
                />
              </div>
              <div className="field">
                <label>Number of identical units (optional)</label>
                <input name="quantity" type="number" min={1} max={100} placeholder="1" />
              </div>
              <button type="submit">Create unit(s)</button>
            </form>
            <p className="muted">
              A property must exist first. Newly created units start in <code>draft</code> — upload a photo for each
              below to publish them as <code>vacant</code>. Creating more than one makes that many independent
              units with the same details (auto-numbered label if you gave one) — handy for e.g. 50 identical
              studios in one building, instead of repeating this form 50 times.
            </p>
          </div>
        </div>

        <div className="card">
          <h2>My units</h2>
          {units.length === 0 ? (
            <p className="muted">No units yet.</p>
          ) : (
            <ul className="list">
              {units.map((u) => (
                <li key={u.id} className="list-item">
                  <span>
                    <strong>{u.label ?? "Unnamed unit"}</strong> — {u.property.name ?? u.property.city} —{" "}
                    {u.rent_amount} {u.currency}
                    {(u.bedrooms || u.bathrooms) && (
                      <span className="muted">
                        {" "}
                        ({u.bedrooms ?? "—"} bed / {u.bathrooms ?? "—"} bath)
                      </span>
                    )}
                    <br />
                    {u.facilities.length > 0 &&
                      u.facilities.map((f) => (
                        <span key={f} className="tag">{facilityLabel(f)}</span>
                      ))}
                    <br />
                    <span className="muted">id: {u.id}</span>
                  </span>
                  <span className="row" style={{ alignItems: "center" }}>
                    <span className={`badge ${u.status}`}>{u.status}</span>
                    <label className="secondary" style={{ cursor: "pointer" }}>
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void uploadPhoto(u.id, file);
                        }}
                      />
                      <span className="secondary" style={{ border: "1px solid var(--accent)", borderRadius: 6, padding: "6px 10px" }}>
                        Upload photo
                      </span>
                    </label>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2>Interested tenants</h2>
          <p className="muted">
            Tenants who expressed interest in one of your units, browsing the public listings — create a tenancy
            for any of them with one click, as an alternative to the paste-the-tenant-id form below.
          </p>
          {interests.filter((i) => i.status === "pending").length === 0 ? (
            <p className="muted">No pending interest yet.</p>
          ) : (
            <ul className="list">
              {interests
                .filter((i) => i.status === "pending")
                .map((i) => (
                  <li key={i.id} className="list-item">
                    <span>
                      <strong>{i.tenant_name ?? i.tenant_phone_number}</strong> ({i.tenant_phone_number}) — interested
                      in <strong>{i.unit_label ?? i.unit_id.slice(0, 8)}</strong>
                    </span>
                    <button onClick={() => createTenancyFromInterest(i)} disabled={creatingTenancyFor === i.id}>
                      {creatingTenancyFor === i.id ? "Creating…" : "Create tenancy"}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2>Create a tenancy</h2>
          <form onSubmit={createTenancy}>
            <div className="row">
              <div className="field">
                <label>Unit</label>
                <select name="unit_id" required>
                  <option value="">Select a vacant unit…</option>
                  {units
                    .filter((u) => u.status === "vacant")
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label ?? u.id.slice(0, 8)} — {u.rent_amount} {u.currency}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label>Tenant user ID</label>
                <input name="tenant_id" required placeholder="paste the tenant's user id" />
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label>Start date</label>
                <input name="start_date" type="date" required />
              </div>
              <div className="field">
                <label>Rent (XAF/month)</label>
                <input name="rent_amount" type="number" required min={0} placeholder="150000" />
              </div>
              <div className="field">
                <label>Max months tenant may pay in advance</label>
                <input name="max_advance_months" type="number" min={1} placeholder="3" />
              </div>
            </div>
            <button type="submit">Create tenancy</button>
          </form>
          <p className="muted">
            The tenant finds their own user ID on their Tenant dashboard — there is no search-by-phone endpoint in this
            demo, so it&apos;s a simple copy/paste hand-off. Max advance months defaults to 3 if left blank, and caps
            how far ahead the tenant is allowed to pay in one go.
          </p>
        </div>

        <div className="card">
          <h2>My tenancies</h2>
          {tenancies.length === 0 ? (
            <p className="muted">No tenancies yet.</p>
          ) : (
            <ul className="list">
              {tenancies.map((t) => (
                <li key={t.id} className="list-item" style={{ alignItems: "flex-start" }}>
                  <span>
                    Unit <span className="muted">{t.unit_id.slice(0, 8)}</span> — {t.rent_amount} {t.currency}/
                    {t.billing_cycle}
                    <br />
                    Balance: <strong>{t.current_balance ?? "—"}</strong> · Paid through:{" "}
                    <strong>{t.paid_through_date ?? "—"}</strong>
                    {t.months_paid_ahead > 0 && (
                      <span className="badge active" style={{ marginLeft: 6 }}>
                        {t.months_paid_ahead} month{t.months_paid_ahead > 1 ? "s" : ""} paid ahead
                      </span>
                    )}
                    <br />
                    Contract: <span className={`badge ${t.contract_status ?? ""}`}>{t.contract_status ?? "none yet"}</span>{" "}
                    <span className={`badge ${t.status}`}>{t.status}</span>
                    <br />
                    <span className="muted">
                      Max advance: {t.max_advance_months} month(s) · Tenancy id (give this to the tenant so they can
                      look it up): <code>{t.id}</code>
                    </span>
                  </span>
                  <span className="row">
                    <button className="secondary" onClick={() => generateContract(t.id)}>
                      Generate contract
                    </button>
                    <button className="secondary" onClick={() => issueTerminationNotice(t.id)}>
                      Issue termination notice
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2>Visit request inbox</h2>
          {visitRequests.length === 0 ? (
            <p className="muted">No visit requests.</p>
          ) : (
            <ul className="list">
              {visitRequests.map((v) => (
                <li key={v.id} className="list-item">
                  <span>
                    Unit {v.unit_id.slice(0, 8)} <span className={`badge ${v.status}`}>{v.status}</span>
                  </span>
                  {v.status === "pending" && (
                    <span className="row">
                      <button onClick={() => respondToVisit(v.id, "accept")}>Accept</button>
                      <button className="danger" onClick={() => respondToVisit(v.id, "decline")}>
                        Decline
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2>Complaints</h2>
          {complaints.length === 0 ? (
            <p className="muted">No complaints filed.</p>
          ) : (
            <ul className="list">
              {complaints.map((c) => (
                <li key={c.id} className="list-item" style={{ alignItems: "flex-start" }}>
                  <span>
                    <span className="badge">{c.category}</span> <span className={`badge ${c.status}`}>{c.status}</span>
                    <br />
                    {c.description}
                    {c.media.length > 0 && <div className="muted">{c.media.length} attachment(s)</div>}
                  </span>
                  {c.status !== "closed" && (
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) void updateComplaintStatus(c.id, e.target.value);
                      }}
                    >
                      <option value="" disabled>
                        Update status…
                      </option>
                      <option value="acknowledged">Acknowledge</option>
                      <option value="in_progress">In progress</option>
                      <option value="resolved">Resolved</option>
                      <option value="closed">Closed</option>
                    </select>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
