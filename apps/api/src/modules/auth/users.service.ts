import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { ApiException } from '../../common/exceptions/api.exception';
import {
  USER_KYC_TIER_CHANGED,
  USER_ROLE_GRANTED,
  UserKycTierChangedEvent,
  UserRoleGrantedEvent,
} from '../../common/events/user.events';
import { OBJECT_STORAGE, ObjectStorage } from '../../common/storage/object-storage';
import { UpdateMeDto } from './dto/update-me.dto';
import { UploadKycDocumentDto } from './dto/upload-kyc-document.dto';
import { ApproveKycDto } from './dto/approve-kyc.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    @Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStorage,
  ) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { roles: true },
    });
    return this.toProfile(user);
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { fullName: dto.full_name, locale: dto.locale },
      include: { roles: true },
    });
    return this.toProfile(user);
  }

  async uploadKycDocument(userId: string, dto: UploadKycDocumentDto, file: Express.Multer.File) {
    if (!file) {
      throw new ApiException('VALIDATION_ERROR', 'A document file is required.', HttpStatus.BAD_REQUEST, [
        { field: 'file', message: 'is required' },
      ]);
    }

    const url = await this.objectStorage.upload('kyc-documents', file.buffer, file.originalname);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        idDocumentType: dto.document_type,
        idDocumentRef: dto.document_ref,
        idDocumentUrl: url,
      },
    });

    return { status: 'queued_for_review' as const };
  }

  async approveKyc(targetUserId: string, adminUserId: string, dto: ApproveKycDto) {
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) {
      throw new NotFoundException('User not found');
    }

    const previousTier = target.kycTier;

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        kycTier: dto.new_tier,
        kycVerifiedAt: new Date(),
        kycVerifiedBy: adminUserId,
      },
      include: { roles: true },
    });

    this.events.emit(USER_KYC_TIER_CHANGED, {
      userId: targetUserId,
      previousTier,
      newTier: dto.new_tier,
      changedBy: adminUserId,
    } satisfies UserKycTierChangedEvent);

    return this.toProfile(updated);
  }

  // Called by other modules through this public interface (never via a
  // direct Prisma write to Auth's tables — see CLAUDE.md's cross-module
  // rule). There's no dedicated "become a landlord" flow in the API spec;
  // per docs/api-specification.md Section 4, creating a property is what
  // makes a user a landlord, so Properties calls this on first success.
  async ensureRole(userId: string, role: UserRole): Promise<void> {
    const existing = await this.prisma.userRoleAssignment.findUnique({
      where: { userId_role: { userId, role } },
    });
    if (existing) return;

    await this.prisma.userRoleAssignment.create({ data: { userId, role } });
    this.events.emit(USER_ROLE_GRANTED, { userId, role } satisfies UserRoleGrantedEvent);
  }

  // Public interface for the Admin module's kyc-queue view (never a direct
  // Prisma read of Auth's users table, per CLAUDE.md's cross-module rule).
  // "Pending" = has submitted an ID document that no admin has acted on yet.
  // Ownership-verification review is a separate, not-yet-built flow — see the
  // Admin module's README.md entry for why `ownership_doc_url` isn't in scope
  // here (same "dead schema, no writer" situation as other deferred fields).
  async listPendingKyc(): Promise<
    {
      id: string;
      fullName: string | null;
      phoneNumber: string;
      locale: string;
      idDocumentType: string | null;
      idDocumentRef: string | null;
      idDocumentUrl: string | null;
      submittedAt: Date;
    }[]
  > {
    const users = await this.prisma.user.findMany({
      where: { idDocumentUrl: { not: null }, kycVerifiedAt: null },
      // `updatedAt` is a proxy for "submitted at" — it's bumped by the same
      // update that stores the document, and nothing else in this MVP updates
      // a user's own row afterwards before an admin reviews it.
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        fullName: true,
        phoneNumber: true,
        locale: true,
        idDocumentType: true,
        idDocumentRef: true,
        idDocumentUrl: true,
        updatedAt: true,
      },
    });
    return users.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      phoneNumber: u.phoneNumber,
      locale: u.locale,
      idDocumentType: u.idDocumentType,
      idDocumentRef: u.idDocumentRef,
      idDocumentUrl: u.idDocumentUrl,
      submittedAt: u.updatedAt,
    }));
  }

  // Public interface for other modules that need to validate a user id
  // (e.g. Tenancies validating the tenant_id it's given) without a direct
  // Prisma read of Auth's tables, per CLAUDE.md's cross-module rule.
  async exists(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    return user !== null;
  }

  // Public interface for other modules that need a user's display details
  // for generated documents (e.g. Contracts naming the landlord/tenant)
  // without a direct Prisma read of Auth's tables, per CLAUDE.md's
  // cross-module rule. Deliberately narrower than getMe()'s full profile —
  // no KYC/role data leaks to a party who is merely named in a document.
  async getPublicProfile(userId: string): Promise<{ id: string; fullName: string | null; phoneNumber: string; locale: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, phoneNumber: true, locale: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return { id: user.id, fullName: user.fullName, phoneNumber: user.phoneNumber, locale: user.locale };
  }

  private toProfile(user: {
    id: string;
    fullName: string | null;
    phoneNumber: string;
    locale: string;
    kycTier: string;
    roles: { role: string }[];
  }) {
    return {
      id: user.id,
      full_name: user.fullName,
      phone_number: user.phoneNumber,
      locale: user.locale,
      roles: user.roles.map((r) => r.role),
      kyc_tier: user.kycTier,
    };
  }
}
