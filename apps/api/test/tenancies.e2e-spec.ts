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
