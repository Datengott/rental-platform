import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UnitStatus } from '@prisma/client';
import { ApiException } from '../../common/exceptions/api.exception';
import {
  UNIT_LISTED,
  UNIT_STATUS_CHANGED,
  UnitListedEvent,
  UnitStatusChangedEvent,
} from '../../common/events/property.events';
import { PrismaService } from '../../common/prisma.service';
import { OBJECT_STORAGE, ObjectStorage } from '../../common/storage/object-storage';
import { UploadUnitPhotoDto } from './dto/upload-unit-photo.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { SearchUnitsDto } from './dto/search-units.dto';
import { toUnitResponse } from './unit-response.mapper';

// Manual transitions a landlord can make via PATCH /units/{id}. Everything
// else is system-driven: draft->vacant happens on first photo upload (below);
// visit_requested/occupied/notice_given belong to the Visits/Tenancies
// modules (build order #3/#4), which don't exist yet.
const ALLOWED_MANUAL_TRANSITIONS: Partial<Record<UnitStatus, UnitStatus[]>> = {
  [UnitStatus.vacant]: [UnitStatus.reserved],
  [UnitStatus.reserved]: [UnitStatus.vacant],
};

@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    @Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStorage,
  ) {}

  async uploadPhoto(landlordId: string, unitId: string, dto: UploadUnitPhotoDto, file: Express.Multer.File) {
    if (!file) {
      throw new ApiException('VALIDATION_ERROR', 'A photo file is required.', HttpStatus.BAD_REQUEST, [
        { field: 'file', message: 'is required' },
      ]);
    }

    const unit = await this.getOwnedUnit(landlordId, unitId);
    const url = await this.objectStorage.upload('unit-photos', file.buffer, file.originalname);
    const photoCount = await this.prisma.unitPhoto.count({ where: { unitId } });

    const photo = await this.prisma.unitPhoto.create({
      data: {
        unitId,
        storageUrl: url,
        geoLatitude: dto.geo_latitude,
        geoLongitude: dto.geo_longitude,
        capturedAt: dto.captured_at ? new Date(dto.captured_at) : undefined,
        sortOrder: photoCount,
      },
    });

    // First photo transitions the unit from draft to vacant — PRD Epic 2
    // US-2.1 AC2. Every subsequent photo just attaches to an already-listed unit.
    if (photoCount === 0 && unit.status === UnitStatus.draft) {
      await this.transitionStatus(unit.id, UnitStatus.draft, UnitStatus.vacant);
      this.events.emit(UNIT_LISTED, {
        unitId: unit.id,
        propertyId: unit.propertyId,
        landlordId,
      } satisfies UnitListedEvent);
    }

    return {
      id: photo.id,
      unit_id: photo.unitId,
      storage_url: photo.storageUrl,
      sort_order: photo.sortOrder,
      uploaded_at: photo.uploadedAt,
      // geo_latitude/geo_longitude/captured_at deliberately omitted from the
      // response — PRD Epic 2 US-2.2 AC2: geo-metadata is stored for internal
      // fraud review only, never surfaced publicly.
    };
  }

  async searchUnits(query: SearchUnitsDto) {
    const limit = query.limit ?? 20;

    const units = await this.prisma.unit.findMany({
      where: {
        status: query.status ?? UnitStatus.vacant,
        ...(query.bedrooms !== undefined ? { bedrooms: query.bedrooms } : {}),
        ...(query.min_price !== undefined || query.max_price !== undefined
          ? {
              rentAmount: {
                ...(query.min_price !== undefined ? { gte: query.min_price } : {}),
                ...(query.max_price !== undefined ? { lte: query.max_price } : {}),
              },
            }
          : {}),
        property: {
          ...(query.city ? { city: query.city } : {}),
          ...(query.region ? { region: query.region } : {}),
        },
      },
      include: {
        property: { select: { city: true, ownershipVerifiedAt: true } },
        photos: { orderBy: { sortOrder: 'asc' }, take: 1 },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = units.length > limit;
    const page = hasMore ? units.slice(0, limit) : units;

    return {
      results: page.map((unit) => ({
        id: unit.id,
        label: unit.label,
        rent_amount: unit.rentAmount,
        currency: unit.currency,
        property: { city: unit.property.city, verified: unit.property.ownershipVerifiedAt !== null },
        cover_photo_url: unit.photos[0]?.storageUrl ?? null,
      })),
      next_cursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async getLandlordUnits(landlordId: string) {
    const units = await this.prisma.unit.findMany({
      where: { property: { landlordId } },
      include: { property: { select: { id: true, name: true, city: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return units.map((unit) => toUnitResponse(unit));
  }

  async updateUnit(landlordId: string, unitId: string, dto: UpdateUnitDto) {
    const unit = await this.getOwnedUnit(landlordId, unitId);

    if (dto.status && dto.status !== unit.status) {
      const allowed = ALLOWED_MANUAL_TRANSITIONS[unit.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw new ApiException(
          'INVALID_STATUS_TRANSITION',
          `Cannot move a unit from "${unit.status}" to "${dto.status}" directly.`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }

    const updated = await this.prisma.unit.update({
      where: { id: unitId },
      data: {
        rentAmount: dto.rent_amount,
        description: dto.description,
        status: dto.status,
      },
      include: { property: { select: { id: true, name: true, city: true } } },
    });

    if (dto.status && dto.status !== unit.status) {
      this.events.emit(UNIT_STATUS_CHANGED, {
        unitId: unit.id,
        previousStatus: unit.status,
        newStatus: dto.status,
      } satisfies UnitStatusChangedEvent);
    }

    return toUnitResponse(updated);
  }

  // Public so the occupancy listener (this module's own reaction to
  // tenancy.created/tenancy.terminated) can drive it — that's this
  // module's own code reacting to events, not a cross-module Prisma write.
  async transitionStatus(unitId: string, from: UnitStatus, to: UnitStatus) {
    await this.prisma.unit.update({ where: { id: unitId }, data: { status: to } });
    this.events.emit(UNIT_STATUS_CHANGED, {
      unitId,
      previousStatus: from,
      newStatus: to,
    } satisfies UnitStatusChangedEvent);
  }

  private async getOwnedUnit(landlordId: string, unitId: string) {
    const unit = await this.prisma.unit.findUnique({ where: { id: unitId }, include: { property: true } });
    if (!unit || unit.property.landlordId !== landlordId) {
      throw new NotFoundException('Unit not found');
    }
    return unit;
  }

  // Public interface for other modules (Visits needs to know who owns a
  // unit to denormalize landlord_id onto a visit request; Tenancies also
  // needs current status to reject creating a tenancy on a non-vacant
  // unit) — never a direct Prisma import of Properties' models, per
  // CLAUDE.md's cross-module rule.
  async getUnitOwnership(
    unitId: string,
  ): Promise<{ id: string; propertyId: string; landlordId: string; status: UnitStatus }> {
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
      select: { id: true, propertyId: true, status: true, property: { select: { landlordId: true } } },
    });
    if (!unit) {
      throw new NotFoundException('Unit not found');
    }
    return { id: unit.id, propertyId: unit.propertyId, landlordId: unit.property.landlordId, status: unit.status };
  }

  // Public interface for Contracts, which needs the unit/property address
  // to render into the generated lease document — never a direct Prisma
  // read of Properties' models, per CLAUDE.md's cross-module rule.
  async getContractDetails(unitId: string): Promise<{ label: string | null; addressLine: string; city: string }> {
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
      select: { label: true, property: { select: { addressLine: true, city: true } } },
    });
    if (!unit) {
      throw new NotFoundException('Unit not found');
    }
    return { label: unit.label, addressLine: unit.property.addressLine, city: unit.property.city };
  }
}
