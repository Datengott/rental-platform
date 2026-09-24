import { NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { signWebhookPayload } from './webhook-signature';

function buildPrismaMock() {
  return {
    payment: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    ledgerEntry: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    paymentWebhookRaw: { create: jest.fn() },
  };
}

describe('PaymentsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let config: { get: jest.Mock };
  let events: { emit: jest.Mock; emitAsync: jest.Mock };
  let objectStorage: { upload: jest.Mock };
  let gateway: { charge: jest.Mock };
  let tenanciesService: { getPaymentConstraints: jest.Mock };
  let service: PaymentsService;

  const baseConstraints = {
    tenancyId: 'tenancy-1',
    tenantId: 'tenant-1',
    landlordId: 'landlord-1',
    status: 'active',
    startDate: new Date('2026-09-01T00:00:00Z'),
    rentAmount: '150000',
    billingCycle: 'monthly',
    maxAdvanceMonths: 3,
    activeNoticeEffectiveDate: null as Date | null,
  };

  beforeEach(() => {
    prisma = buildPrismaMock();
    config = { get: jest.fn().mockReturnValue(undefined) };
    events = { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) };
    objectStorage = { upload: jest.fn().mockResolvedValue('local://receipts/x.txt') };
    gateway = { charge: jest.fn().mockResolvedValue({ providerTxnRef: 'sim_123' }) };
    tenanciesService = { getPaymentConstraints: jest.fn().mockResolvedValue({ ...baseConstraints }) };
    service = new PaymentsService(
      prisma as never,
      config as never,
      events as never,
      objectStorage,
      gateway,
      tenanciesService as never,
    );
  });

  describe('billing starts on the tenancy start date', () => {
    const dto = {
      amount: 150000,
      currency: 'XAF' as const,
      provider: 'campay' as const,
    };

    it('rejects a period that begins before the tenancy start date', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await expect(
        service.initiatePayment('tenant-1', 'tenancy-1', 'idem-early', {
          ...dto,
          period_start: '2026-08-01',
          period_end: '2026-08-31',
        }),
      ).rejects.toMatchObject({ response: { code: 'PAYMENT_BEFORE_TENANCY_START' } });
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('accepts a period that begins exactly on the tenancy start date', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' });
      prisma.payment.update.mockResolvedValue({});

      await service.initiatePayment('tenant-1', 'tenancy-1', 'idem-ok', {
        ...dto,
        period_start: '2026-09-01',
        period_end: '2026-09-30',
      });
      expect(prisma.payment.create).toHaveBeenCalled();
    });
  });

  describe('what a confirmed payment says', () => {
    it('emits when it was paid and which period it covers, and the ledger entry exposes them', async () => {
      const plan = {
        amount: 450000,
        periodStart: new Date('2026-09-20T00:00:00Z'),
        periodEnd: new Date('2026-11-30T00:00:00Z'),
        paidAt: new Date('2026-09-01T12:00:00Z'),
      };
      prisma.payment.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'payment-1', ...data }),
      );
      prisma.ledgerEntry.findFirst.mockResolvedValue(null);

      await service.recordPrepaidRent({ id: 'tenancy-1', tenantId: 'tenant-1', currency: 'XAF' }, plan, 'landlord-1');

      const emitted = events.emitAsync.mock.calls[0] as [string, { periodStart: string; periodEnd: string; confirmedAt: string }];
      expect(emitted[1].periodStart).toBe('2026-09-20');
      expect(emitted[1].periodEnd).toBe('2026-11-30');
      // The date the tenant actually paid, not the day it was recorded.
      expect(emitted[1].confirmedAt).toBe('2026-09-01T12:00:00.000Z');

      prisma.ledgerEntry.findMany.mockResolvedValue([
        {
          id: 'entry-1',
          entryType: 'credit',
          amount: 450000,
          runningBalance: 450000,
          description: 'x',
          createdAt: new Date('2026-09-20T09:00:00Z'),
          paymentId: 'payment-1',
          payment: {
            provider: 'offline',
            periodStart: plan.periodStart,
            periodEnd: plan.periodEnd,
            confirmedAt: new Date('2026-09-20T09:00:00Z'),
          },
        },
      ]);
      const [entry] = await service.getRecentLedgerEntries('tenancy-1', 5);
      expect(entry).toMatchObject({
        period_start: '2026-09-20',
        period_end: '2026-11-30',
        months_covered: 3,
        provider: 'offline',
      });
      expect(entry.paid_at).toEqual(new Date('2026-09-20T09:00:00Z'));
    });
  });

  describe('planPrepaidRent', () => {
    const start = new Date('2026-09-18T00:00:00Z');

    it('covers the start date through the end of the Nth calendar month, at N x rent', () => {
      const plan = service.planPrepaidRent({ rentAmount: '150000', billingCycle: 'monthly', startDate: start, months: 3 });

      expect(plan.amount).toBe(450000);
      expect(plan.periodStart.toISOString().slice(0, 10)).toBe('2026-09-18');
      expect(plan.periodEnd.toISOString().slice(0, 10)).toBe('2026-11-30');
    });

    it('rolls over a year boundary', () => {
      const plan = service.planPrepaidRent({
        rentAmount: 100000,
        billingCycle: 'monthly',
        startDate: new Date('2026-11-05T00:00:00Z'),
        months: 3,
      });
      expect(plan.periodEnd.toISOString().slice(0, 10)).toBe('2027-01-31');
    });

    it('prices whole billing cycles: 6 months of a quarterly tenancy is 2 cycles', () => {
      const plan = service.planPrepaidRent({ rentAmount: 300000, billingCycle: 'quarterly', startDate: start, months: 6 });
      expect(plan.amount).toBe(600000);
    });

    it('dates the payment on the day the tenant actually paid, when given', () => {
      const plan = service.planPrepaidRent({
        rentAmount: 150000,
        billingCycle: 'monthly',
        startDate: start,
        months: 1,
        paidOn: '2026-09-01',
      });
      expect(plan.paidAt.toISOString()).toBe('2026-09-01T12:00:00.000Z');
    });

    it('defaults the payment date to now', () => {
      const before = Date.now();
      const plan = service.planPrepaidRent({ rentAmount: 150000, billingCycle: 'monthly', startDate: start, months: 1 });
      expect(plan.paidAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('rejects a payment date in the future', () => {
      let caught: unknown;
      try {
        service.planPrepaidRent({
          rentAmount: 150000,
          billingCycle: 'monthly',
          startDate: start,
          months: 1,
          paidOn: '2099-01-01',
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toMatchObject({ response: { code: 'PREPAID_PAID_ON_INVALID' } });
    });

    it('rejects a month count that is not a whole number of billing cycles', () => {
      let caught: unknown;
      try {
        service.planPrepaidRent({ rentAmount: 300000, billingCycle: 'quarterly', startDate: start, months: 2 });
      } catch (err) {
        caught = err;
      }
      expect(caught).toMatchObject({ response: { code: 'PREPAID_MONTHS_INVALID_FOR_BILLING_CYCLE' } });
    });
  });

  describe('recordPrepaidRent', () => {
    it('records a confirmed offline payment through the normal confirm path (ledger credit, receipt, payment.confirmed)', async () => {
      const plan = {
        amount: 450000,
        periodStart: new Date('2026-09-18T00:00:00Z'),
        periodEnd: new Date('2026-11-30T00:00:00Z'),
        paidAt: new Date('2026-09-18T12:00:00Z'),
      };
      prisma.payment.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'payment-1', ...data }),
      );
      prisma.ledgerEntry.findFirst.mockResolvedValue(null);

      const result = await service.recordPrepaidRent(
        { id: 'tenancy-1', tenantId: 'tenant-1', currency: 'XAF' },
        plan,
        'landlord-1',
      );

      expect(result).toEqual({ payment_id: 'payment-1' });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const created = prisma.payment.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(created.data).toMatchObject({
        tenancyId: 'tenancy-1',
        tenantId: 'tenant-1',
        amount: 450000,
        provider: 'offline',
        providerTxnRef: 'landlord-recorded:landlord-1',
      });
      // Append-only ledger: one new credit row, with the "paid upfront" wording.
      const ledgerCall = prisma.ledgerEntry.create.mock.calls[0] as [
        { data: { entryType: string; amount: number; runningBalance: number; description: string } },
      ];
      expect(ledgerCall[0].data).toMatchObject({ entryType: 'credit', amount: 450000, runningBalance: 450000 });
      expect(ledgerCall[0].data.description).toContain('paid upfront');
      expect(prisma.ledgerEntry.create).toHaveBeenCalledTimes(1);
      const updateCall = prisma.payment.update.mock.calls[0] as [{ where: { id: string }; data: { status: string } }];
      expect(updateCall[0].where).toEqual({ id: 'payment-1' });
      expect(updateCall[0].data.status).toBe('confirmed');
      expect(events.emitAsync).toHaveBeenCalledWith(
        'payment.confirmed',
        expect.objectContaining({ tenancyId: 'tenancy-1', periodEnd: '2026-11-30' }),
      );
    });
  });

  describe('initiatePayment', () => {
    const dto = {
      amount: 150000,
      currency: 'XAF' as const,
      period_start: '2026-09-01',
      period_end: '2026-09-30',
      provider: 'campay' as const,
    };

    it('rejects when the requester is not this tenancy\'s tenant', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      tenanciesService.getPaymentConstraints.mockResolvedValue({ ...baseConstraints, tenantId: 'someone-else' });

      await expect(service.initiatePayment('tenant-1', 'tenancy-1', 'idem-1', dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects a period_end beyond the active termination notice effective date', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      tenanciesService.getPaymentConstraints.mockResolvedValue({
        ...baseConstraints,
        activeNoticeEffectiveDate: new Date('2026-09-15'),
      });

      await expect(service.initiatePayment('tenant-1', 'tenancy-1', 'idem-1', dto)).rejects.toMatchObject({
        response: { code: 'PAYMENT_BEYOND_NOTICE_EFFECTIVE_DATE' },
      });
    });

    it('rejects a period_end beyond the advance-months cap', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      tenanciesService.getPaymentConstraints.mockResolvedValue({ ...baseConstraints, maxAdvanceMonths: 1 });

      await expect(
        service.initiatePayment('tenant-1', 'tenancy-1', 'idem-1', {
          ...dto,
          period_start: '2027-06-01',
          period_end: '2027-06-30',
        }),
      ).rejects.toMatchObject({ response: { code: 'PAYMENT_EXCEEDS_ADVANCE_MONTHS_CAP' } });
    });

    it('rejects an amount that does not match whole billing cycles of rent', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await expect(
        service.initiatePayment('tenant-1', 'tenancy-1', 'idem-1', { ...dto, amount: 99999 }),
      ).rejects.toMatchObject({ response: { code: 'PAYMENT_AMOUNT_MISMATCH' } });
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('creates a pending payment, calls the gateway, and emits payment.initiated', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1', ...dto, status: 'pending' });

      const result = await service.initiatePayment('tenant-1', 'tenancy-1', 'idem-1', dto);

      expect(result).toEqual({ payment_id: 'payment-1', status: 'pending' });
      expect(gateway.charge).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 150000, idempotencyKey: 'idem-1' }),
      );
      expect(events.emit).toHaveBeenCalledWith('payment.initiated', expect.objectContaining({ tenancyId: 'tenancy-1' }));
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: { providerTxnRef: 'sim_123' },
      });
    });

    it('replays the original response for a repeated idempotency key with the same payload', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'payment-1',
        tenancyId: 'tenancy-1',
        amount: 150000,
        currency: 'XAF',
        periodStart: new Date('2026-09-01'),
        periodEnd: new Date('2026-09-30'),
        provider: 'campay',
        status: 'pending',
      });

      const result = await service.initiatePayment('tenant-1', 'tenancy-1', 'idem-1', dto);

      expect(result).toEqual({ payment_id: 'payment-1', status: 'pending' });
      expect(gateway.charge).not.toHaveBeenCalled();
    });

    it('rejects a repeated idempotency key with a different payload as a conflict', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'payment-1',
        tenancyId: 'tenancy-1',
        amount: 999,
        currency: 'XAF',
        periodStart: new Date('2026-09-01'),
        periodEnd: new Date('2026-09-30'),
        provider: 'campay',
        status: 'pending',
      });

      await expect(service.initiatePayment('tenant-1', 'tenancy-1', 'idem-1', dto)).rejects.toMatchObject({
        response: { code: 'IDEMPOTENCY_KEY_REUSED' },
      });
    });
  });

  describe('processWebhook', () => {
    const rawBody = JSON.stringify({ provider_txn_ref: 'sim_123', idempotency_key: 'idem-1', status: 'confirmed' });

    it('records the raw webhook but does not process it when the signature is invalid', async () => {
      await service.processWebhook('campay', rawBody, 'not-a-real-signature');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const rawCall = prisma.paymentWebhookRaw.create.mock.calls[0][0] as { data: { signatureVerified: boolean } };
      expect(rawCall.data.signatureVerified).toBe(false);
      expect(prisma.payment.findUnique).not.toHaveBeenCalled();
    });

    it('confirms the payment, writes a ledger entry, and generates a receipt on a valid signature', async () => {
      const signature = signWebhookPayload(rawBody, 'dev-simulated-webhook-secret');
      prisma.payment.findUnique.mockResolvedValue({
        id: 'payment-1',
        tenancyId: 'tenancy-1',
        amount: '150000',
        currency: 'XAF',
        periodStart: new Date('2026-09-01'),
        periodEnd: new Date('2026-09-30'),
        provider: 'campay',
        providerTxnRef: 'sim_123',
        status: 'pending',
      });
      prisma.ledgerEntry.findFirst.mockResolvedValue(null);

      await service.processWebhook('campay', rawBody, signature);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const ledgerCall = prisma.ledgerEntry.create.mock.calls[0][0] as {
        data: { entryType: string; runningBalance: number };
      };
      expect(ledgerCall.data).toMatchObject({ entryType: 'credit', runningBalance: 150000 });
      expect(objectStorage.upload).toHaveBeenCalledWith('receipts', expect.any(Buffer), expect.stringContaining('payment-1'));
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const updateCall = prisma.payment.update.mock.calls[0][0] as { data: { status: string } };
      expect(updateCall.data.status).toBe('confirmed');
      expect(events.emitAsync).toHaveBeenCalledWith(
        'payment.confirmed',
        expect.objectContaining({ tenancyId: 'tenancy-1', periodEnd: '2026-09-30' }),
      );
    });

    it('is a no-op when the payment is already resolved (idempotent replay)', async () => {
      const signature = signWebhookPayload(rawBody, 'dev-simulated-webhook-secret');
      prisma.payment.findUnique.mockResolvedValue({ id: 'payment-1', status: 'confirmed' });

      await service.processWebhook('campay', rawBody, signature);

      expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
    });
  });

  describe('getCurrentBalance', () => {
    it('returns 0 when no ledger entries exist', async () => {
      prisma.ledgerEntry.findFirst.mockResolvedValue(null);
      await expect(service.getCurrentBalance('tenancy-1')).resolves.toBe(0);
    });

    it('returns the latest running balance', async () => {
      prisma.ledgerEntry.findFirst.mockResolvedValue({ runningBalance: '300000' });
      await expect(service.getCurrentBalance('tenancy-1')).resolves.toBe(300000);
    });
  });
});
