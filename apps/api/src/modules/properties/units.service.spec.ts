import { NotFoundException } from '@nestjs/common';
import { UnitsService } from './units.service';

function buildPrismaMock() {
  return {
    unit: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), count: jest.fn() },
    unitPhoto: { count: jest.fn(), create: jest.fn() },
  };
}

describe('UnitsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let events: { emit: jest.Mock };
  let objectStorage: { upload: jest.Mock };
  let service: UnitsService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    events = { emit: jest.fn() };
    objectStorage = { upload: jest.fn().mockResolvedValue('local://unit-photos/x.jpg') };
    service = new UnitsService(prisma as never, events as never, objectStorage);
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

  describe('updateUnit', () => {
    it('rejects a status transition that is not in the allowed manual set', async () => {
      prisma.unit.findUnique.mockResolvedValue({
        id: 'unit-1',
        status: 'vacant',
        property: { landlordId: 'user-1' },
      });

      await expect(
        service.updateUnit('user-1', 'unit-1', { status: 'occupied' }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_STATUS_TRANSITION' } });
      expect(prisma.unit.update).not.toHaveBeenCalled();
    });

    it('allows vacant -> reserved and emits unit.status_changed', async () => {
      prisma.unit.findUnique.mockResolvedValue({
        id: 'unit-1',
        status: 'vacant',
        property: { landlordId: 'user-1' },
      });
      prisma.unit.update.mockResolvedValue({
        id: 'unit-1',
        label: null,
        bedrooms: null,
        bathrooms: null,
        sizeSqm: null,
        rentAmount: '100000',
        currency: 'XAF',
        billingCycle: 'monthly',
        status: 'reserved',
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        property: { id: 'prop-1', name: null, city: 'Douala' },
      });

      const result = await service.updateUnit('user-1', 'unit-1', { status: 'reserved' });

      expect(events.emit).toHaveBeenCalledWith(
        'unit.status_changed',
        expect.objectContaining({ previousStatus: 'vacant', newStatus: 'reserved' }),
      );
      expect(result.status).toBe('reserved');
    });
  });
});
