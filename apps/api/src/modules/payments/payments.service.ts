import { forwardRef, HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { LedgerEntryType, PaymentProvider, PaymentStatus } from '@prisma/client';
import { ApiException } from '../../common/exceptions/api.exception';
import { monthsCovered } from '../../common/format/period';
import {
  PAYMENT_CONFIRMED,
  PAYMENT_FAILED,
  PAYMENT_INITIATED,
  PaymentConfirmedEvent,
  PaymentFailedEvent,
  PaymentInitiatedEvent,
} from '../../common/events/payment.events';
import { PrismaService } from '../../common/prisma.service';
import { OBJECT_STORAGE, ObjectStorage } from '../../common/storage/object-storage';
import { TenanciesService } from '../tenancies/tenancies.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ListAdminPaymentsDto } from './dto/list-admin-payments.dto';
import { PAYMENT_GATEWAY, PaymentGateway } from './gateway/payment-gateway';
import { generateReceiptDocument } from './receipt-document';
import { getWebhookSecret, verifyWebhookSignature } from './webhook-signature';

const BILLING_CYCLE_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, biannual: 6 };

// Not spec-required, but CLAUDE.md calls this "the module to be most
// conservative and rigorous with" — a payment amount that doesn't match
// whole billing cycles of rent is rejected rather than silently accepted.
const PAYMENT_AMOUNT_MISMATCH = 'PAYMENT_AMOUNT_MISMATCH';

