import { NotFoundException } from '@nestjs/common';
import { UnitsService } from './units.service';

// Prisma returns Decimal objects (not plain numbers/strings) for NUMERIC columns.
const dec = (value: string) => ({ toString: () => value });

function buildPrismaMock() {
  return {
    unit: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), count: jest.fn() },
    unitPhoto: {
      count: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
    // Edits and their audit row commit together — the mock just resolves the
    // operations it is handed, in order.
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

describe('UnitsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let events: { emit: jest.Mock };
  let objectStorage: { upload: jest.Mock };
  let listingChanges: { buildRecord: jest.Mock };
  // The audit record the service handed to the change log (first call).
  function recordedChange<T>(): T {
    return (listingChanges.buildRecord.mock.calls[0] as [T])[0];
  }
  let service: UnitsService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    events = { emit: jest.fn() };
    objectStorage = { upload: jest.fn().mockResolvedValue('local://unit-photos/x.jpg') };
    listingChanges = { buildRecord: jest.fn().mockResolvedValue({}) };
    service = new UnitsService(
      prisma as never,
      events as never,
      objectStorage,
      { get: jest.fn((key: string) => (key === 'API_PUBLIC_URL' ? 'http://media.test' : undefined)) } as never,
      listingChanges as never,
    );
  });

  describe('uploadPhoto', () => {
    it('transitions draft to vacant and emits unit.listed on the first photo', async () => {
      prisma.unit.findUnique.mockResolvedValue({
        id: 'unit-1',
        propertyId: 'prop-1',
        status: 'draft',
        property: { landlordId: 'user-1' },
      });
      prisma.unitPhoto.count.mockResolvedValue(0);
      prisma.unitPhoto.create.mockResolvedValue({
        id: 'photo-1',
        unitId: 'unit-1',
        storageUrl: 'local://unit-photos/x.jpg',
        sortOrder: 0,
        uploadedAt: new Date(),
      });

      const file = { buffer: Buffer.from('x'), originalname: 'x.jpg' } as Express.Multer.File;
      const result = await service.uploadPhoto('user-1', 'unit-1', {}, file);

      expect(prisma.unit.update).toHaveBeenCalledWith({
        where: { id: 'unit-1' },
        data: { status: 'vacant' },
      });
      expect(events.emit).toHaveBeenCalledWith('unit.listed', expect.objectContaining({ unitId: 'unit-1' }));
      expect(result).not.toHaveProperty('geo_latitude');
    });

    it('does not re-transition status on a second photo', async () => {
      prisma.unit.findUnique.mockResolvedValue({
        id: 'unit-1',
        propertyId: 'prop-1',
        status: 'vacant',
        property: { landlordId: 'user-1' },
      });
      prisma.unitPhoto.count.mockResolvedValue(1);
      prisma.unitPhoto.create.mockResolvedValue({
        id: 'photo-2',
        unitId: 'unit-1',
        storageUrl: 'local://unit-photos/y.jpg',
        sortOrder: 1,
        uploadedAt: new Date(),
      });

      const file = { buffer: Buffer.from('y'), originalname: 'y.jpg' } as Express.Multer.File;
      await service.uploadPhoto('user-1', 'unit-1', {}, file);

      expect(prisma.unit.update).not.toHaveBeenCalled();
      expect(events.emit).not.toHaveBeenCalledWith('unit.listed', expect.anything());
    });

    it('rejects when the unit belongs to a different landlord', async () => {
      prisma.unit.findUnique.mockResolvedValue({
        id: 'unit-1',
        status: 'draft',
        property: { landlordId: 'someone-else' },
      });

      const file = { buffer: Buffer.from('x'), originalname: 'x.jpg' } as Express.Multer.File;
      await expect(service.uploadPhoto('user-1', 'unit-1', {}, file)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  function unitRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'unit-1',
      propertyId: 'prop-1',
      label: 'Studio A',
      bedrooms: 1,
      bathrooms: 1,
      facilities: ['ac', 'wifi'],
      sizeSqm: dec('32'),
      rentAmount: dec('100000'),
      currency: 'XAF',
      billingCycle: 'monthly',
      status: 'vacant',
      description: 'Nice',
      createdAt: new Date(),
      updatedAt: new Date(),
      property: { id: 'prop-1', name: 'Res', city: 'Douala', landlordId: 'user-1', ownershipVerifiedAt: null },
      ...overrides,
    };
  }

  describe('updateUnit', () => {
    it('rejects a status transition that is not in the allowed manual set', async () => {
      prisma.unit.findUnique.mockResolvedValue(unitRow());

      await expect(
        service.updateUnit('user-1', 'unit-1', { status: 'occupied' }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_STATUS_TRANSITION' } });
      expect(prisma.unit.update).not.toHaveBeenCalled();
    });

    it('allows vacant -> reserved, records it, and emits unit.status_changed', async () => {
      prisma.unit.findUnique.mockResolvedValue(unitRow());
      prisma.unit.update.mockResolvedValue(unitRow({ status: 'reserved' }));

      const result = await service.updateUnit('user-1', 'unit-1', { status: 'reserved' });

      expect(events.emit).toHaveBeenCalledWith(
        'unit.status_changed',
        expect.objectContaining({ previousStatus: 'vacant', newStatus: 'reserved' }),
      );
      expect(result.status).toBe('reserved');
      expect(listingChanges.buildRecord).toHaveBeenCalledTimes(1);
    });

    it('records only the fields that changed, with before and after, and the optional reason', async () => {
      prisma.unit.findUnique.mockResolvedValue(unitRow());
      prisma.unit.update.mockResolvedValue(unitRow({ rentAmount: '120000', bedrooms: 2 }));

      await service.updateUnit('user-1', 'unit-1', {
        rent_amount: 120000,
        bedrooms: 2,
        label: 'Studio A', // unchanged — must not appear in the record
        facilities: ['wifi', 'ac'], // same set, different order — not a change
        change_note: 'Annual review',
      });

      const record = recordedChange<{
        changes: { field: string; from: unknown; to: unknown }[];
        note: string;
        occupiedUnitIds: string[];
        changedBy: string;
      }>();
      expect(record.changes).toEqual([
        { field: 'bedrooms', from: 1, to: 2 },
        { field: 'rent_amount', from: 100000, to: 120000 },
      ]);
      expect(record.note).toBe('Annual review');
      expect(record.changedBy).toBe('user-1');
      expect(record.occupiedUnitIds).toEqual([]); // nobody lives there
    });

    it('flags a change made while a tenant is living in the unit (occupied, or under notice)', async () => {
      for (const status of ['occupied', 'notice_given']) {
        listingChanges.buildRecord.mockClear();
        prisma.unit.findUnique.mockResolvedValue(unitRow({ status }));
        prisma.unit.update.mockResolvedValue(unitRow({ status, rentAmount: '150000' }));

        await service.updateUnit('user-1', 'unit-1', { rent_amount: 150000 });

        const record = (listingChanges.buildRecord.mock.calls[0] as [{ occupiedUnitIds: string[] }])[0];
        expect(record.occupiedUnitIds).toEqual(['unit-1']);
      }
    });

    it('records whether the property was verified at the time', async () => {
      prisma.unit.findUnique.mockResolvedValue(
        unitRow({ property: { id: 'prop-1', name: 'Res', city: 'Douala', landlordId: 'user-1', ownershipVerifiedAt: new Date() } }),
      );
      prisma.unit.update.mockResolvedValue(unitRow());

      await service.updateUnit('user-1', 'unit-1', { description: 'Changed' });

      const record = (listingChanges.buildRecord.mock.calls[0] as [{ propertyVerifiedAtChange: boolean }])[0];
      expect(record.propertyVerifiedAtChange).toBe(true);
    });

    it('does nothing (no write, no audit row) when the save changes nothing', async () => {
      prisma.unit.findUnique.mockResolvedValue(unitRow());

      const result = await service.updateUnit('user-1', 'unit-1', { rent_amount: 100000, description: 'Nice' });

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(listingChanges.buildRecord).not.toHaveBeenCalled();
      expect(result.id).toBe('unit-1');
    });

    it('lets a nullable field be cleared with null or an empty string', async () => {
      prisma.unit.findUnique.mockResolvedValue(unitRow());
      prisma.unit.update.mockResolvedValue(unitRow({ description: null }));

      await service.updateUnit('user-1', 'unit-1', { description: '' });

      const record = recordedChange<{ changes: { field: string; to: unknown }[] }>();
      expect(record.changes).toEqual([{ field: 'description', from: 'Nice', to: null }]);
    });

    it("404s for a unit that belongs to someone else, changing and recording nothing", async () => {
      prisma.unit.findUnique.mockResolvedValue(
        unitRow({ property: { id: 'prop-1', landlordId: 'someone-else', ownershipVerifiedAt: null } }),
      );

      await expect(service.updateUnit('user-1', 'unit-1', { rent_amount: 1 })).rejects.toBeInstanceOf(NotFoundException);
      expect(listingChanges.buildRecord).not.toHaveBeenCalled();
    });
  });

  describe('photos', () => {
    const photo = (id: string, sortOrder: number) => ({ id, unitId: 'unit-1', storageUrl: `local://unit-photos/${id}.jpg`, sortOrder });

    it('removing a photo records it (keeping its reference) and re-sequences the rest', async () => {
      prisma.unit.findUnique.mockResolvedValue(unitRow({ status: 'occupied' }));
      prisma.unitPhoto.findMany.mockResolvedValue([photo('a', 0), photo('b', 1), photo('c', 2)]);

      const result = await service.deletePhoto('user-1', 'unit-1', 'b');

      expect(prisma.unitPhoto.delete).toHaveBeenCalledWith({ where: { id: 'b' } });
      expect(prisma.unitPhoto.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { sortOrder: 0 } });
      expect(prisma.unitPhoto.update).toHaveBeenCalledWith({ where: { id: 'c' }, data: { sortOrder: 1 } });
      const record = recordedChange<{
        action: string;
        changes: { from: unknown }[];
        occupiedUnitIds: string[];
      }>();
      expect(record.action).toBe('photo_removed');
      expect(record.changes[0].from).toBe('local://unit-photos/b.jpg');
      expect(record.occupiedUnitIds).toEqual(['unit-1']);
      expect(result.photos.map((p) => p.id)).toEqual(['a', 'c']);
    });

    it('removing the last photo of a vacant unit sends it back to draft (unlisted)', async () => {
      prisma.unit.findUnique.mockResolvedValue(unitRow({ status: 'vacant' }));
      prisma.unitPhoto.findMany.mockResolvedValue([photo('a', 0)]);

      const result = await service.deletePhoto('user-1', 'unit-1', 'a');

      expect(prisma.unit.update).toHaveBeenCalledWith({ where: { id: 'unit-1' }, data: { status: 'draft' } });
      expect(result.unit_status).toBe('draft');
    });

    it('removing the last photo of an OCCUPIED unit leaves it occupied', async () => {
      prisma.unit.findUnique.mockResolvedValue(unitRow({ status: 'occupied' }));
      prisma.unitPhoto.findMany.mockResolvedValue([photo('a', 0)]);

      const result = await service.deletePhoto('user-1', 'unit-1', 'a');

      expect(prisma.unit.update).not.toHaveBeenCalled();
      expect(result.unit_status).toBe('occupied');
    });

    it('404s for a photo that is not on this unit', async () => {
      prisma.unit.findUnique.mockResolvedValue(unitRow());
      prisma.unitPhoto.findMany.mockResolvedValue([photo('a', 0)]);

      await expect(service.deletePhoto('user-1', 'unit-1', 'zzz')).rejects.toBeInstanceOf(NotFoundException);
      expect(listingChanges.buildRecord).not.toHaveBeenCalled();
    });

    it('making a photo the cover reorders and records it; the current cover is a no-op', async () => {
      prisma.unit.findUnique.mockResolvedValue(unitRow());
      prisma.unitPhoto.findMany.mockResolvedValue([photo('a', 0), photo('b', 1)]);

      const result = await service.setCoverPhoto('user-1', 'unit-1', 'b');
      expect(result.photos.map((p) => p.id)).toEqual(['b', 'a']);
      const record = (listingChanges.buildRecord.mock.calls[0] as [{ action: string }])[0];
      expect(record.action).toBe('cover_photo_changed');

      listingChanges.buildRecord.mockClear();
      await service.setCoverPhoto('user-1', 'unit-1', 'a');
      expect(listingChanges.buildRecord).not.toHaveBeenCalled();
    });
  });
});
