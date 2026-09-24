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
import { TenanciesService } from '../src/modules/tenancies/tenancies.service';
import { configureApp } from '../src/setup-app';
import { PrismaService } from '../src/common/prisma.service';
import { SMS_GATEWAY } from '../src/modules/auth/sms/sms-gateway';
import { FakeSmsGateway, randomPhoneNumber } from './support/fake-sms-gateway';
import { signUp } from './support/sign-up';

describe('Tenancies module (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fakeSms: FakeSmsGateway;
  let tenanciesService: TenanciesService;

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
      ],
    })
      .overrideProvider(SMS_GATEWAY)
      .useValue(fakeSms)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    // @nestjs/schedule's cron jobs (this module's own sweepNoticeExpirations)
    // are only cleared on shutdown if shutdown hooks are enabled — without
    // this, app.close() leaves a live timer behind and Jest never exits
    // cleanly.
    app.enableShutdownHooks();
    await app.init();

    prisma = app.get(PrismaService);
    tenanciesService = app.get(TenanciesService);
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

  async function createVacantUnit(landlordAccessToken: string) {
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

    return unitRes.body.id as string;
  }

  it('creates a tenancy defaulting notice_period_days to 90, and flips the unit to occupied', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const unitId = await createVacantUnit(landlord.access_token);
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());

    const res = await request(app.getHttpServer())
      .post('/v1/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ unit_id: unitId, tenant_id: tenant.user.id, start_date: '2026-09-01', rent_amount: 150000 })
      .expect(201);

    expect(res.body).toMatchObject({ status: 'active', notice_period_days: 90 });

    const units = await request(app.getHttpServer())
      .get('/v1/landlords/me/units')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .expect(200);
    expect(units.body.find((u: { id: string }) => u.id === unitId).status).toBe('occupied');
  });

  it("lists the tenant's own tenancies on /tenants/me/tenancies, mirroring the landlord's view", async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const unitId = await createVacantUnit(landlord.access_token);
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());

    const created = await request(app.getHttpServer())
      .post('/v1/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ unit_id: unitId, tenant_id: tenant.user.id, start_date: '2026-09-01', rent_amount: 150000 })
      .expect(201);

    const tenantList = await request(app.getHttpServer())
      .get('/v1/tenants/me/tenancies')
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(tenantList.body).toHaveLength(1);
    expect(tenantList.body[0]).toMatchObject({ id: created.body.id, status: 'active', months_paid_ahead: 0 });

    // A stranger (nor the landlord themselves, calling the tenant-side
    // route) never sees someone else's tenancy here.
    const landlordCallingTenantRoute = await request(app.getHttpServer())
      .get('/v1/tenants/me/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .expect(200);
    expect(landlordCallingTenantRoute.body).toEqual([]);
  });

  it('records rent the landlord says was paid upfront: ledger credit, paid_through_date, receipt, and the tenant sees it', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const unitId = await createVacantUnit(landlord.access_token);
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());

    const created = await request(app.getHttpServer())
      .post('/v1/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ unit_id: unitId, tenant_id: tenant.user.id, start_date: '2026-09-01', rent_amount: 150000, prepaid_months: 3 })
      .expect(201);

    // Sept 1 + 3 months (calendar-month convention) => through Nov 30, in the response itself.
    expect(created.body.paid_through_date).toBe('2026-11-30');

    // What the tenant's dashboard loads on open.
    const tenantList = await request(app.getHttpServer())
      .get('/v1/tenants/me/tenancies')
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .expect(200);
    const mine = tenantList.body[0];
    expect(mine).toMatchObject({ id: created.body.id, paid_through_date: '2026-11-30', current_balance: 450000 });
    expect(mine.recent_ledger_entries).toHaveLength(1);
    expect(mine.recent_ledger_entries[0]).toMatchObject({
      type: 'credit',
      amount: '450000',
      running_balance: '450000',
      provider: 'offline',
    });
    expect(mine.recent_ledger_entries[0].description).toContain('paid upfront');

    // A real, confirmed payment with a receipt — not a bare number on the tenancy.
    const receipt = await request(app.getHttpServer())
      .get(`/v1/payments/${mine.recent_ledger_entries[0].payment_id}/receipt`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(receipt.body.download_url).toContain('local://receipts/');

    // The landlord sees the same on their dashboard.
    const landlordList = await request(app.getHttpServer())
      .get('/v1/landlords/me/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .expect(200);
    expect(landlordList.body[0]).toMatchObject({ paid_through_date: '2026-11-30', current_balance: 450000 });
  });

  it('says when the next payment is due: the start date until anything is paid, then the day after paid-through', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const unitA = await createVacantUnit(landlord.access_token);
    const unitB = await createVacantUnit(landlord.access_token);
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());

    // Start date in the future (not the day of creation): billing starts THEN.
    const future = await request(app.getHttpServer())
      .post('/v1/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ unit_id: unitA, tenant_id: tenant.user.id, start_date: '2027-03-15', rent_amount: 150000 })
      .expect(201);
    expect(future.body).toMatchObject({ start_date: '2027-03-15', paid_through_date: null, next_payment_due_date: '2027-03-15' });

    const prepaid = await request(app.getHttpServer())
      .post('/v1/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ unit_id: unitB, tenant_id: tenant.user.id, start_date: '2026-09-20', rent_amount: 150000, prepaid_months: 3 })
      .expect(201);
    // Sept 20 + 3 calendar months => through Nov 30; next payment the day after.
    expect(prepaid.body).toMatchObject({ paid_through_date: '2026-11-30', next_payment_due_date: '2026-12-01' });

    // The ledger entry says when it was paid and which months it covers.
    const tenantList = await request(app.getHttpServer())
      .get('/v1/tenants/me/tenancies')
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .expect(200);
    const withPayment = tenantList.body.find((t: { id: string }) => t.id === prepaid.body.id);
    expect(withPayment.recent_ledger_entries[0]).toMatchObject({
      period_start: '2026-09-20',
      period_end: '2026-11-30',
      months_covered: 3,
    });
    expect(new Date(withPayment.recent_ledger_entries[0].paid_at).getTime()).not.toBeNaN();
  });

  it('shows the day the tenant actually paid (not the day it was recorded), and refuses a future date', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const unitId = await createVacantUnit(landlord.access_token);
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const body = { unit_id: unitId, tenant_id: tenant.user.id, start_date: '2026-09-01', rent_amount: 150000, prepaid_months: 2 };

    const future = await request(app.getHttpServer())
      .post('/v1/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ ...body, prepaid_paid_on: '2099-01-01' })
      .expect(422);
    expect(future.body.error.code).toBe('PREPAID_PAID_ON_INVALID');

    await request(app.getHttpServer())
      .post('/v1/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ ...body, prepaid_paid_on: '2026-08-28' })
      .expect(201);

    const tenantList = await request(app.getHttpServer())
      .get('/v1/tenants/me/tenancies')
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .expect(200);
    const entry = tenantList.body[0].recent_ledger_entries[0];
    expect(entry.paid_at.slice(0, 10)).toBe('2026-08-28');
    // ...while the ledger row itself still records when it was actually entered.
    expect(entry.created_at.slice(0, 10)).not.toBe('2026-08-28');
  });

  it('a tenancy without prepaid_months has no payment or ledger entry', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const unitId = await createVacantUnit(landlord.access_token);
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());

    await request(app.getHttpServer())
      .post('/v1/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ unit_id: unitId, tenant_id: tenant.user.id, start_date: '2026-09-01', rent_amount: 150000 })
      .expect(201);

    const tenantList = await request(app.getHttpServer())
      .get('/v1/tenants/me/tenancies')
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(tenantList.body[0]).toMatchObject({ paid_through_date: null, current_balance: 0, recent_ledger_entries: [] });
  });

  it('rejects an invalid prepaid_months without creating a tenancy (or occupying the unit)', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const unitId = await createVacantUnit(landlord.access_token);
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const body = { unit_id: unitId, tenant_id: tenant.user.id, start_date: '2026-09-01', rent_amount: 300000 };

    // 2 months of a quarterly tenancy isn't a whole billing cycle.
    const notWholeCycles = await request(app.getHttpServer())
      .post('/v1/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ ...body, billing_cycle: 'quarterly', prepaid_months: 2 })
      .expect(422);
    expect(notWholeCycles.body.error.code).toBe('PREPAID_MONTHS_INVALID_FOR_BILLING_CYCLE');

    for (const bad of [0, 25, 1.5]) {
      const res = await request(app.getHttpServer())
        .post('/v1/tenancies')
        .set('Authorization', `Bearer ${landlord.access_token}`)
        .send({ ...body, prepaid_months: bad })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }

    const list = await request(app.getHttpServer())
      .get('/v1/landlords/me/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .expect(200);
    expect(list.body).toEqual([]);
    const units = await request(app.getHttpServer())
      .get('/v1/landlords/me/units')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .expect(200);
    expect(units.body.find((u: { id: string }) => u.id === unitId).status).toBe('vacant');
  });

  it("a tenant can't mark their own rent as paid by sending provider 'offline'", async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const unitId = await createVacantUnit(landlord.access_token);
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const created = await request(app.getHttpServer())
      .post('/v1/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ unit_id: unitId, tenant_id: tenant.user.id, start_date: '2026-09-01', rent_amount: 150000 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/v1/tenancies/${created.body.id}/payments`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .set('Idempotency-Key', 'try-offline-1')
      .send({ amount: 150000, currency: 'XAF', period_start: '2026-09-01', period_end: '2026-09-30', provider: 'offline' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects creating a tenancy on a non-vacant unit', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const unitId = await createVacantUnit(landlord.access_token);
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());

    await request(app.getHttpServer())
      .post('/v1/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ unit_id: unitId, tenant_id: tenant.user.id, start_date: '2026-09-01', rent_amount: 150000 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/v1/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ unit_id: unitId, tenant_id: tenant.user.id, start_date: '2026-09-01', rent_amount: 150000 })
      .expect(422);

    expect(res.body.error.code).toBe('UNIT_NOT_VACANT');
  });

  it('rejects a notice_period_days below the statutory minimum', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const unitId = await createVacantUnit(landlord.access_token);
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());

    const res = await request(app.getHttpServer())
      .post('/v1/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({
        unit_id: unitId,
        tenant_id: tenant.user.id,
        start_date: '2026-09-01',
        rent_amount: 150000,
        notice_period_days: 30,
      })
      .expect(422);

    expect(res.body.error.code).toBe('NOTICE_PERIOD_BELOW_STATUTORY_MINIMUM');
  });

  it('rejects a termination notice effective too soon, with the earliest valid date in the message', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const unitId = await createVacantUnit(landlord.access_token);
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());

    const tenancy = await request(app.getHttpServer())
      .post('/v1/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ unit_id: unitId, tenant_id: tenant.user.id, start_date: '2026-09-01', rent_amount: 150000 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancy.body.id}/termination-notices`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ reason: 'non_payment', effective_date: '2026-10-01' })
      .expect(422);

    expect(res.body.error.code).toBe('NOTICE_PERIOD_TOO_SHORT');
    expect(res.body.error.message).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('issues a valid termination notice, generates a document, and moves the tenancy to notice_given', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const unitId = await createVacantUnit(landlord.access_token);
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());

    const tenancy = await request(app.getHttpServer())
      .post('/v1/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ unit_id: unitId, tenant_id: tenant.user.id, start_date: '2026-09-01', rent_amount: 150000 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancy.body.id}/termination-notices`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ reason: 'non_payment', reason_detail: 'Unpaid rent', effective_date: '2026-12-31' })
      .expect(201);

    expect(res.body.document_url).toContain('local://termination-notices/');

    const detail = await request(app.getHttpServer())
      .get(`/v1/tenancies/${tenancy.body.id}`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .expect(200);
    expect(detail.body.status).toBe('notice_given');

    const history = await request(app.getHttpServer())
      .get(`/v1/tenancies/${tenancy.body.id}/termination-notices`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(history.body).toHaveLength(1);
  });

  it("rejects someone who isn't the landlord or tenant from viewing the tenancy", async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const unitId = await createVacantUnit(landlord.access_token);
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const stranger = await signUp(app, fakeSms, randomPhoneNumber());

    const tenancy = await request(app.getHttpServer())
      .post('/v1/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ unit_id: unitId, tenant_id: tenant.user.id, start_date: '2026-09-01', rent_amount: 150000 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/v1/tenancies/${tenancy.body.id}`)
      .set('Authorization', `Bearer ${stranger.access_token}`)
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('the notice-expiry sweep terminates a tenancy past its effective date and frees the unit', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const unitId = await createVacantUnit(landlord.access_token);
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());

    const tenancy = await request(app.getHttpServer())
      .post('/v1/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ unit_id: unitId, tenant_id: tenant.user.id, start_date: '2026-09-01', rent_amount: 150000 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancy.body.id}/termination-notices`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ reason: 'end_of_term', effective_date: '2026-12-31' })
      .expect(201);

    // Backdate the notice so the sweep considers it due, then invoke the
    // exact @Cron-decorated method directly on the running app instance —
    // deterministic and immediate, rather than waiting on the real 15-minute
    // timer, while still exercising the real DB + real EventEmitter2 that
    // Properties' UnitOccupancyListener is subscribed to.
    await prisma.terminationNotice.updateMany({
      where: { tenancyId: tenancy.body.id },
      data: { effectiveDate: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    await tenanciesService.sweepNoticeExpirations();

    const detail = await request(app.getHttpServer())
      .get(`/v1/tenancies/${tenancy.body.id}`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .expect(200);
    expect(detail.body.status).toBe('terminated');

    const units = await request(app.getHttpServer())
      .get('/v1/landlords/me/units')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .expect(200);
    expect(units.body.find((u: { id: string }) => u.id === unitId).status).toBe('vacant');
  });
});
