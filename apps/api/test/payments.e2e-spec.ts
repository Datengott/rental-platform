import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaModule } from '../src/common/prisma.module';
import { StorageModule } from '../src/common/storage/storage.module';
import { AuthModule } from '../src/modules/auth/auth.module';
import { PropertiesModule } from '../src/modules/properties/properties.module';
import { TenanciesModule } from '../src/modules/tenancies/tenancies.module';
import { PaymentsModule } from '../src/modules/payments/payments.module';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { PAYMENT_GATEWAY } from '../src/modules/payments/gateway/payment-gateway';
import { configureApp } from '../src/setup-app';
import { PrismaService } from '../src/common/prisma.service';
import { SMS_GATEWAY } from '../src/modules/auth/sms/sms-gateway';
import { signWebhookPayload } from '../src/modules/payments/webhook-signature';
import { FakeSmsGateway, randomPhoneNumber } from './support/fake-sms-gateway';
import { FakePaymentGateway } from './support/fake-payment-gateway';
import { signUp } from './support/sign-up';

describe('Payments module (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fakeSms: FakeSmsGateway;

  beforeAll(async () => {
    fakeSms = new FakeSmsGateway();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        EventEmitterModule.forRoot(),
        ScheduleModule.forRoot(),
        PrismaModule,
        StorageModule,
        AuthModule,
        PropertiesModule,
        TenanciesModule,
        PaymentsModule,
      ],
    })
      .overrideProvider(SMS_GATEWAY)
      .useValue(fakeSms)
      .overrideProvider(PAYMENT_GATEWAY)
      .useValue(new FakePaymentGateway())
      .compile();

    // rawBody: true — the webhook signature test posts a real HTTP request
    // and needs the exact raw body NestJS's rawBody feature captures,
    // matching main.ts's own bootstrap option.
    app = moduleRef.createNestApplication({ rawBody: true });
    configureApp(app);
    // @nestjs/schedule's cron jobs (this module's reconcilePendingPayments,
    // and TenanciesModule's own sweep) are only cleared on shutdown if
    // shutdown hooks are enabled — see the same comment in tenancies.e2e-spec.ts.
    app.enableShutdownHooks();
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prisma.paymentWebhookRaw.deleteMany();
    await prisma.ledgerEntry.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.terminationNotice.deleteMany();
    await prisma.tenancy.deleteMany();
    await prisma.unitPhoto.deleteMany();
    await prisma.unit.deleteMany();
    await prisma.property.deleteMany();
    await prisma.session.deleteMany();
    await prisma.otpChallenge.deleteMany();
    await prisma.userRoleAssignment.deleteMany();
    await prisma.user.deleteMany();
  });

  async function setUpTenancy(landlordAccessToken: string, tenantId: string) {
    const propertyRes = await request(app.getHttpServer())
      .post('/v1/properties')
      .set('Authorization', `Bearer ${landlordAccessToken}`)
      .send({ address_line: '1 Rue Test', city: 'Douala' })
      .expect(201);

    const unitRes = await request(app.getHttpServer())
      .post(`/v1/properties/${propertyRes.body.id}/units`)
      .set('Authorization', `Bearer ${landlordAccessToken}`)
      .send({ rent_amount: 150000 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/units/${unitRes.body.id}/photos`)
      .set('Authorization', `Bearer ${landlordAccessToken}`)
      .attach('file', Buffer.from('fake-image'), 'photo.jpg')
      .expect(201);

    const tenancyRes = await request(app.getHttpServer())
      .post('/v1/tenancies')
      .set('Authorization', `Bearer ${landlordAccessToken}`)
      .send({ unit_id: unitRes.body.id, tenant_id: tenantId, start_date: '2026-09-01', rent_amount: 150000 })
      .expect(201);

    return { unitId: unitRes.body.id, tenancyId: tenancyRes.body.id as string };
  }

  const validPaymentBody = {
    amount: 150000,
    currency: 'XAF',
    period_start: '2026-09-01',
    period_end: '2026-09-30',
    provider: 'campay',
  };

  it('initiates a payment as 202 pending, and confirming it via a signed webhook updates the ledger and the tenancy dashboard', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const { tenancyId } = await setUpTenancy(landlord.access_token, tenant.user.id);

    const initiateRes = await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancyId}/payments`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .set('Idempotency-Key', 'e2e-key-1')
      .send(validPaymentBody)
      .expect(202);
    expect(initiateRes.body.status).toBe('pending');

    // Drive the webhook directly rather than waiting on the simulated
    // gateway's real timer+self-HTTP-call — that path is covered live in
    // docker compose; here we test webhook processing as its own concern,
    // deterministically.
    const rawBody = JSON.stringify({
      provider_txn_ref: 'sim_test',
      idempotency_key: 'e2e-key-1',
      status: 'confirmed',
    });
    await request(app.getHttpServer())
      .post('/v1/webhooks/payments/campay')
      .set('Content-Type', 'application/json')
      .set('x-webhook-signature', signWebhookPayload(rawBody, 'dev-simulated-webhook-secret'))
      .send(rawBody)
      .expect(200);

    const ledgerRes = await request(app.getHttpServer())
      .get(`/v1/tenancies/${tenancyId}/ledger`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(ledgerRes.body.current_balance).toBe(150000);
    expect(ledgerRes.body.entries).toHaveLength(1);
    expect(ledgerRes.body.entries[0]).toMatchObject({ type: 'credit', amount: '150000' });

    const dashboardRes = await request(app.getHttpServer())
      .get('/v1/landlords/me/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .expect(200);
    expect(dashboardRes.body[0]).toMatchObject({ current_balance: 150000, paid_through_date: '2026-09-30' });

    const receiptRes = await request(app.getHttpServer())
      .get(`/v1/payments/${initiateRes.body.payment_id}/receipt`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(receiptRes.body.download_url).toContain('local://receipts/');
  });

  it('rejects a forged webhook signature (still 200, but never processed)', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const { tenancyId } = await setUpTenancy(landlord.access_token, tenant.user.id);

    await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancyId}/payments`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .set('Idempotency-Key', 'e2e-key-forged')
      .send(validPaymentBody)
      .expect(202);

    await request(app.getHttpServer())
      .post('/v1/webhooks/payments/campay')
      .set('Content-Type', 'application/json')
      .set('x-webhook-signature', 'not-a-real-signature')
      .send(JSON.stringify({ provider_txn_ref: 'x', idempotency_key: 'e2e-key-forged', status: 'confirmed' }))
      .expect(200);

    const ledgerRes = await request(app.getHttpServer())
      .get(`/v1/tenancies/${tenancyId}/ledger`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(ledgerRes.body.current_balance).toBe(0);
    expect(ledgerRes.body.entries).toHaveLength(0);
  });

  it('requires the Idempotency-Key header', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const { tenancyId } = await setUpTenancy(landlord.access_token, tenant.user.id);

    const res = await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancyId}/payments`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .send(validPaymentBody)
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('replays the original response for a repeated idempotency key, and 409s on a different payload', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const { tenancyId } = await setUpTenancy(landlord.access_token, tenant.user.id);

    const first = await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancyId}/payments`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .set('Idempotency-Key', 'e2e-key-replay')
      .send(validPaymentBody)
      .expect(202);

    const replay = await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancyId}/payments`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .set('Idempotency-Key', 'e2e-key-replay')
      .send(validPaymentBody)
      .expect(202);
    expect(replay.body.payment_id).toBe(first.body.payment_id);

    const conflict = await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancyId}/payments`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .set('Idempotency-Key', 'e2e-key-replay')
      .send({ ...validPaymentBody, amount: 1 })
      .expect(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('rejects rent for a period before the tenancy start date — billing starts on that date', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const { tenancyId } = await setUpTenancy(landlord.access_token, tenant.user.id);

    // setUpTenancy starts the tenancy on 2026-09-01.
    const res = await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancyId}/payments`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .set('Idempotency-Key', 'e2e-before-start')
      .send({ ...validPaymentBody, period_start: '2026-08-01', period_end: '2026-08-31' })
      .expect(422);
    expect(res.body.error.code).toBe('PAYMENT_BEFORE_TENANCY_START');
  });

  it('rejects an amount that does not match whole billing cycles of rent', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const { tenancyId } = await setUpTenancy(landlord.access_token, tenant.user.id);

    const res = await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancyId}/payments`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .set('Idempotency-Key', 'e2e-key-amount')
      .send({ ...validPaymentBody, amount: 1 })
      .expect(422);
    expect(res.body.error.code).toBe('PAYMENT_AMOUNT_MISMATCH');
  });

  it('rejects a payment beyond the advance-months cap', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const { tenancyId } = await setUpTenancy(landlord.access_token, tenant.user.id);

    const res = await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancyId}/payments`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .set('Idempotency-Key', 'e2e-key-advance')
      .send({ ...validPaymentBody, period_start: '2028-01-01', period_end: '2028-01-31' })
      .expect(422);
    expect(res.body.error.code).toBe('PAYMENT_EXCEEDS_ADVANCE_MONTHS_CAP');
  });

  it('rejects a payment beyond the tenancy\'s termination notice effective date', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const { tenancyId } = await setUpTenancy(landlord.access_token, tenant.user.id);

    await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancyId}/termination-notices`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      // Well beyond the 90-day statutory floor from "today", however far in
      // the future this suite happens to run — a date close to that floor
      // rots as real time passes (this one used to be 2026-12-20).
      .send({ reason: 'end_of_term', effective_date: '2027-06-20' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancyId}/payments`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .set('Idempotency-Key', 'e2e-key-notice')
      .send({ ...validPaymentBody, period_start: '2027-07-01', period_end: '2027-07-31' })
      .expect(422);
    expect(res.body.error.code).toBe('PAYMENT_BEYOND_NOTICE_EFFECTIVE_DATE');
  });

  it("rejects someone who isn't this tenancy's tenant from initiating a payment", async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const stranger = await signUp(app, fakeSms, randomPhoneNumber());
    const { tenancyId } = await setUpTenancy(landlord.access_token, tenant.user.id);

    const res = await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancyId}/payments`)
      .set('Authorization', `Bearer ${stranger.access_token}`)
      .set('Idempotency-Key', 'e2e-key-stranger')
      .send(validPaymentBody)
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects a non-admin from viewing the admin payments queue', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());

    const res = await request(app.getHttpServer())
      .get('/v1/admin/payments')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it("the reconciliation sweep confirms a stale pending payment the webhook never reached", async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const { tenancyId } = await setUpTenancy(landlord.access_token, tenant.user.id);

    await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancyId}/payments`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .set('Idempotency-Key', 'e2e-key-recon')
      .send(validPaymentBody)
      .expect(202);

    // Backdate initiatedAt so the sweep's staleness threshold considers it
    // due, then invoke the exact @Cron-decorated method directly — same
    // pattern as Tenancies' notice-expiry sweep test: deterministic, and
    // still exercises the real DB + real event bus.
    await prisma.payment.updateMany({
      where: { tenancyId },
      data: { initiatedAt: new Date(Date.now() - 60_000) },
    });

    await app.get(PaymentsService).reconcilePendingPayments();

    const ledgerRes = await request(app.getHttpServer())
      .get(`/v1/tenancies/${tenancyId}/ledger`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(ledgerRes.body.current_balance).toBe(150000);
  });
});
