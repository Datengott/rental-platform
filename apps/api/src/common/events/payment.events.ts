// Events published by the Payments module (docs/deployment-infrastructure-and-module-schemas.md
// Section B.5). Tenancies subscribes to payment.confirmed to recompute
// paid_through_date — but purely from this event's own payload (a running
// MAX against periodEnd), never by reading Payments' tables directly, per
// CLAUDE.md's cross-module rule.
//
// The schema doc also describes Payments *consuming* tenancy.created/
// tenancy.notice_given to cache max_advance_months/effective_date locally.
// In this modular monolith (not yet split into microservices) that cache
// would just be a second, staler source of truth for data Tenancies
// already owns — PaymentsService instead calls TenanciesService's public
// interface synchronously at payment-initiation time for the current
// value. Revisit if Payments is ever actually extracted to its own
// service (it's the documented first candidate).

export const PAYMENT_INITIATED = 'payment.initiated';
export const PAYMENT_CONFIRMED = 'payment.confirmed';
export const PAYMENT_FAILED = 'payment.failed';

export interface PaymentInitiatedEvent {
  paymentId: string;
  tenancyId: string;
  tenantId: string;
}

export interface PaymentConfirmedEvent {
  paymentId: string;
  tenancyId: string;
  periodEnd: string; // YYYY-MM-DD
}

export interface PaymentFailedEvent {
  paymentId: string;
  tenancyId: string;
  reason: string;
}
