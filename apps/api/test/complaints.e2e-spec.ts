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
import { NotificationsModule } from '../src/modules/notifications/notifications.module';
import { ComplaintsModule } from '../src/modules/complaints/complaints.module';
import { configureApp } from '../src/setup-app';
import { PrismaService } from '../src/common/prisma.service';
import { SMS_GATEWAY } from '../src/modules/auth/sms/sms-gateway';
import { FakeSmsGateway, randomPhoneNumber } from './support/fake-sms-gateway';
import { FakePaymentGateway } from './support/fake-payment-gateway';
import { signUp } from './support/sign-up';

async function waitFor<T>(check: () => Promise<T | null | undefined>, timeoutMs = 2000): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value || Date.now() > deadline) return value ?? null;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('Complaints module (e2e)', () => {
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
        ContractsModule,
        NotificationsModule,
        ComplaintsModule,
      ],
    })
      .overrideProvider(SMS_GATEWAY)
      .useValue(fakeSms)
      .overrideProvider(PAYMENT_GATEWAY)
      .useValue(new FakePaymentGateway())
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    app.enableShutdownHooks();
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prisma.notification.deleteMany();
    await prisma.notificationChannel.deleteMany();
    await prisma.pushDeviceToken.deleteMany();
    await prisma.notificationPreference.deleteMany();
    await prisma.complaintUpdate.deleteMany();
    await prisma.complaintMedia.deleteMany();
    await prisma.complaint.deleteMany();
    await prisma.paymentWebhookRaw.deleteMany();
    await prisma.ledgerEntry.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.contract.deleteMany();
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
      .send({ rent_amount: 150000, label: 'Studio A' })
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

    return { unitId: unitRes.body.id as string, tenancyId: tenancyRes.body.id as string };
  }

  it('creates a complaint with a photo attachment, and notifies the landlord', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const { tenancyId, unitId } = await setUpTenancy(landlord.access_token, tenant.user.id);

    const res = await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancyId}/complaints`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .field('category', 'plumbing')
      .field('description', 'Leaking pipe under the kitchen sink')
      .attach('media', Buffer.from('fake-photo'), 'leak.jpg')
      .expect(201);

    expect(res.body).toMatchObject({
      tenancy_id: tenancyId,
      unit_id: unitId,
      tenant_id: tenant.user.id,
      landlord_id: landlord.user.id,
      category: 'plumbing',
      status: 'open',
    });
    expect(res.body.media).toHaveLength(1);
    expect(res.body.media[0]).toMatchObject({ media_type: 'photo' });

    // Waterfall (push -> whatsapp -> sms), landlord has neither push nor
    // whatsapp opted in, so falls through to sms.
    const notification = await waitFor(() =>
      prisma.notification.findFirst({ where: { userId: landlord.user.id, eventType: 'complaint.created' } }),
    );
    expect(notification?.channel).toBe('sms');
    expect(notification?.status).toBe('sent');
  });

  it("rejects someone who isn't this tenancy's tenant from filing a complaint", async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const stranger = await signUp(app, fakeSms, randomPhoneNumber());
    const { tenancyId } = await setUpTenancy(landlord.access_token, tenant.user.id);

    const res = await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancyId}/complaints`)
      .set('Authorization', `Bearer ${stranger.access_token}`)
      .field('category', 'noise')
      .field('description', 'Loud neighbors')
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects an unsupported media file type', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const { tenancyId } = await setUpTenancy(landlord.access_token, tenant.user.id);

    const res = await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancyId}/complaints`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .field('category', 'other')
      .field('description', 'See attached document')
      .attach('media', Buffer.from('not a photo'), 'notes.pdf')
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it("landlord's aggregate view filters by unit, status, and category, and updating status notifies the tenant", async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const { tenancyId, unitId } = await setUpTenancy(landlord.access_token, tenant.user.id);

    const created = await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancyId}/complaints`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .field('category', 'electrical')
      .field('description', 'Flickering lights in the hallway')
      .expect(201);

    const listRes = await request(app.getHttpServer())
      .get(`/v1/landlords/me/complaints?unit_id=${unitId}&status=open&category=electrical`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .expect(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].id).toBe(created.body.id);

    const noMatchRes = await request(app.getHttpServer())
      .get(`/v1/landlords/me/complaints?category=plumbing`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .expect(200);
    expect(noMatchRes.body).toHaveLength(0);

    const updateRes = await request(app.getHttpServer())
      .patch(`/v1/complaints/${created.body.id}/status`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ new_status: 'acknowledged', note: 'Electrician scheduled for Thursday' })
      .expect(200);
    expect(updateRes.body.status).toBe('acknowledged');
    expect(updateRes.body.acknowledged_at).not.toBeNull();

    // complaint.status_changed -> tenant, waterfall (push -> in_app);
    // no push token registered, so falls through to in_app.
    const notification = await waitFor(() =>
      prisma.notification.findFirst({ where: { userId: tenant.user.id, eventType: 'complaint.status_changed' } }),
    );
    expect(notification?.channel).toBe('in_app');
    expect(notification?.status).toBe('sent');
  });

  it('rejects a landlord updating a complaint that belongs to a different landlord', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const otherLandlord = await signUp(app, fakeSms, randomPhoneNumber());
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const { tenancyId } = await setUpTenancy(landlord.access_token, tenant.user.id);

    const created = await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancyId}/complaints`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .field('category', 'security')
      .field('description', 'Broken gate lock')
      .expect(201);

    const res = await request(app.getHttpServer())
      .patch(`/v1/complaints/${created.body.id}/status`)
      .set('Authorization', `Bearer ${otherLandlord.access_token}`)
      .send({ new_status: 'acknowledged' })
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    // complaint.created's listener (for the real landlord) runs via a
    // fire-and-forget emit() — wait for it to land before afterEach wipes
    // notification_preferences out from under it.
    await waitFor(() => prisma.notification.findFirst({ where: { userId: landlord.user.id, eventType: 'complaint.created' } }));
  });

  it('rejects updating a complaint that is already closed', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());
    const { tenancyId } = await setUpTenancy(landlord.access_token, tenant.user.id);

    const created = await request(app.getHttpServer())
      .post(`/v1/tenancies/${tenancyId}/complaints`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .field('category', 'other')
      .field('description', 'Something minor')
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/v1/complaints/${created.body.id}/status`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ new_status: 'closed' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .patch(`/v1/complaints/${created.body.id}/status`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ new_status: 'resolved' })
      .expect(422);
    expect(res.body.error.code).toBe('COMPLAINT_ALREADY_CLOSED');

    // Same reasoning as the previous test: let the fire-and-forget
    // listeners (complaint.created for the landlord, complaint.status_changed
    // for the tenant) finish before afterEach's cleanup runs.
    await waitFor(() => prisma.notification.findFirst({ where: { userId: landlord.user.id, eventType: 'complaint.created' } }));
    await waitFor(() => prisma.notification.findFirst({ where: { userId: tenant.user.id, eventType: 'complaint.status_changed' } }));
  });
});
