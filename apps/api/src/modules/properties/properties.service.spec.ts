import { NotFoundException } from '@nestjs/common';
import { PropertiesService } from './properties.service';

function buildPrismaMock() {
  return {
    property: { create: jest.fn(), findUnique: jest.fn() },
    unit: { create: jest.fn() },
  };
}

describe('PropertiesService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let usersService: { ensureRole: jest.Mock };
  let service: PropertiesService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    usersService = { ensureRole: jest.fn().mockResolvedValue(undefined) };
    service = new PropertiesService(prisma as never, usersService as never);
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
  });
});
