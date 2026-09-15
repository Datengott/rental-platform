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
