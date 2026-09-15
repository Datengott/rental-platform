import { NotFoundException } from '@nestjs/common';
import { VisitsService } from './visits.service';

function buildPrismaMock() {
  return {
    visitRequest: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  };
}

describe('VisitsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let units: { getUnitOwnership: jest.Mock };
  let events: { emit: jest.Mock };
  let service: VisitsService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    units = { getUnitOwnership: jest.fn() };
    events = { emit: jest.fn() };
    service = new VisitsService(prisma as never, units as never, events as never);
  });

  describe('createVisitRequest', () => {
    it('denormalizes the landlord id from the unit and emits visit_request.created', async () => {
      units.getUnitOwnership.mockResolvedValue({ id: 'unit-1', propertyId: 'prop-1', landlordId: 'landlord-1' });
      prisma.visitRequest.create.mockResolvedValue({
        id: 'vr-1',
        unitId: 'unit-1',
        tenantId: 'tenant-1',
        landlordId: 'landlord-1',
        requestedSlots: [{ start: '2026-09-20T10:00:00Z' }],
        status: 'pending',
        confirmedSlot: null,
        landlordNote: null,
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.createVisitRequest('tenant-1', 'unit-1', {
        requested_slots: [{ start: '2026-09-20T10:00:00Z' }],
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const createCall = prisma.visitRequest.create.mock.calls[0][0] as { data: { landlordId: string } };
      expect(createCall.data.landlordId).toBe('landlord-1');
      expect(events.emit).toHaveBeenCalledWith(
        'visit_request.created',
        expect.objectContaining({ unitId: 'unit-1', landlordId: 'landlord-1' }),
      );
      expect(result.status).toBe('pending');
    });
  });

  describe('respond', () => {
    it('rejects when the request belongs to a different landlord', async () => {
      prisma.visitRequest.findUnique.mockResolvedValue({ id: 'vr-1', landlordId: 'someone-else' });

      await expect(service.respond('landlord-1', 'vr-1', { action: 'decline' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('lazily expires a stale pending request and rejects the response', async () => {
      prisma.visitRequest.findUnique.mockResolvedValue({
        id: 'vr-1',
        landlordId: 'landlord-1',
        status: 'pending',
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.respond('landlord-1', 'vr-1', { action: 'decline' }),
      ).rejects.toMatchObject({ response: { code: 'VISIT_REQUEST_NOT_RESPONDABLE' } });

      expect(prisma.visitRequest.update).toHaveBeenCalledWith({
        where: { id: 'vr-1' },
        data: { status: 'expired' },
      });
    });

    it('rejects responding to a request that is already decided', async () => {
      prisma.visitRequest.findUnique.mockResolvedValue({
        id: 'vr-1',
        landlordId: 'landlord-1',
        status: 'accepted',
        expiresAt: new Date(Date.now() + 100000),
      });

      await expect(
        service.respond('landlord-1', 'vr-1', { action: 'decline' }),
      ).rejects.toMatchObject({ response: { code: 'VISIT_REQUEST_NOT_RESPONDABLE' } });
    });

    it('accepts and stores the confirmed slot', async () => {
      prisma.visitRequest.findUnique.mockResolvedValue({
        id: 'vr-1',
        landlordId: 'landlord-1',
        status: 'pending',
        expiresAt: new Date(Date.now() + 100000),
      });
      prisma.visitRequest.update.mockResolvedValue({
        id: 'vr-1',
        unitId: 'unit-1',
        tenantId: 'tenant-1',
        landlordId: 'landlord-1',
        requestedSlots: [],
        status: 'accepted',
        confirmedSlot: new Date('2026-09-20T10:00:00Z'),
        landlordNote: null,
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.respond('landlord-1', 'vr-1', {
        action: 'accept',
        confirmed_slot: '2026-09-20T10:00:00Z',
      });

      expect(result.status).toBe('accepted');
      expect(events.emit).toHaveBeenCalledWith(
        'visit_request.responded',
        expect.objectContaining({ action: 'accept', status: 'accepted' }),
      );
    });
  });
});
