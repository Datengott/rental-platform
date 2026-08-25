import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { OtpPurpose } from './dto/request-otp.dto';
import { hashOtp } from './otp.util';

// Fully mocked PrismaService — no real database. Covers AuthService's
// business rules (cooldown, attempt-locking, hash comparison) in
// milliseconds; the DB-backed behavior itself is covered by
// test/auth.e2e-spec.ts.
function buildPrismaMock() {
  return {
    otpChallenge: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };
}

describe('AuthService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let events: { emit: jest.Mock };
  let smsGateway: { send: jest.Mock };
  let config: ConfigService;
  let jwtService: JwtService;
  let service: AuthService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    events = { emit: jest.fn() };
    smsGateway = { send: jest.fn().mockResolvedValue(undefined) };
    config = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          OTP_TTL_SECONDS: '300',
          OTP_MAX_ATTEMPTS: '3',
          JWT_ACCESS_TOKEN_SECRET: 'access-secret',
          JWT_ACCESS_TOKEN_TTL_SECONDS: '3600',
          JWT_REFRESH_TOKEN_SECRET: 'refresh-secret',
        };
        return values[key];
      }),
    } as unknown as ConfigService;
    jwtService = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') } as unknown as JwtService;

    service = new AuthService(
      prisma as never,
      jwtService,
      config,
      events as unknown as EventEmitter2,
      smsGateway,
    );
  });

  describe('requestOtp', () => {
    it('creates a challenge and sends the OTP when there is no recent request', async () => {
      prisma.otpChallenge.findFirst.mockResolvedValue(null);
      prisma.otpChallenge.create.mockResolvedValue({ id: 'challenge-1' });

      const result = await service.requestOtp({
        phone_number: '+237670000001',
        purpose: OtpPurpose.login,
      });

      expect(result).toEqual({ challenge_id: 'challenge-1', expires_in_seconds: 300 });
      expect(smsGateway.send).toHaveBeenCalledWith('+237670000001', expect.stringContaining('code is'));
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const createCall = prisma.otpChallenge.create.mock.calls[0][0] as { data: { phoneNumber: string } };
      expect(createCall.data.phoneNumber).toBe('+237670000001');
    });

    it('rejects with TOO_MANY_ATTEMPTS when a challenge was created within the cooldown', async () => {
      prisma.otpChallenge.findFirst.mockResolvedValue({ id: 'recent-challenge' });

      await expect(
        service.requestOtp({ phone_number: '+237670000001', purpose: OtpPurpose.login }),
      ).rejects.toMatchObject({ response: { code: 'TOO_MANY_ATTEMPTS' } });
      expect(smsGateway.send).not.toHaveBeenCalled();
      expect(prisma.otpChallenge.create).not.toHaveBeenCalled();
    });
  });

  describe('verifyOtp', () => {
    it('rejects an unknown or expired challenge with INVALID_OTP', async () => {
      prisma.otpChallenge.findUnique.mockResolvedValue(null);

      await expect(service.verifyOtp({ challenge_id: 'missing', otp: '123456' })).rejects.toMatchObject({
        response: { code: 'INVALID_OTP' },
      });
    });

    it('increments attempts and rejects INVALID_OTP on a wrong code', async () => {
      prisma.otpChallenge.findUnique.mockResolvedValue({
        id: 'challenge-1',
        otpHash: hashOtp('999999'),
        attempts: 0,
        consumedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        phoneNumber: '+237670000001',
      });

      await expect(service.verifyOtp({ challenge_id: 'challenge-1', otp: '000000' })).rejects.toMatchObject({
        response: { code: 'INVALID_OTP' },
      });
      expect(prisma.otpChallenge.update).toHaveBeenCalledWith({
        where: { id: 'challenge-1' },
        data: { attempts: { increment: 1 } },
      });
    });

    it('rejects with TOO_MANY_ATTEMPTS once the challenge is already locked', async () => {
      prisma.otpChallenge.findUnique.mockResolvedValue({
        id: 'challenge-1',
        otpHash: hashOtp('999999'),
        attempts: 3,
        consumedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        phoneNumber: '+237670000001',
      });

      await expect(service.verifyOtp({ challenge_id: 'challenge-1', otp: '999999' })).rejects.toMatchObject({
        response: { code: 'TOO_MANY_ATTEMPTS' },
      });
    });

    it('creates a new tenant on first-ever verify for a phone number and issues a session', async () => {
      const otp = '654321';
      prisma.otpChallenge.findUnique.mockResolvedValue({
        id: 'challenge-1',
        otpHash: hashOtp(otp),
        attempts: 0,
        consumedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        phoneNumber: '+237670000009',
      });
      prisma.otpChallenge.update.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'user-1',
        phoneNumber: '+237670000009',
        kycTier: 'unverified',
        roles: [{ role: 'tenant' }],
      });
      (prisma as unknown as { session: { create: jest.Mock } }).session = {
        create: jest.fn().mockResolvedValue({ id: 'session-1' }),
      };

      const result = await service.verifyOtp({ challenge_id: 'challenge-1', otp });

      expect(result.user).toMatchObject({
        phone_number: '+237670000009',
        roles: ['tenant'],
        kyc_tier: 'unverified',
      });
      expect(events.emit).toHaveBeenCalledWith(
        'user.registered',
        expect.objectContaining({ userId: 'user-1', phoneNumber: '+237670000009' }),
      );
    });
  });
});
