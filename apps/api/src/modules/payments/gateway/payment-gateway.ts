// Real CamPay/Monetbil credentials are still blank in .env.example — per
// the user's explicit direction, this is simulated for now (a demo/pilot
// deliverable, not waiting on aggregator sandbox access). Swap the
// provider registered in payments.module.ts for a RealCamPayGateway /
// RealMonetbilGateway once credentials exist; nothing else in this module
// needs to change, since PaymentsService only depends on this interface.
export interface ChargeParams {
  amount: number;
  currency: string;
  provider: string;
  idempotencyKey: string;
}

export interface PaymentGateway {
  charge(params: ChargeParams): Promise<{ providerTxnRef: string }>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
