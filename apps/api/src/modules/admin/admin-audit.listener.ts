import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { USER_KYC_TIER_CHANGED, UserKycTierChangedEvent } from '../../common/events/user.events';
import { AdminService } from './admin.service';

// Logs admin actions that happen through another module's own endpoint
// (Auth's existing POST /admin/users/{id}/kyc/approve) — reacting to the
// event bus rather than Auth calling into this module directly, per
// CLAUDE.md's cross-module rule ("call the other module's public interface,
// or subscribe to its events"). Admin's own endpoints (flag/unflag/remove)
// log inline instead, in AdminService, since there's no other module's
// endpoint to react to there — this module owns those actions itself.
@Injectable()
export class AdminAuditListener {
  constructor(private readonly adminService: AdminService) {}

  @OnEvent(USER_KYC_TIER_CHANGED)
  async onKycTierChanged(event: UserKycTierChangedEvent) {
    await this.adminService.record({
      adminId: event.changedBy,
      actionType: 'kyc_approved',
      targetType: 'user',
      targetId: event.userId,
      detail: { previous_tier: event.previousTier, new_tier: event.newTier },
    });
  }
}
