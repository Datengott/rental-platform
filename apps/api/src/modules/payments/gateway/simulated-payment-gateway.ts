import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChargeParams, PaymentGateway } from './payment-gateway';
import { getWebhookSecret, signWebhookPayload, WEBHOOK_SIGNATURE_HEADER } from '../webhook-signature';

// Simulates a real mobile-money aggregator's async confirmation flow as
// faithfully as possible without one: charge() returns an immediate ack +
// transaction ref (matching how CamPay/Monetbil's own charge APIs work),
// and confirmation arrives later via a genuinely separate HTTP call to our
// own webhook endpoint — not an in-process shortcut — so the signature
// verification and webhook-processing code this needs to work for a real
// provider gets exercised for real, not bypassed.
//
// Always succeeds, and quickly (a few seconds): this is a demo/pilot tool
// for showing landlords the product, not a chaos-testing harness — an
// unpredictable failure mid-demo would undermine the point. The failure
// code path (PaymentsService still handles a "failed" webhook) exists and
// is unit-tested; it just isn't what this gateway chooses to send.
//
// If this self-call is ever lost (e.g. the process restarts in the few
// seconds before the timer fires), PaymentsService's reconciliation sweep
// is the real safety net, not a decorative one — see its @Cron.
const SIMULATED_CONFIRMATION_DELAY_MS = 4000;

@Injectable()
export class SimulatedPaymentGateway implements PaymentGateway {
  private readonly logger = new Logger(SimulatedPaymentGateway.name);

  constructor(private readonly config: ConfigService) {}

  charge(params: ChargeParams): Promise<{ providerTxnRef: string }> {
    const providerTxnRef = `sim_${randomUUID()}`;

    this.logger.log(
      `[simulated ${params.provider}] charging ${params.amount} ${params.currency} ` +
        `(txn ${providerTxnRef}) — confirming in ~${SIMULATED_CONFIRMATION_DELAY_MS / 1000}s via webhook`,
    );

    // unref(): don't let this timer alone keep the process alive — the
    // real server stays up via its own HTTP listener regardless, and in
    // tests/short-lived scripts this is what lets the process exit
    // cleanly instead of hanging on a purely cosmetic delayed self-call.
    setTimeout(() => {
      void this.sendSimulatedWebhook(params, providerTxnRef);
    }, SIMULATED_CONFIRMATION_DELAY_MS).unref();

    return Promise.resolve({ providerTxnRef });
  }

  private async sendSimulatedWebhook(params: ChargeParams, providerTxnRef: string): Promise<void> {
    const body = JSON.stringify({
      provider_txn_ref: providerTxnRef,
      idempotency_key: params.idempotencyKey,
      status: 'confirmed',
    });
    const secret = getWebhookSecret(params.provider, this.config);
    const port = this.config.get<string>('PORT') ?? 3000;

    try {
      await fetch(`http://localhost:${port}/v1/webhooks/payments/${params.provider}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [WEBHOOK_SIGNATURE_HEADER]: signWebhookPayload(body, secret),
        },
        body,
      });
    } catch (error) {
      // Only reachable if the api process isn't actually listening (e.g. a
      // test environment that never called app.listen(), or the process
      // restarted) — the reconciliation sweep covers this, so this is a
      // debug log, not an error.
      this.logger.debug(
        `Simulated webhook self-call for ${providerTxnRef} didn't land (${(error as Error).message}); ` +
          'the reconciliation sweep will catch it.',
      );
    }
  }
}
