import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ListingEntityType, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { toPublicMediaUrl } from '../../common/storage/public-url';
import { UsersService } from '../auth/users.service';
import { FieldChange } from './listing-diff';

export interface RecordListingChange {
  entityType: ListingEntityType;
  propertyId: string;
  unitId?: string | null;
  entityLabel: string | null;
  changedBy: string;
  action: 'updated' | 'photo_added' | 'photo_removed' | 'cover_photo_changed';
  changes: FieldChange[];
  note?: string | null;
  occupiedUnitIds: string[];
  propertyVerifiedAtChange: boolean;
}

export interface ListingChangeFilters {
  propertyIds?: string[];
  propertyId?: string;
  unitId?: string;
  whileOccupied?: boolean;
  cursor?: string;
  limit: number;
}

type ChangeRow = {
  id: string;
  entityType: ListingEntityType;
  propertyId: string;
  unitId: string | null;
  entityLabel: string | null;
  changedBy: string;
  action: string;
  changes: Prisma.JsonValue;
  note: string | null;
  occupiedUnitIds: string[];
  propertyVerifiedAtChange: boolean;
  createdAt: Date;
};

// Append-only: this service only ever INSERTs into listing_changes (see the
// model's comment in schema.prisma) — no update or delete path exists.
@Injectable()
export class ListingChangesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  // Returns the un-awaited Prisma promise so callers can put the edit and its
  // audit row in ONE transaction — an edit must never land without its record.
  buildRecord(input: RecordListingChange) {
    return this.prisma.listingChange.create({
      data: {
        entityType: input.entityType,
        propertyId: input.propertyId,
        unitId: input.unitId ?? null,
        entityLabel: input.entityLabel,
        changedBy: input.changedBy,
        action: input.action,
        changes: input.changes as unknown as Prisma.InputJsonValue,
        note: input.note?.trim() ? input.note.trim() : null,
        occupiedUnitIds: input.occupiedUnitIds,
        propertyVerifiedAtChange: input.propertyVerifiedAtChange,
      },
    });
  }

  private where(filters: ListingChangeFilters): Prisma.ListingChangeWhereInput {
    return {
      ...(filters.propertyIds ? { propertyId: { in: filters.propertyIds } } : {}),
      ...(filters.propertyId ? { propertyId: filters.propertyId } : {}),
      ...(filters.unitId ? { unitId: filters.unitId } : {}),
      ...(filters.whileOccupied ? { occupiedUnitIds: { isEmpty: false } } : {}),
    };
  }

  private async page(filters: ListingChangeFilters, extraWhere?: Prisma.ListingChangeWhereInput) {
    const rows = await this.prisma.listingChange.findMany({
      where: { AND: [this.where(filters), extraWhere ?? {}] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filters.limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > filters.limit;
    const pageRows = hasMore ? rows.slice(0, filters.limit) : rows;
    return { rows: pageRows, next_cursor: hasMore ? pageRows[pageRows.length - 1].id : null };
  }

  // A landlord's view of edits to their own listings.
  async listForProperties(propertyIds: string[], filters: Omit<ListingChangeFilters, 'propertyIds' | 'limit'> & { limit: number }) {
    if (propertyIds.length === 0) return { results: [], next_cursor: null };
    const { rows, next_cursor } = await this.page({ ...filters, propertyIds });
    return { results: rows.map((r) => this.toResponse(r, { includeActor: true })), next_cursor };
  }

  // The platform's view: everything, with who made each change.
  async listForAdmin(filters: ListingChangeFilters) {
    const { rows, next_cursor } = await this.page(filters);
    const actorIds = [...new Set(rows.map((r) => r.changedBy))];
    const actors = new Map<string, { name: string | null; phone_number: string | null }>();
    await Promise.all(
      actorIds.map(async (id) => {
        try {
          const p = await this.usersService.getPublicProfile(id);
          actors.set(id, { name: p.fullName, phone_number: p.phoneNumber });
        } catch {
          actors.set(id, { name: null, phone_number: null }); // account since removed
        }
      }),
    );
    return {
      results: rows.map((r) => ({ ...this.toResponse(r, { includeActor: true }), changed_by_profile: actors.get(r.changedBy) })),
      next_cursor,
    };
  }

  // What a tenant (or the landlord) sees for one tenancy: edits made to that
  // unit, and to its property, since the tenancy was created. The actor's id is
  // left out — to a tenant it's simply "your landlord".
  async listForTenancy(input: { unitId: string; propertyId: string; since: Date; limit?: number }) {
    const { rows } = await this.page(
      { limit: input.limit ?? 50 },
      {
        createdAt: { gte: input.since },
        OR: [{ unitId: input.unitId }, { entityType: ListingEntityType.property, propertyId: input.propertyId }],
      },
    );
    return { results: rows.map((r) => this.toResponse(r, { includeActor: false })) };
  }

  private publicValue(field: string, value: unknown): unknown {
    // Stored photo references are internal; show what a browser can load.
    if ((field === 'photo' || field === 'cover_photo') && typeof value === 'string') {
      const base = this.config.get<string>('API_PUBLIC_URL') ?? `http://localhost:${this.config.get<string>('PORT') ?? 3000}`;
      return toPublicMediaUrl(value, base);
    }
    return value;
  }

  private toResponse(row: ChangeRow, opts: { includeActor: boolean }) {
    const changes = (row.changes as unknown as FieldChange[]).map((c) => ({
      field: c.field,
      from: this.publicValue(c.field, c.from),
      to: this.publicValue(c.field, c.to),
    }));
    return {
      id: row.id,
      entity_type: row.entityType,
      property_id: row.propertyId,
      unit_id: row.unitId,
      entity_label: row.entityLabel,
      action: row.action,
      changes,
      note: row.note,
      // True when someone was living in an affected unit at the time.
      while_occupied: row.occupiedUnitIds.length > 0,
      occupied_unit_ids: row.occupiedUnitIds,
      property_verified_at_change: row.propertyVerifiedAtChange,
      ...(opts.includeActor ? { changed_by: row.changedBy } : {}),
      created_at: row.createdAt,
    };
  }
}
