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
import { VisitsModule } from '../src/modules/visits/visits.module';
import { TenanciesModule } from '../src/modules/tenancies/tenancies.module';
import { PaymentsModule } from '../src/modules/payments/payments.module';
import { PAYMENT_GATEWAY } from '../src/modules/payments/gateway/payment-gateway';
import { ContractsModule } from '../src/modules/contracts/contracts.module';
import { NotificationsModule } from '../src/modules/notifications/notifications.module';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { configureApp } from '../src/setup-app';
import { PrismaService } from '../src/common/prisma.service';
import { Prisma } from '@prisma/client';
import { SMS_GATEWAY } from '../src/modules/auth/sms/sms-gateway';
import { FakeSmsGateway, randomPhoneNumber } from './support/fake-sms-gateway';
import { FakePaymentGateway } from './support/fake-payment-gateway';
import { signUp } from './support/sign-up';

// Every event that triggers a notification fan-out/waterfall is emitted
// with plain emit() (fire-and-forget), not emitAsync() — correctly: the
// HTTP response for e.g. "issue a termination notice" doesn't need to
// wait for the (async, best-effort) notification dispatch to finish. That
// means a test asserting on the resulting `notifications` rows right
// after the triggering request can race the listener — this polls briefly
// instead of asserting immediately.
async function waitForNotifications(
  prisma: PrismaService,
  where: Prisma.NotificationWhereInput,
  minCount = 1,
  timeoutMs = 2000,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await prisma.notification.findMany({ where });
    if (rows.length >= minCount || Date.now() > deadline) return rows;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('Notifications module (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fakeSms: FakeSmsGateway;
  let notificationsService: NotificationsService;

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
        VisitsModule,
        TenanciesModule,
        PaymentsModule,
        ContractsModule,
        NotificationsModule,
      ],
    })
      .overrideProvider(SMS_GATEWAY)
      .useValue(fakeSms)
      .overrideProvider(PAYMENT_GATEWAY)
      .useValue(new FakePaymentGateway())
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    // Tenancies'/Payments'/Notifications' @Cron sweeps need shutdown hooks
    // enabled to clear cleanly — same reasoning as the other e2e specs.
    app.enableShutdownHooks();
    await app.init();

    prisma = app.get(PrismaService);
    notificationsService = app.get(NotificationsService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prisma.notification.deleteMany();
    await prisma.notificationChannel.deleteMany();
    await prisma.pushDeviceToken.deleteMany();
    await prisma.notificationPreference.deleteMany();
    await prisma.paymentWebhookRaw.deleteMany();
    await prisma.ledgerEntry.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.contract.deleteMany();
    await prisma.terminationNotice.deleteMany();
    await prisma.tenancy.deleteMany();
    await prisma.visitRequest.deleteMany();
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

  describe('channel opt-in/opt-out', () => {
    it('defaults to sms opted-in/verified and everything else opted-out', async () => {
      const user = await signUp(app, fakeSms, randomPhoneNumber());

      const res = await request(app.getHttpServer())
        .get('/v1/users/me/notification-channels')
        .set('Authorization', `Bearer ${user.access_token}`)
        .expect(200);

      expect(res.body).toEqual([
        { channel: 'sms', opted_in: true, verified: true },
        { channel: 'whatsapp', opted_in: false, verified: false },
        { channel: 'email', opted_in: false, verified: false },
        { channel: 'push', opted_in: false, verified: false },
      ]);
    });

    it('opts into whatsapp with a captured identifier', async () => {
      const user = await signUp(app, fakeSms, randomPhoneNumber());

      await request(app.getHttpServer())
        .post('/v1/users/me/notification-channels/whatsapp/opt-in')
        .set('Authorization', `Bearer ${user.access_token}`)
        .send({ channel_identifier: '+237670000000' })
        .expect(204);

      const res = await request(app.getHttpServer())
        .get('/v1/users/me/notification-channels')
        .set('Authorization', `Bearer ${user.access_token}`)
        .expect(200);
      expect(res.body.find((c: { channel: string }) => c.channel === 'whatsapp')).toMatchObject({ opted_in: true });
    });

    it('rejects opting out of sms without confirmation, and allows it with confirmation', async () => {
      const user = await signUp(app, fakeSms, randomPhoneNumber());

      const rejected = await request(app.getHttpServer())
        .post('/v1/users/me/notification-channels/sms/opt-out')
        .set('Authorization', `Bearer ${user.access_token}`)
        .send({})
        .expect(422);
      expect(rejected.body.error.code).toBe('SMS_OPT_OUT_REQUIRES_CONFIRMATION');

      await request(app.getHttpServer())
        .post('/v1/users/me/notification-channels/sms/opt-out')
        .set('Authorization', `Bearer ${user.access_token}`)
        .send({ confirm: true })
        .expect(204);

      const res = await request(app.getHttpServer())
        .get('/v1/users/me/notification-channels')
        .set('Authorization', `Bearer ${user.access_token}`)
        .expect(200);
      expect(res.body.find((c: { channel: string }) => c.channel === 'sms')).toMatchObject({ opted_in: false });
    });

    it('rejects opt-in for push (managed via push-tokens instead)', async () => {
      const user = await signUp(app, fakeSms, randomPhoneNumber());

      const res = await request(app.getHttpServer())
        .post('/v1/users/me/notification-channels/push/opt-in')
        .set('Authorization', `Bearer ${user.access_token}`)
        .send({ channel_identifier: 'some-token-value' })
        .expect(400);
      expect(res.body.error.code).toBe('INVALID_NOTIFICATION_CHANNEL');
    });
  });

  describe('push tokens', () => {
    it('registering a push token makes push show as opted-in', async () => {
      const user = await signUp(app, fakeSms, randomPhoneNumber());

      await request(app.getHttpServer())
        .post('/v1/users/me/push-tokens')
        .set('Authorization', `Bearer ${user.access_token}`)
        .send({ fcm_token: 'fcm-token-123', platform: 'android' })
        .expect(204);

      const res = await request(app.getHttpServer())
        .get('/v1/users/me/notification-channels')
        .set('Authorization', `Bearer ${user.access_token}`)
        .expect(200);
      expect(res.body.find((c: { channel: string }) => c.channel === 'push')).toMatchObject({ opted_in: true });
    });
  });

  describe('fan-out on tenancy.notice_given', () => {
    it('sends the tenant an SMS and records the in-app notification, defaulting whatsapp/email as skipped', async () => {
      const landlord = await signUp(app, fakeSms, randomPhoneNumber());
      const tenant = await signUp(app, fakeSms, randomPhoneNumber());
      const { tenancyId } = await setUpTenancy(landlord.access_token, tenant.user.id);

      await request(app.getHttpServer())
        .post(`/v1/tenancies/${tenancyId}/termination-notices`)
        .set('Authorization', `Bearer ${landlord.access_token}`)
        .send({ reason: 'end_of_term', effective_date: '2026-12-31' })
        .expect(201);

      const notifications = await waitForNotifications(prisma, { userId: tenant.user.id, eventType: 'tenancy.notice_given' }, 5);
      const byChannel = new Map(notifications.map((n) => [n.channel, n]));

      expect(byChannel.get('sms')?.status).toBe('sent');
      expect(byChannel.get('in_app')?.status).toBe('sent');
      expect(byChannel.get('whatsapp')?.status).toBe('skipped');
      expect(byChannel.get('email')?.status).toBe('skipped');
      expect(fakeSms.lastMessage).toContain('résiliation');

      const inAppRes = await request(app.getHttpServer())
        .get('/v1/users/me/notifications')
        .set('Authorization', `Bearer ${tenant.access_token}`)
        .expect(200);
      expect(inAppRes.body.results.some((n: { event_type: string }) => n.event_type === 'tenancy.notice_given')).toBe(true);
    });
  });

  describe('waterfall on visit_request.created', () => {
    it('sends the landlord an SMS when they have no push token or whatsapp opt-in (falls through to the floor channel)', async () => {
      const landlord = await signUp(app, fakeSms, randomPhoneNumber());
      const tenant = await signUp(app, fakeSms, randomPhoneNumber());

      const propertyRes = await request(app.getHttpServer())
        .post('/v1/properties')
        .set('Authorization', `Bearer ${landlord.access_token}`)
        .send({ address_line: '1 Rue Test', city: 'Douala' })
        .expect(201);
      const unitRes = await request(app.getHttpServer())
        .post(`/v1/properties/${propertyRes.body.id}/units`)
        .set('Authorization', `Bearer ${landlord.access_token}`)
        .send({ rent_amount: 150000 })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/v1/units/${unitRes.body.id}/photos`)
        .set('Authorization', `Bearer ${landlord.access_token}`)
        .attach('file', Buffer.from('fake-image'), 'photo.jpg')
        .expect(201);

      await request(app.getHttpServer())
        .post(`/v1/units/${unitRes.body.id}/visit-requests`)
        .set('Authorization', `Bearer ${tenant.access_token}`)
        .send({ requested_slots: [{ start: '2026-08-15T10:00:00Z' }] })
        .expect(201);

      const notifications = await waitForNotifications(prisma, { userId: landlord.user.id, eventType: 'visit_request.created' }, 1);
      // Waterfall: no push token, no whatsapp opt-in -> falls through to sms, exactly one row.
      expect(notifications).toHaveLength(1);
      expect(notifications[0].channel).toBe('sms');
      expect(notifications[0].status).toBe('sent');
    });
  });

  describe('rent-expiry reminder scheduler', () => {
    it('fires the first reminder to both tenant and landlord, and is idempotent on a same-day re-run', async () => {
      const landlord = await signUp(app, fakeSms, randomPhoneNumber());
      const tenant = await signUp(app, fakeSms, randomPhoneNumber());
      const { tenancyId } = await setUpTenancy(landlord.access_token, tenant.user.id);

      const paidThroughDate = new Date();
      paidThroughDate.setUTCDate(paidThroughDate.getUTCDate() + 30); // matches the default reminder_first_days_before
      await prisma.tenancy.update({ where: { id: tenancyId }, data: { paidThroughDate } });

      await notificationsService.rentExpiryReminderScan();

      const firstRunNotifications = await prisma.notification.findMany({ where: { eventType: 'rent_expiry.first_reminder_due' } });
      const recipientIds = firstRunNotifications.map((n) => n.userId);
      expect(recipientIds).toContain(tenant.user.id);
      expect(recipientIds).toContain(landlord.user.id);

      // Re-running the same day must not double-send (already_sent guard).
      await notificationsService.rentExpiryReminderScan();
      const afterSecondRun = await prisma.notification.findMany({ where: { eventType: 'rent_expiry.first_reminder_due' } });
      expect(afterSecondRun).toHaveLength(firstRunNotifications.length);
    });

    it('fires the overdue event the day after paid_through_date passes', async () => {
      const landlord = await signUp(app, fakeSms, randomPhoneNumber());
      const tenant = await signUp(app, fakeSms, randomPhoneNumber());
      const { tenancyId } = await setUpTenancy(landlord.access_token, tenant.user.id);

      const paidThroughDate = new Date();
      paidThroughDate.setUTCDate(paidThroughDate.getUTCDate() - 1);
      await prisma.tenancy.update({ where: { id: tenancyId }, data: { paidThroughDate } });

      await notificationsService.rentExpiryReminderScan();

      const overdueNotifications = await prisma.notification.findMany({ where: { eventType: 'rent_expiry.overdue' } });
      const recipientIds = overdueNotifications.map((n) => n.userId);
      expect(recipientIds).toContain(tenant.user.id);
      expect(recipientIds).toContain(landlord.user.id);
    });
  });

  describe('webhooks', () => {
    it('a whatsapp status callback marks the matching notification delivered', async () => {
      const landlord = await signUp(app, fakeSms, randomPhoneNumber());
      const tenant = await signUp(app, fakeSms, randomPhoneNumber());
      await request(app.getHttpServer())
        .post('/v1/users/me/notification-channels/whatsapp/opt-in')
        .set('Authorization', `Bearer ${tenant.access_token}`)
        .send({ channel_identifier: tenant.user.phone_number })
        .expect(204);
      const { tenancyId } = await setUpTenancy(landlord.access_token, tenant.user.id);

      await request(app.getHttpServer())
        .post(`/v1/tenancies/${tenancyId}/termination-notices`)
        .set('Authorization', `Bearer ${landlord.access_token}`)
        .send({ reason: 'end_of_term', effective_date: '2026-12-31' })
        .expect(201);

      const whatsappNotifications = await waitForNotifications(
        prisma,
        { userId: tenant.user.id, eventType: 'tenancy.notice_given', channel: 'whatsapp' },
        1,
      );
      const whatsappNotification = whatsappNotifications[0];
      expect(whatsappNotification?.status).toBe('sent');

      await request(app.getHttpServer())
        .post('/v1/webhooks/whatsapp/status')
        .send({ provider_message_id: whatsappNotification!.providerMessageId, status: 'delivered' })
        .expect(200);

      const updated = await prisma.notification.findUnique({ where: { id: whatsappNotification!.id } });
      expect(updated?.status).toBe('delivered');
      expect(updated?.deliveredAt).not.toBeNull();
    });
  });
});
