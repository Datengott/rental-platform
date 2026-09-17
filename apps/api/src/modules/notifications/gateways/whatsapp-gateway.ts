import { Injectable, Logger } from '@nestjs/common';

// Africa's Talking's WhatsApp (Chat API) product isn't wired up yet — same
// unset-credentials situation as Auth's SmsGateway, and the same reasoning
// applies: build the real routing/consent/category logic now, swap this
// console stub for a real Meta-BSP client once credentials exist. Meta
// requires WhatsApp messages to use a pre-approved template name + billing
// category (utility/authentication/marketing/service) — both are passed
// through here so the real client will have what it needs later, even
// though the stub just logs them.
export interface WhatsAppGateway {
  send(
    phoneNumber: string,
    templateName: string,
    category: string,
    body: string,
  ): Promise<{ providerMessageId: string }>;
}

@Injectable()
export class ConsoleWhatsAppGateway implements WhatsAppGateway {
  private readonly logger = new Logger(ConsoleWhatsAppGateway.name);

  send(phoneNumber: string, templateName: string, category: string, body: string): Promise<{ providerMessageId: string }> {
    this.logger.log(`[dev-only WhatsApp stub] to ${phoneNumber} (template=${templateName}, category=${category}): ${body}`);
    return Promise.resolve({ providerMessageId: `wa_stub_${Date.now()}` });
  }
}

export const WHATSAPP_GATEWAY = Symbol('WHATSAPP_GATEWAY');
