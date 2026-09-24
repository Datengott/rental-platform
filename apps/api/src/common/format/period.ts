// Human-readable descriptions of a rent period, shared by everything that
// "says rent is paid" (the notification, the receipt, the ledger API) so they
// all describe a payment the same way: when it was made, which month(s) it
// covers, and when the next payment is expected.
//
// Dates travel as YYYY-MM-DD strings and are handled in UTC throughout — a
// rent period is a calendar concept, and letting the server's timezone shift
// "2026-09-01" to Aug 31 would be a nasty bug.
//
// Month counting follows the Payments module's own calendar-month convention
// (PaymentsService.expectedAmountFor): a period is priced by the number of
// calendar months it touches, so a period starting mid-month still counts
// that month in full.

export type PeriodLocale = 'fr' | 'en';

const INTL_LOCALE: Record<PeriodLocale, string> = { fr: 'fr-FR', en: 'en-GB' };

function parseDate(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

export function addDays(iso: string, days: number): string {
  const d = parseDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Inclusive count of calendar months a period touches.
export function monthsCovered(periodStart: string, periodEnd: string): number {
  const s = parseDate(periodStart);
  const e = parseDate(periodEnd);
  return (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth()) + 1;
}

export function formatLongDate(iso: string, locale: PeriodLocale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parseDate(iso));
}

// "September 2026", "September – November 2026", "November 2026 – February 2027"
export function describeCoveredMonths(
  periodStart: string,
  periodEnd: string,
  locale: PeriodLocale,
): { label: string; count: number } {
  const count = monthsCovered(periodStart, periodEnd);
  const start = parseDate(periodStart);
  const end = parseDate(periodEnd);
  const fmt = (d: Date, withYear: boolean) =>
    new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      month: 'long',
      ...(withYear ? { year: 'numeric' as const } : {}),
      timeZone: 'UTC',
    }).format(d);

  if (count <= 1) return { label: fmt(start, true), count: Math.max(count, 1) };
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  return { label: `${fmt(start, !sameYear)} – ${fmt(end, true)}`, count };
}
