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
  created_at: string;
}

export interface Unit {
  id: string;
  label: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  facilities: string[];
  rent_amount: string;
  currency: string;
  status: string;
  property: { id: string; name: string | null; city: string };
}

export interface PublicUnit {
  id: string;
  label: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  facilities: string[];
  rent_amount: string;
  currency: string;
  property: { city: string; verified: boolean; property_type: PropertyType | null; facilities: string[] };
  cover_photo_url: string | null;
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
