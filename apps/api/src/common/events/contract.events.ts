// Published by the Contracts module (docs/deployment-infrastructure-and-module-schemas.md
// Section B.6). No subscriber exists yet — Notifications (build order #7)
// is the documented consumer (it "subscribes to nearly everything" per the
// schema doc's B.7) but isn't built. Emitted anyway, same as other modules'
// events published ahead of their eventual subscribers, so wiring
// Notifications later is additive rather than a change to this module.
//
// contract.signed (schema doc B.6) is deliberately not defined here — it
// has no emitter until the e-signature flow itself is built (see the
// Contract model's comment in schema.prisma).

export const CONTRACT_GENERATED = 'contract.generated';

export interface ContractGeneratedEvent {
  contractId: string;
  tenancyId: string;
}
