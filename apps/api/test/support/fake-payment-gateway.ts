import { ChargeParams, PaymentGateway } from '../../src/modules/payments/gateway/payment-gateway';

// Unlike SimulatedPaymentGateway, this schedules no real timer or self-HTTP
// call — tests that need a webhook drive it explicitly (POSTing a signed
// payload themselves), which exercises the exact same processing code path
// deterministically. The real gateway's delayed self-call is a live-demo
// concern, verified manually against docker compose, not something these
// tests need to wait on.
export class FakePaymentGateway implements PaymentGateway {
  public lastCharge: ChargeParams | undefined;

  charge(params: ChargeParams): Promise<{ providerTxnRef: string }> {
    this.lastCharge = params;
    return Promise.resolve({ providerTxnRef: 'fake_txn_ref' });
  }
}
