"use client";

import { useState } from "react";
import FacilityPicker from "@/components/FacilityPicker";
import { api, ApiError } from "@/lib/api";
import { PROPERTY_FACILITIES, PROPERTY_TYPE_LABELS } from "@/lib/facilities";
import type { Property } from "@/lib/types";

// Edit every landlord-editable field of a property. The API records each real
// change (and whether a tenant was living in one of its units) — this form only
// has to say why, if the landlord wants to.
export default function PropertyEditor({
  property,
  onSaved,
  onCancel,
}: {
  property: Property;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(property.name ?? "");
  const [propertyType, setPropertyType] = useState(property.property_type ?? "");
  const [facilities, setFacilities] = useState<string[]>(property.facilities);
  const [addressLine, setAddressLine] = useState(property.address_line);
  const [city, setCity] = useState(property.city);
  const [region, setRegion] = useState(property.region ?? "");
  const [latitude, setLatitude] = useState(property.latitude ? String(property.latitude) : "");
  const [longitude, setLongitude] = useState(property.longitude ? String(property.longitude) : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const occupied = property.occupied_unit_count ?? 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/properties/${property.id}`, {
        method: "PATCH",
        body: {
          name: name.trim() || null,
          property_type: propertyType || null,
          facilities,
          address_line: addressLine,
          city,
          region: region.trim() || null,
          latitude: latitude.trim() === "" ? null : Number(latitude),
          longitude: longitude.trim() === "" ? null : Number(longitude),
          change_note: note.trim() || undefined,
        },
      });
      onSaved(`Saved changes to "${name.trim() || addressLine}".`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save changes.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="editor" onSubmit={save}>
      <h3>Edit property</h3>

      {occupied > 0 && (
        <div className="editor-warning">
          {occupied} unit{occupied === 1 ? " here has" : "s here have"} a tenant living in {occupied === 1 ? "it" : "them"}.
          Changes are recorded, and the tenant{occupied === 1 ? "" : "s"} can see what changed. Add a reason below so
          it&apos;s clear why.
        </div>
      )}
      {property.ownership_verified_at && (
        <div className="editor-warning">
          This property is ownership-verified. Editing it does not remove that, but the edit is flagged in the audit log.
        </div>
      )}

      <div className="field">
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Résidence Kennedy" maxLength={120} />
      </div>
      <div className="row">
        <div className="field" style={{ flex: 2, minWidth: 220 }}>
          <label>Address</label>
          <input value={addressLine} onChange={(e) => setAddressLine(e.target.value)} required />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 140 }}>
          <label>City</label>
          <input value={city} onChange={(e) => setCity(e.target.value)} required />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 140 }}>
          <label>Region</label>
          <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Littoral" />
        </div>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label>Property type</label>
          <select value={propertyType} onChange={(e) => setPropertyType(e.target.value)}>
            <option value="">Not specified</option>
            {Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 120 }}>
          <label>Latitude</label>
          <input type="number" step="any" min={-90} max={90} value={latitude} onChange={(e) => setLatitude(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 120 }}>
          <label>Longitude</label>
          <input type="number" step="any" min={-180} max={180} value={longitude} onChange={(e) => setLongitude(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Facilities</label>
        <FacilityPicker name="facilities" options={PROPERTY_FACILITIES} selected={facilities} onChange={setFacilities} />
      </div>
      <div className="field">
        <label>Reason for the change (optional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Corrected the street number" />
      </div>

      {error && <div className="error">{error}</div>}
      <div className="row">
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
