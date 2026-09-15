import { SmsGateway } from '../../src/modules/auth/sms/sms-gateway';

// Captures whatever the auth flow "sends" instead of hitting a real SMS
// provider, so tests can read back the OTP without scraping console logs.
export class FakeSmsGateway implements SmsGateway {
  public lastMessage: string | undefined;

  async send(_phoneNumber: string, message: string): Promise<void> {
    this.lastMessage = message;
    return Promise.resolve();
  }

  extractOtp(): string {
    const match = this.lastMessage?.match(/(\d{6})/);
    if (!match) throw new Error('No OTP captured — did requestOtp run first?');
    return match[1];
  }
}

export function randomPhoneNumber(): string {
  const suffix = Math.floor(100000 + Math.random() * 899999);
  return `+2376${suffix}`;
}
