import { addDays, describeCoveredMonths, formatLongDate, monthsCovered } from './period';

describe('period helpers', () => {
  it('counts the calendar months a period touches, inclusive', () => {
    expect(monthsCovered('2026-09-01', '2026-09-30')).toBe(1);
    expect(monthsCovered('2026-09-20', '2026-11-30')).toBe(3);
    expect(monthsCovered('2026-11-05', '2027-01-31')).toBe(3);
  });

  it('adds days across month and year boundaries (UTC, no timezone drift)', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('describes covered months in English and French, collapsing a shared year', () => {
    expect(describeCoveredMonths('2026-09-01', '2026-09-30', 'en')).toEqual({ label: 'September 2026', count: 1 });
    expect(describeCoveredMonths('2026-09-20', '2026-11-30', 'en')).toEqual({ label: 'September – November 2026', count: 3 });
    expect(describeCoveredMonths('2026-11-05', '2027-01-31', 'en')).toEqual({
      label: 'November 2026 – January 2027',
      count: 3,
    });
    expect(describeCoveredMonths('2026-09-20', '2026-11-30', 'fr').label).toBe('septembre – novembre 2026');
  });

  it('formats a long date per locale', () => {
    expect(formatLongDate('2026-09-20', 'en')).toBe('20 September 2026');
    expect(formatLongDate('2026-09-20', 'fr')).toBe('20 septembre 2026');
  });
});
