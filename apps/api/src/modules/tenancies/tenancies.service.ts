import { forwardRef, HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { TenancyStatus, UnitStatus } from '@prisma/client';
import { ApiException } from '../../common/exceptions/api.exception';
import {
  TENANCY_CREATED,
  TENANCY_NOTICE_GIVEN,
  TENANCY_TERMINATED,
  TenancyCreatedEvent,
  TenancyNoticeGivenEvent,
  TenancyTerminatedEvent,
} from '../../common/events/tenancy.events';
import { PAYMENT_CONFIRMED, PaymentConfirmedEvent } from '../../common/events/payment.events';
import { PrismaService } from '../../common/prisma.service';
import { OBJECT_STORAGE, ObjectStorage } from '../../common/storage/object-storage';
import { UnitsService } from '../properties/units.service';
import { UsersService } from '../auth/users.service';
import { PaymentsService } from '../payments/payments.service';
import { ContractsService } from '../contracts/contracts.service';
import { CreateTenancyDto } from './dto/create-tenancy.dto';
import { UpdateReminderSettingsDto } from './dto/update-reminder-settings.dto';
import { CreateTerminationNoticeDto } from './dto/create-termination-notice.dto';
import { generateNoticeDocument } from './notice-document';

// Confirmed by the user (not a placeholder pending legal sign-off anymore)
// — api-specification.md Section 6 and PRD Epic 4 US-4.2 AC1. The DDL
// default happens to match, but this is the value the application layer
// enforces regardless of what the DB column default says.
const STATUTORY_NOTICE_PERIOD_DAYS = 90;

@Injectable()
export class TenanciesService {
  private readonly logger = new Logger(TenanciesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly units: UnitsService,
    private readonly usersService: UsersService,
    private readonly events: EventEmitter2,
    @Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStorage,
    // forwardRef: Payments needs getPaymentConstraints() from us, and the
    // landlord dashboard here needs current_balance from Payments' ledger —
    // a genuine bidirectional read between two closely-related bounded
    // contexts, not a layering mistake. NestJS's documented pattern for it.
    @Inject(forwardRef(() => PaymentsService)) private readonly paymentsService: PaymentsService,
    @Inject(forwardRef(() => ContractsService)) private readonly contractsService: ContractsService,
  ) {}

  async createTenancy(landlordId: string, dto: CreateTenancyDto) {
    const unit = await this.units.getUnitOwnership(dto.unit_id);
    if (unit.landlordId !== landlordId) {
      // 404 rather than 403 — don't reveal that a unit with this id exists
      // under a different landlord, matching Properties/Visits' pattern.
      throw new NotFoundException('Unit not found');
    }
    if (unit.status !== UnitStatus.vacant) {
      throw new ApiException(
        'UNIT_NOT_VACANT',
        `Unit is "${unit.status}", not vacant — cannot start a new tenancy on it.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (!(await this.usersService.exists(dto.tenant_id))) {
      throw new NotFoundException('Tenant not found');
    }

    if (dto.notice_period_days !== undefined && dto.notice_period_days < STATUTORY_NOTICE_PERIOD_DAYS) {
      throw new ApiException(
        'NOTICE_PERIOD_BELOW_STATUTORY_MINIMUM',
        `notice_period_days cannot be set below the statutory minimum of ${STATUTORY_NOTICE_PERIOD_DAYS} days.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const tenancy = await this.prisma.tenancy.create({
      data: {
        unitId: dto.unit_id,
        tenantId: dto.tenant_id,
        landlordId,
        startDate: new Date(dto.start_date),
        rentAmount: dto.rent_amount,
        currency: dto.currency,
        billingCycle: dto.billing_cycle,
        noticePeriodDays: dto.notice_period_days ?? STATUTORY_NOTICE_PERIOD_DAYS,
        maxAdvanceMonths: dto.max_advance_months,
        reminderFirstDaysBefore: dto.reminder_first_days_before,
        reminderSecondDaysBefore: dto.reminder_second_days_before,
      },
    });

    // emitAsync, not emit: Properties' UnitOccupancyListener does a real
    // async DB write in response to this (occupied), and a caller that
    // immediately re-reads unit status must see it — plain emit() is
    // fire-and-forget and would let the response return before that
    // write lands.
    await this.events.emitAsync(TENANCY_CREATED, {
      tenancyId: tenancy.id,
      unitId: tenancy.unitId,
      tenantId: tenancy.tenantId,
      landlordId,
    } satisfies TenancyCreatedEvent);

    return this.toResponse(tenancy);
  }

  async listForLandlord(landlordId: string) {
    const tenancies = await this.prisma.tenancy.findMany({
      where: { landlordId },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(
      tenancies.map(async (t) => ({
        ...this.toResponse(t),
        current_balance: await this.paymentsService.getCurrentBalance(t.id),
        // Same field getById() already surfaces — the occupancy dashboard
        // (this list) needs contract status just as much as the detail
        // view does. Missing here was a real gap the web demo caught live.
        contract_status: await this.contractsService.getLatestStatusForTenancy(t.id),
      })),
    );
  }

  // Mirrors listForLandlord() but scoped to the tenant side — added after
  // live demo feedback (2026-09-18): api-specification.md never defined a
  // tenant-facing "my tenancies" endpoint, so the web demo could only look
  // a tenancy up by pasting its id. This closes that gap the same way
  // listForLandlord() already serves the landlord's occupancy dashboard.
  async listForTenant(tenantId: string) {
    const tenancies = await this.prisma.tenancy.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(
      tenancies.map(async (t) => ({
        ...this.toResponse(t),
        current_balance: await this.paymentsService.getCurrentBalance(t.id),
        contract_status: await this.contractsService.getLatestStatusForTenancy(t.id),
      })),
    );
  }

  async getById(requesterId: string, tenancyId: string) {
    const tenancy = await this.getAccessibleTenancy(requesterId, tenancyId);
    const [currentBalance, recentEntries, contractStatus] = await Promise.all([
      this.paymentsService.getCurrentBalance(tenancyId),
      this.paymentsService.getRecentLedgerEntries(tenancyId, 5),
      this.contractsService.getLatestStatusForTenancy(tenancyId),
    ]);
    return {
      ...this.toResponse(tenancy),
      current_balance: currentBalance,
      recent_ledger_entries: recentEntries,
      contract_status: contractStatus,
    };
  }

  // Public interface for Payments (through this, never a direct read of
  // Tenancies' Prisma models, per CLAUDE.md). Gives Payments everything it
  // needs to validate a payment request in one call, synchronously, rather
  // than maintaining a denormalized event-driven cache of this same data
  // (see the comment in common/events/payment.events.ts).
  async getPaymentConstraints(tenancyId: string) {
    const tenancy = await this.prisma.tenancy.findUnique({
      where: { id: tenancyId },
      include: { terminationNotices: { orderBy: { issuedAt: 'desc' }, take: 1 } },
    });
    if (!tenancy) {
      throw new NotFoundException('Tenancy not found');
    }

    const activeNotice =
      tenancy.status === TenancyStatus.notice_given ? tenancy.terminationNotices[0] : undefined;

    return {
      tenancyId: tenancy.id,
      tenantId: tenancy.tenantId,
      landlordId: tenancy.landlordId,
      status: tenancy.status,
      rentAmount: tenancy.rentAmount,
      billingCycle: tenancy.billingCycle,
      maxAdvanceMonths: tenancy.maxAdvanceMonths,
      activeNoticeEffectiveDate: activeNotice?.effectiveDate ?? null,
    };
  }

  // Public interface for Notifications, which needs to resolve a bare
  // tenancyId (from events like TENANCY_NOTICE_GIVEN/PAYMENT_CONFIRMED
  // that don't carry tenantId/landlordId/unitId directly) to the parties
  // and unit to notify about — never a direct Prisma read of Tenancies'
  // models, per CLAUDE.md's cross-module rule. No access check: this is an
  // internal system lookup triggered by an event listener, not a
  // user-facing request with a requester to authorize.
  async getPartiesForTenancy(tenancyId: string): Promise<{ tenantId: string; landlordId: string; unitId: string } | null> {
    const tenancy = await this.prisma.tenancy.findUnique({
      where: { id: tenancyId },
      select: { tenantId: true, landlordId: true, unitId: true },
    });
    return tenancy ? { tenantId: tenancy.tenantId, landlordId: tenancy.landlordId, unitId: tenancy.unitId } : null;
  }

  // Public interface for Notifications' rent-expiry reminder scheduler
  // (docs/deployment-infrastructure-and-module-schemas.md Section B.7's
  // pseudocode) — never a direct Prisma read of Tenancies' models, per
  // CLAUDE.md's cross-module rule. Mirrors that pseudocode's own candidate
  // query almost exactly; the caller applies the day-by-day threshold
  // logic itself using these fields.
  async listActiveForReminderScan(): Promise<
    {
      id: string;
      tenantId: string;
      landlordId: string;
      unitId: string;
      paidThroughDate: Date | null;
      reminderFirstDaysBefore: number;
      reminderSecondDaysBefore: number;
    }[]
  > {
    const tenancies = await this.prisma.tenancy.findMany({
      where: { status: TenancyStatus.active, paidThroughDate: { not: null } },
      select: {
        id: true,
        tenantId: true,
        landlordId: true,
        unitId: true,
        paidThroughDate: true,
        reminderFirstDaysBefore: true,
        reminderSecondDaysBefore: true,
      },
    });
    return tenancies;
  }

  // Public interface for Contracts (through this, never a direct read of
  // Tenancies' Prisma models, per CLAUDE.md). Reuses the same access check
  // as getById() — api-specification.md Section 8 doesn't mark
  // POST /tenancies/{id}/contracts "(landlord)", so either party may
  // trigger generation, same as viewing the tenancy itself.
  async getContractContext(requesterId: string, tenancyId: string) {
    const tenancy = await this.getAccessibleTenancy(requesterId, tenancyId);
    return this.toResponse(tenancy);
  }

  // payment.confirmed -> recompute paid_through_date, per schema doc B.4's
  // documented event consumption. Uses ONLY the event payload (a running
  // MAX), never a query against Payments' own tables.
  @OnEvent(PAYMENT_CONFIRMED)
  async handlePaymentConfirmed(event: PaymentConfirmedEvent) {
    const tenancy = await this.prisma.tenancy.findUnique({ where: { id: event.tenancyId } });
    if (!tenancy) return;

    const newPeriodEnd = new Date(event.periodEnd);
    if (!tenancy.paidThroughDate || newPeriodEnd > tenancy.paidThroughDate) {
      await this.prisma.tenancy.update({
        where: { id: event.tenancyId },
        data: { paidThroughDate: newPeriodEnd },
      });
    }
  }

  async updateReminderSettings(landlordId: string, tenancyId: string, dto: UpdateReminderSettingsDto) {
    const tenancy = await this.getOwnedTenancy(landlordId, tenancyId);
    const updated = await this.prisma.tenancy.update({
      where: { id: tenancy.id },
      data: {
        reminderFirstDaysBefore: dto.reminder_first_days_before,
        reminderSecondDaysBefore: dto.reminder_second_days_before,
      },
    });
    return this.toResponse(updated);
  }

  async createTerminationNotice(landlordId: string, tenancyId: string, dto: CreateTerminationNoticeDto) {
    const tenancy = await this.getOwnedTenancy(landlordId, tenancyId);

    if (tenancy.status === TenancyStatus.terminated || tenancy.status === TenancyStatus.expired) {
      throw new ApiException(
        'TENANCY_NOT_ACTIVE',
        `Tenancy is already "${tenancy.status}" — cannot issue a termination notice.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const issuedAt = new Date();
    const effectiveDate = new Date(dto.effective_date);
    const earliestValid = new Date(issuedAt);
    earliestValid.setDate(earliestValid.getDate() + tenancy.noticePeriodDays);

    if (effectiveDate < earliestValid) {
      throw new ApiException(
        'NOTICE_PERIOD_TOO_SHORT',
        `effective_date must be on or after ${earliestValid.toISOString().slice(0, 10)} ` +
          `(this tenancy's notice_period_days is ${tenancy.noticePeriodDays}).`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const documentText = generateNoticeDocument({
      tenancyId: tenancy.id,
      reason: dto.reason,
      reasonDetail: dto.reason_detail,
      issuedAt,
      effectiveDate: dto.effective_date,
      noticePeriodDays: tenancy.noticePeriodDays,
    });
    const documentUrl = await this.objectStorage.upload(
      'termination-notices',
      Buffer.from(documentText, 'utf-8'),
      `${tenancy.id}.txt`,
    );

    const notice = await this.prisma.terminationNotice.create({
      data: {
        tenancyId: tenancy.id,
        issuedBy: landlordId,
        reason: dto.reason,
        reasonDetail: dto.reason_detail,
        issuedAt,
        effectiveDate,
        documentUrl,
        // Real multi-channel delivery (PRD Epic 4 US-4.2 AC2: SMS + WhatsApp
        // + Email + Push + In-app fan-out) is now wired — the Notifications
        // module (build order #7) subscribes to TENANCY_NOTICE_GIVEN below
        // and fans out for real. delivery_channel/delivery_confirmed_at on
        // THIS row stay null deliberately, though: with 5 possible channels
        // each with its own status, a single "the" delivery channel/
        // timestamp on the notice itself can't represent that. The
        // Notifications module's own `notifications` table (queryable by
        // `payload.tenancyId`) is the real, richer evidentiary record per
        // channel — timestamp, channel, provider, status — satisfying
        // AC3 there instead of duplicating a flattened summary here.
      },
    });
    this.logger.log(`Termination notice ${notice.id} generated for tenancy ${tenancy.id}; fan-out delivery handled by Notifications.`);

    await this.prisma.tenancy.update({ where: { id: tenancy.id }, data: { status: TenancyStatus.notice_given } });

    this.events.emit(TENANCY_NOTICE_GIVEN, {
      tenancyId: tenancy.id,
      terminationNoticeId: notice.id,
      effectiveDate: dto.effective_date,
    } satisfies TenancyNoticeGivenEvent);

    return this.toNoticeResponse(notice);
  }

  async listTerminationNotices(requesterId: string, tenancyId: string) {
    await this.getAccessibleTenancy(requesterId, tenancyId);
    const notices = await this.prisma.terminationNotice.findMany({
      where: { tenancyId },
      orderBy: { issuedAt: 'desc' },
    });
    return notices.map((n) => this.toNoticeResponse(n));
  }

  // PRD Epic 4 US-4.2: a tenancy under notice must actually terminate once
  // the effective date arrives — nothing in api-specification.md exposes a
  // manual "terminate" endpoint, so this is system-driven. Runs in-process
  // (not the worker) specifically so it shares the EventEmitter2 bus that
  // Properties' UnitOccupancyListener subscribes to.
  @Cron('*/15 * * * *')
  async sweepNoticeExpirations() {
    const candidates = await this.prisma.tenancy.findMany({
      where: { status: TenancyStatus.notice_given, terminationNotices: { some: { effectiveDate: { lte: new Date() } } } },
      include: { terminationNotices: { orderBy: { issuedAt: 'desc' }, take: 1 } },
    });

    let terminatedCount = 0;
    for (const tenancy of candidates) {
      const latestNotice = tenancy.terminationNotices[0];
      if (!latestNotice || latestNotice.effectiveDate > new Date()) continue;

      await this.prisma.tenancy.update({ where: { id: tenancy.id }, data: { status: TenancyStatus.terminated } });
      // emitAsync — see the comment in createTenancy(); same reasoning.
      await this.events.emitAsync(TENANCY_TERMINATED, {
        tenancyId: tenancy.id,
        unitId: tenancy.unitId,
      } satisfies TenancyTerminatedEvent);
      terminatedCount++;
    }

    if (terminatedCount > 0) {
      this.logger.log(`tenancy_notice_expiry_sweep: terminated ${terminatedCount} tenanc(y/ies).`);
    }
  }

  private async getOwnedTenancy(landlordId: string, tenancyId: string) {
    const tenancy = await this.prisma.tenancy.findUnique({ where: { id: tenancyId } });
    if (!tenancy || tenancy.landlordId !== landlordId) {
      throw new NotFoundException('Tenancy not found');
    }
    return tenancy;
  }

  // GET /tenancies/{id} and its termination-notice history aren't marked
  // "(landlord)" in api-specification.md the way the mutating endpoints
  // are — the tenant party has a reasonable claim to view their own
  // tenancy, so both sides of it get read access.
  private async getAccessibleTenancy(requesterId: string, tenancyId: string) {
    const tenancy = await this.prisma.tenancy.findUnique({ where: { id: tenancyId } });
    if (!tenancy || (tenancy.landlordId !== requesterId && tenancy.tenantId !== requesterId)) {
      throw new NotFoundException('Tenancy not found');
    }
    return tenancy;
  }

  private monthsPaidAhead(paidThroughDate: Date | null): number {
    if (!paidThroughDate) return 0;
    const today = new Date();
    const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    if (paidThroughDate <= todayUtc) return 0;
    const months =
      (paidThroughDate.getUTCFullYear() - todayUtc.getUTCFullYear()) * 12 +
      (paidThroughDate.getUTCMonth() - todayUtc.getUTCMonth());
    return Math.max(0, months);
  }

  private toResponse(tenancy: {
    id: string;
    unitId: string;
    tenantId: string;
    landlordId: string;
    startDate: Date;
    rentAmount: unknown;
    currency: string;
    billingCycle: string;
    noticePeriodDays: number;
    maxAdvanceMonths: number;
    paidThroughDate: Date | null;
    reminderFirstDaysBefore: number;
    reminderSecondDaysBefore: number;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: tenancy.id,
      unit_id: tenancy.unitId,
      tenant_id: tenancy.tenantId,
      landlord_id: tenancy.landlordId,
      start_date: tenancy.startDate.toISOString().slice(0, 10),
      rent_amount: tenancy.rentAmount,
      currency: tenancy.currency,
      billing_cycle: tenancy.billingCycle,
      notice_period_days: tenancy.noticePeriodDays,
      max_advance_months: tenancy.maxAdvanceMonths,
      paid_through_date: tenancy.paidThroughDate ? tenancy.paidThroughDate.toISOString().slice(0, 10) : null,
      // How many whole calendar months of rent this tenancy is currently
      // paid ahead of today — landlord-visible "how far ahead has this
      // tenant paid" indicator requested after the live demo (2026-09-18).
      // Deliberately a simple whole-month count, not tied to billing_cycle,
      // since it's a demo convenience field, not a billing calculation
      // (expectedAmountFor in PaymentsService remains the source of truth
      // for what a payment must actually cover).
      months_paid_ahead: this.monthsPaidAhead(tenancy.paidThroughDate),
      reminder_first_days_before: tenancy.reminderFirstDaysBefore,
      reminder_second_days_before: tenancy.reminderSecondDaysBefore,
      status: tenancy.status,
      created_at: tenancy.createdAt,
      updated_at: tenancy.updatedAt,
    };
  }

  private toNoticeResponse(notice: {
    id: string;
    tenancyId: string;
    issuedBy: string;
    reason: string | null;
    reasonDetail: string | null;
    issuedAt: Date;
    effectiveDate: Date;
    documentUrl: string | null;
    deliveryChannel: string | null;
    deliveryConfirmedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: notice.id,
      tenancy_id: notice.tenancyId,
      issued_by: notice.issuedBy,
      reason: notice.reason,
      reason_detail: notice.reasonDetail,
      issued_at: notice.issuedAt,
      effective_date: notice.effectiveDate.toISOString().slice(0, 10),
      document_url: notice.documentUrl,
      delivery_channel: notice.deliveryChannel,
      delivery_confirmed_at: notice.deliveryConfirmedAt,
      created_at: notice.createdAt,
    };
  }
}
