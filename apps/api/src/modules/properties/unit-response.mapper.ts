// Shared by PropertiesService (create) and UnitsService (read/update) so
// every endpoint returns the same snake_case shape — api-specification.md
// doesn't show a full unit object, but the contract convention (snake_case,
// matching field names) is consistent across every other endpoint.
export interface UnitWithPropertySummary {
  id: string;
  label: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  facilities: string[];
  sizeSqm: unknown;
  rentAmount: unknown;
  currency: string;
  billingCycle: string;
  status: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  property: { id: string; name: string | null; city: string };
}

export function toUnitResponse(unit: UnitWithPropertySummary) {
  return {
    id: unit.id,
    property: { id: unit.property.id, name: unit.property.name, city: unit.property.city },
    label: unit.label,
    bedrooms: unit.bedrooms,
    bathrooms: unit.bathrooms,
    facilities: unit.facilities,
    size_sqm: unit.sizeSqm,
    rent_amount: unit.rentAmount,
    currency: unit.currency,
    billing_cycle: unit.billingCycle,
    status: unit.status,
    description: unit.description,
    created_at: unit.createdAt,
    updated_at: unit.updatedAt,
  };
}
