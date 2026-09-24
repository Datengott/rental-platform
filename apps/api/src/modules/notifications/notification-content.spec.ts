import { renderNotificationContent } from './notification-content';

describe('renderNotificationContent — payment.confirmed', () => {
  const context = {
    unitLabel: 'Studio A',
    paidAt: '2026-09-20',
    periodStart: '2026-09-20',
    periodEnd: '2026-11-30',
  };

  it('states when it was paid, the month(s) covered and the next due date (English)', () => {
    const { body } = renderNotificationContent('payment.confirmed', 'en', context);
    expect(body).toContain('Payment received on 20 September 2026');
    expect(body).toContain('Covers September – November 2026 (3 months)');
    expect(body).toContain('Next payment due 1 December 2026');
  });

  it('states the same in French', () => {
    const { body } = renderNotificationContent('payment.confirmed', 'fr', context);
    expect(body).toContain('Paiement reçu le 20 septembre 2026');
    expect(body).toContain('Mois couverts : septembre – novembre 2026 (3 mois)');
    expect(body).toContain('Prochain paiement attendu le 1 décembre 2026');
  });

  it('uses the singular for a single month', () => {
    const { body } = renderNotificationContent('payment.confirmed', 'en', {
      ...context,
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
    });
    expect(body).toContain('Covers September 2026 (1 month)');
    expect(body).toContain('Next payment due 1 October 2026');
  });
});
