import { Injectable, Logger } from '@nestjs/common';

// No Firebase server credentials exist yet. Same swappable-stub pattern —
// build the real module now, swap this console stub for a real FCM Admin
// SDK client once credentials exist; nothing else changes since callers
// only depend on this interface.
export interface PushGateway {
  send(fcmToken: string, body: string): Promise<{ providerMessageId: string }>;
}

@Injectable()
export class ConsolePushGateway implements PushGateway {
  private readonly logger = new Logger(ConsolePushGateway.name);

  send(fcmToken: string, body: string): Promise<{ providerMessageId: string }> {
    this.logger.log(`[dev-only Push stub] to device ${fcmToken}: ${body}`);
    return Promise.resolve({ providerMessageId: `push_stub_${Date.now()}` });
  }
}

export const PUSH_GATEWAY = Symbol('PUSH_GATEWAY');
