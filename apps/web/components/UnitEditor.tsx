"use client";

import { useState } from "react";
import FacilityPicker from "@/components/FacilityPicker";
import { api, ApiError } from "@/lib/api";
import { UNIT_FACILITIES } from "@/lib/facilities";
import { formatMoney } from "@/lib/format";
import type { Unit } from "@/lib/types";

const IN_RESIDENCE = ["occupied", "notice_given"];

// Edit every landlord-editable field of a unit, and manage its photos (remove,
// pick the cover). Everything is recorded by the API; while a tenant is living
// in the unit the form says so up front, because that's exactly when a change
// matters most — in particular, a new listed rent does NOT change what the
// tenant's existing tenancy charges.
export default function UnitEditor({
  unit,
  onSaved,
  onPhotosChanged,
  onCancel,
}: {
  unit: Unit;
  onSaved: (message: string) => void;
  onPhotosChanged: (message: string) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(unit.label ?? "");
  const [rent, setRent] = useState(String(Math.round(Number(unit.rent_amount))));
  const [billingCycle, setBillingCycle] = useState(unit.billing_cycle ?? "monthly");
  const [bedrooms, setBedrooms] = useState(unit.bedrooms?.toString() ?? "");
  const [bathrooms, setBathrooms] = useState(unit.bathrooms?.toString() ?? "");
  const [sizeSqm, setSizeSqm] = useState(unit.size_sqm ? String(Number(unit.size_sqm)) : "");
  const [description, setDescription] = useState(unit.description ?? "");
  const [facilities, setFacilities] = useState<string[]>(unit.facilities);
  const [status, setStatus] = useState(unit.status);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inResidence = IN_RESIDENCE.includes(unit.status);
  const statusEditable = unit.status === "vacant" || unit.status === "reserved";
  const rentChanged = Number(rent) !== Math.round(Number(unit.rent_amount));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/units/${unit.id}`, {
        method: "PATCH",
        body: {
          label: label.trim() || null,
          rent_amount: Number(rent),
          billing_cycle: billingCycle,
          bedrooms: bedrooms === "" ? null : Number(bedrooms),
          bathrooms: bathrooms === "" ? null : Number(bathrooms),
          size_sqm: sizeSqm === "" ? null : Number(sizeSqm),
          description: description.trim() || null,
          facilities,
          // Only send a status when it's one the landlord can actually set.
          status: statusEditable ? status : undefined,
          change_note: note.trim() || undefined,
        },
      });
      onSaved(`Saved changes to "${label.trim() || "unit"}".`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save changes.");
    } finally {
      setBusy(false);
    }
  }

  async function photoAction(path: string, method: "DELETE" | "POST", message: string) {
    setError(null);
    try {
      await api(path, { method });
      onPhotosChanged(message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update photos.");
    }
  }

  const photos = unit.photos ?? [];
  const coverUrl = unit.cover_photo_url;

  return (
    <form className="editor" onSubmit={save}>
      <h3>Edit unit</h3>

      {inResidence && (
        <div className="editor-warning">
          A tenant is living in this unit. Your changes are recorded and the tenant can see them. Changing the
          listed rent here does <strong>not</strong> change what the tenant is charged — that stays as agreed in their
          tenancy.
        </div>
      )}

      <div className="row">
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label>Label</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={50} placeholder="Studio A" />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 140 }}>
          <label>Listed rent (XAF)</label>
          <input type="number" min={1} step={1} required value={rent} onChange={(e) => setRent(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 140 }}>
          <label>Billing cycle</label>
          <select value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Annual</option>
          </select>
        </div>
      </div>
      {rentChanged && (
        <p className="muted" style={{ marginTop: -6 }}>
          Listed rent goes from {formatMoney(unit.rent_amount)} to {formatMoney(rent || 0)} XAF.
        </p>
      )}

      <div className="row">
        <div className="field" style={{ flex: 1, minWidth: 110 }}>
          <label>Bedrooms</label>
          <input type="number" min={0} value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 110 }}>
          <label>Bathrooms</label>
          <input type="number" min={0} value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 110 }}>
          <label>Size (m²)</label>
          <input type="number" min={0} step="any" value={sizeSqm} onChange={(e) => setSizeSqm(e.target.value)} />
        </div>
        {statusEditable && (
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label>Availability</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="vacant">Vacant (listed)</option>
              <option value="reserved">Reserved</option>
            </select>
          </div>
        )}
      </div>

      <div className="field">
        <label>Description</label>
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="field">
        <label>Facilities</label>
        <FacilityPicker name="facilities" options={UNIT_FACILITIES} selected={facilities} onChange={setFacilities} />
      </div>

      <div className="field">
        <label>Photos</label>
        {photos.length === 0 ? (
          <p className="muted">No photos. Upload one from the unit list to publish it.</p>
        ) : (
          <div className="photo-strip">
            {photos.map((p) => (
              <div key={p.id} className="photo-tile">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" loading="lazy" />
                <div className="btn-row">
                  {p.url === coverUrl ? (
                    <span className="badge active" style={{ flex: 1, textAlign: "center" }}>Cover</span>
                  ) : (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void photoAction(`/units/${unit.id}/photos/${p.id}/cover`, "POST", "Cover photo changed.")}
                    >
                      Make cover
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      if (confirm("Remove this photo?")) {
                        void photoAction(`/units/${unit.id}/photos/${p.id}`, "DELETE", "Photo removed.");
                      }
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {photos.length === 1 && unit.status === "vacant" && (
          <p className="muted">Removing the only photo takes this unit off the public listings until you add another.</p>
        )}
      </div>

      <div className="field">
        <label>Reason for the change (optional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Added Wi-Fi after installation" />
      </div>

      {error && <div className="error">{error}</div>}
      <div className="row">
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
          Close
        </button>
      </div>
    </form>
  );
}
