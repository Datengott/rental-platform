// Bilingual (FR/EN) receipt for a confirmed payment — PRD Epic 5 US-5.3.
// Plain text rather than a real PDF, same reasoning as the termination
// notice document: no PDF library exists in this project yet.

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

  return `REÇU DE PAIEMENT / PAYMENT RECEIPT
===================================

Référence paiement / Payment reference: ${params.paymentId}
Référence bail / Tenancy reference: ${params.tenancyId}

--- FRANÇAIS ---
Montant payé : ${params.amount} ${params.currency}
Période couverte : ${params.periodStart} au ${params.periodEnd}
Fournisseur : ${params.provider}
Référence de transaction : ${params.providerTxnRef ?? 'N/A'}
Date de confirmation : ${confirmedAtIso}

Ce reçu confirme la réception du paiement ci-dessus.

--- ENGLISH ---
Amount paid: ${params.amount} ${params.currency}
Period covered: ${params.periodStart} to ${params.periodEnd}
Provider: ${params.provider}
Transaction reference: ${params.providerTxnRef ?? 'N/A'}
Confirmed on: ${confirmedAtIso}

This receipt confirms the payment above was received.
`;
}
