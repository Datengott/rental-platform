import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { UsersService } from '../auth/users.service';
import { UnitsService } from '../properties/units.service';
import { PaymentsService } from '../payments/payments.service';
import { ListAuditLogDto } from './dto/list-audit-log.dto';

export type AdminActionType = 'kyc_approved' | 'listing_flagged' | 'listing_unflagged' | 'listing_removed';
export type AdminTargetType = 'user' | 'unit';

// The Admin module: mostly a read/action layer over the other modules'
// public services, per the schema doc's B.9 — it owns exactly one table of
// its own, admin_actions_log, and never reaches into another module's
// tables directly (see CLAUDE.md's cross-module rule; UnitsService,
// UsersService and PaymentsService are all called through their own public
// interfaces here).
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly unitsService: UnitsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  // Every state-changing admin action goes through this — either called
  // directly (this module's own flag/unflag/remove endpoints below) or from
  // AdminAuditListener reacting to an event another module's own endpoint
  // published (kyc_approved). Purely an audit trail, never a bypass around
  // the owning module's API.
  async record(input: {
    adminId: string;
    actionType: AdminActionType;
    targetType: AdminTargetType;
    targetId: string;
    detail?: Record<string, unknown>;
  }) {
    await this.prisma.adminActionLog.create({
      data: {
        adminId: input.adminId,
        actionType: input.actionType,
        targetType: input.targetType,
        targetId: input.targetId,
        detail: (input.detail ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  // ---- KYC queue ----

  async listKycQueue() {
    const pending = await this.usersService.listPendingKyc();
    return {
      results: pending.map((u) => ({
        id: u.id,
        full_name: u.fullName,
        phone_number: u.phoneNumber,
        locale: u.locale,
        id_document_type: u.idDocumentType,
        id_document_ref: u.idDocumentRef,
        id_document_url: u.idDocumentUrl,
        submitted_at: u.submittedAt,
      })),
    };
  }

  // ---- Listing moderation ----

  async listFlaggedListings() {
    const flagged = await this.unitsService.listFlaggedUnits();
    const landlordIds = [...new Set(flagged.map((u) => u.landlord_id))];
    const landlords = new Map<string, { name: string | null; phone_number: string | null }>();
    await Promise.all(
      landlordIds.map(async (id) => {
        try {
          const p = await this.usersService.getPublicProfile(id);
          landlords.set(id, { name: p.fullName, phone_number: p.phoneNumber });
        } catch {
          landlords.set(id, { name: null, phone_number: null }); // account since removed
        }
      }),
    );
    return { results: flagged.map((u) => ({ ...u, landlord: landlords.get(u.landlord_id) })) };
  }

  async flagListing(unitId: string, adminId: string, reason: string) {
    const { updated } = await this.unitsService.flagUnit(unitId, adminId, reason);
    await this.record({ adminId, actionType: 'listing_flagged', targetType: 'unit', targetId: unitId, detail: { reason } });
    return { id: updated.id, flagged: true, flag_reason: updated.flagReason, flagged_at: updated.flaggedAt };
  }

  async unflagListing(unitId: string, adminId: string) {
    const updated = await this.unitsService.unflagUnit(unitId);
    if (updated.flaggedAt === null) {
      await this.record({ adminId, actionType: 'listing_unflagged', targetType: 'unit', targetId: unitId });
    }
    return { id: updated.id, flagged: false };
  }

  async removeListing(unitId: string, adminId: string, reason: string) {
    const { updated } = await this.unitsService.removeUnit(unitId, adminId);
    await this.record({ adminId, actionType: 'listing_removed', targetType: 'unit', targetId: unitId, detail: { reason } });
    return { id: updated.id, status: updated.status, flagged: false };
  }

  // ---- Payment disputes ----

  async listPaymentDisputes() {
    return this.paymentsService.listDisputes();
  }

  // ---- Audit log ----

  async listAuditLog(query: ListAuditLogDto) {
    const limit = query.limit ?? 30;
    const where: Prisma.AdminActionLogWhereInput = {
      ...(query.target_type ? { targetType: query.target_type } : {}),
      ...(query.target_id ? { targetId: query.target_id } : {}),
    };
    const rows = await this.prisma.adminActionLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const adminIds = [...new Set(page.map((r) => r.adminId))];
    const admins = new Map<string, { name: string | null; phone_number: string | null }>();
    await Promise.all(
      adminIds.map(async (id) => {
        try {
          const p = await this.usersService.getPublicProfile(id);
          admins.set(id, { name: p.fullName, phone_number: p.phoneNumber });
        } catch {
          admins.set(id, { name: null, phone_number: null }); // account since removed
        }
      }),
    );

    return {
      results: page.map((r) => ({
        id: r.id,
        admin_id: r.adminId,
        admin_profile: admins.get(r.adminId),
        action_type: r.actionType,
        target_type: r.targetType,
        target_id: r.targetId,
        detail: r.detail,
        created_at: r.createdAt,
      })),
      next_cursor: hasMore ? page[page.length - 1].id : null,
    };
  }
}
