import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaModule } from '../src/common/prisma.module';
import { AuthModule } from '../src/modules/auth/auth.module';
import { configureApp } from '../src/setup-app';
import { PrismaService } from '../src/common/prisma.service';
import { SMS_GATEWAY, SmsGateway } from '../src/modules/auth/sms/sms-gateway';

// Captures whatever the auth flow "sends" instead of hitting a real SMS
// provider, so tests can read back the OTP without scraping console logs.
class FakeSmsGateway implements SmsGateway {
  public lastMessage: string | undefined;

  async send(_phoneNumber: string, message: string): Promise<void> {
    this.lastMessage = message;
    return Promise.resolve();
  }

  extractOtp(): string {
    const match = this.lastMessage?.match(/(\d{6})/);
    if (!match) throw new Error('No OTP captured — did requestOtp run first?');
    return match[1];
  }
}

function randomPhoneNumber(): string {
  const suffix = Math.floor(100000 + Math.random() * 899999);
  return `+2376${suffix}`;
}

describe('Auth module (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fakeSms: FakeSmsGateway;

  beforeAll(async () => {
    fakeSms = new FakeSmsGateway();

    // Only the modules Auth actually depends on — not the full AppModule
    // (which also boots AppController's live Redis health-check client,
    // unrelated to anything under test here and a needless slowdown).
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), EventEmitterModule.forRoot(), PrismaModule, AuthModule],
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

  async function signUp(phoneNumber: string) {
    const requestRes = await request(app.getHttpServer())
      .post('/v1/auth/otp/request')
      .send({ phone_number: phoneNumber, purpose: 'signup' })
      .expect(200);

    const otp = fakeSms.extractOtp();

    const verifyRes = await request(app.getHttpServer())
      .post('/v1/auth/otp/verify')
      .send({ challenge_id: requestRes.body.challenge_id, otp })
      .expect(200);

    return verifyRes.body as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      user: { id: string; phone_number: string; roles: string[]; kyc_tier: string };
    };
  }

  afterEach(async () => {
    // Keep the e2e DB clean between tests without touching the append-only
    // ledger rule from CLAUDE.md — none of this module's tables are ledgers.
    await prisma.session.deleteMany();
    await prisma.otpChallenge.deleteMany();
    await prisma.userRoleAssignment.deleteMany();
    await prisma.user.deleteMany();
  });

  it('signs up a new user via OTP and returns a tenant-role session', async () => {
    const phone = randomPhoneNumber();
    const session = await signUp(phone);

    expect(session.access_token).toBeDefined();
    expect(session.refresh_token).toBeDefined();
    expect(session.user).toMatchObject({ phone_number: phone, roles: ['tenant'], kyc_tier: 'unverified' });
  });

  it('rejects an incorrect OTP with INVALID_OTP', async () => {
    const phone = randomPhoneNumber();
    const requestRes = await request(app.getHttpServer())
      .post('/v1/auth/otp/request')
      .send({ phone_number: phone, purpose: 'login' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/v1/auth/otp/verify')
      .send({ challenge_id: requestRes.body.challenge_id, otp: '000000' })
      .expect(400);

    expect(res.body.error.code).toBe('INVALID_OTP');
  });

  it('rate-limits a second OTP request for the same phone number within the cooldown', async () => {
    const phone = randomPhoneNumber();
    await request(app.getHttpServer())
      .post('/v1/auth/otp/request')
      .send({ phone_number: phone, purpose: 'login' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/v1/auth/otp/request')
      .send({ phone_number: phone, purpose: 'login' })
      .expect(429);

    expect(res.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('rejects malformed phone numbers with a VALIDATION_ERROR field error', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/otp/request')
      .send({ phone_number: 'not-a-phone', purpose: 'login' })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.field_errors[0].field).toBe('phone_number');
  });

  it('rejects requests to protected endpoints without a bearer token', async () => {
    const res = await request(app.getHttpServer()).get('/v1/users/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns and updates the authenticated user profile', async () => {
    const phone = randomPhoneNumber();
    const session = await signUp(phone);

    const meRes = await request(app.getHttpServer())
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${session.access_token}`)
      .expect(200);
    expect(meRes.body.phone_number).toBe(phone);

    const patchRes = await request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${session.access_token}`)
      .send({ full_name: 'Test User', locale: 'en' })
      .expect(200);
    expect(patchRes.body).toMatchObject({ full_name: 'Test User', locale: 'en' });
  });

  it('rejects a non-admin calling the admin KYC-approve endpoint', async () => {
    const phone = randomPhoneNumber();
    const session = await signUp(phone);

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/users/${session.user.id}/kyc/approve`)
      .set('Authorization', `Bearer ${session.access_token}`)
      .send({ new_tier: 'ownership_verified' })
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it("lets an admin advance another user's KYC tier", async () => {
    const targetPhone = randomPhoneNumber();
    const target = await signUp(targetPhone);

    // Fixture setup only (the OTP flow itself is covered by the other
    // tests) — seed the admin role directly so this test only needs a
    // single OTP request for the admin phone number, avoiding a collision
    // with AuthService's per-phone request cooldown.
    const adminPhone = randomPhoneNumber();
    await prisma.user.create({
      data: { phoneNumber: adminPhone, roles: { create: [{ role: 'tenant' }, { role: 'admin' }] } },
    });
    const adminSession = await signInAgain(adminPhone);

    const res = await request(app.getHttpServer())
      .post(`/v1/admin/users/${target.user.id}/kyc/approve`)
      .set('Authorization', `Bearer ${adminSession.access_token}`)
      .send({ new_tier: 'ownership_verified', note: 'reviewed' })
      .expect(200);

    expect(res.body.kyc_tier).toBe('ownership_verified');
  });

  it('revokes the session on logout so the refresh token stops working', async () => {
    const phone = randomPhoneNumber();
    const session = await signUp(phone);

    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${session.access_token}`)
      .expect(204);

    const res = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refresh_token: session.refresh_token })
      .expect(401);

    expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  async function signInAgain(phoneNumber: string) {
    const requestRes = await request(app.getHttpServer())
      .post('/v1/auth/otp/request')
      .send({ phone_number: phoneNumber, purpose: 'login' })
      .expect(200);
    const otp = fakeSms.extractOtp();
    const verifyRes = await request(app.getHttpServer())
      .post('/v1/auth/otp/verify')
      .send({ challenge_id: requestRes.body.challenge_id, otp })
      .expect(200);
    return verifyRes.body as { access_token: string };
  }
});
