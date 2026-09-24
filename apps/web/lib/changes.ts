import { facilityLabel, PROPERTY_TYPE_LABELS } from "./facilities";
import { formatMoney } from "./format";

// Human wording for the raw before/after values in a change record.

export const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  property_type: "Property type",
  facilities: "Facilities",
  address_line: "Address",
  city: "City",
  region: "Region",
  latitude: "Latitude",
  longitude: "Longitude",
  label: "Label",
  bedrooms: "Bedrooms",
  bathrooms: "Bathrooms",
  size_sqm: "Size",
  rent_amount: "Listed rent",
  currency: "Currency",
  billing_cycle: "Billing cycle",
  description: "Description",
  status: "Status",
  photo: "Photo",
  cover_photo: "Cover photo",
};

export const ACTION_LABELS: Record<string, string> = {
  updated: "Edited",
  photo_added: "Photo added",
  photo_removed: "Photo removed",
  cover_photo_changed: "Cover photo changed",
};

export function formatChangeValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "(none)";
  if (field === "rent_amount") return `${formatMoney(String(value))} XAF`;
  if (field === "size_sqm") return `${value} m²`;
  if (field === "property_type") return PROPERTY_TYPE_LABELS[String(value)] ?? String(value);
  if (field === "facilities" && Array.isArray(value)) {
    return value.length === 0 ? "(none)" : value.map((v) => facilityLabel(String(v))).join(", ");
  }
  return String(value);
}

export function isPhotoField(field: string): boolean {
  return field === "photo" || field === "cover_photo";
}
