import { Injectable, NotFoundException } from '@nestjs/common';
import { ListingEntityType, UnitStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { UsersService } from '../auth/users.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { ListListingChangesDto } from './dto/list-listing-changes.dto';
import { applyEdits } from './listing-diff';
import { ListingChangesService } from './listing-changes.service';
import { toUnitResponse } from './unit-response.mapper';

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly listingChanges: ListingChangesService,
  ) {}

  // A tenant is "in residence" while the unit is occupied or under notice
  // (Properties owns unit status; Tenancies drives it through events).
  private static readonly IN_RESIDENCE: UnitStatus[] = [UnitStatus.occupied, UnitStatus.notice_given];

  async listForLandlord(landlordId: string) {
    const properties = await this.prisma.property.findMany({
      where: { landlordId },
      orderBy: { createdAt: 'desc' },
      include: { units: { select: { status: true } } },
    });
    return properties.map((p) => ({
      ...this.toPropertyResponse(p),
      unit_count: p.units.length,
      occupied_unit_count: p.units.filter((u) => PropertiesService.IN_RESIDENCE.includes(u.status)).length,
    }));
  }

  // Landlords can edit everything about their own property except the
  // ownership-verification fields (an admin action). Every real change is
  // written to the append-only change log in the same transaction, together
  // with whether anyone was living in the property's units at the time.
  async updateProperty(landlordId: string, propertyId: string, dto: UpdatePropertyDto) {
    const property = await this.getOwnedProperty(landlordId, propertyId);

    const blankToNull = (v: string | null | undefined) => (v === '' ? null : v);
    const { data, changes } = applyEdits([
      { field: 'name', key: 'name', current: property.name, next: blankToNull(dto.name) },
      { field: 'property_type', key: 'propertyType', current: property.propertyType, next: dto.property_type },
      { field: 'facilities', key: 'facilities', current: property.facilities, next: dto.facilities, unordered: true },
      { field: 'address_line', key: 'addressLine', current: property.addressLine, next: dto.address_line?.trim() },
      { field: 'city', key: 'city', current: property.city, next: dto.city?.trim() },
      { field: 'region', key: 'region', current: property.region, next: blankToNull(dto.region) },
      { field: 'latitude', key: 'latitude', current: property.latitude, next: dto.latitude },
      { field: 'longitude', key: 'longitude', current: property.longitude, next: dto.longitude },
    ]);

    if (changes.length === 0) return this.toPropertyResponse(property);

    const inResidence = await this.prisma.unit.findMany({
      where: { propertyId, status: { in: PropertiesService.IN_RESIDENCE } },
      select: { id: true },
    });

    const [updated] = await this.prisma.$transaction([
      this.prisma.property.update({ where: { id: propertyId }, data }),
      this.listingChanges.buildRecord({
        entityType: ListingEntityType.property,
        propertyId,
        entityLabel: (data.name as string | null | undefined) ?? property.name ?? property.addressLine,
        changedBy: landlordId,
        action: 'updated',
        changes,
        note: dto.change_note,
        occupiedUnitIds: inResidence.map((u) => u.id),
        propertyVerifiedAtChange: property.ownershipVerifiedAt !== null,
      }),
    ]);

    return this.toPropertyResponse(updated);
  }

  // Edits to the landlord's own properties AND units (a unit change records its
  // property too), newest first.
  async listChangesForLandlord(landlordId: string, query: ListListingChangesDto) {
    const owned = await this.prisma.property.findMany({ where: { landlordId }, select: { id: true } });
    return this.listingChanges.listForProperties(
      owned.map((p) => p.id),
      {
        propertyId: query.property_id,
        unitId: query.unit_id,
        whileOccupied: query.while_occupied,
        cursor: query.cursor,
        limit: query.limit ?? 30,
      },
    );
  }

  async createProperty(landlordId: string, dto: CreatePropertyDto) {
    // No dedicated "become a landlord" flow exists (api-specification.md
    // Section 4) — creating a property is what makes you one. Calls
    // Auth's public service, never Auth's Prisma models directly.
    await this.usersService.ensureRole(landlordId, UserRole.landlord);

    const property = await this.prisma.property.create({
      data: {
        landlordId,
        name: dto.name,
        propertyType: dto.property_type,
        facilities: dto.facilities ?? [],
        addressLine: dto.address_line,
        city: dto.city,
        region: dto.region,
        latitude: dto.latitude,
        longitude: dto.longitude,
      },
    });

    return this.toPropertyResponse(property);
  }

  async createUnit(landlordId: string, propertyId: string, dto: CreateUnitDto) {
    const property = await this.getOwnedProperty(landlordId, propertyId);
    const quantity = dto.quantity ?? 1;

    const baseData = {
      propertyId,
      bedrooms: dto.bedrooms,
      bathrooms: dto.bathrooms,
      facilities: dto.facilities ?? [],
      sizeSqm: dto.size_sqm,
      rentAmount: dto.rent_amount,
      currency: dto.currency,
      billingCycle: dto.billing_cycle,
      description: dto.description,
      // status defaults to 'draft' (prisma/schema.prisma) — the schema
      // doc's DDL default of 'vacant' contradicts PRD Epic 2 US-2.1 AC2
      // ("moves from draft to vacant" on first photo), so the DDL default
      // there is a doc inconsistency; this follows the PRD.
    };
    const propertySummary = { id: property.id, name: property.name, city: property.city };

    if (quantity === 1) {
      const unit = await this.prisma.unit.create({ data: { ...baseData, label: dto.label } });
      return toUnitResponse({ ...unit, property: propertySummary });
    }

    // Bulk path (`quantity` > 1): each row is fully independent — its own
    // id, own status/photos/tenancy lifecycle — not a count on a shared
    // row. Only auto-numbers the label ("Studio A #1".."Studio A #N") when
    // a base label was actually given; otherwise every row's label stays
    // null, same as a single unit created without one. Response shape
    // deliberately branches here (array under `units`) rather than always
    // wrapping in an array, so every existing caller that only ever sent
    // quantity 1 (i.e. never sent it at all) keeps getting the exact same
    // single-object response it always has.
    const units = await Promise.all(
      Array.from({ length: quantity }, (_, i) =>
        this.prisma.unit.create({
          data: { ...baseData, label: dto.label ? `${dto.label} #${i + 1}` : undefined },
        }),
      ),
    );
    return { units: units.map((unit) => toUnitResponse({ ...unit, property: propertySummary })) };
  }

  // Used by UnitsService for ownership checks — Properties owns this check
  // since it owns the properties table.
  async getOwnedProperty(landlordId: string, propertyId: string) {
    const property = await this.prisma.property.findUnique({ where: { id: propertyId } });
    if (!property || property.landlordId !== landlordId) {
      // 404 rather than 403 — don't reveal that a property with this id
      // exists under a different landlord.
      throw new NotFoundException('Property not found');
    }
    return property;
  }

  private toPropertyResponse(property: {
    id: string;
    landlordId: string;
    name: string | null;
    propertyType: string | null;
    facilities: string[];
    addressLine: string;
    city: string;
    region: string | null;
    latitude: unknown;
    longitude: unknown;
    ownershipVerifiedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: property.id,
      landlord_id: property.landlordId,
      name: property.name,
      property_type: property.propertyType,
      facilities: property.facilities,
      address_line: property.addressLine,
      city: property.city,
      region: property.region,
      latitude: property.latitude,
      longitude: property.longitude,
      ownership_verified_at: property.ownershipVerifiedAt,
      created_at: property.createdAt,
      updated_at: property.updatedAt,
    };
  }
}
