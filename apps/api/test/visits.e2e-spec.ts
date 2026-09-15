import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaModule } from '../src/common/prisma.module';
import { StorageModule } from '../src/common/storage/storage.module';
import { AuthModule } from '../src/modules/auth/auth.module';
import { PropertiesModule } from '../src/modules/properties/properties.module';
import { VisitsModule } from '../src/modules/visits/visits.module';
import { configureApp } from '../src/setup-app';
import { PrismaService } from '../src/common/prisma.service';
import { SMS_GATEWAY } from '../src/modules/auth/sms/sms-gateway';
import { FakeSmsGateway, randomPhoneNumber } from './support/fake-sms-gateway';
import { signUp } from './support/sign-up';

describe('Visits module (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fakeSms: FakeSmsGateway;

  beforeAll(async () => {
    fakeSms = new FakeSmsGateway();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        EventEmitterModule.forRoot(),
        PrismaModule,
        StorageModule,
        AuthModule,
        PropertiesModule,
        VisitsModule,
      ],
    })
      .overrideProvider(SMS_GATEWAY)
      .useValue(fakeSms)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prisma.visitRequest.deleteMany();
    await prisma.unitPhoto.deleteMany();
    await prisma.unit.deleteMany();
    await prisma.property.deleteMany();
    await prisma.session.deleteMany();
    await prisma.otpChallenge.deleteMany();
    await prisma.userRoleAssignment.deleteMany();
    await prisma.user.deleteMany();
  });

  async function createListedUnit(landlordAccessToken: string) {
    const propertyRes = await request(app.getHttpServer())
      .post('/v1/properties')
      .set('Authorization', `Bearer ${landlordAccessToken}`)
      .send({ address_line: '1 Rue Test', city: 'Douala' })
      .expect(201);

    const unitRes = await request(app.getHttpServer())
      .post(`/v1/properties/${propertyRes.body.id}/units`)
      .set('Authorization', `Bearer ${landlordAccessToken}`)
      .send({ rent_amount: 100000 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/units/${unitRes.body.id}/photos`)
      .set('Authorization', `Bearer ${landlordAccessToken}`)
      .attach('file', Buffer.from('fake-image'), 'photo.jpg')
      .expect(201);

    return unitRes.body.id as string;
  }

  it('a tenant can request a visit, which is pending with a +48h expiry', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const unitId = await createListedUnit(landlord.access_token);
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());

    const before = Date.now();
    const res = await request(app.getHttpServer())
      .post(`/v1/units/${unitId}/visit-requests`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .send({ requested_slots: [{ start: '2026-09-20T10:00:00Z' }] })
      .expect(201);

    expect(res.body.status).toBe('pending');
    expect(res.body.landlord_id).toBe(landlord.user.id);
    expect(res.body.tenant_id).toBe(tenant.user.id);
    const expiresInHours = (new Date(res.body.expires_at).getTime() - before) / (1000 * 60 * 60);
    expect(expiresInHours).toBeGreaterThan(47.9);
    expect(expiresInHours).toBeLessThan(48.1);
  });

  it('rejects requesting a visit on a nonexistent unit with 404', async () => {
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());

    const res = await request(app.getHttpServer())
      .post('/v1/units/00000000-0000-0000-0000-000000000000/visit-requests')
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .send({ requested_slots: [{ start: '2026-09-20T10:00:00Z' }] })
      .expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it("rejects someone other than the unit's landlord from responding", async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const unitId = await createListedUnit(landlord.access_token);
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());

    const vr = await request(app.getHttpServer())
      .post(`/v1/units/${unitId}/visit-requests`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .send({ requested_slots: [{ start: '2026-09-20T10:00:00Z' }] })
      .expect(201);

    const res = await request(app.getHttpServer())
      .patch(`/v1/visit-requests/${vr.body.id}/respond`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .send({ action: 'decline' })
      .expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('lets the landlord accept with a confirmed slot, and blocks acting on it again', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const unitId = await createListedUnit(landlord.access_token);
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());

    const vr = await request(app.getHttpServer())
      .post(`/v1/units/${unitId}/visit-requests`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .send({ requested_slots: [{ start: '2026-09-20T10:00:00Z' }] })
      .expect(201);

    const acceptRes = await request(app.getHttpServer())
      .patch(`/v1/visit-requests/${vr.body.id}/respond`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ action: 'accept', confirmed_slot: '2026-09-20T10:00:00Z' })
      .expect(200);

    expect(acceptRes.body).toMatchObject({ status: 'accepted' });
    expect(new Date(acceptRes.body.confirmed_slot).toISOString()).toBe('2026-09-20T10:00:00.000Z');

    const res = await request(app.getHttpServer())
      .patch(`/v1/visit-requests/${vr.body.id}/respond`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ action: 'decline' })
      .expect(422);

    expect(res.body.error.code).toBe('VISIT_REQUEST_NOT_RESPONDABLE');
  });

  it('rejects accept without a confirmed_slot as a validation error', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const unitId = await createListedUnit(landlord.access_token);
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());

    const vr = await request(app.getHttpServer())
      .post(`/v1/units/${unitId}/visit-requests`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .send({ requested_slots: [{ start: '2026-09-20T10:00:00Z' }] })
      .expect(201);

    const res = await request(app.getHttpServer())
      .patch(`/v1/visit-requests/${vr.body.id}/respond`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ action: 'accept' })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('lets the landlord propose an alternate time via reschedule', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const unitId = await createListedUnit(landlord.access_token);
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());

    const vr = await request(app.getHttpServer())
      .post(`/v1/units/${unitId}/visit-requests`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .send({ requested_slots: [{ start: '2026-09-20T10:00:00Z' }] })
      .expect(201);

    const res = await request(app.getHttpServer())
      .patch(`/v1/visit-requests/${vr.body.id}/respond`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ action: 'reschedule', proposed_slot: '2026-09-23T09:00:00Z', landlord_note: 'Works better for me' })
      .expect(200);

    expect(res.body).toMatchObject({ status: 'rescheduled', landlord_note: 'Works better for me' });
    expect(new Date(res.body.confirmed_slot).toISOString()).toBe('2026-09-23T09:00:00.000Z');
  });

  it('lazily expires a stale pending request when the landlord tries to respond to it', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const unitId = await createListedUnit(landlord.access_token);
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());

    const vr = await request(app.getHttpServer())
      .post(`/v1/units/${unitId}/visit-requests`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .send({ requested_slots: [{ start: '2026-09-20T10:00:00Z' }] })
      .expect(201);

    await prisma.visitRequest.update({
      where: { id: vr.body.id },
      data: { expiresAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const res = await request(app.getHttpServer())
      .patch(`/v1/visit-requests/${vr.body.id}/respond`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ action: 'decline' })
      .expect(422);

    expect(res.body.error.code).toBe('VISIT_REQUEST_NOT_RESPONDABLE');

    const stored = await prisma.visitRequest.findUniqueOrThrow({ where: { id: vr.body.id } });
    expect(stored.status).toBe('expired');
  });

  it('filters the landlord inbox by status', async () => {
    const landlord = await signUp(app, fakeSms, randomPhoneNumber());
    const unitId = await createListedUnit(landlord.access_token);
    const tenant = await signUp(app, fakeSms, randomPhoneNumber());

    const pending = await request(app.getHttpServer())
      .post(`/v1/units/${unitId}/visit-requests`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .send({ requested_slots: [{ start: '2026-09-20T10:00:00Z' }] })
      .expect(201);

    const declined = await request(app.getHttpServer())
      .post(`/v1/units/${unitId}/visit-requests`)
      .set('Authorization', `Bearer ${tenant.access_token}`)
      .send({ requested_slots: [{ start: '2026-09-21T10:00:00Z' }] })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/v1/visit-requests/${declined.body.id}/respond`)
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .send({ action: 'decline' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/v1/landlords/me/visit-requests?status=pending')
      .set('Authorization', `Bearer ${landlord.access_token}`)
      .expect(200);

    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].id).toBe(pending.body.id);
  });
});
