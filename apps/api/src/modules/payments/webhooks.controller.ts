import { Controller, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import { WEBHOOK_SIGNATURE_HEADER } from './webhook-signature';

// Aggregator callback, not client-facing — excluded from Swagger and not
// behind JwtAuthGuard (the provider has no user session; the signature
// header is the auth). Always 200s per api-specification.md Section 7:
// "acknowledged regardless of business outcome" — retries are the
// aggregator's problem to manage, not something a non-200 should induce.
@ApiExcludeController()
@Controller('webhooks/payments')
export class WebhooksController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post(':provider')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Param('provider') provider: string, @Req() request: Request & { rawBody?: Buffer }) {
    const rawBody = request.rawBody?.toString('utf-8') ?? JSON.stringify(request.body);
    const signature = request.headers[WEBHOOK_SIGNATURE_HEADER] as string | undefined;
    await this.paymentsService.processWebhook(provider, rawBody, signature);
    return { received: true };
  }
}
