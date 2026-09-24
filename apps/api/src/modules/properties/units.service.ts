import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ListingEntityType, UnitStatus } from '@prisma/client';
import { ApiException } from '../../common/exceptions/api.exception';
import {
  UNIT_LISTED,
  UNIT_STATUS_CHANGED,
  UnitListedEvent,
  UnitStatusChangedEvent,
} from '../../common/events/property.events';
import { PrismaService } from '../../common/prisma.service';
import { OBJECT_STORAGE, ObjectStorage } from '../../common/storage/object-storage';
import { toPublicMediaUrl } from '../../common/storage/public-url';
import { UploadUnitPhotoDto } from './dto/upload-unit-photo.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { SearchUnitsDto } from './dto/search-units.dto';
import { toUnitResponse } from './unit-response.mapper';
import { applyEdits } from './listing-diff';
import { ListingChangesService } from './listing-changes.service';

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
    private readonly config: ConfigService,
    private readonly listingChanges: ListingChangesService,
  ) {}

  // A tenant is "in residence" while the unit is occupied or under notice.
  private inResidence(status: UnitStatus): boolean {
    return status === UnitStatus.occupied || status === UnitStatus.notice_given;
  }

  // Where the browser can reach this API's /media/* static route — separate
  // from the request's own host so it also works behind a proxy/Cloud Run.
  private publicMediaBase(): string {
    return this.config.get<string>('API_PUBLIC_URL') ?? `http://localhost:${this.config.get<string>('PORT') ?? 3000}`;
  }

  private photoUrl(storageUrl: string): string {
    return toPublicMediaUrl(storageUrl, this.publicMediaBase());
  }

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

    // Adding photos is how a listing gets built, so on a unit nobody lives in
    // it isn't a "change" worth logging (it would bury the real edits in setup
    // noise). While a tenant is in residence it IS unusual, and recorded.
    if (this.inResidence(unit.status)) {
      await this.listingChanges.buildRecord({
        entityType: ListingEntityType.unit,
        propertyId: unit.propertyId,
        unitId: unit.id,
        entityLabel: unit.label,
        changedBy: landlordId,
        action: 'photo_added',
        changes: [{ field: 'photo', from: null, to: url }],
        occupiedUnitIds: [unit.id],
        propertyVerifiedAtChange: unit.property.ownershipVerifiedAt !== null,
      });
    }

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

    const where = {
      status: query.status ?? UnitStatus.vacant,
      ...(query.bedrooms !== undefined ? { bedrooms: query.bedrooms } : {}),
      ...(query.min_bedrooms !== undefined ? { bedrooms: { gte: query.min_bedrooms } } : {}),
      ...(query.min_price !== undefined || query.max_price !== undefined
        ? {
            rentAmount: {
              ...(query.min_price !== undefined ? { gte: query.min_price } : {}),
              ...(query.max_price !== undefined ? { lte: query.max_price } : {}),
            },
          }
        : {}),
      property: {
        // Case-insensitive so "douala" from a search box matches "Douala".
        ...(query.city ? { city: { equals: query.city, mode: 'insensitive' as const } } : {}),
        ...(query.region ? { region: { equals: query.region, mode: 'insensitive' as const } } : {}),
        ...(query.property_type ? { propertyType: query.property_type } : {}),
      },
    };

    const [units, total] = await Promise.all([
      this.prisma.unit.findMany({
        where,
        include: {
          property: {
            select: {
              name: true,
              city: true,
              region: true,
              ownershipVerifiedAt: true,
              propertyType: true,
              facilities: true,
            },
          },
          photos: { orderBy: { sortOrder: 'asc' }, take: 1 },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
      this.prisma.unit.count({ where }),
    ]);

    const hasMore = units.length > limit;
    const page = hasMore ? units.slice(0, limit) : units;

    return {
      results: page.map((unit) => ({
        id: unit.id,
        label: unit.label,
        description: unit.description,
        bedrooms: unit.bedrooms,
        bathrooms: unit.bathrooms,
        size_sqm: unit.sizeSqm,
        facilities: unit.facilities,
        rent_amount: unit.rentAmount,
        currency: unit.currency,
        billing_cycle: unit.billingCycle,
        property: {
          name: unit.property.name,
          city: unit.property.city,
          region: unit.property.region,
          verified: unit.property.ownershipVerifiedAt !== null,
          property_type: unit.property.propertyType,
          facilities: unit.property.facilities,
        },
        cover_photo_url: unit.photos[0] ? this.photoUrl(unit.photos[0].storageUrl) : null,
      })),
      total,
      next_cursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  // Public detail for a listed unit — what a prospective tenant sees before
  // signing in. Deliberately omits the street address and any landlord
  // identity (those are for after a visit is agreed), and 404s for anything
  // that isn't currently vacant so drafts/occupied units aren't enumerable.
  async getPublicUnit(unitId: string) {
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
      include: {
        property: {
          select: {
            name: true,
            city: true,
            region: true,
            ownershipVerifiedAt: true,
            propertyType: true,
            facilities: true,
          },
        },
        photos: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!unit || unit.status !== UnitStatus.vacant) {
      throw new NotFoundException('Unit not found');
    }

    return {
      id: unit.id,
      label: unit.label,
      description: unit.description,
      bedrooms: unit.bedrooms,
      bathrooms: unit.bathrooms,
      size_sqm: unit.sizeSqm,
      facilities: unit.facilities,
      rent_amount: unit.rentAmount,
      currency: unit.currency,
      billing_cycle: unit.billingCycle,
      property: {
        name: unit.property.name,
        city: unit.property.city,
        region: unit.property.region,
        verified: unit.property.ownershipVerifiedAt !== null,
        property_type: unit.property.propertyType,
        facilities: unit.property.facilities,
      },
      photos: unit.photos.map((p) => ({ id: p.id, url: this.photoUrl(p.storageUrl), sort_order: p.sortOrder })),
      created_at: unit.createdAt,
    };
  }

  async getLandlordUnits(landlordId: string) {
    const units = await this.prisma.unit.findMany({
      where: { property: { landlordId } },
      include: {
        property: { select: { id: true, name: true, city: true } },
        photos: { orderBy: { sortOrder: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return units.map((unit) => ({
      ...toUnitResponse(unit),
      cover_photo_url: unit.photos[0] ? this.photoUrl(unit.photos[0].storageUrl) : null,
      // All photos, in order, so the landlord can manage them (remove, pick a cover).
      photos: unit.photos.map((p) => ({ id: p.id, url: this.photoUrl(p.storageUrl), sort_order: p.sortOrder })),
    }));
  }

  // Landlords can edit every aspect of their unit. Only fields that actually
  // change are applied, and each real edit is written to the append-only change
  // log in the same transaction — with whether a tenant was living in the unit
  // at the time, so the platform can tell if details were changed after
  // someone moved in. (A tenancy's own agreed rent is a snapshot on the
  // tenancy and is NOT altered by editing the unit's listed rent here.)
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

    const blankToNull = (v: string | null | undefined) => (v === '' ? null : v);
    const { data, changes } = applyEdits([
      { field: 'label', key: 'label', current: unit.label, next: blankToNull(dto.label) },
      { field: 'bedrooms', key: 'bedrooms', current: unit.bedrooms, next: dto.bedrooms },
      { field: 'bathrooms', key: 'bathrooms', current: unit.bathrooms, next: dto.bathrooms },
      { field: 'facilities', key: 'facilities', current: unit.facilities, next: dto.facilities, unordered: true },
      { field: 'size_sqm', key: 'sizeSqm', current: unit.sizeSqm, next: dto.size_sqm },
      { field: 'rent_amount', key: 'rentAmount', current: unit.rentAmount, next: dto.rent_amount },
      { field: 'currency', key: 'currency', current: unit.currency, next: dto.currency },
      { field: 'billing_cycle', key: 'billingCycle', current: unit.billingCycle, next: dto.billing_cycle },
      { field: 'description', key: 'description', current: unit.description, next: blankToNull(dto.description) },
      { field: 'status', key: 'status', current: unit.status, next: dto.status },
    ]);

    if (changes.length === 0) {
      return toUnitResponse(unit);
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.unit.update({
        where: { id: unitId },
        data,
        include: { property: { select: { id: true, name: true, city: true } } },
      }),
      this.listingChanges.buildRecord({
        entityType: ListingEntityType.unit,
        propertyId: unit.propertyId,
        unitId: unit.id,
        entityLabel: (data.label as string | null | undefined) ?? unit.label,
        changedBy: landlordId,
        action: 'updated',
        changes,
        note: dto.change_note,
        occupiedUnitIds: this.inResidence(unit.status) ? [unit.id] : [],
        propertyVerifiedAtChange: unit.property.ownershipVerifiedAt !== null,
      }),
    ]);

    if (dto.status && dto.status !== unit.status) {
      this.events.emit(UNIT_STATUS_CHANGED, {
        unitId: unit.id,
        previousStatus: unit.status,
        newStatus: dto.status,
      } satisfies UnitStatusChangedEvent);
    }

    return toUnitResponse(updated);
  }

  // Removing a photo is an edit like any other: recorded (with the removed
  // photo's reference kept in the log), and the remaining photos are
  // re-sequenced so sort_order stays contiguous. A vacant unit left with no
  // photos goes back to draft — the same "no photo, not listed" rule as before
  // its first photo was uploaded.
  async deletePhoto(landlordId: string, unitId: string, photoId: string) {
    const unit = await this.getOwnedUnit(landlordId, unitId);
    const photos = await this.prisma.unitPhoto.findMany({ where: { unitId }, orderBy: { sortOrder: 'asc' } });
    const target = photos.find((p) => p.id === photoId);
    if (!target) throw new NotFoundException('Photo not found');

    const remaining = photos.filter((p) => p.id !== photoId);
    await this.prisma.$transaction([
      this.prisma.unitPhoto.delete({ where: { id: photoId } }),
      ...remaining.map((p, i) => this.prisma.unitPhoto.update({ where: { id: p.id }, data: { sortOrder: i } })),
      this.listingChanges.buildRecord({
        entityType: ListingEntityType.unit,
        propertyId: unit.propertyId,
        unitId: unit.id,
        entityLabel: unit.label,
        changedBy: landlordId,
        action: 'photo_removed',
        changes: [{ field: 'photo', from: target.storageUrl, to: null }],
        occupiedUnitIds: this.inResidence(unit.status) ? [unit.id] : [],
        propertyVerifiedAtChange: unit.property.ownershipVerifiedAt !== null,
      }),
    ]);

    let status = unit.status;
    if (remaining.length === 0 && unit.status === UnitStatus.vacant) {
      await this.transitionStatus(unit.id, UnitStatus.vacant, UnitStatus.draft);
      status = UnitStatus.draft;
    }
    return { unit_status: status, photos: this.photoList(remaining.map((p, i) => ({ ...p, sortOrder: i }))) };
  }

  async setCoverPhoto(landlordId: string, unitId: string, photoId: string) {
    const unit = await this.getOwnedUnit(landlordId, unitId);
    const photos = await this.prisma.unitPhoto.findMany({ where: { unitId }, orderBy: { sortOrder: 'asc' } });
    const target = photos.find((p) => p.id === photoId);
    if (!target) throw new NotFoundException('Photo not found');
    if (photos[0].id === photoId) {
      return { unit_status: unit.status, photos: this.photoList(photos) }; // already the cover: nothing to record
    }

    const reordered = [target, ...photos.filter((p) => p.id !== photoId)];
    await this.prisma.$transaction([
      ...reordered.map((p, i) => this.prisma.unitPhoto.update({ where: { id: p.id }, data: { sortOrder: i } })),
      this.listingChanges.buildRecord({
        entityType: ListingEntityType.unit,
        propertyId: unit.propertyId,
        unitId: unit.id,
        entityLabel: unit.label,
        changedBy: landlordId,
        action: 'cover_photo_changed',
        changes: [{ field: 'cover_photo', from: photos[0].storageUrl, to: target.storageUrl }],
        occupiedUnitIds: this.inResidence(unit.status) ? [unit.id] : [],
        propertyVerifiedAtChange: unit.property.ownershipVerifiedAt !== null,
      }),
    ]);
    return { unit_status: unit.status, photos: this.photoList(reordered.map((p, i) => ({ ...p, sortOrder: i }))) };
  }

  private photoList(photos: { id: string; storageUrl: string; sortOrder: number }[]) {
    return photos.map((p) => ({ id: p.id, url: this.photoUrl(p.storageUrl), sort_order: p.sortOrder }));
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
