import { NotFoundException } from '@nestjs/common';
import { ContractsService } from './contracts.service';

function buildPrismaMock() {
  return {
    contract: { create: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
  };
}

describe('ContractsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let events: { emit: jest.Mock };
  let objectStorage: { upload: jest.Mock };
  let tenanciesService: { getContractContext: jest.Mock };
  let unitsService: { getContractDetails: jest.Mock };
  let usersService: { getPublicProfile: jest.Mock };
  let service: ContractsService;

  const tenancyContext = {
    id: 'tenancy-1',
    unit_id: 'unit-1',
    tenant_id: 'tenant-1',
    landlord_id: 'landlord-1',
    start_date: '2026-09-01',
    rent_amount: '150000',
    currency: 'XAF',
    billing_cycle: 'monthly',
    notice_period_days: 90,
    status: 'active',
  };

  const landlordProfile = { id: 'landlord-1', fullName: 'Jean Landlord', phoneNumber: '+237600000001', locale: 'fr' };
  const tenantProfile = { id: 'tenant-1', fullName: 'Marie Tenant', phoneNumber: '+237600000002', locale: 'en' };
  const unitDetails = { label: 'Studio A', addressLine: '1 Rue Test', city: 'Douala' };

  beforeEach(() => {
    prisma = buildPrismaMock();
    events = { emit: jest.fn() };
    objectStorage = { upload: jest.fn().mockResolvedValue('local://contracts/x.txt') };
    tenanciesService = { getContractContext: jest.fn().mockResolvedValue({ ...tenancyContext }) };
    unitsService = { getContractDetails: jest.fn().mockResolvedValue({ ...unitDetails }) };
    usersService = {
      getPublicProfile: jest.fn().mockImplementation((userId: string) =>
        Promise.resolve(userId === 'landlord-1' ? { ...landlordProfile } : { ...tenantProfile }),
      ),
    };
    service = new ContractsService(
      prisma as never,
      events as never,
      objectStorage,
      tenanciesService as never,
      unitsService as never,
      usersService as never,
    );
  });

  describe('generateContract', () => {
    it('generates a draft contract, defaulting locale to the requester\'s own stored locale', async () => {
      prisma.contract.create.mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...args.data, status: 'draft', createdAt: new Date('2026-09-17') }),
      );

      const result = await service.generateContract('tenant-1', 'tenancy-1', {});

      expect(tenanciesService.getContractContext).toHaveBeenCalledWith('tenant-1', 'tenancy-1');
      expect(objectStorage.upload).toHaveBeenCalledWith('contracts', expect.any(Buffer), expect.stringMatching(/\.txt$/));
      // requester is the tenant, whose stored locale is 'en'.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const createCall = prisma.contract.create.mock.calls[0][0] as { data: { tenancyId: string; locale: string } };
      expect(createCall.data).toMatchObject({ tenancyId: 'tenancy-1', locale: 'en' });
      expect(result).toMatchObject({ tenancy_id: 'tenancy-1', locale: 'en', status: 'draft' });
      expect(events.emit).toHaveBeenCalledWith('contract.generated', expect.objectContaining({ tenancyId: 'tenancy-1' }));
    });

    it('honors an explicit locale over the requester\'s stored default', async () => {
      prisma.contract.create.mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...args.data, status: 'draft', createdAt: new Date('2026-09-17') }),
      );

      const result = await service.generateContract('landlord-1', 'tenancy-1', { locale: 'en' });

      // requester is the landlord, whose stored locale is 'fr' — explicit dto wins.
      expect(result.locale).toBe('en');
    });

    it('propagates a 404 when the requester has no access to the tenancy', async () => {
      tenanciesService.getContractContext.mockRejectedValue(new NotFoundException('Tenancy not found'));

      await expect(service.generateContract('stranger-1', 'tenancy-1', {})).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.contract.create).not.toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('throws 404 when the contract does not exist', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);

      await expect(service.getById('tenant-1', 'contract-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('delegates authorization to TenanciesService.getContractContext and returns the contract', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        id: 'contract-1',
        tenancyId: 'tenancy-1',
        templateVersion: 'v1',
        locale: 'fr',
        documentUrl: 'local://contracts/x.txt',
        status: 'draft',
        createdAt: new Date('2026-09-17'),
      });

      const result = await service.getById('tenant-1', 'contract-1');

      expect(tenanciesService.getContractContext).toHaveBeenCalledWith('tenant-1', 'tenancy-1');
      expect(result).toMatchObject({ id: 'contract-1', tenancy_id: 'tenancy-1', status: 'draft' });
    });

    it('propagates a 404 when the requester has no access to the underlying tenancy', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        id: 'contract-1',
        tenancyId: 'tenancy-1',
        templateVersion: 'v1',
        locale: 'fr',
        documentUrl: 'local://contracts/x.txt',
        status: 'draft',
        createdAt: new Date('2026-09-17'),
      });
      tenanciesService.getContractContext.mockRejectedValue(new NotFoundException('Tenancy not found'));

      await expect(service.getById('stranger-1', 'contract-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getLatestStatusForTenancy', () => {
    it('returns null when the tenancy has no generated contract', async () => {
      prisma.contract.findFirst.mockResolvedValue(null);
      await expect(service.getLatestStatusForTenancy('tenancy-1')).resolves.toBeNull();
    });

    it("returns the most recent contract's status", async () => {
      prisma.contract.findFirst.mockResolvedValue({ status: 'draft' });
      await expect(service.getLatestStatusForTenancy('tenancy-1')).resolves.toBe('draft');
    });
  });
});