// A pending payment past this age gets reconciled even if the simulated
// webhook's self-call never lands — see the comment on SimulatedPaymentGateway.
const RECONCILIATION_THRESHOLD_MS = 20_000;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
    @Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStorage,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    // forwardRef — see the comment in tenancies.service.ts.
    @Inject(forwardRef(() => TenanciesService)) private readonly tenanciesService: TenanciesService,
  ) {}

  async initiatePayment(tenantId: string, tenancyId: string, idempotencyKey: string, dto: CreatePaymentDto) {
    const existing = await this.prisma.payment.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return this.replayOrConflict(existing, tenancyId, dto);
    }

    const constraints = await this.tenanciesService.getPaymentConstraints(tenancyId);
    if (constraints.tenantId !== tenantId) {
      throw new NotFoundException('Tenancy not found');
    }

    const periodStart = new Date(dto.period_start);
    const periodEnd = new Date(dto.period_end);

    // Billing starts on the tenancy's start date (which the landlord can set
    // to something other than the day the tenancy was created): rent can't
    // be paid for any period before it.
    if (periodStart < constraints.startDate) {
      throw new ApiException(
        'PAYMENT_BEFORE_TENANCY_START',
        `period_start cannot be before this tenancy's start date (${constraints.startDate.toISOString().slice(0, 10)}) — billing starts on that date.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (constraints.activeNoticeEffectiveDate && periodEnd > constraints.activeNoticeEffectiveDate) {
      throw new ApiException(
        'PAYMENT_BEYOND_NOTICE_EFFECTIVE_DATE',
        `period_end cannot be after this tenancy's termination notice effective date ` +
          `(${constraints.activeNoticeEffectiveDate.toISOString().slice(0, 10)}).`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const advanceCapDate = new Date();
    advanceCapDate.setMonth(advanceCapDate.getMonth() + constraints.maxAdvanceMonths);
    if (periodEnd > advanceCapDate) {
      throw new ApiException(
        'PAYMENT_EXCEEDS_ADVANCE_MONTHS_CAP',
        `period_end is more than ${constraints.maxAdvanceMonths} month(s) ahead, ` +
          `which exceeds this tenancy's advance-payment cap.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const expectedAmount = this.expectedAmountFor(periodStart, periodEnd, constraints);
    if (expectedAmount !== null && dto.amount !== expectedAmount) {
      throw new ApiException(
        PAYMENT_AMOUNT_MISMATCH,
        `amount ${dto.amount} does not match the expected ${expectedAmount} for this period ` +
          `(rent ${String(constraints.rentAmount)} per ${constraints.billingCycle} cycle).`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const payment = await this.prisma.payment.create({
      data: {
        tenancyId,
        tenantId,
        amount: dto.amount,
        currency: dto.currency,
        periodStart,
        periodEnd,
        provider: dto.provider,
        idempotencyKey,
        status: PaymentStatus.pending,
      },
    });

    this.events.emit(PAYMENT_INITIATED, {
      paymentId: payment.id,
      tenancyId,
      tenantId,
    } satisfies PaymentInitiatedEvent);

    const { providerTxnRef } = await this.gateway.charge({
      amount: dto.amount,
      currency: dto.currency,
      provider: dto.provider,
      idempotencyKey,
    });
    await this.prisma.payment.update({ where: { id: payment.id }, data: { providerTxnRef } });

    return { payment_id: payment.id, status: PaymentStatus.pending };
  }

  // Verifies the signature itself (not the controller) so unit tests can
  // exercise it without an HTTP layer; always stores the raw payload for
  // audit purposes regardless of verification outcome, per the DDL.
  async processWebhook(provider: string, rawBody: string, signature: string | undefined) {
    const secret = getWebhookSecret(provider, this.config);
    const signatureVerified = !!signature && verifyWebhookSignature(rawBody, signature, secret);
    const body = JSON.parse(rawBody) as {
      provider_txn_ref: string;
      idempotency_key: string;
      status: string;
    };

    await this.prisma.paymentWebhookRaw.create({
      data: { provider, payload: body, signatureVerified },
    });

    if (!signatureVerified) {
      this.logger.warn(`Rejected webhook from ${provider}: invalid or missing signature.`);
      return; // still acknowledged 200 by the controller — see B.5.
    }

    await this.applyProviderResult(body.idempotency_key, body.status);
  }

  // --- Rent the landlord records as already paid when creating a tenancy ---
  //
  // Demo feedback (2026-09-20): a tenant often hands over several months of
  // rent in cash before moving in, and the landlord should be able to say so
  // at tenancy creation. That's real money received, so it goes through the
  // exact same path as any confirmed payment — an append-only ledger credit,
  // a receipt, the payment.confirmed event (which advances paid_through_date
  // and notifies the tenant) — just with provider 'offline' and no
  // aggregator call. The ledger is never edited or backfilled directly.
  //
  // Split in two so Tenancies can validate BEFORE it creates anything (a bad
  // request must not leave a half-created tenancy behind), then record after.
  //
  // Follows this module's existing calendar-month convention (see
  // expectedAmountFor): the covered period starts on the tenancy's start
  // date and ends on the last day of the Nth calendar month. Deliberately
  // NOT capped by the tenancy's max_advance_months — that cap limits what a
  // tenant may pay through the platform; a landlord recording cash they
  // actually received is stating a fact, not requesting a permission.
  planPrepaidRent(input: {
    rentAmount: unknown;
    billingCycle: string;
    startDate: Date;
    months: number;
    // YYYY-MM-DD the money actually changed hands; defaults to now.
    paidOn?: string;
  }): { amount: number; periodStart: Date; periodEnd: Date; paidAt: Date } {
    const cycleMonths = BILLING_CYCLE_MONTHS[input.billingCycle] ?? 1;
    if (input.months % cycleMonths !== 0) {
      throw new ApiException(
        'PREPAID_MONTHS_INVALID_FOR_BILLING_CYCLE',
        `prepaid_months must be a whole number of ${input.billingCycle} cycles (a multiple of ${cycleMonths}).`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ field: 'prepaid_months', message: `must be a multiple of ${cycleMonths}` }],
      );
    }
    const periodStart = input.startDate;
    // Day 0 of the following month = last day of the Nth month from the start.
    const periodEnd = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + input.months, 0));
    return {
      amount: Number(input.rentAmount) * (input.months / cycleMonths),
      periodStart,
      periodEnd,
      paidAt: this.resolvePaidAt(input.paidOn),
    };
  }

  // A recorded payment can't be dated in the future. One day of slack, since
  // "today" in the landlord's timezone can already be tomorrow in UTC. Noon
  // UTC so the calendar day survives any timezone when it's displayed.
  private resolvePaidAt(paidOn?: string): Date {
    if (!paidOn) return new Date();
    const paidAt = new Date(`${paidOn}T12:00:00Z`);
    if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      throw new ApiException(
        'PREPAID_PAID_ON_INVALID',
        'prepaid_paid_on must be a real date that is not in the future.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ field: 'prepaid_paid_on', message: 'must not be in the future' }],
      );
    }
    return paidAt;
  }

  async recordPrepaidRent(
    tenancy: { id: string; tenantId: string; currency: string },
    plan: { amount: number; periodStart: Date; periodEnd: Date; paidAt: Date },
    recordedByLandlordId: string,
  ): Promise<{ payment_id: string }> {
    const payment = await this.prisma.payment.create({
      data: {
        tenancyId: tenancy.id,
        tenantId: tenancy.tenantId,
        amount: plan.amount,
        currency: tenancy.currency,
        periodStart: plan.periodStart,
        periodEnd: plan.periodEnd,
        provider: PaymentProvider.offline,
        // Audit trail for who vouched for this payment — there's no aggregator
        // transaction to reference, and no "recorded_by" column to put it in.
        providerTxnRef: `landlord-recorded:${recordedByLandlordId}`,
        idempotencyKey: `offline-${randomUUID()}`,
        status: PaymentStatus.pending,
      },
    });
    await this.confirmPayment(payment, plan.paidAt);
    return { payment_id: payment.id };
  }

  async getLedger(requesterId: string, tenancyId: string, cursor?: string, limit = 20) {
    const constraints = await this.tenanciesService.getPaymentConstraints(tenancyId);
    if (constraints.tenantId !== requesterId && constraints.landlordId !== requesterId) {
      throw new NotFoundException('Tenancy not found');
    }

    const entries = await this.prisma.ledgerEntry.findMany({
      where: { tenancyId },
      include: { payment: { select: { provider: true, periodStart: true, periodEnd: true, confirmedAt: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = entries.length > limit;
    const page = hasMore ? entries.slice(0, limit) : entries;

    return {
      current_balance: await this.getCurrentBalance(tenancyId),
      entries: page.map((e) => this.toLedgerEntryResponse(e)),
      next_cursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  // Public interface for Tenancies' dashboard (through this, never a
  // direct read of this module's Prisma models).
  async getCurrentBalance(tenancyId: string): Promise<number> {
    const latest = await this.prisma.ledgerEntry.findFirst({
      where: { tenancyId },
      orderBy: { createdAt: 'desc' },
    });
    return latest ? Number(latest.runningBalance) : 0;
  }

  async getRecentLedgerEntries(tenancyId: string, limit: number) {
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { tenancyId },
      include: { payment: { select: { provider: true, periodStart: true, periodEnd: true, confirmedAt: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return entries.map((e) => this.toLedgerEntryResponse(e));
  }

  async getReceipt(requesterId: string, paymentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    const constraints = await this.tenanciesService.getPaymentConstraints(payment.tenancyId);
    if (constraints.tenantId !== requesterId && constraints.landlordId !== requesterId) {
      throw new NotFoundException('Payment not found');
    }
    if (!payment.receiptUrl) {
      throw new ApiException(
        'RECEIPT_NOT_AVAILABLE',
        `Payment is "${payment.status}" — a receipt is only generated once a payment confirms.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    // A real R2-backed receipt_url would be a signed, time-limited download
    // link (per api-specification.md) — LocalDiskObjectStorage has no such
    // feature yet, so this is the same stored pointer every time.
    return { download_url: payment.receiptUrl };
  }

  async listForAdmin(dto: ListAdminPaymentsDto) {
    const payments = await this.prisma.payment.findMany({
      where: { status: dto.status },
      orderBy: { initiatedAt: 'desc' },
    });
    return payments.map((p) => this.toPaymentResponse(p));
  }

  // Public interface for the Admin module's payments/disputes view (never a
  // direct Prisma read of Payments' own tables, per CLAUDE.md's cross-module
  // rule). "Needs manual review" = stuck outside the two healthy end states
  // (confirmed, or pending-and-still-within-the-reconciliation-window):
  // `failed` (the aggregator rejected it) or `reconciling` (the 15s sweep in
  // reconcilePendingPayments() above already tried once and it's still not
  // resolved) — a `pending` payment younger than that isn't a dispute yet.
  async listDisputes() {
    const payments = await this.prisma.payment.findMany({
      where: { status: { in: [PaymentStatus.failed, PaymentStatus.reconciling] } },
      orderBy: { initiatedAt: 'desc' },
    });
    return payments.map((p) => this.toPaymentResponse(p));
  }

  // Safety net for AC3 (PRD Epic 5 US-5.1): if the simulated webhook's
  // self-call never lands, a payment must not stay stuck forever. Runs
  // in-process so it shares the event bus Tenancies' paid_through_date
  // listener subscribes to (same reasoning as Tenancies' own notice sweep).
  @Cron('*/15 * * * * *')
  async reconcilePendingPayments() {
    const cutoff = new Date(Date.now() - RECONCILIATION_THRESHOLD_MS);
    const stale = await this.prisma.payment.findMany({
      where: { status: PaymentStatus.pending, initiatedAt: { lt: cutoff } },
    });

    for (const payment of stale) {
      this.logger.log(`Reconciling stale pending payment ${payment.id} (polling simulated provider)`);
      // The simulated gateway has no real transaction-status endpoint to
      // poll — it always confirms, matching the "always succeeds" design
      // noted on SimulatedPaymentGateway. A real gateway integration would
      // call its status API here instead of assuming success.
      await this.applyProviderResult(payment.idempotencyKey, 'confirmed');
    }
  }

  private replayOrConflict(
    existing: { tenancyId: string; amount: unknown; currency: string; periodStart: Date; periodEnd: Date; provider: string; id: string; status: string },
    tenancyId: string,
    dto: CreatePaymentDto,
  ) {
    const matches =
      existing.tenancyId === tenancyId &&
      Number(existing.amount) === dto.amount &&
      existing.currency === dto.currency &&
      existing.periodStart.toISOString().slice(0, 10) === dto.period_start &&
      existing.periodEnd.toISOString().slice(0, 10) === dto.period_end &&
      existing.provider === dto.provider;

    if (!matches) {
      throw new ApiException(
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used with a different request payload.',
        HttpStatus.CONFLICT,
      );
    }
    return { payment_id: existing.id, status: existing.status };
  }

  private async applyProviderResult(idempotencyKey: string, status: string) {
    const payment = await this.prisma.payment.findUnique({ where: { idempotencyKey } });
    if (!payment || payment.status !== PaymentStatus.pending) {
      return; // unknown payment, or already resolved — idempotent no-op.
    }

    if (status === 'confirmed') {
      await this.confirmPayment(payment);
    } else {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.failed, failureReason: 'Provider reported failure.' },
      });
      this.events.emit(PAYMENT_FAILED, {
        paymentId: payment.id,
        tenancyId: payment.tenancyId,
        reason: 'Provider reported failure.',
      } satisfies PaymentFailedEvent);
    }
  }

  // `confirmedAt` is "now" for a real provider confirmation. A landlord-recorded
  // offline payment passes the day the tenant actually paid instead, so the
  // receipt, notification and dashboards say when it was really made; the
  // ledger row's own createdAt still records when it was entered.
  private async confirmPayment(payment: {
    id: string;
    tenancyId: string;
    amount: unknown;
    currency: string;
    periodStart: Date;
    periodEnd: Date;
    provider: string;
    providerTxnRef: string | null;
  }, confirmedAt: Date = new Date()) {
    const previousBalance = await this.getCurrentBalance(payment.tenancyId);
    const amount = Number(payment.amount);
    const runningBalance = previousBalance + amount;

    await this.prisma.ledgerEntry.create({
      data: {
        tenancyId: payment.tenancyId,
        paymentId: payment.id,
        entryType: LedgerEntryType.credit,
        amount,
        runningBalance,
        description: `${payment.provider === PaymentProvider.offline ? 'Rent paid upfront (recorded by landlord)' : 'Rent payment'} for ${payment.periodStart.toISOString().slice(0, 10)} to ${payment.periodEnd.toISOString().slice(0, 10)}`,
      },
    });

    const receiptText = generateReceiptDocument({
      paymentId: payment.id,
      tenancyId: payment.tenancyId,
      amount: String(payment.amount),
      currency: payment.currency,
      periodStart: payment.periodStart.toISOString().slice(0, 10),
      periodEnd: payment.periodEnd.toISOString().slice(0, 10),
      provider: payment.provider,
      providerTxnRef: payment.providerTxnRef,
      confirmedAt,
    });
    const receiptUrl = await this.objectStorage.upload('receipts', Buffer.from(receiptText, 'utf-8'), `${payment.id}.txt`);

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.confirmed, confirmedAt, receiptUrl },
    });

    // emitAsync — Tenancies' paid_through_date listener does a real DB
    // write in response to this; same reasoning as tenancy.created.
    await this.events.emitAsync(PAYMENT_CONFIRMED, {
      paymentId: payment.id,
      tenancyId: payment.tenancyId,
      periodStart: payment.periodStart.toISOString().slice(0, 10),
      periodEnd: payment.periodEnd.toISOString().slice(0, 10),
      confirmedAt: confirmedAt.toISOString(),
    } satisfies PaymentConfirmedEvent);

    this.logger.log(`Payment ${payment.id} confirmed; receipt generated, ledger updated, paid_through_date advanced.`);
  }

  // Whole billing cycles only (e.g. one month for a monthly tenancy, three
  // for quarterly) — returns null (skip the check) if the period doesn't
  // cleanly divide into cycles, rather than guessing at a partial-period rule
  // the docs never specify.
  private expectedAmountFor(
    periodStart: Date,
    periodEnd: Date,
    constraints: { rentAmount: unknown; billingCycle: string },
  ): number | null {
    const cycleMonths = BILLING_CYCLE_MONTHS[constraints.billingCycle];
    if (!cycleMonths) return null;

    const months =
      (periodEnd.getUTCFullYear() - periodStart.getUTCFullYear()) * 12 +
      (periodEnd.getUTCMonth() - periodStart.getUTCMonth()) +
      1;
    if (months <= 0 || months % cycleMonths !== 0) return null;

    return Number(constraints.rentAmount) * (months / cycleMonths);
  }

  private toPaymentResponse(payment: {
    id: string;
    tenancyId: string;
    tenantId: string;
    amount: unknown;
    currency: string;
    periodStart: Date;
    periodEnd: Date;
    provider: string;
    providerTxnRef: string | null;
    idempotencyKey: string;
    status: string;
    initiatedAt: Date;
    confirmedAt: Date | null;
    failureReason: string | null;
    receiptUrl: string | null;
  }) {
    return {
      id: payment.id,
      tenancy_id: payment.tenancyId,
      tenant_id: payment.tenantId,
      amount: payment.amount,
      currency: payment.currency,
      period_start: payment.periodStart.toISOString().slice(0, 10),
      period_end: payment.periodEnd.toISOString().slice(0, 10),
      provider: payment.provider,
      provider_txn_ref: payment.providerTxnRef,
      status: payment.status,
      initiated_at: payment.initiatedAt,
      confirmed_at: payment.confirmedAt,
      failure_reason: payment.failureReason,
      receipt_url: payment.receiptUrl,
    };
  }

  private toLedgerEntryResponse(entry: {
    id: string;
    entryType: string;
    amount: unknown;
    runningBalance: unknown;
    description?: string | null;
    createdAt: Date;
    paymentId: string | null;
    payment?: { provider: string; periodStart: Date; periodEnd: Date; confirmedAt: Date | null } | null;
  }) {
    const periodStart = entry.payment?.periodStart.toISOString().slice(0, 10) ?? null;
    const periodEnd = entry.payment?.periodEnd.toISOString().slice(0, 10) ?? null;
    return {
      id: entry.id,
      type: entry.entryType,
      amount: entry.amount,
      running_balance: entry.runningBalance,
      description: entry.description ?? null,
      // 'campay' | 'monetbil' | 'offline' — lets a UI tell "paid through the
      // platform" from "landlord recorded as paid upfront" without parsing the
      // free-text description.
      provider: entry.payment?.provider ?? null,
      // What a payment "says" (added 2026-09-20): when it was made, and which
      // period — and so which month(s) — it covers. Null for a ledger entry
      // with no payment behind it (none exist yet, but the ledger allows it).
      paid_at: entry.payment?.confirmedAt ?? entry.createdAt,
      period_start: periodStart,
      period_end: periodEnd,
      months_covered: periodStart && periodEnd ? monthsCovered(periodStart, periodEnd) : null,
      created_at: entry.createdAt,
      payment_id: entry.paymentId,
    };
  }
}
