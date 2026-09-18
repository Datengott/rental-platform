import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { UsersService } from '../auth/users.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { CreateUnitDto } from './dto/create-unit.dto';
import { toUnitResponse } from './unit-response.mapper';

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

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
