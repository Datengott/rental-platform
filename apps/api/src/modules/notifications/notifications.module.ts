import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PropertiesModule } from '../properties/properties.module';
import { TenanciesModule } from '../tenancies/tenancies.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsWebhooksController } from './notifications-webhooks.controller';
import { NotificationsService } from './notifications.service';
import { ConsoleWhatsAppGateway, WHATSAPP_GATEWAY } from './gateways/whatsapp-gateway';
import { ConsoleEmailGateway, EMAIL_GATEWAY } from './gateways/email-gateway';
import { ConsolePushGateway, PUSH_GATEWAY } from './gateways/push-gateway';

@Module({
  // AuthModule for JwtAuthGuard + UsersService.getPublicProfile() +
  // SMS_GATEWAY (reused, not reimplemented); PropertiesModule for
  // UnitsService.getContractDetails(); TenanciesModule for the tenancy
  // party/reminder-scan lookups this module builds its routing decisions
  // from — all through their public interfaces, per CLAUDE.md's
  // cross-module rule. One-way only (Notifications -> Tenancies):
  // Tenancies needs nothing back, so no forwardRef here.
  imports: [AuthModule, PropertiesModule, TenanciesModule],
  controllers: [NotificationsController, NotificationsWebhooksController],
  providers: [
    NotificationsService,
    { provide: WHATSAPP_GATEWAY, useClass: ConsoleWhatsAppGateway },
    { provide: EMAIL_GATEWAY, useClass: ConsoleEmailGateway },
    { provide: PUSH_GATEWAY, useClass: ConsolePushGateway },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
