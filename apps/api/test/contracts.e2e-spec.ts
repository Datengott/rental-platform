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
import { PAYMENT_GATEWAY } from '../src/modules/payments/gateway/payment-gateway';
import { ContractsModule } from '../src/modules/contracts/contracts.module';
import { configureApp } from '../src/setup-app';
import { PrismaService } from '../src/common/prisma.service';
import { SMS_GATEWAY } from '../src/modules/auth/sms/sms-gateway';
import { FakeSmsGateway, randomPhoneNumber } from './support/fake-sms-gateway';
import { FakePaymentGateway } from './support/fake-payment-gateway';
import { signUp } from './support/sign-up';

describe('Contracts module (e2e)', () => {
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
        // TenanciesModule pulls in PaymentsModule via forwardRef — the
        // payment gateway is faked the same way payments.e2e-spec.ts does,
        // even though this suite never touches payments directly.
        TenanciesModule,
        PaymentsModule,
        ContractsModule,
      ],
    })
      .overrideProvider(SMS_GATEWAY)
      .useValue(fakeSms)
      .overrideProvider(PAYMENT_GATEWAY)
      .useValue(new FakePaymentGateway())
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    // Tenancies'/Payments' @Cron sweeps need shutdown hooks enabled to
    // clear cleanly — same reasoning as tenancies.e2e-spec.ts/payments.e2e-spec.ts.
    app.enableShutdownHooks();
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prisma.contract.deleteMany();
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

    return tenancyRes.body.id as string;
  }

  it('generates a contract in the requested locale, in draft status, downloadable by either party', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const tenancyId = await setUpTenancy(landlord.access_token, tenant.user.id);

    const generateRes = await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancyId}/contracts`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ locale: 'fr' })
      .expect(201);

    expect(generateRes.body).toMatchObject({
      tenancy_id: tenancyId,
      locale: 'fr',
      status: 'draft',
      template_version: 'v1',
    });
    expect(generateRes.body.document_url).toContain('local://contracts/');

    // Both parties can re-fetch it, per PRD Epic 6 US-6.1 AC3.
    const asLandlord = await request(app.getHttpServer())
      .get(`/v1/contracts/${generateRes.body.id}`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .expect(200);
    expect(asLandlord.body.document_url).toBe(generateRes.body.document_url);

    const asTenant = await request(app.getHttpServer())
      .get(`/v1/contracts/${generateRes.body.id}`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(asTenant.body.status).toBe('draft');

    // GET /tenancies/{id} already surfaced contract_status — the landlord's
    // own occupancy dashboard (GET /landlords/me/tenancies) is a separate
    // code path and had been missing it entirely until this was caught live.
    const dashboardRes = await request(app.getHttpServer())
      .get('/v1/landlords/me/tenancies')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .expect(200);
    expect(dashboardRes.body.find((t: { id: string }) => t.id === tenancyId)).toMatchObject({ contract_status: 'draft' });
  });

  it("defaults the locale to the requester's own stored locale when omitted", async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const tenancyId = await setUpTenancy(landlord.access_token, tenant.user.id);

    // New users default to 'fr' (User.locale's own default) unless changed.
    const generateRes = await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancyId}/contracts`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .send({})
      .expect(201);

    expect(generateRes.body.locale).toBe('fr');
  });

  it("rejects someone who isn't the landlord or tenant from generating or viewing the contract", async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const stranger = await signUp(app, fakeSms, randomPhoneNumber());
    const tenancyId = await setUpTenancy(landlord.access_token, tenant.user.id);

    const generateAttempt = await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancyId}/contracts`)
      .set('Authorization', `Bearer ${stranger.access_token}`)
      .send({})
      .expect(404);
    expect(generateAttempt.body.error.code).toBe('NOT_FOUND');

    const generateRes = await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancyId}/contracts`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({})
      .expect(201);

    const viewAttempt = await request(app.getHttpServer())
      .get(`/v1/contracts/${generateRes.body.id}`)
      .set('Authorization', `Bearer ${stranger.access_token}`)
      .expect(404);
    expect(viewAttempt.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for a contract id that does not exist', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());

    const res = await request(app.getHttpServer())
      .get('/v1/contracts/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
