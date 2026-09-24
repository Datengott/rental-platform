// Minimal shapes matching the API's actual JSON responses (snake_case,
// matching api-specification.md) — just the fields this demo UI renders,
// not full fidelity with every field the backend returns.

export type PropertyType = "residential" | "commercial" | "mixed_use";

export interface Property {
  id: string;
  name: string | null;
  property_type: PropertyType | null;
  facilities: string[];
  address_line: string;
  city: string;
  region?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  ownership_verified_at?: string | null;
  // Only on GET /landlords/me/properties
  unit_count?: number;
  occupied_unit_count?: number;
  created_at: string;
}

export interface UnitPhoto {
  id: string;
  url: string;
  sort_order: number;
}

export interface Unit {
  id: string;
  cover_photo_url?: string | null;
  photos?: UnitPhoto[];
  label: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  size_sqm?: string | null;
  billing_cycle?: string;
  description?: string | null;
  facilities: string[];
  rent_amount: string;
  currency: string;
  status: string;
  property: { id: string; name: string | null; city: string };
}

export interface PublicProperty {
  name: string | null;
  city: string;
  region: string | null;
  verified: boolean;
  property_type: PropertyType | null;
  facilities: string[];
}

export interface PublicUnit {
  id: string;
  label: string | null;
  description: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  size_sqm: string | null;
  facilities: string[];
  rent_amount: string;
  currency: string;
  billing_cycle: string;
  property: PublicProperty;
  cover_photo_url: string | null;
}

export interface PublicUnitDetail extends Omit<PublicUnit, "cover_photo_url"> {
  photos: { id: string; url: string; sort_order: number }[];
  created_at: string;
}

export interface Tenancy {
  id: string;
  unit_id: string;
  tenant_id: string;
  landlord_id: string;
  start_date: string;
  rent_amount: string;
  currency: string;
  billing_cycle: string;
  notice_period_days: number;
  max_advance_months: number;
  paid_through_date: string | null;
  // Whole calendar months paid_through_date sits ahead of today — see the
  // comment on TenanciesService.monthsPaidAhead in the backend.
  months_paid_ahead: number;
  // When the next rent payment is expected: the day after paid_through_date,
  // or the start date until anything is paid. null once the tenancy has ended.
  next_payment_due_date: string | null;
  status: string;
  current_balance?: number;
  recent_ledger_entries?: LedgerEntry[];
  contract_status?: string | null;
}

export interface LedgerEntry {
  id: string;
  type: string;
  amount: string;
  running_balance: string;
  created_at: string;
  payment_id: string | null;
  description?: string | null;
  // 'campay' | 'monetbil' | 'offline' (rent the landlord recorded as paid upfront)
  provider?: string | null;
  // When the payment was made, and the period (and so the month(s)) it covers.
  paid_at?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  months_covered?: number | null;
}

export interface UnitInterest {
  id: string;
  unit_id: string;
  tenant_id: string;
  landlord_id: string;
  status: string;
  tenant_name: string | null;
  tenant_phone_number: string;
  unit_label: string | null;
  created_at: string;
  updated_at: string;
}

export interface MyInterest {
  id: string;
  unit_id: string;
  status: string;
  created_at: string;
}

export interface VisitRequest {
  id: string;
  unit_id: string;
  tenant_id: string;
  landlord_id: string;
  status: string;
  confirmed_slot: string | null;
  requested_slots?: { start: string }[];
  created_at: string;
}

export interface Complaint {
  id: string;
  tenancy_id: string;
  unit_id: string;
  category: string;
  description: string;
  status: string;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  media: { id: string; storage_url: string; media_type: string }[];
}

export interface Contract {
  id: string;
  tenancy_id: string;
  template_version: string;
  locale: string;
  document_url: string;
  status: string;
  created_at: string;
}

export interface AppNotification {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

// One entry in the append-only history of landlord edits to a property/unit.
export interface ListingChange {
  id: string;
  entity_type: "property" | "unit";
  property_id: string;
  unit_id: string | null;
  entity_label: string | null;
  // 'updated' | 'photo_added' | 'photo_removed' | 'cover_photo_changed'
  action: string;
  changes: { field: string; from: unknown; to: unknown }[];
  note: string | null;
  // True when a tenant was living in an affected unit at the time.
  while_occupied: boolean;
  property_verified_at_change: boolean;
  // Present for landlords/admins; deliberately absent in a tenant's view.
  changed_by?: string;
  changed_by_profile?: { name: string | null; phone_number: string | null };
  created_at: string;
}
