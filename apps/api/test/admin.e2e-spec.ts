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
import { AdminModule } from '../src/modules/admin/admin.module';
import { PAYMENT_GATEWAY } from '../src/modules/payments/gateway/payment-gateway';
import { configureApp } from '../src/setup-app';
import { PrismaService } from '../src/common/prisma.service';
import { SMS_GATEWAY } from '../src/modules/auth/sms/sms-gateway';
import { signWebhookPayload } from '../src/modules/payments/webhook-signature';
import { FakeSmsGateway, randomPhoneNumber } from './support/fake-sms-gateway';
import { FakePaymentGateway } from './support/fake-payment-gateway';
import { signUp, TestSession } from './support/sign-up';

describe('Admin module (e2e)', () => {
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
        AdminModule,
      ],
    })
      .overrideProvider(SMS_GATEWAY)
      .useValue(fakeSms)
      .overrideProvider(PAYMENT_GATEWAY)
      .useValue(new FakePaymentGateway())
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    configureApp(app);
    app.enableShutdownHooks();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prisma.adminActionLog.deleteMany();
    await prisma.paymentWebhookRaw.deleteMany();
    await prisma.ledgerEntry.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.terminationNotice.deleteMany();
    await prisma.tenancy.deleteMany();
    await prisma.listingChange.deleteMany();
    await prisma.unitPhoto.deleteMany();
    await prisma.unit.deleteMany();
    await prisma.property.deleteMany();
    await prisma.session.deleteMany();
    await prisma.otpChallenge.deleteMany();
    await prisma.userRoleAssignment.deleteMany();
    await prisma.user.deleteMany();
  });

  async function makeAdmin(): Promise<TestSession> {
    const phone = randomPhoneNumber();
    await prisma.user.create({ data: { phoneNumber: phone, roles: { create: [{ role: 'admin' }] } } });
    return signUp(app, fakeSms, phone);
  }

  async function createListing(token: string) {
    const property = await request(app.getHttpServer())
      .post('/v1/properties')
      .set('Authorization', `Bearer ${token}`)
      .send({ address_line: '1 Rue Test', city: 'Douala' })
      .expect(201);
    const unit = await request(app.getHttpServer())
      .post(`/v1/properties/${property.body.id}/units`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Studio A', rent_amount: 150000 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/units/${unit.body.id}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('fake-image'), 'photo.jpg')
      .expect(201);
    return { propertyId: property.body.id as string, unitId: unit.body.id as string };
  }

  const inSearch = async (unitId: string) =>
    (await request(app.getHttpServer()).get('/v1/units?city=Douala').expect(200)).body.results.some(
      (u: { id: string }) => u.id === unitId,
    );

  const auditLog = async (token: string, query = '') =>
    (
      await request(app.getHttpServer())
        .get(`/v1/admin/audit-log${query}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body.results as { action_type: string; target_type: string; target_id: string; admin_profile: unknown }[];

  it('rejects every admin endpoint for a non-admin', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    for (const path of ['/v1/admin/kyc-queue', '/v1/admin/listings/flagged', '/v1/admin/payments/disputes', '/v1/admin/audit-log']) {
      await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${landlord.access_token}`).expect(403);
    }
  });

  it('lists users pending KYC review, and approving one removes them from the queue and logs the action', async () => {
    const admin = await makeAdmin();
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());

    await request(app.getHttpServer())
      .post('/v1/users/me/kyc-documents')
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .field('document_type', 'national_id')
      .field('document_ref', 'ID-123')
      .attach('file', Buffer.from('fake-id'), 'id.jpg')
      .expect(202);

    const queue = await request(app.getHttpServer())
      .get('/v1/admin/kyc-queue')
      .set('Authorization', `Bearer ${admin.access_token}`)
      .expect(200);
    expect(queue.body.results).toEqual([
      expect.objectContaining({ id: tenant.user.id, id_document_type: 'national_id', id_document_ref: 'ID-123' }),
    ]);

    await request(app.getHttpServer())
      .post(`/v1/admin/users/${tenant.user.id}/kyc/approve`)
      .set('Authorization', `Bearer ${admin.access_token}`)
      .send({ new_tier: 'id_verified' })
      .expect(200);

    const queueAfter = await request(app.getHttpServer())
      .get('/v1/admin/kyc-queue')
      .set('Authorization', `Bearer ${admin.access_token}`)
      .expect(200);
    expect(queueAfter.body.results).toHaveLength(0);

    const log = await auditLog(admin.access_token);
    expect(log).toEqual([
      expect.objectContaining({ action_type: 'kyc_approved', target_type: 'user', target_id: tenant.user.id }),
    ]);
    expect(log[0].admin_profile).toMatchObject({ phone_number: admin.user.phone_number });
  });

  it('flagging a listing removes it from public search until it is unflagged', async () => {
    const admin = await makeAdmin();
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const { unitId } = await createListing(landlord.access_token);
    expect(await inSearch(unitId)).toBe(true);

    const flagged = await request(app.getHttpServer())
      .post(`/v1/admin/listings/${unitId}/flag`)
      .set('Authorization', `Bearer ${admin.access_token}`)
      .send({ reason: 'Suspiciously low price' })
      .expect(200);
    expect(flagged.body).toMatchObject({ id: unitId, flagged: true });
    expect(await inSearch(unitId)).toBe(false);
    // A flagged unit is also gone from its own public detail page.
    await request(app.getHttpServer()).get(`/v1/units/${unitId}`).expect(404);

    const queue = await request(app.getHttpServer())
      .get('/v1/admin/listings/flagged')
      .set('Authorization', `Bearer ${admin.access_token}`)
      .expect(200);
    expect(queue.body.results).toEqual([
      expect.objectContaining({ id: unitId, flag_reason: 'Suspiciously low price', landlord: { name: null, phone_number: landlord.user.phone_number } }),
    ]);

    await request(app.getHttpServer())
      .post(`/v1/admin/listings/${unitId}/unflag`)
      .set('Authorization', `Bearer ${admin.access_token}`)
      .expect(200);
    expect(await inSearch(unitId)).toBe(true);

    const queueAfter = await request(app.getHttpServer())
      .get('/v1/admin/listings/flagged')
      .set('Authorization', `Bearer ${admin.access_token}`)
      .expect(200);
    expect(queueAfter.body.results).toHaveLength(0);

    const log = await auditLog(admin.access_token);
    expect(log.map((l) => l.action_type)).toEqual(['listing_unflagged', 'listing_flagged']);
  });

  it('removing a listing sends it back to draft, refuses if a tenant lives there, and resolves the flag', async () => {
    const admin = await makeAdmin();
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const { unitId: vacantUnitId } = await createListing(landlord.access_token);
    const { unitId: occupiedUnitId } = await createListing(landlord.access_token);
    await request(app.getHttpServer())
      .post('/v1/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ unit_id: occupiedUnitId, tenant_id: tenant.user.id, start_date: '2026-09-01', rent_amount: 150000 })
      .expect(201);

    // Can't take down a home someone is currently living in.
    await request(app.getHttpServer())
      .post(`/v1/admin/listings/${occupiedUnitId}/remove`)
      .set('Authorization', `Bearer ${admin.access_token}`)
      .send({ reason: 'Attempted removal' })
      .expect(422);

    await request(app.getHttpServer())
      .post(`/v1/admin/listings/${vacantUnitId}/flag`)
      .set('Authorization', `Bearer ${admin.access_token}`)
      .send({ reason: 'Fake listing' })
      .expect(200);

    const removed = await request(app.getHttpServer())
      .post(`/v1/admin/listings/${vacantUnitId}/remove`)
      .set('Authorization', `Bearer ${admin.access_token}`)
      .send({ reason: 'Confirmed fake' })
      .expect(200);
    expect(removed.body).toMatchObject({ id: vacantUnitId, status: 'draft', flagged: false });
    expect(await inSearch(vacantUnitId)).toBe(false);

    // Resolved — no longer in the flagged queue.
    const queue = await request(app.getHttpServer())
      .get('/v1/admin/listings/flagged')
      .set('Authorization', `Bearer ${admin.access_token}`)
      .expect(200);
    expect(queue.body.results).toHaveLength(0);
  });

  it('lists payments stuck failed or reconciling as disputes, not confirmed/pending ones', async () => {
    const admin = await makeAdmin();
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const { unitId } = await createListing(landlord.access_token);
    const tenancy = await request(app.getHttpServer())
      .post('/v1/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ unit_id: unitId, tenant_id: tenant.user.id, start_date: '2026-09-01', rent_amount: 150000 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancy.body.id}/payments`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .set('Idempotency-Key', 'e2e-admin-dispute')
      .send({ amount: 150000, currency: 'XAF', period_start: '2026-09-01', period_end: '2026-09-30', provider: 'campay' })
      .expect(202);

    const rawBody = JSON.stringify({ provider_txn_ref: 'x', idempotency_key: 'e2e-admin-dispute', status: 'failed' });
    await request(app.getHttpServer())
      .post('/v1/webhooks/payments/campay')
      .set('Content-Type', 'application/json')
      .set('x-webhook-signature', signWebhookPayload(rawBody, 'dev-simulated-webhook-secret'))
      .send(rawBody)
      .expect(200);

    const disputes = await request(app.getHttpServer())
      .get('/v1/admin/payments/disputes')
      .set('Authorization', `Bearer ${admin.access_token}`)
      .expect(200);
    expect(disputes.body).toEqual([expect.objectContaining({ tenancy_id: tenancy.body.id, status: 'failed' })]);
  });

  it('filters the audit log by target and paginates with a cursor', async () => {
    const admin = await makeAdmin();
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const { unitId: unitA } = await createListing(landlord.access_token);
    const { unitId: unitB } = await createListing(landlord.access_token);

    await request(app.getHttpServer())
      .post(`/v1/admin/listings/${unitA}/flag`)
      .set('Authorization', `Bearer ${admin.access_token}`)
      .send({ reason: 'Reason A' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/admin/listings/${unitB}/flag`)
      .set('Authorization', `Bearer ${admin.access_token}`)
      .send({ reason: 'Reason B' })
      .expect(200);

    const forA = await auditLog(admin.access_token, `?target_type=unit&target_id=${unitA}`);
    expect(forA).toHaveLength(1);
    expect(forA[0].target_id).toBe(unitA);

    const firstPage = await request(app.getHttpServer())
      .get('/v1/admin/audit-log?limit=1')
      .set('Authorization', `Bearer ${admin.access_token}`)
      .expect(200);
    expect(firstPage.body.results).toHaveLength(1);
    expect(firstPage.body.next_cursor).toBeTruthy();

    const secondPage = await request(app.getHttpServer())
      .get(`/v1/admin/audit-log?limit=1&cursor=${firstPage.body.next_cursor}`)
      .set('Authorization', `Bearer ${admin.access_token}`)
      .expect(200);
    expect(secondPage.body.results).toHaveLength(1);
    expect(secondPage.body.results[0].id).not.toBe(firstPage.body.results[0].id);
  });
});
