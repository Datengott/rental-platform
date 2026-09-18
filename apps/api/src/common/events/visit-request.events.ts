// Events published by the Visits module (docs/deployment-infrastructure-and-module-schemas.md
// Section B.3). Per that section, nothing consumes these yet — the
// Notification module (build order #7) will subscribe once it exists;
// Visits itself consumes nothing.

export const VISIT_REQUEST_CREATED = 'visit_request.created';
export const VISIT_REQUEST_RESPONDED = 'visit_request.responded';
export const VISIT_REQUEST_EXPIRED = 'visit_request.expired';

export interface VisitRequestCreatedEvent {
  visitRequestId: string;
  unitId: string;
  tenantId: string;
  landlordId: string;
}

export interface VisitRequestRespondedEvent {
  visitRequestId: string;
  action: 'accept' | 'decline' | 'reschedule';
  status: string;
  tenantId: string;
  landlordId: string;
}

export interface VisitRequestExpiredEvent {
  visitRequestId: string;
  tenantId: string;
  landlordId: string;
}

// UnitInterest lives in the Visits module too (see the comment on the
// model in schema.prisma) — added 2026-09-18, not in the original schema
// doc's Section B.3. TENANCY_CREATED (Tenancies' own event) is consumed
// here to mark a matching interest 'converted'; nothing here is consumed
// by Tenancies — the dependency runs one way.
export const UNIT_INTEREST_CREATED = 'unit_interest.created';

export interface UnitInterestCreatedEvent {
  unitInterestId: string;
  unitId: string;
  tenantId: string;
  landlordId: string;
}
