// Presentation helpers shared by the listing pages.

// XAF has no minor unit, so whole numbers only. fr-FR gives the
// space-separated thousands people in Cameroon actually write ("150 000").
const xaf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

export function formatMoney(amount: string | number): string {
  // fr-FR uses a narrow no-break space as the group separator; swap it for a
  // plain no-break space so it renders the same in every font.
  return xaf.format(Number(amount)).replace(/[  ]/g, " ");
}

const CYCLE_LABEL: Record<string, string> = { monthly: "month", quarterly: "quarter", biannual: "6 months" };

export function cycleLabel(cycle: string): string {
  return CYCLE_LABEL[cycle] ?? cycle;
}

// Accent- and case-insensitive comparison key, so "yaounde" finds "Yaoundé".
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function initials(nameOrPhone: string): string {
  const cleaned = nameOrPhone.replace(/[^\p{L}\p{N} ]/gu, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return cleaned.slice(-2).toUpperCase() || "?";
}
