import { UsersService } from './users.service';

function buildPrismaMock() {
  return {
    user: { findUniqueOrThrow: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    userRoleAssignment: { findUnique: jest.fn(), create: jest.fn() },
  };
}

describe('UsersService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let events: { emit: jest.Mock };
  let objectStorage: { upload: jest.Mock };
  let service: UsersService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    events = { emit: jest.fn() };
    objectStorage = { upload: jest.fn() };
    service = new UsersService(prisma as never, events as never, objectStorage);
  });

  // Backs the Admin module's GET /admin/kyc-queue.
  describe('listPendingKyc', () => {
    it('queries users with a submitted document and no admin review yet', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.listPendingKyc();

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { idDocumentUrl: { not: null }, kycVerifiedAt: null } }),
      );
    });

    it('maps to the fields an admin needs to review the submission', async () => {
      const submittedAt = new Date('2026-09-20T10:00:00Z');
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          fullName: 'Jean Dupont',
          phoneNumber: '+237600000010',
          locale: 'fr',
          idDocumentType: 'national_id',
          idDocumentRef: 'ID-123',
          idDocumentUrl: 'local://kyc-documents/x.jpg',
          updatedAt: submittedAt,
        },
      ]);

      const result = await service.listPendingKyc();

      expect(result).toEqual([
        {
          id: 'user-1',
          fullName: 'Jean Dupont',
          phoneNumber: '+237600000010',
          locale: 'fr',
          idDocumentType: 'national_id',
          idDocumentRef: 'ID-123',
          idDocumentUrl: 'local://kyc-documents/x.jpg',
          submittedAt,
        },
      ]);
    });
  });
});
