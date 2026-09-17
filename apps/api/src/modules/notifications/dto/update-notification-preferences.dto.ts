import { IsOptional, IsString, Matches } from 'class-validator';

// Comma-separated channel names, e.g. "push,whatsapp,sms,email" — matches
// api-specification.md Section 9's example exactly. rent_reminder_days_before
// from that same example is deliberately NOT accepted here — see the
// comment on NotificationPreference in schema.prisma for why (Tenancies'
// own per-tenancy fields are the real, already-wired setting).
const CHANNEL_LIST = /^(sms|whatsapp|email|push)(,(sms|whatsapp|email|push)){0,3}$/;

export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsString()
  @Matches(CHANNEL_LIST, { message: 'preferred_channel_order must be a comma-separated list of sms, whatsapp, email, push' })
  preferred_channel_order?: string;
}
