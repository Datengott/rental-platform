import { generateReceiptDocument } from './receipt-document';

describe('generateReceiptDocument', () => {
  const receipt = generateReceiptDocument({
    paymentId: 'payment-1',
    tenancyId: 'tenancy-1',
    amount: '450000',
    currency: 'XAF',
    periodStart: '2026-09-20',
    periodEnd: '2026-11-30',
    provider: 'offline',
    providerTxnRef: 'landlord-recorded:landlord-1',
    confirmedAt: new Date('2026-09-20T09:00:00Z'),
  });

  it('says when the payment was made, which months it covers, and when the next payment is expected — in English', () => {
    expect(receipt).toContain('Payment made on: 20 September 2026');
    expect(receipt).toContain('Months covered: September – November 2026 (3 months)');
    expect(receipt).toContain('Next payment expected on: 1 December 2026');
  });

  it('says the same in French', () => {
    expect(receipt).toContain('Date du paiement : 20 septembre 2026');
    expect(receipt).toContain('Mois couverts : septembre – novembre 2026 (3 mois)');
    expect(receipt).toContain('Prochain paiement attendu le : 1 décembre 2026');
  });
});
