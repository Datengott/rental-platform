import { NotFoundException } from '@nestjs/common';
import { ComplaintsService } from './complaints.service';

function buildPrismaMock() {
  return {
    complaint: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
    complaintMedia: { create: jest.fn() },
    complaintUpdate: { create: jest.fn() },
  };
}

describe('ComplaintsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let events: { emit: jest.Mock };
  let objectStorage: { upload: jest.Mock };
  let tenanciesService: { getPartiesForTenancy: jest.Mock };
  let service: ComplaintsService;

  const parties = { tenantId: 'tenant-1', landlordId: 'landlord-1', unitId: 'unit-1' };

  beforeEach(() => {
    prisma = buildPrismaMock();
    events = { emit: jest.fn() };
    objectStorage = { upload: jest.fn().mockResolvedValue('local://complaint-media/x.jpg') };
    tenanciesService = { getPartiesForTenancy: jest.fn().mockResolvedValue({ ...parties }) };
    service = new ComplaintsService(prisma as never, events as never, objectStorage, tenanciesService as never);
  });

  describe('createComplaint', () => {
    const dto = { category: 'plumbing' as const, description: 'Leaking pipe under the sink' };

    it("rejects when the requester isn't this tenancy's tenant", async () => {
      tenanciesService.getPartiesForTenancy.mockResolvedValue({ ...parties, tenantId: 'someone-else' });

      await expect(service.createComplaint('tenant-1', 'tenancy-1', dto, [])).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.complaint.create).not.toHaveBeenCalled();
    });

    it('creates the complaint, uploads media, and emits complaint.created', async () => {
      prisma.complaint.create.mockResolvedValue({ id: 'complaint-1', ...parties, category: 'plumbing', description: dto.description, status: 'open' });
      prisma.complaint.findUniqueOrThrow.mockResolvedValue({
        id: 'complaint-1',
        tenancyId: 'tenancy-1',
        unitId: 'unit-1',
        tenantId: 'tenant-1',
        landlordId: 'landlord-1',
        category: 'plumbing',
        description: dto.description,
        status: 'open',
        createdAt: new Date(),
        acknowledgedAt: null,
        resolvedAt: null,
        media: [],
      });
      const files = [{ mimetype: 'image/jpeg', buffer: Buffer.from('x'), originalname: 'a.jpg' } as Express.Multer.File];

      const result = await service.createComplaint('tenant-1', 'tenancy-1', dto, files);

      expect(objectStorage.upload).toHaveBeenCalledWith('complaint-media', expect.any(Buffer), 'a.jpg');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const mediaCall = prisma.complaintMedia.create.mock.calls[0][0] as { data: { mediaType: string } };
      expect(mediaCall.data.mediaType).toBe('photo');
      expect(events.emit).toHaveBeenCalledWith('complaint.created', expect.objectContaining({ tenancyId: 'tenancy-1', category: 'plumbing' }));
      expect(result).toMatchObject({ id: 'complaint-1', status: 'open' });
    });

    it('rejects an unsupported media mimetype', async () => {
      prisma.complaint.create.mockResolvedValue({ id: 'complaint-1', ...parties });
      const files = [{ mimetype: 'application/pdf', buffer: Buffer.from('x'), originalname: 'a.pdf' } as Express.Multer.File];

      await expect(service.createComplaint('tenant-1', 'tenancy-1', dto, files)).rejects.toMatchObject({
        response: { code: 'VALIDATION_ERROR' },
      });
    });
  });

  describe('updateStatus', () => {
    const existing = {
      id: 'complaint-1',
      tenancyId: 'tenancy-1',
      unitId: 'unit-1',
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      category: 'plumbing',
      description: 'x',
      status: 'open',
      acknowledgedAt: null,
      resolvedAt: null,
    };

    it('rejects when the complaint belongs to a different landlord', async () => {
      prisma.complaint.findUnique.mockResolvedValue({ ...existing, landlordId: 'someone-else' });

      await expect(service.updateStatus('landlord-1', 'complaint-1', { new_status: 'acknowledged' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects updating an already-closed complaint', async () => {
      prisma.complaint.findUnique.mockResolvedValue({ ...existing, status: 'closed' });

      await expect(service.updateStatus('landlord-1', 'complaint-1', { new_status: 'resolved' })).rejects.toMatchObject({
        response: { code: 'COMPLAINT_ALREADY_CLOSED' },
      });
    });

    it('updates status, stamps acknowledged_at once, records an update row, and emits complaint.status_changed', async () => {
      prisma.complaint.findUnique.mockResolvedValue({ ...existing });
      prisma.complaint.findUniqueOrThrow.mockResolvedValue({
        ...existing,
        status: 'acknowledged',
        acknowledgedAt: new Date(),
        createdAt: new Date(),
        media: [],
      });

      const result = await service.updateStatus('landlord-1', 'complaint-1', { new_status: 'acknowledged', note: 'On it' });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const updateCall = prisma.complaint.update.mock.calls[0][0] as { data: { status: string; acknowledgedAt: Date | undefined } };
      expect(updateCall.data.status).toBe('acknowledged');
      expect(updateCall.data.acknowledgedAt).toBeInstanceOf(Date);
      expect(prisma.complaintUpdate.create).toHaveBeenCalledWith({
        data: { complaintId: 'complaint-1', authorId: 'landlord-1', note: 'On it', newStatus: 'acknowledged' },
      });
      expect(events.emit).toHaveBeenCalledWith(
        'complaint.status_changed',
        expect.objectContaining({ complaintId: 'complaint-1', tenantId: 'tenant-1', newStatus: 'acknowledged' }),
      );
      expect(result.status).toBe('acknowledged');
    });

    it('does not re-stamp acknowledged_at if already set', async () => {
      prisma.complaint.findUnique.mockResolvedValue({ ...existing, status: 'acknowledged', acknowledgedAt: new Date('2026-01-01') });
      prisma.complaint.findUniqueOrThrow.mockResolvedValue({ ...existing, status: 'in_progress', createdAt: new Date(), media: [] });

      await service.updateStatus('landlord-1', 'complaint-1', { new_status: 'in_progress' });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const updateCall = prisma.complaint.update.mock.calls[0][0] as { data: { acknowledgedAt: Date | undefined } };
      expect(updateCall.data.acknowledgedAt).toBeUndefined();
    });
  });

  describe('listForLandlord', () => {
    it('filters by unit_id, status, and category', async () => {
      prisma.complaint.findMany.mockResolvedValue([]);

      await service.listForLandlord('landlord-1', { unit_id: 'unit-1', status: 'open', category: 'plumbing' });

      expect(prisma.complaint.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { landlordId: 'landlord-1', unitId: 'unit-1', status: 'open', category: 'plumbing' } }),
      );
    });
  });
});
