import { AdminService } from './admin.service';

function buildPrismaMock() {
  return {
    adminActionLog: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn() },
  };
}

describe('AdminService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let usersService: { listPendingKyc: jest.Mock; getPublicProfile: jest.Mock };
  let unitsService: {
    listFlaggedUnits: jest.Mock;
    flagUnit: jest.Mock;
    unflagUnit: jest.Mock;
    removeUnit: jest.Mock;
  };
  let paymentsService: { listDisputes: jest.Mock };
  let service: AdminService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    usersService = {
      listPendingKyc: jest.fn().mockResolvedValue([]),
      getPublicProfile: jest.fn().mockResolvedValue({ id: 'x', fullName: 'Admin One', phoneNumber: '+237600000001', locale: 'fr' }),
    };
    unitsService = {
      listFlaggedUnits: jest.fn().mockResolvedValue([]),
      flagUnit: jest.fn(),
      unflagUnit: jest.fn(),
      removeUnit: jest.fn(),
    };
    paymentsService = { listDisputes: jest.fn().mockResolvedValue([]) };
    service = new AdminService(prisma as never, usersService as never, unitsService as never, paymentsService as never);
  });

  describe('record', () => {
    it('writes one row to admin_actions_log', async () => {
      await service.record({ adminId: 'admin-1', actionType: 'listing_flagged', targetType: 'unit', targetId: 'unit-1', detail: { reason: 'x' } });

      expect(prisma.adminActionLog.create).toHaveBeenCalledWith({
        data: { adminId: 'admin-1', actionType: 'listing_flagged', targetType: 'unit', targetId: 'unit-1', detail: { reason: 'x' } },
      });
    });
  });

  describe('listKycQueue', () => {
    it('maps pending submissions to the response shape', async () => {
      usersService.listPendingKyc.mockResolvedValue([
        {
          id: 'user-1',
          fullName: 'Jean',
          phoneNumber: '+237600000010',
          locale: 'fr',
          idDocumentType: 'national_id',
          idDocumentRef: 'ID-1',
          idDocumentUrl: 'local://x.jpg',
          submittedAt: new Date('2026-09-20'),
        },
      ]);

      const result = await service.listKycQueue();

      expect(result.results).toEqual([
        expect.objectContaining({ id: 'user-1', full_name: 'Jean', phone_number: '+237600000010' }),
      ]);
    });
  });

  describe('listing moderation', () => {
    it('flagListing flags the unit and logs the action', async () => {
      unitsService.flagUnit.mockResolvedValue({
        unit: { id: 'unit-1' },
        updated: { id: 'unit-1', flagReason: 'Suspicious price', flaggedAt: new Date() },
      });

      const result = await service.flagListing('unit-1', 'admin-1', 'Suspicious price');

      expect(unitsService.flagUnit).toHaveBeenCalledWith('unit-1', 'admin-1', 'Suspicious price');
      expect(prisma.adminActionLog.create).toHaveBeenCalledWith({
        data: { adminId: 'admin-1', actionType: 'listing_flagged', targetType: 'unit', targetId: 'unit-1', detail: { reason: 'Suspicious price' } },
      });
      expect(result.flagged).toBe(true);
    });

    it('unflagListing logs the action only when there was actually a flag to clear', async () => {
      unitsService.unflagUnit.mockResolvedValue({ id: 'unit-1', flaggedAt: null });

      await service.unflagListing('unit-1', 'admin-1');

      expect(prisma.adminActionLog.create).toHaveBeenCalledTimes(1);
    });

    it('removeListing refuses nothing itself — that check lives in UnitsService — and logs on success', async () => {
      unitsService.removeUnit.mockResolvedValue({ unit: { id: 'unit-1' }, updated: { id: 'unit-1', status: 'draft' } });

      const result = await service.removeListing('unit-1', 'admin-1', 'Fake listing');

      expect(prisma.adminActionLog.create).toHaveBeenCalledWith({
        data: { adminId: 'admin-1', actionType: 'listing_removed', targetType: 'unit', targetId: 'unit-1', detail: { reason: 'Fake listing' } },
      });
      expect(result.status).toBe('draft');
    });

    it('listFlaggedListings attaches the landlord profile to each flagged unit', async () => {
      unitsService.listFlaggedUnits.mockResolvedValue([{ id: 'unit-1', landlord_id: 'landlord-1' }]);

      const result = await service.listFlaggedListings();

      expect(usersService.getPublicProfile).toHaveBeenCalledWith('landlord-1');
      expect(result.results[0].landlord).toEqual({ name: 'Admin One', phone_number: '+237600000001' });
    });
  });

  describe('listPaymentDisputes', () => {
    it('delegates to PaymentsService.listDisputes', async () => {
      await service.listPaymentDisputes();
      expect(paymentsService.listDisputes).toHaveBeenCalled();
    });
  });

  describe('listAuditLog', () => {
    it('filters by target_type/target_id and enriches with the admin profile', async () => {
      prisma.adminActionLog.findMany.mockResolvedValue([
        { id: 'log-1', adminId: 'admin-1', actionType: 'kyc_approved', targetType: 'user', targetId: 'user-1', detail: null, createdAt: new Date() },
      ]);

      const result = await service.listAuditLog({ target_type: 'user', target_id: 'user-1', limit: 30 });

      expect(prisma.adminActionLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { targetType: 'user', targetId: 'user-1' } }),
      );
      expect(result.results[0].admin_profile).toEqual({ name: 'Admin One', phone_number: '+237600000001' });
      expect(result.next_cursor).toBeNull();
    });

    it('paginates with a cursor when there are more rows than the limit', async () => {
      const row = (id: string) => ({ id, adminId: 'admin-1', actionType: 'kyc_approved', targetType: 'user', targetId: 'user-1', detail: null, createdAt: new Date() });
      prisma.adminActionLog.findMany.mockResolvedValue([row('a'), row('b')]);

      const result = await service.listAuditLog({ limit: 1 });

      expect(result.results).toHaveLength(1);
      expect(result.next_cursor).toBe('a');
    });
  });
});
