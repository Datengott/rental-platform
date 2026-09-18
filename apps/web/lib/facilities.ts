// Fixed suggested tag sets for the facilities chip-pickers — the API itself
// accepts any freeform string (see CreatePropertyDto/CreateUnitDto), this is
// just a curated starting set so landlords aren't typing free text for the
// common cases raised in demo feedback.

export const PROPERTY_FACILITIES: { value: string; label: string }[] = [
  { value: "gated", label: "Gated compound" },
  { value: "generator", label: "Backup generator" },
  { value: "borehole", label: "Private water source" },
  { value: "security_personnel", label: "Security personnel" },
];

export const UNIT_FACILITIES: { value: string; label: string }[] = [
  { value: "ac", label: "Air conditioning" },
  { value: "wifi", label: "Wi-Fi" },
  { value: "hot_water", label: "Hot water" },
  { value: "furnished", label: "Furnished" },
];

export const PROPERTY_TYPE_LABELS: Record<string, string> = {
  residential: "Residential",
  commercial: "Commercial",
  mixed_use: "Mixed use",
};

export function facilityLabel(value: string): string {
  return (
    PROPERTY_FACILITIES.find((f) => f.value === value)?.label ??
    UNIT_FACILITIES.find((f) => f.value === value)?.label ??
    value.replace(/_/g, " ")
  );
}
