import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

function buildPrismaMock() {
  return {
    notification: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    notificationChannel: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    pushDeviceToken: { findFirst: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    notificationPreference: {
      findUnique: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn().mockImplementation((args: { where: { userId: string } }) =>
        Promise.resolve({
          userId: args.where.userId,
          preferredChannelOrder: 'push,whatsapp,sms,email',
          smsEnabled: true,
          whatsappEnabled: false,
          emailEnabled: true,
          pushEnabled: true,
        }),
      ),
    },
  };
}

describe('NotificationsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let events: { emit: jest.Mock };
  let smsGateway: { send: jest.Mock };
  let whatsAppGateway: { send: jest.Mock };
  let emailGateway: { send: jest.Mock };
  let pushGateway: { send: jest.Mock };
  let usersService: { getPublicProfile: jest.Mock };
  let unitsService: { getContractDetails: jest.Mock };
  let tenanciesService: { getPartiesForTenancy: jest.Mock; listActiveForReminderScan: jest.Mock };
  let service: NotificationsService;

  const tenantProfile = { id: 'tenant-1', fullName: 'Marie Tenant', phoneNumber: '+237600000002', locale: 'fr' };
  const landlordProfile = { id: 'landlord-1', fullName: 'Jean Landlord', phoneNumber: '+237600000001', locale: 'fr' };
  const unitDetails = { label: 'Studio A', addressLine: '1 Rue Test', city: 'Douala' };

  beforeEach(() => {
    prisma = buildPrismaMock();
    events = { emit: jest.fn() };
    smsGateway = { send: jest.fn().mockResolvedValue(undefined) };
    whatsAppGateway = { send: jest.fn().mockResolvedValue({ providerMessageId: 'wa_1' }) };
    emailGateway = { send: jest.fn().mockResolvedValue({ providerMessageId: 'email_1' }) };
    pushGateway = { send: jest.fn().mockResolvedValue({ providerMessageId: 'push_1' }) };
    usersService = {
      getPublicProfile: jest.fn().mockImplementation((userId: string) =>
        Promise.resolve(userId === 'landlord-1' ? { ...landlordProfile } : { ...tenantProfile, id: userId }),
      ),
    };
    unitsService = { getContractDetails: jest.fn().mockResolvedValue({ ...unitDetails }) };
    tenanciesService = {
      getPartiesForTenancy: jest.fn().mockResolvedValue({ tenantId: 'tenant-1', landlordId: 'landlord-1', unitId: 'unit-1' }),
      listActiveForReminderScan: jest.fn().mockResolvedValue([]),
    };

    service = new NotificationsService(
      prisma as never,
      events as never,
      smsGateway,
      whatsAppGateway,
      emailGateway,
      pushGateway,
      usersService as never,
      unitsService as never,
      tenanciesService as never,
    );
  });

  describe('fan-out routing (tenancy.notice_given)', () => {
    it('sends to every reachable channel and records one notification row each', async () => {
      // whatsapp/email not opted into -> notificationChannel.findUnique resolves null for both.
      prisma.notificationChannel.findUnique.mockResolvedValue(null);
      prisma.pushDeviceToken.findFirst.mockResolvedValue({ fcmToken: 'token-1' });

      await service.onTenancyNoticeGiven({ tenancyId: 'tenancy-1', terminationNoticeId: 'notice-1', effectiveDate: '2026-12-31' });

      expect(smsGateway.send).toHaveBeenCalledWith('+237600000002', expect.any(String));
      expect(pushGateway.send).toHaveBeenCalledWith('token-1', expect.any(String));
      expect(whatsAppGateway.send).not.toHaveBeenCalled();
      expect(emailGateway.send).not.toHaveBeenCalled();

      // sms, whatsapp (skipped), email (skipped), push, in_app -> 5 rows.
      expect(prisma.notification.create).toHaveBeenCalledTimes(5);
      const statuses = prisma.notification.create.mock.calls.map((call: [{ data: { channel: string; status: string } }]) => call[0].data.status);
      expect(statuses.filter((s: string) => s === 'skipped')).toHaveLength(2);
      expect(statuses.filter((s: string) => s === 'sent')).toHaveLength(3);
    });

    it('does nothing when the tenancy has no resolvable parties', async () => {
      tenanciesService.getPartiesForTenancy.mockResolvedValue(null);

      await service.onTenancyNoticeGiven({ tenancyId: 'gone', terminationNoticeId: 'notice-1', effectiveDate: '2026-12-31' });

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('waterfall routing (visit_request.created)', () => {
    it('sends only to the first reachable channel', async () => {
      prisma.pushDeviceToken.findFirst.mockResolvedValue({ fcmToken: 'token-1' });

      await service.onVisitRequestCreated({ visitRequestId: 'vr-1', unitId: 'unit-1', tenantId: 'tenant-1', landlordId: 'landlord-1' });

      expect(pushGateway.send).toHaveBeenCalledTimes(1);
      expect(whatsAppGateway.send).not.toHaveBeenCalled();
      expect(smsGateway.send).not.toHaveBeenCalled();
      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    });

    it('falls through to the next channel when the first is unreachable', async () => {
      prisma.pushDeviceToken.findFirst.mockResolvedValue(null); // no push token
      prisma.notificationChannel.findUnique.mockResolvedValue({ optedIn: true, channelIdentifier: '+237600000001' }); // whatsapp opted in

      await service.onVisitRequestCreated({ visitRequestId: 'vr-1', unitId: 'unit-1', tenantId: 'tenant-1', landlordId: 'landlord-1' });

      expect(pushGateway.send).not.toHaveBeenCalled();
      expect(whatsAppGateway.send).toHaveBeenCalledWith('+237600000001', expect.any(String), 'utility', expect.any(String));
      expect(smsGateway.send).not.toHaveBeenCalled();
    });
  });

  describe('opt-in / opt-out', () => {
    it('opting into whatsapp records the identifier and enables the preference', async () => {
      prisma.notificationChannel.upsert.mockResolvedValue({});

      await service.optIn('user-1', 'whatsapp', { channel_identifier: '+237600000009' });

      expect(prisma.notificationChannel.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId_channel: { userId: 'user-1', channel: 'whatsapp' } } }),
      );
      expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { whatsappEnabled: true } }),
      );
    });

    it('rejects opting out of sms without confirmation', async () => {
      await expect(service.optOut('user-1', 'sms', {})).rejects.toMatchObject({
        response: { code: 'SMS_OPT_OUT_REQUIRES_CONFIRMATION' },
      });
    });

    it('allows opting out of sms with confirmation', async () => {
      await service.optOut('user-1', 'sms', { confirm: true });
      expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { smsEnabled: false } }));
    });

    it('rejects opt-in for a channel that is not sms/whatsapp/email', async () => {
      await expect(service.optIn('user-1', 'push', { channel_identifier: 'x' })).rejects.toMatchObject({
        response: { code: 'INVALID_NOTIFICATION_CHANNEL' },
      });
    });
  });

  describe('markRead', () => {
    it('throws 404 for a notification belonging to someone else', async () => {
      prisma.notification.findUnique.mockResolvedValue({ id: 'n-1', userId: 'someone-else', readAt: null });
      await expect(service.markRead('user-1', 'n-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('marks an unread notification as read', async () => {
      prisma.notification.findUnique.mockResolvedValue({ id: 'n-1', userId: 'user-1', readAt: null });
      await service.markRead('user-1', 'n-1');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const updateCall = prisma.notification.update.mock.calls[0][0] as { where: { id: string }; data: { readAt: Date } };
      expect(updateCall.where).toEqual({ id: 'n-1' });
      expect(updateCall.data.readAt).toBeInstanceOf(Date);
    });
  });

  describe('rentExpiryReminderScan', () => {
    const baseTenancy = {
      id: 'tenancy-1',
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      unitId: 'unit-1',
      reminderFirstDaysBefore: 30,
      reminderSecondDaysBefore: 14,
    };

    function daysFromNow(days: number): Date {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + days);
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }

    it('fires the first reminder to both tenant and landlord when days_remaining matches reminder_first_days_before', async () => {
      tenanciesService.listActiveForReminderScan.mockResolvedValue([{ ...baseTenancy, paidThroughDate: daysFromNow(30) }]);
      prisma.notification.findFirst.mockResolvedValue(null); // not already sent today
      prisma.notificationChannel.findUnique.mockResolvedValue(null);
      prisma.pushDeviceToken.findFirst.mockResolvedValue(null);

      await service.rentExpiryReminderScan();

      const userIdsSent: string[] = prisma.notification.create.mock.calls.map((call: [{ data: { userId: string } }]) => call[0].data.userId);
      expect(userIdsSent).toContain('tenant-1');
      expect(userIdsSent).toContain('landlord-1');
    });

    it('does not fire when days_remaining matches neither threshold nor 0/-1', async () => {
      tenanciesService.listActiveForReminderScan.mockResolvedValue([{ ...baseTenancy, paidThroughDate: daysFromNow(5) }]);

      await service.rentExpiryReminderScan();

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('is idempotent: skips a stage already fired today for the same tenancy', async () => {
      tenanciesService.listActiveForReminderScan.mockResolvedValue([{ ...baseTenancy, paidThroughDate: daysFromNow(0) }]);
      prisma.notification.findFirst.mockResolvedValue({ id: 'existing' }); // already_sent guard

      await service.rentExpiryReminderScan();

      expect(usersService.getPublicProfile).not.toHaveBeenCalled();
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('fires the overdue event the day after paid_through_date with no new payment', async () => {
      tenanciesService.listActiveForReminderScan.mockResolvedValue([{ ...baseTenancy, paidThroughDate: daysFromNow(-1) }]);
      prisma.notification.findFirst.mockResolvedValue(null);
      prisma.notificationChannel.findUnique.mockResolvedValue(null);
      prisma.pushDeviceToken.findFirst.mockResolvedValue(null);

      await service.rentExpiryReminderScan();

      const eventTypes: string[] = prisma.notification.create.mock.calls.map((call: [{ data: { eventType: string } }]) => call[0].data.eventType);
      expect(eventTypes.every((e: string) => e === 'rent_expiry.overdue')).toBe(true);
    });

    it('skips tenancies with no paid_through_date set', async () => {
      tenanciesService.listActiveForReminderScan.mockResolvedValue([{ ...baseTenancy, paidThroughDate: null }]);

      await service.rentExpiryReminderScan();

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });
  });
});
