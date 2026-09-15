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
