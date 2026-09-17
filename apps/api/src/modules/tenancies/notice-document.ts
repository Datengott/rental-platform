// Generates the bilingual (FR/EN) termination notice document required by
// PRD Epic 4 US-4.2 AC2. Plain text rather than a real PDF — no PDF
// generation library exists anywhere in this project yet, and adding one
// is a bigger call than this module needs to make on its own; the content
// itself is real (not a stub), uploaded via the same ObjectStorage
// interface used elsewhere so document_url is real too.

const REASON_LABELS: Record<string, { fr: string; en: string }> = {
  non_payment: { fr: 'non-paiement du loyer', en: 'non-payment of rent' },
  end_of_term: { fr: 'fin de bail', en: 'end of lease term' },
  other: { fr: 'autre motif', en: 'other reason' },
};

export interface NoticeDocumentParams {
  tenancyId: string;
  reason: string;
  reasonDetail?: string;
  issuedAt: Date;
  effectiveDate: string;
  noticePeriodDays: number;
}

export function generateNoticeDocument(params: NoticeDocumentParams): string {
  const label = REASON_LABELS[params.reason] ?? { fr: params.reason, en: params.reason };
  const issuedAtIso = params.issuedAt.toISOString().slice(0, 10);

  return `AVIS DE RÉSILIATION DE BAIL / TERMINATION NOTICE
================================================

Référence bail / Tenancy reference: ${params.tenancyId}

--- FRANÇAIS ---
Date d'émission : ${issuedAtIso}
Motif : ${label.fr}${params.reasonDetail ? `\nDétails : ${params.reasonDetail}` : ''}
Date d'effet : ${params.effectiveDate}
Délai de préavis appliqué : ${params.noticePeriodDays} jours (minimum légal en vigueur).

Le présent avis notifie la résiliation du bail à la date d'effet indiquée
ci-dessus, conformément au délai de préavis statutaire.

--- ENGLISH ---
Issued on: ${issuedAtIso}
Reason: ${label.en}${params.reasonDetail ? `\nDetails: ${params.reasonDetail}` : ''}
Effective date: ${params.effectiveDate}
Notice period applied: ${params.noticePeriodDays} days (statutory minimum in effect).

This notice confirms termination of the tenancy effective on the date
above, in accordance with the statutory notice period.
`;
}
