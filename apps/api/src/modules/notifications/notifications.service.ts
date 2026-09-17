import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { NotificationChannelType, NotificationStatus, Prisma } from '@prisma/client';
import { ApiException } from '../../common/exceptions/api.exception';
import { PrismaService } from '../../common/prisma.service';
import { SMS_GATEWAY, SmsGateway } from '../auth/sms/sms-gateway';
import { UsersService } from '../auth/users.service';
import { UnitsService } from '../properties/units.service';
import { TenanciesService } from '../tenancies/tenancies.service';
import {
  TENANCY_NOTICE_GIVEN,
  TenancyNoticeGivenEvent,
} from '../../common/events/tenancy.events';
import {
  PAYMENT_CONFIRMED,
  PAYMENT_FAILED,
  PaymentConfirmedEvent,
  PaymentFailedEvent,
} from '../../common/events/payment.events';
import {
  VISIT_REQUEST_CREATED,
  VISIT_REQUEST_RESPONDED,
  VisitRequestCreatedEvent,
  VisitRequestRespondedEvent,
} from '../../common/events/visit-request.events';
import {
  NOTIFICATION_FAILED,
  NOTIFICATION_SENT,
  RENT_EXPIRY_DUE_TODAY,
  RENT_EXPIRY_FIRST_REMINDER_DUE,
  RENT_EXPIRY_OVERDUE,
  RENT_EXPIRY_SECOND_REMINDER_DUE,
} from '../../common/events/notification.events';
import { NotificationContext, RenderedContent, renderNotificationContent } from './notification-content';
import { ROUTING_TABLE, WHATSAPP_TEMPLATE_INFO } from './routing-table';
import { WHATSAPP_GATEWAY, WhatsAppGateway } from './gateways/whatsapp-gateway';
import { EMAIL_GATEWAY, EmailGateway } from './gateways/email-gateway';
import { PUSH_GATEWAY, PushGateway } from './gateways/push-gateway';
import { OptInChannelDto } from './dto/opt-in-channel.dto';
import { OptOutChannelDto } from './dto/opt-out-channel.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';

const PROVIDER_NAME: Record<NotificationChannelType, string> = {
  sms: 'africastalking',
  whatsapp: 'africastalking',
  email: 'postmark_stub',
  push: 'fcm',
  in_app: 'in_app',
};

