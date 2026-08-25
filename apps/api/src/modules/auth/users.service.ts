import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../common/prisma.service';
import { ApiException } from '../../common/exceptions/api.exception';
import {
  USER_KYC_TIER_CHANGED,
  UserKycTierChangedEvent,
} from '../../common/events/user.events';
import { UpdateMeDto } from './dto/update-me.dto';
import { UploadKycDocumentDto } from './dto/upload-kyc-document.dto';
import { ApproveKycDto } from './dto/approve-kyc.dto';
import { OBJECT_STORAGE, ObjectStorage } from './storage/object-storage';

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

    const url = await this.objectStorage.upload(file.buffer, file.originalname);

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
