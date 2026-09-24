// Date helpers for rent periods. Dates travel as YYYY-MM-DD strings and are
// handled in UTC (a rent period is a calendar concept; the browser's timezone
// must never shift "2026-09-01" to Aug 31). Mirrors the server's
// common/format/period.ts, which words the same things in notifications and
// receipts.

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" });
const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function parse(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

// Today in the user's own timezone, as YYYY-MM-DD (what a date input expects).
export function todayIso(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// "20 Sep 2026"
export function formatDate(iso: string): string {
  return DAY.format(parse(iso));
}

// A timestamp (e.g. when a payment was made) as a local date: "20 Sep 2026".
export function formatTimestampDate(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function monthsCovered(start: string, end: string): number {
  const s = parse(start);
  const e = parse(end);
  return (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth()) + 1;
}

// "September 2026", "September – November 2026", "November 2026 – January 2027"
export function describeCoveredMonths(start: string, end: string): { label: string; count: number } {
  const count = Math.max(monthsCovered(start, end), 1);
  const s = parse(start);
  const e = parse(end);
  if (count === 1) return { label: MONTH_YEAR.format(s), count };
  const sameYear = s.getUTCFullYear() === e.getUTCFullYear();
  return { label: `${sameYear ? MONTH.format(s) : MONTH_YEAR.format(s)} – ${MONTH_YEAR.format(e)}`, count };
}

// Where a due date sits relative to today, for a small status badge.
export function dueStatus(dueDate: string, today: string): "overdue" | "today" | "upcoming" {
  if (dueDate < today) return "overdue";
  return dueDate === today ? "today" : "upcoming";
}

// Last day of the Nth calendar month from a start date (the server's period
// convention) — used only for on-screen previews; the server computes the real thing.
export function endOfNthMonth(startDate: string, months: number): string {
  const s = parse(startDate);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + months, 0)).toISOString().slice(0, 10);
}
