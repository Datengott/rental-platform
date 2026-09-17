import { NotFoundException } from '@nestjs/common';
import { TenanciesService } from './tenancies.service';

function buildPrismaMock() {
  return {
    tenancy: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    terminationNotice: { create: jest.fn(), findMany: jest.fn() },
  };
}

describe('TenanciesService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let units: { getUnitOwnership: jest.Mock };
  let usersService: { exists: jest.Mock };
  let events: { emit: jest.Mock; emitAsync: jest.Mock };
  let objectStorage: { upload: jest.Mock };
  let paymentsService: { getCurrentBalance: jest.Mock; getRecentLedgerEntries: jest.Mock };
  let contractsService: { getLatestStatusForTenancy: jest.Mock };
  let service: TenanciesService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    units = { getUnitOwnership: jest.fn() };
    usersService = { exists: jest.fn() };
    events = { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) };
    objectStorage = { upload: jest.fn().mockResolvedValue('local://termination-notices/x.txt') };
    paymentsService = { getCurrentBalance: jest.fn().mockResolvedValue(0), getRecentLedgerEntries: jest.fn().mockResolvedValue([]) };
    contractsService = { getLatestStatusForTenancy: jest.fn().mockResolvedValue(null) };
    service = new TenanciesService(
      prisma as never,
      units as never,
      usersService as never,
      events as never,
      objectStorage,
      paymentsService as never,
      contractsService as never,
    );
  });

  describe('createTenancy', () => {
    const baseDto = { unit_id: 'unit-1', tenant_id: 'tenant-1', start_date: '2026-09-01', rent_amount: 150000 };

    it('rejects when the unit belongs to a different landlord', async () => {
      units.getUnitOwnership.mockResolvedValue({ id: 'unit-1', landlordId: 'someone-else', status: 'vacant' });

      await expect(service.createTenancy('landlord-1', baseDto)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects when the unit is not vacant', async () => {
      units.getUnitOwnership.mockResolvedValue({ id: 'unit-1', landlordId: 'landlord-1', status: 'occupied' });

      await expect(service.createTenancy('landlord-1', baseDto)).rejects.toMatchObject({
        response: { code: 'UNIT_NOT_VACANT' },
      });
    });

    it('rejects when the tenant does not exist', async () => {
      units.getUnitOwnership.mockResolvedValue({ id: 'unit-1', landlordId: 'landlord-1', status: 'vacant' });
      usersService.exists.mockResolvedValue(false);

      await expect(service.createTenancy('landlord-1', baseDto)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a notice_period_days below the statutory minimum', async () => {
      units.getUnitOwnership.mockResolvedValue({ id: 'unit-1', landlordId: 'landlord-1', status: 'vacant' });
      usersService.exists.mockResolvedValue(true);

      await expect(
        service.createTenancy('landlord-1', { ...baseDto, notice_period_days: 30 }),
      ).rejects.toMatchObject({ response: { code: 'NOTICE_PERIOD_BELOW_STATUTORY_MINIMUM' } });
      expect(prisma.tenancy.create).not.toHaveBeenCalled();
    });

    it('defaults notice_period_days to 90 and emits tenancy.created', async () => {
      units.getUnitOwnership.mockResolvedValue({ id: 'unit-1', landlordId: 'landlord-1', status: 'vacant' });
      usersService.exists.mockResolvedValue(true);
      prisma.tenancy.create.mockResolvedValue({
        id: 'tenancy-1',
        unitId: 'unit-1',
        tenantId: 'tenant-1',
        landlordId: 'landlord-1',
        startDate: new Date('2026-09-01'),
        rentAmount: '150000',
        currency: 'XAF',
        billingCycle: 'monthly',
        noticePeriodDays: 90,
        maxAdvanceMonths: 3,
        paidThroughDate: null,
        reminderFirstDaysBefore: 30,
        reminderSecondDaysBefore: 14,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.createTenancy('landlord-1', baseDto);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const createCall = prisma.tenancy.create.mock.calls[0][0] as { data: { noticePeriodDays: number } };
      expect(createCall.data.noticePeriodDays).toBe(90);
      expect(events.emitAsync).toHaveBeenCalledWith(
        'tenancy.created',
        expect.objectContaining({ unitId: 'unit-1', landlordId: 'landlord-1' }),
      );
      expect(result.notice_period_days).toBe(90);
    });
  });

  describe('createTerminationNotice', () => {
    const tenancy = {
      id: 'tenancy-1',
      landlordId: 'landlord-1',
      tenantId: 'tenant-1',
      unitId: 'unit-1',
      noticePeriodDays: 90,
      status: 'active',
    };

    it('rejects an effective_date sooner than the statutory floor', async () => {
      prisma.tenancy.findUnique.mockResolvedValue(tenancy);

      await expect(
        service.createTerminationNotice('landlord-1', 'tenancy-1', {
          reason: 'non_payment',
          effective_date: '2026-01-01',
        }),
      ).rejects.toMatchObject({ response: { code: 'NOTICE_PERIOD_TOO_SHORT' } });
      expect(prisma.terminationNotice.create).not.toHaveBeenCalled();
    });

    it('rejects issuing a notice on an already-terminated tenancy', async () => {
      prisma.tenancy.findUnique.mockResolvedValue({ ...tenancy, status: 'terminated' });

      await expect(
        service.createTerminationNotice('landlord-1', 'tenancy-1', {
          reason: 'non_payment',
          effective_date: '2027-01-01',
        }),
      ).rejects.toMatchObject({ response: { code: 'TENANCY_NOT_ACTIVE' } });
    });

    it('generates a document, transitions the tenancy, and emits tenancy.notice_given', async () => {
      prisma.tenancy.findUnique.mockResolvedValue(tenancy);
      const farFuture = new Date();
      farFuture.setDate(farFuture.getDate() + 200);
      const effectiveDate = farFuture.toISOString().slice(0, 10);
      prisma.terminationNotice.create.mockResolvedValue({
        id: 'notice-1',
        tenancyId: 'tenancy-1',
        issuedBy: 'landlord-1',
        reason: 'non_payment',
        reasonDetail: null,
        issuedAt: new Date(),
        effectiveDate: new Date(effectiveDate),
        documentUrl: 'local://termination-notices/x.txt',
        deliveryChannel: null,
        deliveryConfirmedAt: null,
        createdAt: new Date(),
      });

      const result = await service.createTerminationNotice('landlord-1', 'tenancy-1', {
        reason: 'non_payment',
        effective_date: effectiveDate,
      });

      expect(objectStorage.upload).toHaveBeenCalledWith(
        'termination-notices',
        expect.any(Buffer),
        expect.stringContaining('tenancy-1'),
      );
      expect(prisma.tenancy.update).toHaveBeenCalledWith({
        where: { id: 'tenancy-1' },
        data: { status: 'notice_given' },
      });
      expect(events.emit).toHaveBeenCalledWith(
        'tenancy.notice_given',
        expect.objectContaining({ tenancyId: 'tenancy-1' }),
      );
      expect(result.document_url).toBe('local://termination-notices/x.txt');
    });
  });

  describe('getById', () => {
    it("surfaces the tenancy's most recently generated contract status", async () => {
      prisma.tenancy.findUnique.mockResolvedValue({
        id: 'tenancy-1',
        landlordId: 'landlord-1',
        tenantId: 'tenant-1',
        unitId: 'unit-1',
        startDate: new Date('2026-09-01'),
        rentAmount: '150000',
        currency: 'XAF',
        billingCycle: 'monthly',
        noticePeriodDays: 90,
        maxAdvanceMonths: 3,
        paidThroughDate: null,
        reminderFirstDaysBefore: 30,
        reminderSecondDaysBefore: 14,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      contractsService.getLatestStatusForTenancy.mockResolvedValue('draft');

      const result = await service.getById('landlord-1', 'tenancy-1');

      expect(contractsService.getLatestStatusForTenancy).toHaveBeenCalledWith('tenancy-1');
      expect(result.contract_status).toBe('draft');
    });

    it("rejects a requester who is neither the landlord nor the tenant", async () => {
      prisma.tenancy.findUnique.mockResolvedValue({ id: 'tenancy-1', landlordId: 'landlord-1', tenantId: 'tenant-1' });

      await expect(service.getById('stranger-1', 'tenancy-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('sweepNoticeExpirations', () => {
    it('terminates tenancies whose latest notice has an elapsed effective date, and emits tenancy.terminated', async () => {
      prisma.tenancy.findMany.mockResolvedValue([
        {
          id: 'tenancy-1',
          unitId: 'unit-1',
          terminationNotices: [{ effectiveDate: new Date(Date.now() - 86_400_000) }],
        },
      ]);

      await service.sweepNoticeExpirations();

      expect(prisma.tenancy.update).toHaveBeenCalledWith({
        where: { id: 'tenancy-1' },
        data: { status: 'terminated' },
      });
      expect(events.emitAsync).toHaveBeenCalledWith(
        'tenancy.terminated',
        expect.objectContaining({ tenancyId: 'tenancy-1', unitId: 'unit-1' }),
      );
    });

    it('does nothing when no tenancies are due', async () => {
      prisma.tenancy.findMany.mockResolvedValue([]);

      await service.sweepNoticeExpirations();

      expect(prisma.tenancy.update).not.toHaveBeenCalled();
      expect(events.emitAsync).not.toHaveBeenCalled();
    });
  });
});
