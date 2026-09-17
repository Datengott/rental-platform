// Published by the Complaints module (docs/deployment-infrastructure-and-module-schemas.md
// Section B.8). complaint.status_changed has a documented routing entry in
// notification-module-multichannel.md's Section 4 (in-app + push, to the
// tenant — "tenant sees status updates", PRD Epic 7 US-7.1 AC2).
// complaint.created has NO entry in that table (an apparent oversight —
// the doc predates this module existing), but US-7.1 AC2 explicitly
// requires "landlord is notified per the routing rules" on creation, so
// Notifications routes it by analogy to the structurally identical
// visit_request.created (tenant-initiated, landlord needs to know):
// waterfall push -> whatsapp -> sms. See routing-table.ts.

export const COMPLAINT_CREATED = 'complaint.created';
export const COMPLAINT_STATUS_CHANGED = 'complaint.status_changed';

export interface ComplaintCreatedEvent {
  complaintId: string;
  tenancyId: string;
  unitId: string;
  tenantId: string;
  landlordId: string;
  category: string;
}

export interface ComplaintStatusChangedEvent {
  complaintId: string;
  tenantId: string;
  landlordId: string;
  unitId: string;
  newStatus: string;
}
