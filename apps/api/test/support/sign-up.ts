import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FakeSmsGateway } from './fake-sms-gateway';

export interface TestSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; phone_number: string; roles: string[]; kyc_tier: string };
}

// Drives the real OTP request/verify HTTP flow (not a shortcut) so e2e
// tests for other modules can get an authenticated session without
// re-implementing Auth's own test setup.
export async function signUp(
  app: INestApplication,
  fakeSms: FakeSmsGateway,
  phoneNumber: string,
): Promise<TestSession> {
  const requestRes = await request(app.getHttpServer())
    .post('/v1/auth/otp/request')
    .send({ phone_number: phoneNumber, purpose: 'signup' })
    .expect(200);

  const otp = fakeSms.extractOtp();

  const verifyRes = await request(app.getHttpServer())
    .post('/v1/auth/otp/verify')
    .send({ challenge_id: requestRes.body.challenge_id, otp })
    .expect(200);

  return verifyRes.body as TestSession;
}
