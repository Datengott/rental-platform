// Events published by the Properties module (docs/deployment-infrastructure-and-module-schemas.md
// Section B.2). Other modules subscribe via @OnEvent(...) — never import
// Properties' Prisma models directly, per CLAUDE.md's cross-module rule.
//
// Per the schema doc, Properties also CONSUMES tenancy.created/tenancy.terminated
// to flip unit status to occupied/vacant — no listener exists yet since the
// Tenancies module (build order #4) hasn't been built, so those event names
// and payload shapes aren't finalized. Add the listener when that module lands.

export const UNIT_LISTED = 'unit.listed';
export const UNIT_STATUS_CHANGED = 'unit.status_changed';

export interface UnitListedEvent {
  unitId: string;
  propertyId: string;
  landlordId: string;
}

export interface UnitStatusChangedEvent {
  unitId: string;
  previousStatus: string;
  newStatus: string;
}
