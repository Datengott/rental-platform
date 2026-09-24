import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PropertiesModule } from '../properties/properties.module';
import { PaymentsModule } from '../payments/payments.module';
import { AdminService } from './admin.service';
import { AdminAuditListener } from './admin-audit.listener';
import { AdminKycQueueController } from './kyc-queue.controller';
import { AdminListingModerationController } from './listing-moderation.controller';
import { AdminPaymentDisputesController } from './payment-disputes.controller';
import { AdminAuditLogController } from './audit-log.controller';

// Built last, per CLAUDE.md's build order (Epic 9) — "mostly a read/action
// layer over other modules' own APIs, plus its own audit log" per the
// schema doc's B.9. One-directional: Admin depends on Auth/Properties/
// Payments through their public services; none of them depend back on
// Admin (KYC approval logs itself via an event listener instead, so no
// forwardRef is needed here, unlike Tenancies↔Payments/Contracts).
@Module({
  imports: [AuthModule, PropertiesModule, PaymentsModule],
  controllers: [
    AdminKycQueueController,
    AdminListingModerationController,
    AdminPaymentDisputesController,
    AdminAuditLogController,
  ],
  providers: [AdminService, AdminAuditListener],
})
export class AdminModule {}
