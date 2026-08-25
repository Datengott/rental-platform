import { Injectable, Logger } from '@nestjs/common';

// Africa's Talking isn't wired up yet (AFRICASTALKING_* are still blank in
// .env.example — see docs/notification-module-multichannel.md). OTP delivery
// is time-critical and per-user, unlike the notifications module's async
// multi-channel fan-out, so Auth sends it directly rather than waiting on
// that module. Swap this implementation for a real Africa's Talking client
// when those credentials exist; nothing else in the auth module needs to
// change since callers only depend on this interface.
export interface SmsGateway {
  send(phoneNumber: string, message: string): Promise<void>;
}

@Injectable()
export class ConsoleSmsGateway implements SmsGateway {
  private readonly logger = new Logger(ConsoleSmsGateway.name);

  async send(phoneNumber: string, message: string): Promise<void> {
    this.logger.log(`[dev-only SMS stub] to ${phoneNumber}: ${message}`);
    return Promise.resolve();
  }
}

export const SMS_GATEWAY = Symbol('SMS_GATEWAY');
