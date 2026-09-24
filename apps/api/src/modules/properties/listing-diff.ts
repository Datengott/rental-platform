// Field-by-field diff for listing edits: only what actually changed is applied
// and recorded, so re-saving a form unchanged creates no audit noise, and a
// recorded change is exactly what someone would want to know.

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface FieldEdit {
  // Name in the API (snake_case) — what shows in the change history.
  field: string;
  // Column name on the Prisma model.
  key: string;
  current: unknown;
  // undefined = "not sent, leave alone"; null = "clear it".
  next: unknown;
  // Compare arrays as sets (facility tags' order isn't meaningful).
  unordered?: boolean;
}

// Prisma Decimals and Dates come back as objects; reduce everything to plain
// JSON-comparable values.
export function normalize(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    const asString = (value as { toString(): string }).toString();
    const n = Number(asString);
    // Decimal.js-style objects stringify to a number.
    return Number.isNaN(n) ? asString : n;
  }
  return value;
}

function sameValue(a: unknown, b: unknown, unordered: boolean): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (unordered && Array.isArray(na) && Array.isArray(nb)) {
    return JSON.stringify([...(na as unknown[])].sort()) === JSON.stringify([...(nb as unknown[])].sort());
  }
  return JSON.stringify(na) === JSON.stringify(nb);
}

// Returns the Prisma `data` to write and the change list to log — both empty
// when nothing changed.
export function applyEdits(edits: FieldEdit[]): { data: Record<string, unknown>; changes: FieldChange[] } {
  const data: Record<string, unknown> = {};
  const changes: FieldChange[] = [];
  for (const edit of edits) {
    if (edit.next === undefined) continue;
    if (sameValue(edit.current, edit.next, edit.unordered ?? false)) continue;
    data[edit.key] = edit.next;
    changes.push({ field: edit.field, from: normalize(edit.current), to: normalize(edit.next) });
  }
  return { data, changes };
}