// Channels an end user can opt into/out of via the dedicated endpoints —
// push (governed by device-token registration) and in_app (always on)
// aren't valid here, per api-specification.md Section 9 and the schema
// doc's own notification_channels channel list excluding both.
const OPT_IN_CHANNELS: NotificationChannelType[] = ['sms', 'whatsapp', 'email'];

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function toLocale(raw: string | null | undefined): 'fr' | 'en' {
  return raw === 'en' ? 'en' : 'fr';
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    @Inject(SMS_GATEWAY) private readonly smsGateway: SmsGateway,
    @Inject(WHATSAPP_GATEWAY) private readonly whatsAppGateway: WhatsAppGateway,
    @Inject(EMAIL_GATEWAY) private readonly emailGateway: EmailGateway,
    @Inject(PUSH_GATEWAY) private readonly pushGateway: PushGateway,
    private readonly usersService: UsersService,
    private readonly unitsService: UnitsService,
    private readonly tenanciesService: TenanciesService,
  ) {}

  // ---------------------------------------------------------------------
  // In-app notifications
  // ---------------------------------------------------------------------

  async listInApp(userId: string, unreadOnly: boolean, cursor: string | undefined, limit: number) {
    const notifications = await this.prisma.notification.findMany({
      where: { userId, channel: 'in_app', ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = notifications.length > limit;
    const page = hasMore ? notifications.slice(0, limit) : notifications;

    return {
      results: page.map((n) => ({
        id: n.id,
        event_type: n.eventType,
        payload: n.payload,
        read_at: n.readAt,
        created_at: n.createdAt,
      })),
      next_cursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    const notification = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Notification not found');
    }
    if (!notification.readAt) {
      await this.prisma.notification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
    }
  }

  // ---------------------------------------------------------------------
  // Channel opt-in/opt-out + preferences + push tokens
  // ---------------------------------------------------------------------

  async getChannelStatus(userId: string) {
    const [smsPrefs, rows, pushToken] = await Promise.all([
      this.getOrCreatePreferences(userId),
      this.prisma.notificationChannel.findMany({ where: { userId } }),
      this.prisma.pushDeviceToken.findFirst({ where: { userId } }),
    ]);
    const byChannel = new Map(rows.map((r) => [r.channel, r]));

    return [
      { channel: 'sms', opted_in: smsPrefs.smsEnabled, verified: true }, // phone was OTP-verified at signup
      { channel: 'whatsapp', opted_in: byChannel.get('whatsapp')?.optedIn ?? false, verified: byChannel.get('whatsapp')?.verified ?? false },
      { channel: 'email', opted_in: byChannel.get('email')?.optedIn ?? false, verified: byChannel.get('email')?.verified ?? false },
      { channel: 'push', opted_in: pushToken !== null, verified: pushToken !== null },
    ];
  }

  async optIn(userId: string, channel: string, dto: OptInChannelDto): Promise<void> {
    const normalized = this.assertOptInChannel(channel);
    const now = new Date();

    await this.prisma.notificationChannel.upsert({
      where: { userId_channel: { userId, channel: normalized } },
      create: { userId, channel: normalized, channelIdentifier: dto.channel_identifier, optedIn: true, optedInAt: now, verified: normalized === 'sms' },
      update: { channelIdentifier: dto.channel_identifier, optedIn: true, optedInAt: now, optedOutAt: null },
    });

    if (normalized === 'whatsapp' || normalized === 'email') {
      await this.setPreferenceEnabled(userId, normalized, true);
    } else {
      await this.setPreferenceEnabled(userId, 'sms', true);
    }
  }

  async optOut(userId: string, channel: string, dto: OptOutChannelDto): Promise<void> {
    const normalized = this.assertOptInChannel(channel);

    // SMS is the reliability floor for critical categories (notice/payment/
    // rent-expiry) — Section 4 point 5 — so opting out of it specifically
    // requires an explicit confirmation, unlike whatsapp/email.
    if (normalized === 'sms' && dto.confirm !== true) {
      throw new ApiException(
        'SMS_OPT_OUT_REQUIRES_CONFIRMATION',
        'Opting out of SMS affects critical notifications (termination notices, payment receipts, rent-expiry reminders). Pass confirm: true to proceed.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const now = new Date();
    if (normalized === 'sms') {
      await this.setPreferenceEnabled(userId, 'sms', false);
      return;
    }

    await this.prisma.notificationChannel.updateMany({
      where: { userId, channel: normalized },
      data: { optedIn: false, optedOutAt: now },
    });
    await this.setPreferenceEnabled(userId, normalized, false);
  }

  async updatePreferences(userId: string, dto: UpdateNotificationPreferencesDto) {
    const preferences = await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...(dto.preferred_channel_order ? { preferredChannelOrder: dto.preferred_channel_order } : {}) },
      update: { ...(dto.preferred_channel_order ? { preferredChannelOrder: dto.preferred_channel_order } : {}) },
    });
    return this.toPreferencesResponse(preferences);
  }

  async registerPushToken(userId: string, dto: RegisterPushTokenDto): Promise<void> {
    await this.prisma.pushDeviceToken.upsert({
      where: { fcmToken: dto.fcm_token },
      create: { userId, fcmToken: dto.fcm_token, platform: dto.platform },
      update: { userId, platform: dto.platform, lastSeenAt: new Date() },
    });
  }

  // ---------------------------------------------------------------------
  // Provider webhooks — not client-facing, no real provider calls these
  // yet (every gateway is a dev stub). No signature verification for the
  // same reason Payments' webhook needs a real secret before it can check
  // one — revisit once real Africa's Talking/email credentials exist.
  // ---------------------------------------------------------------------

  async handleWhatsAppInbound(fromPhoneNumber: string): Promise<void> {
    const row = await this.prisma.notificationChannel.findFirst({
      where: { channel: 'whatsapp', channelIdentifier: fromPhoneNumber },
    });
    if (row && !row.verified) {
      await this.prisma.notificationChannel.update({
        where: { id: row.id },
        data: { verified: true, lastKnownGoodAt: new Date() },
      });
    }
  }

  async handleWhatsAppStatus(providerMessageId: string, status: string): Promise<void> {
    const notification = await this.prisma.notification.findFirst({ where: { providerMessageId } });
    if (!notification) return;

    if (status === 'delivered') {
      await this.prisma.notification.update({ where: { id: notification.id }, data: { deliveredAt: new Date(), status: 'delivered' } });
    } else if (status === 'read') {
      await this.prisma.notification.update({ where: { id: notification.id }, data: { readAt: new Date(), status: 'read' } });
    }
  }

  async handleEmailStatus(providerMessageId: string, event: string): Promise<void> {
    const notification = await this.prisma.notification.findFirst({ where: { providerMessageId } });
    if (!notification) return;

    if (event === 'delivered') {
      await this.prisma.notification.update({ where: { id: notification.id }, data: { deliveredAt: new Date(), status: 'delivered' } });
    } else if (event === 'bounced' || event === 'complained') {
      // A bounced address should auto-deprioritize, not keep silently
      // failing every send — doc Section 6.
      await this.prisma.notificationChannel.updateMany({
        where: { userId: notification.userId, channel: 'email' },
        data: { optedIn: false, optedOutAt: new Date() },
      });
    }
  }

  // ---------------------------------------------------------------------
  // Event listeners — fan-out/waterfall triggers from other modules' real
  // events. Every one of these resolves tenantId/landlordId/unitId via
  // TenanciesService's/other modules' public interfaces, never a direct
  // Prisma read of their tables, per CLAUDE.md's cross-module rule.
  // ---------------------------------------------------------------------

  @OnEvent(TENANCY_NOTICE_GIVEN)
  async onTenancyNoticeGiven(event: TenancyNoticeGivenEvent): Promise<void> {
    const parties = await this.tenanciesService.getPartiesForTenancy(event.tenancyId);
    if (!parties) return;
    const [tenant, unit] = await Promise.all([
      this.usersService.getPublicProfile(parties.tenantId),
      this.unitsService.getContractDetails(parties.unitId),
    ]);
    await this.dispatch(
      parties.tenantId,
      TENANCY_NOTICE_GIVEN,
      { unitLabel: unit.label ?? undefined, effectiveDate: event.effectiveDate },
      event.tenancyId,
      toLocale(tenant.locale),
    );
  }

  @OnEvent(PAYMENT_CONFIRMED)
  async onPaymentConfirmed(event: PaymentConfirmedEvent): Promise<void> {
    const parties = await this.tenanciesService.getPartiesForTenancy(event.tenancyId);
    if (!parties) return;
    const [tenant, unit] = await Promise.all([
      this.usersService.getPublicProfile(parties.tenantId),
      this.unitsService.getContractDetails(parties.unitId),
    ]);
    await this.dispatch(
      parties.tenantId,
      PAYMENT_CONFIRMED,
      { unitLabel: unit.label ?? undefined, periodEnd: event.periodEnd },
      event.tenancyId,
      toLocale(tenant.locale),
    );
  }

  @OnEvent(PAYMENT_FAILED)
  async onPaymentFailed(event: PaymentFailedEvent): Promise<void> {
    const parties = await this.tenanciesService.getPartiesForTenancy(event.tenancyId);
    if (!parties) return;
    const [tenant, unit] = await Promise.all([
      this.usersService.getPublicProfile(parties.tenantId),
      this.unitsService.getContractDetails(parties.unitId),
    ]);
    await this.dispatch(
      parties.tenantId,
      PAYMENT_FAILED,
      { unitLabel: unit.label ?? undefined, reason: event.reason },
      event.tenancyId,
      toLocale(tenant.locale),
    );
  }

  @OnEvent(VISIT_REQUEST_CREATED)
  async onVisitRequestCreated(event: VisitRequestCreatedEvent): Promise<void> {
    const [tenant, unit, landlord] = await Promise.all([
      this.usersService.getPublicProfile(event.tenantId),
      this.unitsService.getContractDetails(event.unitId),
      this.usersService.getPublicProfile(event.landlordId),
    ]);
    await this.dispatch(
      event.landlordId,
      VISIT_REQUEST_CREATED,
      { tenantName: tenant.fullName ?? tenant.phoneNumber, unitLabel: unit.label ?? undefined },
      null,
      toLocale(landlord.locale),
    );
  }

  @OnEvent(VISIT_REQUEST_RESPONDED)
  async onVisitRequestResponded(event: VisitRequestRespondedEvent): Promise<void> {
    const tenant = await this.usersService.getPublicProfile(event.tenantId);
    await this.dispatch(event.tenantId, VISIT_REQUEST_RESPONDED, { visitAction: event.action }, null, toLocale(tenant.locale));
  }

  // ---------------------------------------------------------------------
  // Rent-expiry reminder scheduler — docs/deployment-infrastructure-and-
  // module-schemas.md Section B.7's pseudocode, explicitly protected by
  // CLAUDE.md ("a named product requirement, don't simplify it away").
  // Runs daily; exposed as a public method (not just the @Cron binding) so
  // e2e tests can invoke it directly and deterministically, same pattern
  // as Tenancies'/Payments' own sweeps.
  // ---------------------------------------------------------------------

  @Cron('0 7 * * *')
  async rentExpiryReminderScan(): Promise<void> {
    const today = startOfUtcDay(new Date());
    const tenancies = await this.tenanciesService.listActiveForReminderScan();

    for (const tenancy of tenancies) {
      if (!tenancy.paidThroughDate) continue;
      const paidThrough = startOfUtcDay(tenancy.paidThroughDate);
      const daysRemaining = Math.round((paidThrough.getTime() - today.getTime()) / 86_400_000);

      if (daysRemaining === tenancy.reminderFirstDaysBefore) {
        await this.fireRentExpiryStage(RENT_EXPIRY_FIRST_REMINDER_DUE, tenancy);
      }
      if (daysRemaining === tenancy.reminderSecondDaysBefore) {
        await this.fireRentExpiryStage(RENT_EXPIRY_SECOND_REMINDER_DUE, tenancy);
      }
      if (daysRemaining === 0) {
        await this.fireRentExpiryStage(RENT_EXPIRY_DUE_TODAY, tenancy);
      }
      if (daysRemaining === -1) {
        await this.fireRentExpiryStage(RENT_EXPIRY_OVERDUE, tenancy);
      }
    }
  }

  private async fireRentExpiryStage(
    eventType: string,
    tenancy: { id: string; tenantId: string; landlordId: string; unitId: string; paidThroughDate: Date | null },
  ): Promise<void> {
    if (await this.alreadySentToday(eventType, tenancy.id)) return;

    const [tenant, landlord, unit] = await Promise.all([
      this.usersService.getPublicProfile(tenancy.tenantId),
      this.usersService.getPublicProfile(tenancy.landlordId),
      this.unitsService.getContractDetails(tenancy.unitId),
    ]);
    const context: NotificationContext = {
      tenantName: tenant.fullName ?? tenant.phoneNumber,
      landlordName: landlord.fullName ?? landlord.phoneNumber,
      unitLabel: unit.label ?? undefined,
      paidThroughDate: tenancy.paidThroughDate ? tenancy.paidThroughDate.toISOString().slice(0, 10) : undefined,
    };

    // Both parties, always — PRD Epic 8 US-8.2 AC1 treats this as a hard
    // requirement, not a default that only applies to one side.
    await Promise.all([
      this.dispatch(tenancy.tenantId, eventType, context, tenancy.id, toLocale(tenant.locale)),
      this.dispatch(tenancy.landlordId, eventType, context, tenancy.id, toLocale(landlord.locale)),
    ]);
  }

  private async alreadySentToday(eventType: string, tenancyId: string): Promise<boolean> {
    const startOfDay = startOfUtcDay(new Date());
    const existing = await this.prisma.notification.findFirst({
      where: {
        eventType,
        createdAt: { gte: startOfDay },
        payload: { path: ['tenancyId'], equals: tenancyId },
      },
    });
    return existing !== null;
  }

  // ---------------------------------------------------------------------
  // Routing engine core
  // ---------------------------------------------------------------------

  private async dispatch(
    userId: string,
    eventType: string,
    context: NotificationContext,
    tenancyId: string | null,
    locale: 'fr' | 'en',
  ): Promise<void> {
    const rule = ROUTING_TABLE[eventType];
    if (!rule) {
      // No routing configured for this event — a disclosed gap (see
      // routing-table.ts), not an error condition.
      return;
    }

    if (rule.pattern === 'fan_out') {
      // Ensure the preferences row exists BEFORE fanning out concurrently —
      // every channel's reachability check reads/creates it, and doing
      // that check-then-create per channel inside the same Promise.all
      // races two concurrent inserts for the same brand-new user (a
      // plain upsert isn't enough of a fix on its own: it still resolved
      // to two competing inserts under this exact concurrent-first-call
      // shape). One awaited call here removes the race at its source.
      await this.getOrCreatePreferences(userId);
      await Promise.all(rule.channels.map((channel) => this.sendOnChannel(userId, eventType, channel, context, tenancyId, locale)));
      return;
    }

    // Waterfall: first reachable channel in priority order wins. No timed
    // escalation to the next channel — see routing-table.ts's comment.
    for (const channel of rule.channels) {
      const reach = await this.resolveReachability(userId, channel);
      if (reach.reachable) {
        await this.sendOnChannel(userId, eventType, channel, context, tenancyId, locale, reach.identifier);
        return;
      }
    }
  }

  private async sendOnChannel(
    userId: string,
    eventType: string,
    channel: NotificationChannelType,
    context: NotificationContext,
    tenancyId: string | null,
    locale: 'fr' | 'en',
    knownIdentifier?: string,
  ): Promise<void> {
    const identifier = knownIdentifier ?? (await this.resolveReachability(userId, channel)).identifier;
    const payload = { tenancyId, ...context };

    if (!identifier && channel !== 'in_app') {
      await this.recordNotification({ userId, eventType, channel, status: 'skipped', skipReason: 'user_opted_out', payload });
      return;
    }

    const content = renderNotificationContent(eventType, locale, context);
    try {
      const result = await this.callGateway(channel, identifier, content, eventType);
      await this.recordNotification({
        userId,
        eventType,
        channel,
        status: channel === 'in_app' ? 'sent' : 'sent',
        provider: PROVIDER_NAME[channel],
        providerMessageId: result.providerMessageId,
        sentAt: new Date(),
        whatsappCategoryBilled: channel === 'whatsapp' ? WHATSAPP_TEMPLATE_INFO[eventType]?.category : undefined,
        payload,
      });
      this.events.emit(NOTIFICATION_SENT, { userId, eventType, channel });
    } catch (error) {
      await this.recordNotification({ userId, eventType, channel, status: 'failed', payload });
      this.events.emit(NOTIFICATION_FAILED, { userId, eventType, channel, reason: (error as Error).message });
    }
  }

  private async callGateway(
    channel: NotificationChannelType,
    identifier: string | undefined,
    content: RenderedContent,
    eventType: string,
  ): Promise<{ providerMessageId?: string }> {
    switch (channel) {
      case 'sms':
        await this.smsGateway.send(identifier!, content.body);
        return { providerMessageId: `sms_${Date.now()}` };
      case 'whatsapp': {
        const info = WHATSAPP_TEMPLATE_INFO[eventType] ?? { templateName: 'generic_v1', category: 'utility' };
        return this.whatsAppGateway.send(identifier!, info.templateName, info.category, content.body);
      }
      case 'email':
        return this.emailGateway.send(identifier!, content.subject ?? 'Rental Platform', content.body);
      case 'push':
        return this.pushGateway.send(identifier!, content.body);
      case 'in_app':
        return {};
    }
  }

  private async resolveReachability(
    userId: string,
    channel: NotificationChannelType,
  ): Promise<{ reachable: boolean; identifier?: string }> {
    switch (channel) {
      case 'sms': {
        const prefs = await this.getOrCreatePreferences(userId);
        if (!prefs.smsEnabled) return { reachable: false };
        const profile = await this.usersService.getPublicProfile(userId);
        return { reachable: true, identifier: profile.phoneNumber };
      }
      case 'whatsapp':
      case 'email': {
        const row = await this.prisma.notificationChannel.findUnique({ where: { userId_channel: { userId, channel } } });
        if (!row || !row.optedIn) return { reachable: false };
        return { reachable: true, identifier: row.channelIdentifier };
      }
      case 'push': {
        const prefs = await this.getOrCreatePreferences(userId);
        if (!prefs.pushEnabled) return { reachable: false };
        const token = await this.prisma.pushDeviceToken.findFirst({ where: { userId }, orderBy: { lastSeenAt: 'desc' } });
        return token ? { reachable: true, identifier: token.fcmToken } : { reachable: false };
      }
      case 'in_app':
        return { reachable: true };
    }
  }

  private async recordNotification(params: {
    userId: string;
    eventType: string;
    channel: NotificationChannelType;
    status: NotificationStatus;
    skipReason?: string;
    provider?: string;
    providerMessageId?: string;
    sentAt?: Date;
    whatsappCategoryBilled?: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.notification.create({
      data: {
        userId: params.userId,
        eventType: params.eventType,
        channel: params.channel,
        status: params.status,
        skipReason: params.skipReason,
        provider: params.provider,
        providerMessageId: params.providerMessageId,
        sentAt: params.sentAt,
        whatsappCategoryBilled: params.whatsappCategoryBilled,
        payload: params.payload as Prisma.InputJsonObject,
      },
    });
  }

  // upsert, not find-then-create: fan-out dispatches to several channels
  // concurrently (Promise.all in dispatch()), and more than one of them
  // can call this for the same brand-new user at the same time — a plain
  // find-then-create races and throws a unique-constraint error on the
  // loser. upsert is atomic, so concurrent callers just converge on the
  // same row.
  private async getOrCreatePreferences(userId: string) {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  private async setPreferenceEnabled(userId: string, channel: 'sms' | 'whatsapp' | 'email', enabled: boolean): Promise<void> {
    const field = `${channel}Enabled` as const;
    await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, [field]: enabled },
      update: { [field]: enabled },
    });
  }

  private assertOptInChannel(channel: string): 'sms' | 'whatsapp' | 'email' {
    if (!OPT_IN_CHANNELS.includes(channel as NotificationChannelType)) {
      throw new ApiException(
        'INVALID_NOTIFICATION_CHANNEL',
        `"${channel}" is not a channel that supports opt-in/opt-out here — push is managed via /users/me/push-tokens, in_app is always on.`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return channel as 'sms' | 'whatsapp' | 'email';
  }

  private toPreferencesResponse(preferences: {
    userId: string;
    preferredChannelOrder: string;
    smsEnabled: boolean;
    whatsappEnabled: boolean;
    emailEnabled: boolean;
    pushEnabled: boolean;
  }) {
    return {
      preferred_channel_order: preferences.preferredChannelOrder,
      sms_enabled: preferences.smsEnabled,
      whatsapp_enabled: preferences.whatsappEnabled,
      email_enabled: preferences.emailEnabled,
      push_enabled: preferences.pushEnabled,
    };
  }
}
