import { NotFoundException } from '@nestjs/common';
import { PropertiesService } from './properties.service';

const dec = (value: string) => ({ toString: () => value });

function buildPrismaMock() {
  return {
    property: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    unit: { create: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

describe('PropertiesService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let usersService: { ensureRole: jest.Mock };
  let listingChanges: { buildRecord: jest.Mock };
  // The audit record the service handed to the change log (first call).
  function recordedChange<T>(): T {
    return (listingChanges.buildRecord.mock.calls[0] as [T])[0];
  }
  let service: PropertiesService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    usersService = { ensureRole: jest.fn().mockResolvedValue(undefined) };
    listingChanges = { buildRecord: jest.fn().mockResolvedValue({}) };
    service = new PropertiesService(prisma as never, usersService as never, listingChanges as never);
  });

  describe('createProperty', () => {
    it('grants the landlord role and creates the property', async () => {
      prisma.property.create.mockResolvedValue({
        id: 'prop-1',
        landlordId: 'user-1',
        name: 'Résidence Bonapriso',
        addressLine: '12 Rue de la Paix',
        city: 'Douala',
        region: 'Littoral',
        latitude: '4.05',
        longitude: '9.7',
        ownershipVerifiedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.createProperty('user-1', {
        name: 'Résidence Bonapriso',
        address_line: '12 Rue de la Paix',
        city: 'Douala',
        region: 'Littoral',
      });

      expect(usersService.ensureRole).toHaveBeenCalledWith('user-1', 'landlord');
      expect(result).toMatchObject({ id: 'prop-1', landlord_id: 'user-1', ownership_verified_at: null });
    });
  });

  describe('updateProperty', () => {
    const propertyRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'prop-1',
      landlordId: 'user-1',
      name: 'Résidence Bonapriso',
      propertyType: 'residential',
      facilities: ['gated'],
      addressLine: '12 Rue de la Paix',
      city: 'Douala',
      region: 'Littoral',
      latitude: dec('4.05'),
      longitude: dec('9.7'),
      ownershipVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });

    it('records the changed fields, and which units had a tenant living in them at the time', async () => {
      prisma.property.findUnique.mockResolvedValue(propertyRow({ ownershipVerifiedAt: new Date() }));
      prisma.unit.findMany.mockResolvedValue([{ id: 'unit-9' }]);
      prisma.property.update.mockResolvedValue(propertyRow({ addressLine: '99 New Street' }));

      await service.updateProperty('user-1', 'prop-1', {
        address_line: '99 New Street',
        city: 'Douala', // unchanged
        change_note: 'Moved the gate',
      });

      const record = recordedChange<{
        entityType: string;
        changes: { field: string; from: unknown; to: unknown }[];
        occupiedUnitIds: string[];
        propertyVerifiedAtChange: boolean;
        note: string;
      }>();
      expect(record.entityType).toBe('property');
      expect(record.changes).toEqual([{ field: 'address_line', from: '12 Rue de la Paix', to: '99 New Street' }]);
      expect(record.occupiedUnitIds).toEqual(['unit-9']);
      expect(record.propertyVerifiedAtChange).toBe(true);
      expect(record.note).toBe('Moved the gate');
      expect(prisma.unit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { propertyId: 'prop-1', status: { in: ['occupied', 'notice_given'] } } }),
      );
    });

    it('does nothing when nothing changed', async () => {
      prisma.property.findUnique.mockResolvedValue(propertyRow());

      await service.updateProperty('user-1', 'prop-1', { name: 'Résidence Bonapriso', latitude: 4.05 });

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(listingChanges.buildRecord).not.toHaveBeenCalled();
    });

    it("404s for someone else's property, changing and recording nothing", async () => {
      prisma.property.findUnique.mockResolvedValue(propertyRow({ landlordId: 'someone-else' }));

      await expect(service.updateProperty('user-1', 'prop-1', { city: 'Yaoundé' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(listingChanges.buildRecord).not.toHaveBeenCalled();
    });
  });

  describe('createUnit', () => {
    it('rejects when the property belongs to a different landlord', async () => {
      prisma.property.findUnique.mockResolvedValue({ id: 'prop-1', landlordId: 'someone-else' });

      await expect(
        service.createUnit('user-1', 'prop-1', { rent_amount: 100000 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.unit.create).not.toHaveBeenCalled();
    });

    it('rejects when the property does not exist', async () => {
      prisma.property.findUnique.mockResolvedValue(null);

      await expect(
        service.createUnit('user-1', 'missing-prop', { rent_amount: 100000 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates `quantity` independent units and returns them under `units`, auto-numbering the label', async () => {
      prisma.property.findUnique.mockResolvedValue({ id: 'prop-1', landlordId: 'user-1', name: null, city: 'Douala' });
      let nextId = 1;
      prisma.unit.create.mockImplementation(({ data }: { data: { label?: string } }) =>
        Promise.resolve({ id: `unit-${nextId++}`, ...data, status: 'draft' }),
      );

      const result = await service.createUnit('user-1', 'prop-1', {
        label: 'Studio',
        rent_amount: 100000,
        quantity: 3,
      });

      expect(prisma.unit.create).toHaveBeenCalledTimes(3);
      const units = (result as { units: { label: string | null }[] }).units;
      expect(units).toHaveLength(3);
      expect(units.map((u) => u.label)).toEqual(['Studio #1', 'Studio #2', 'Studio #3']);
    });

    it('keeps the single-object response shape when quantity is 1 or omitted', async () => {
      prisma.property.findUnique.mockResolvedValue({ id: 'prop-1', landlordId: 'user-1', name: null, city: 'Douala' });
      prisma.unit.create.mockResolvedValue({ id: 'unit-1', label: null, status: 'draft' });

      const result = await service.createUnit('user-1', 'prop-1', { rent_amount: 100000 });

      expect(prisma.unit.create).toHaveBeenCalledTimes(1);
      expect(result).not.toHaveProperty('units');
      expect(result.id).toBe('unit-1');
    });
  });
});
