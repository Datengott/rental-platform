import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConfigService } from '@nestjs/config';

// HMAC-SHA256 over the exact raw request body — this is the generic
// scheme most mobile-money aggregators use, but CamPay/Monetbil's real
// webhook signing may differ in header name/encoding. Verify against
// their actual sandbox docs when swapping in a real gateway; only the
// SimulatedPaymentGateway (which both signs and verifies) needs this to
// be internally consistent.
export function signWebhookPayload(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = signWebhookPayload(rawBody, secret);
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(signature, 'hex');
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

export const WEBHOOK_SIGNATURE_HEADER = 'x-webhook-signature';

// Both the simulated gateway (signing) and the webhook controller
// (verifying) need the exact same secret resolution — kept in one place
// so they can never drift apart.
export function getWebhookSecret(provider: string, config: ConfigService): string {
  const key = `${provider.toUpperCase()}_WEBHOOK_SECRET`;
  return config.get<string>(key) || 'dev-simulated-webhook-secret';
}
