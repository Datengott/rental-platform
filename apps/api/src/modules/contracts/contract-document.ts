// Generates the tenancy contract document required by PRD Epic 6 US-6.1
// AC1. Unlike termination-notice/receipt documents (which are always
// rendered bilingually into one file), this renders a SINGLE locale —
// the contracts table has its own `locale` column per api-specification.md
// Section 8 and the schema doc's DDL (B.6), so the product decision here
// is "the requester's chosen language", not "always show both". Plain
// text for the same reason as those other documents: no PDF generation
// library exists anywhere in this project yet.

const BILLING_CYCLE_LABELS: Record<string, { fr: string; en: string }> = {
  monthly: { fr: 'mensuel', en: 'monthly' },
  quarterly: { fr: 'trimestriel', en: 'quarterly' },
  biannual: { fr: 'semestriel', en: 'biannual' },
};

export interface ContractDocumentParams {
  contractId: string;
  tenancyId: string;
  templateVersion: string;
  locale: 'fr' | 'en';
  landlord: { fullName: string | null; phoneNumber: string };
  tenant: { fullName: string | null; phoneNumber: string };
  property: { addressLine: string; city: string };
  unit: { label: string | null };
  startDate: string;
  rentAmount: string;
  currency: string;
  billingCycle: string;
  noticePeriodDays: number;
  generatedAt: Date;
}

export function generateContractDocument(params: ContractDocumentParams): string {
  const cycle = BILLING_CYCLE_LABELS[params.billingCycle] ?? {
    fr: params.billingCycle,
    en: params.billingCycle,
  };
  const generatedAtIso = params.generatedAt.toISOString().slice(0, 10);
  const landlordName = params.landlord.fullName ?? params.landlord.phoneNumber;
  const tenantName = params.tenant.fullName ?? params.tenant.phoneNumber;

  if (params.locale === 'fr') {
    const unitLabel = params.unit.label ?? 'Logement non désigné';
    return `CONTRAT DE BAIL
===============

Référence contrat : ${params.contractId}
Référence bail : ${params.tenancyId}
Version du modèle : ${params.templateVersion}
Généré le : ${generatedAtIso}

Entre les soussignés :
Bailleur : ${landlordName} (${params.landlord.phoneNumber})
Locataire : ${tenantName} (${params.tenant.phoneNumber})

Objet de la location :
${unitLabel}, ${params.property.addressLine}, ${params.property.city}

Conditions :
- Date de prise d'effet : ${params.startDate}
- Loyer : ${params.rentAmount} ${params.currency}, payable selon une périodicité ${cycle.fr}
- Préavis de résiliation requis : ${params.noticePeriodDays} jours

Le présent contrat est établi automatiquement à partir des termes convenus entre les parties sur la plateforme.
`;
  }

  const unitLabel = params.unit.label ?? 'Unnamed unit';
  return `TENANCY AGREEMENT
==================

Contract reference: ${params.contractId}
Tenancy reference: ${params.tenancyId}
Template version: ${params.templateVersion}
Generated on: ${generatedAtIso}

Between:
Landlord: ${landlordName} (${params.landlord.phoneNumber})
Tenant: ${tenantName} (${params.tenant.phoneNumber})

Property:
${unitLabel}, ${params.property.addressLine}, ${params.property.city}

Terms:
- Start date: ${params.startDate}
- Rent: ${params.rentAmount} ${params.currency}, billed ${cycle.en}
- Required termination notice period: ${params.noticePeriodDays} days

This contract was generated automatically from the terms agreed between the parties on the platform.
`;
}
