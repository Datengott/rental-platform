import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
import { PrismaService } from '../../common/prisma.service';
import { OBJECT_STORAGE, ObjectStorage } from '../../common/storage/object-storage';
import { UnitsService } from '../properties/units.service';
import { UsersService } from '../auth/users.service';
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
    // current_balance would come from the Payments ledger (module #5,
    // doesn't exist yet) — 0 is the honest value for "no ledger exists",
    // not a fabricated number. Same for paid_through_date via toResponse.
    return tenancies.map((t) => ({ ...this.toResponse(t), current_balance: 0 }));
  }

  async getById(requesterId: string, tenancyId: string) {
    const tenancy = await this.getAccessibleTenancy(requesterId, tenancyId);
    return {
      ...this.toResponse(tenancy),
      current_balance: 0,
      // Contracts (#6) and Payments (#5) don't exist yet.
      contract_status: null,
      recent_ledger_entries: [],
    };
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
        // + Email + Push + In-app fan-out) needs the Notifications module
        // (build order #7), which doesn't exist yet — delivery_channel and
        // delivery_confirmed_at stay null until it does. Logged here so the
        // gap is visible rather than silently faked.
      },
    });
    this.logger.log(`Termination notice ${notice.id} generated for tenancy ${tenancy.id}; delivery not yet wired.`);

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
