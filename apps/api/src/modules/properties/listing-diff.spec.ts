import { applyEdits, normalize } from './listing-diff';

describe('applyEdits', () => {
  it('ignores fields that were not sent, and fields that did not change', () => {
    const { data, changes } = applyEdits([
      { field: 'label', key: 'label', current: 'A', next: undefined },
      { field: 'city', key: 'city', current: 'Douala', next: 'Douala' },
    ]);
    expect(data).toEqual({});
    expect(changes).toEqual([]);
  });

  it('records from/to for real changes, and null clears a value', () => {
    const { data, changes } = applyEdits([
      { field: 'region', key: 'region', current: 'Littoral', next: null },
      { field: 'city', key: 'city', current: 'Douala', next: 'Yaoundé' },
    ]);
    expect(data).toEqual({ region: null, city: 'Yaoundé' });
    expect(changes).toEqual([
      { field: 'region', from: 'Littoral', to: null },
      { field: 'city', from: 'Douala', to: 'Yaoundé' },
    ]);
  });

  it('compares Prisma-style Decimal objects by numeric value', () => {
    const decimal = { toString: () => '150000' };
    expect(applyEdits([{ field: 'rent_amount', key: 'rentAmount', current: decimal, next: 150000 }]).changes).toEqual([]);
    expect(applyEdits([{ field: 'rent_amount', key: 'rentAmount', current: decimal, next: 160000 }]).changes).toEqual([
      { field: 'rent_amount', from: 150000, to: 160000 },
    ]);
  });

  it('treats tag lists as sets when unordered', () => {
    const same = applyEdits([
      { field: 'facilities', key: 'facilities', current: ['ac', 'wifi'], next: ['wifi', 'ac'], unordered: true },
    ]);
    expect(same.changes).toEqual([]);
    const added = applyEdits([
      { field: 'facilities', key: 'facilities', current: ['ac'], next: ['ac', 'wifi'], unordered: true },
    ]);
    expect(added.changes).toEqual([{ field: 'facilities', from: ['ac'], to: ['ac', 'wifi'] }]);
  });

  it('normalizes undefined/null and dates', () => {
    expect(normalize(undefined)).toBeNull();
    expect(normalize(new Date('2026-09-20T00:00:00Z'))).toBe('2026-09-20T00:00:00.000Z');
  });
});
