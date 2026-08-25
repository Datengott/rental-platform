import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';

export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

// OTPs are short-lived (5 min) and single-use, so a plain hash is enough —
// per the DDL comment on otp_challenges.otp_hash: never store plaintext.
export function hashOtp(otp: string): string {
  return createHash('sha256').update(otp).digest('hex');
}

export function generateOpaqueToken(): string {
  return randomBytes(40).toString('base64url');
}

// Refresh tokens get an HMAC keyed with JWT_REFRESH_TOKEN_SECRET rather than
// a plain hash, so a leaked sessions.refresh_token_hash row alone can't be
// offline-brute-forced without the server secret too.
export function hashRefreshToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}
