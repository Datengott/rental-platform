import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ComplaintStatus } from '@prisma/client';
import { ApiException } from '../../common/exceptions/api.exception';
import { PrismaService } from '../../common/prisma.service';
import { OBJECT_STORAGE, ObjectStorage } from '../../common/storage/object-storage';
import {
  COMPLAINT_CREATED,
  COMPLAINT_STATUS_CHANGED,
  ComplaintCreatedEvent,
  ComplaintStatusChangedEvent,
} from '../../common/events/complaint.events';
import { TenanciesService } from '../tenancies/tenancies.service';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import { ListComplaintsDto } from './dto/list-complaints.dto';
import { UpdateComplaintStatusDto } from './dto/update-complaint-status.dto';

@Injectable()
export class ComplaintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    @Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStorage,
    private readonly tenanciesService: TenanciesService,
  ) {}

  async createComplaint(tenantId: string, tenancyId: string, dto: CreateComplaintDto, files: Express.Multer.File[]) {
    const parties = await this.tenanciesService.getPartiesForTenancy(tenancyId);
    if (!parties || parties.tenantId !== tenantId) {
      // 404 rather than 403 — don't reveal that a tenancy with this id
      // exists under a different tenant, matching the pattern used
      // throughout (Tenancies, Payments, Contracts).
      throw new NotFoundException('Tenancy not found');
    }

    // Classify every file's media type BEFORE creating anything — doing
    // this after would leave an orphaned Complaint row with no media if a
    // later file in the batch turned out to be an unsupported type.
    const classifiedFiles = files.map((file) => ({ file, mediaType: this.classifyMedia(file.mimetype) }));

    const complaint = await this.prisma.complaint.create({
      data: {
        tenancyId,
        unitId: parties.unitId,
        tenantId,
        landlordId: parties.landlordId,
        category: dto.category,
        description: dto.description,
      },
    });

    for (const { file, mediaType } of classifiedFiles) {
      const storageUrl = await this.objectStorage.upload('complaint-media', file.buffer, file.originalname);
      await this.prisma.complaintMedia.create({
        data: { complaintId: complaint.id, storageUrl, mediaType },
      });
    }

    this.events.emit(COMPLAINT_CREATED, {
      complaintId: complaint.id,
      tenancyId,
      unitId: parties.unitId,
      tenantId,
      landlordId: parties.landlordId,
      category: dto.category,
    } satisfies ComplaintCreatedEvent);

    return this.getByIdForResponse(complaint.id);
  }

  async listForLandlord(landlordId: string, query: ListComplaintsDto) {
    const complaints = await this.prisma.complaint.findMany({
      where: {
        landlordId,
        ...(query.unit_id ? { unitId: query.unit_id } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.category ? { category: query.category } : {}),
      },
      include: { media: true },
      orderBy: { createdAt: 'desc' },
    });
    return complaints.map((c) => this.toResponse(c));
  }

  // PRD Epic 7 US-7.1 AC2's "tenant sees status updates" is satisfied via
  // the Notifications module's complaint.status_changed listener (in-app +
  // push) rather than a dedicated tenant-facing GET endpoint here —
  // api-specification.md Section 10 doesn't define one; the tenant's
  // in-app notification feed (GET /users/me/notifications) is where this
  // surfaces, consistent with that module owning cross-cutting "how does
  // a user find out something happened" concerns.
  async updateStatus(landlordId: string, complaintId: string, dto: UpdateComplaintStatusDto) {
    const complaint = await this.prisma.complaint.findUnique({ where: { id: complaintId } });
    if (!complaint || complaint.landlordId !== landlordId) {
      throw new NotFoundException('Complaint not found');
    }

    if (complaint.status === ComplaintStatus.closed) {
      throw new ApiException('COMPLAINT_ALREADY_CLOSED', 'This complaint is closed and cannot be updated further.', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const now = new Date();
    await this.prisma.complaint.update({
      where: { id: complaintId },
      data: {
        status: dto.new_status,
        // First-reached-wins, same pattern as other evidentiary timestamps
        // in this codebase — a status that bounces back and forth doesn't
        // re-stamp an already-recorded milestone.
        acknowledgedAt: dto.new_status === 'acknowledged' && !complaint.acknowledgedAt ? now : undefined,
        resolvedAt: dto.new_status === 'resolved' && !complaint.resolvedAt ? now : undefined,
      },
    });
    await this.prisma.complaintUpdate.create({
      data: { complaintId, authorId: landlordId, note: dto.note, newStatus: dto.new_status },
    });

    this.events.emit(COMPLAINT_STATUS_CHANGED, {
      complaintId,
      tenantId: complaint.tenantId,
      landlordId,
      unitId: complaint.unitId,
      newStatus: dto.new_status,
    } satisfies ComplaintStatusChangedEvent);

    return this.getByIdForResponse(complaintId);
  }

  private async getByIdForResponse(complaintId: string) {
    const complaint = await this.prisma.complaint.findUniqueOrThrow({
      where: { id: complaintId },
      include: { media: true },
    });
    return this.toResponse(complaint);
  }

  private classifyMedia(mimetype: string): 'photo' | 'video' {
    if (mimetype.startsWith('image/')) return 'photo';
    if (mimetype.startsWith('video/')) return 'video';
    throw new ApiException('VALIDATION_ERROR', `Unsupported media type "${mimetype}" — only images and videos are accepted.`, HttpStatus.BAD_REQUEST, [
      { field: 'media', message: 'must be an image or video file' },
    ]);
  }

  private toResponse(complaint: {
    id: string;
    tenancyId: string;
    unitId: string;
    tenantId: string;
    landlordId: string;
    category: string;
    description: string;
    status: string;
    createdAt: Date;
    acknowledgedAt: Date | null;
    resolvedAt: Date | null;
    media: { id: string; storageUrl: string; mediaType: string; uploadedAt: Date }[];
  }) {
    return {
      id: complaint.id,
      tenancy_id: complaint.tenancyId,
      unit_id: complaint.unitId,
      tenant_id: complaint.tenantId,
      landlord_id: complaint.landlordId,
      category: complaint.category,
      description: complaint.description,
      status: complaint.status,
      created_at: complaint.createdAt,
      acknowledged_at: complaint.acknowledgedAt,
      resolved_at: complaint.resolvedAt,
      media: complaint.media.map((m) => ({
        id: m.id,
        storage_url: m.storageUrl,
        media_type: m.mediaType,
        uploaded_at: m.uploadedAt,
      })),
    };
  }
}
