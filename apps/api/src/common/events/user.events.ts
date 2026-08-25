// Events published by the Auth module (docs/deployment-infrastructure-and-module-schemas.md
// Section B.1). Other modules subscribe via @OnEvent(...) — never import Auth's Prisma
// models directly, per CLAUDE.md's cross-module rule.

export const USER_REGISTERED = 'user.registered';
export const USER_KYC_TIER_CHANGED = 'user.kyc_tier_changed';
export const USER_ROLE_GRANTED = 'user.role_granted';

export interface UserRegisteredEvent {
  userId: string;
  phoneNumber: string;
}

export interface UserKycTierChangedEvent {
  userId: string;
  previousTier: string;
  newTier: string;
  changedBy: string;
}

export interface UserRoleGrantedEvent {
  userId: string;
  role: string;
}
