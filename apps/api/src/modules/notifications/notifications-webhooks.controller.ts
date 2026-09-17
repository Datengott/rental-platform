import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';

// Provider callbacks, not client-facing — excluded from Swagger and not
// behind JwtAuthGuard, same as Payments' webhook controller. No real
// Africa's Talking/email provider calls these yet (every gateway is a dev
// stub), so there's no real signature to verify against — this is the
// endpoint shape api-specification.md Section 9 documents, kept minimal
// and honest about that gap rather than faking verification against a
// secret that doesn't exist.
@ApiExcludeController()
@Controller('webhooks')
export class NotificationsWebhooksController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('whatsapp/inbound')
  @HttpCode(HttpStatus.OK)
  async whatsAppInbound(@Body() body: { from?: string }) {
    if (body.from) {
      await this.notificationsService.handleWhatsAppInbound(body.from);
    }
    return { received: true };
  }

  @Post('whatsapp/status')
  @HttpCode(HttpStatus.OK)
  async whatsAppStatus(@Body() body: { provider_message_id?: string; status?: string }) {
    if (body.provider_message_id && body.status) {
      await this.notificationsService.handleWhatsAppStatus(body.provider_message_id, body.status);
    }
    return { received: true };
  }

  @Post('email/status')
  @HttpCode(HttpStatus.OK)
  async emailStatus(@Body() body: { provider_message_id?: string; event?: string }) {
    if (body.provider_message_id && body.event) {
      await this.notificationsService.handleEmailStatus(body.provider_message_id, body.event);
    }
    return { received: true };
  }
}
