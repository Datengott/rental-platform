// Bilingual (FR/EN) receipt for a confirmed payment — PRD Epic 5 US-5.3.
// Plain text rather than a real PDF, same reasoning as the termination
// notice document: no PDF library exists in this project yet.

import { addDays, describeCoveredMonths, formatLongDate } from '../../common/format/period';

export interface ReceiptDocumentParams {
  paymentId: string;
  tenancyId: string;
  amount: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  provider: string;
  providerTxnRef: string | null;
  confirmedAt: Date;
}

export function generateReceiptDocument(params: ReceiptDocumentParams): string {
  const confirmedAtIso = params.confirmedAt.toISOString().slice(0, 10);
  // Next payment is expected the day after this period ends.
  const nextDue = addDays(params.periodEnd, 1);
  const fr = describeCoveredMonths(params.periodStart, params.periodEnd, 'fr');
  const en = describeCoveredMonths(params.periodStart, params.periodEnd, 'en');

  return `REÇU DE PAIEMENT / PAYMENT RECEIPT
===================================

Référence paiement / Payment reference: ${params.paymentId}
Référence bail / Tenancy reference: ${params.tenancyId}

--- FRANÇAIS ---
Montant payé : ${params.amount} ${params.currency}
Date du paiement : ${formatLongDate(confirmedAtIso, 'fr')}
Mois couverts : ${fr.label} (${fr.count} mois)
Période exacte : ${params.periodStart} au ${params.periodEnd}
Prochain paiement attendu le : ${formatLongDate(nextDue, 'fr')}
Fournisseur : ${params.provider}
Référence de transaction : ${params.providerTxnRef ?? 'N/A'}

Ce reçu confirme la réception du paiement ci-dessus.

--- ENGLISH ---
Amount paid: ${params.amount} ${params.currency}
Payment made on: ${formatLongDate(confirmedAtIso, 'en')}
Months covered: ${en.label} (${en.count} month${en.count === 1 ? '' : 's'})
Exact period: ${params.periodStart} to ${params.periodEnd}
Next payment expected on: ${formatLongDate(nextDue, 'en')}
Provider: ${params.provider}
Transaction reference: ${params.providerTxnRef ?? 'N/A'}

This receipt confirms the payment above was received.
`;
}
