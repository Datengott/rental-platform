import { Injectable, Logger } from '@nestjs/common';

// No email provider credentials exist yet (Resend is the recommended pick —
// see README — but nothing is wired up). Same swappable-stub pattern as
// every other external integration in this project: build the real
// module now, swap this console stub for a real Resend/Postmark client
// once credentials exist.
export interface EmailGateway {
  send(emailAddress: string, subject: string, body: string): Promise<{ providerMessageId: string }>;
}

@Injectable()
export class ConsoleEmailGateway implements EmailGateway {
  private readonly logger = new Logger(ConsoleEmailGateway.name);

  send(emailAddress: string, subject: string, body: string): Promise<{ providerMessageId: string }> {
    this.logger.log(`[dev-only Email stub] to ${emailAddress}: "${subject}" — ${body}`);
    return Promise.resolve({ providerMessageId: `email_stub_${Date.now()}` });
  }
}

export const EMAIL_GATEWAY = Symbol('EMAIL_GATEWAY');
