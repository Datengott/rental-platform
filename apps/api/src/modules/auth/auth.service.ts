import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { ApiException } from '../../common/exceptions/api.exception';
import { USER_REGISTERED, UserRegisteredEvent } from '../../common/events/user.events';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { generateOpaqueToken, generateOtp, hashOtp, hashRefreshToken } from './otp.util';
import { SMS_GATEWAY, SmsGateway } from './sms/sms-gateway';
import { AuthenticatedUser } from './decorators/current-user.decorator';

// Not in .env.example — reasonable scaffold-stage defaults, not a statutory
// or contractual figure like the values CLAUDE.md flags for human sign-off.
const OTP_REQUEST_COOLDOWN_SECONDS = 60;
const REFRESH_TOKEN_TTL_DAYS = 30;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
    @Inject(SMS_GATEWAY) private readonly smsGateway: SmsGateway,
  ) {}

  async requestOtp(dto: RequestOtpDto): Promise<{ challenge_id: string; expires_in_seconds: number }> {
    const cooldownStart = new Date(Date.now() - OTP_REQUEST_COOLDOWN_SECONDS * 1000);
    const recentChallenge = await this.prisma.otpChallenge.findFirst({
      where: { phoneNumber: dto.phone_number, createdAt: { gt: cooldownStart } },
      orderBy: { createdAt: 'desc' },
    });
    if (recentChallenge) {
      throw new ApiException(
        'TOO_MANY_ATTEMPTS',
        'Please wait before requesting another OTP.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const otp = this.pickOtp(dto.phone_number);
    const otpTtlSeconds = Number(this.config.get('OTP_TTL_SECONDS') ?? 300);

    const challenge = await this.prisma.otpChallenge.create({
      data: {
        phoneNumber: dto.phone_number,
        otpHash: hashOtp(otp),
        purpose: dto.purpose,
        expiresAt: new Date(Date.now() + otpTtlSeconds * 1000),
      },
    });

    await this.smsGateway.send(dto.phone_number, `Your rental platform verification code is ${otp}`);

    return { challenge_id: challenge.id, expires_in_seconds: otpTtlSeconds };
  }

  // Demo/dev convenience only: the seeded demo accounts (see src/seed/seed.ts)
  // get a fixed, documented code so a stakeholder can sign
  // in without tailing the SMS stub's logs. Needs BOTH env vars set, only
  // applies to the phone numbers listed in DEMO_ACCOUNT_PHONES, and is
  // refused outright in production — a static OTP is a login backdoor
  // anywhere real users exist, so the guard is deliberately not optional.
  private pickOtp(phoneNumber: string): string {
    const staticOtp = this.config.get<string>('DEMO_STATIC_OTP');
    const demoPhones = (this.config.get<string>('DEMO_ACCOUNT_PHONES') ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    if (staticOtp && demoPhones.includes(phoneNumber)) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error('DEMO_STATIC_OTP is set in production — ignoring it and issuing a random OTP.');
      } else if (!/^\d{6}$/.test(staticOtp)) {
        this.logger.warn('DEMO_STATIC_OTP must be exactly 6 digits — ignoring it.');
      } else {
        return staticOtp;
      }
    }
    return generateOtp();
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const challenge = await this.prisma.otpChallenge.findUnique({
      where: { id: dto.challenge_id },
    });

    if (!challenge || challenge.consumedAt || challenge.expiresAt < new Date()) {
      throw new ApiException('INVALID_OTP', 'This OTP is invalid or has expired.', HttpStatus.BAD_REQUEST);
    }

    const otpMaxAttempts = Number(this.config.get('OTP_MAX_ATTEMPTS') ?? 3);
    if (challenge.attempts >= otpMaxAttempts) {
      throw new ApiException(
        'TOO_MANY_ATTEMPTS',
        'Too many failed attempts. Please request a new OTP.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (hashOtp(dto.otp) !== challenge.otpHash) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new ApiException('INVALID_OTP', 'Incorrect OTP.', HttpStatus.BAD_REQUEST);
    }

    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });

    let user = await this.prisma.user.findUnique({
      where: { phoneNumber: challenge.phoneNumber },
      include: { roles: true },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          phoneNumber: challenge.phoneNumber,
          roles: { create: [{ role: 'tenant' }] },
        },
        include: { roles: true },
      });
      this.events.emit(USER_REGISTERED, {
        userId: user.id,
        phoneNumber: user.phoneNumber,
      } satisfies UserRegisteredEvent);
    }

    return this.issueSession(user.id, user.phoneNumber, user.roles.map((r) => r.role), user.kycTier);
  }

  async refresh(dto: RefreshTokenDto): Promise<{ access_token: string; expires_in: number }> {
    const refreshSecret = this.getRequiredSecret('JWT_REFRESH_TOKEN_SECRET');
    const tokenHash = hashRefreshToken(dto.refresh_token, refreshSecret);

    const session = await this.prisma.session.findFirst({
      where: { refreshTokenHash: tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!session) {
      throw new ApiException(
        'INVALID_REFRESH_TOKEN',
        'This refresh token is invalid, expired, or revoked.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: session.userId },
      include: { roles: true },
    });

    const { accessToken, expiresIn } = await this.signAccessToken(
      user.id,
      user.phoneNumber,
      user.roles.map((r) => r.role),
      session.id,
    );
    return { access_token: accessToken, expires_in: expiresIn };
  }

  async logout(user: AuthenticatedUser): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: user.sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueSession(userId: string, phoneNumber: string, roles: string[], kycTier: string) {
    const refreshToken = generateOpaqueToken();
    const refreshSecret = this.getRequiredSecret('JWT_REFRESH_TOKEN_SECRET');

    const session = await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: hashRefreshToken(refreshToken, refreshSecret),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    const { accessToken, expiresIn } = await this.signAccessToken(userId, phoneNumber, roles, session.id);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
      user: { id: userId, phone_number: phoneNumber, roles, kyc_tier: kycTier },
    };
  }

  private async signAccessToken(userId: string, phoneNumber: string, roles: string[], sessionId: string) {
    const expiresIn = Number(this.config.get('JWT_ACCESS_TOKEN_TTL_SECONDS') ?? 3600);
    const accessToken = await this.jwtService.signAsync(
      { sub: userId, phone_number: phoneNumber, roles, sid: sessionId },
      { secret: this.getRequiredSecret('JWT_ACCESS_TOKEN_SECRET'), expiresIn },
    );
    return { accessToken, expiresIn };
  }

  private getRequiredSecret(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new Error(`Missing required env var ${key}`);
    }
    return value;
  }
}
