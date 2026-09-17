// Events published by the Tenancies module (docs/deployment-infrastructure-and-module-schemas.md
// Section B.4). Consumed by the Properties module (documented there as
// "tenancy.created -> set unit status to occupied, tenancy.terminated ->
// set unit status to vacant") — Properties listens via @OnEvent on these
// constants, never by importing Tenancies' Prisma models.
//
// Tenancies itself is documented to consume contract.signed (-> activate
// tenancy) and payment.confirmed (-> recompute paid_through_date), but
// Contracts and Payments (build order #6, #5) don't exist yet — no
// listener for those two lands until those modules do.

export const TENANCY_CREATED = 'tenancy.created';
export const TENANCY_NOTICE_GIVEN = 'tenancy.notice_given';
export const TENANCY_TERMINATED = 'tenancy.terminated';

export interface TenancyCreatedEvent {
  tenancyId: string;
  unitId: string;
  tenantId: string;
  landlordId: string;
}

export interface TenancyNoticeGivenEvent {
  tenancyId: string;
  terminationNoticeId: string;
  effectiveDate: string;
}

export interface TenancyTerminatedEvent {
  tenancyId: string;
  unitId: string;
}
