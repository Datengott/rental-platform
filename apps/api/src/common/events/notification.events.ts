// Published by the Notifications module (docs/notification-module-multichannel.md
// Section 6 lists these implicitly via the "Events published" line carried
// over from the schema doc's B.7: notification.sent, notification.failed).
// No consumer exists yet — kept for parity with every other module's
// events being declared ahead of their eventual subscriber (Admin's cost
// dashboard, most likely), same as CONTRACT_GENERATED before Notifications
// itself existed.
//
// rent_expiry.* are consumed BY this module but published by it too — they
// don't belong to Tenancies (which owns the tenancy data the scan reads
// via its own public interface) because the schema doc explicitly assigns
// the scheduled scan job itself to the Notification Engine module
// (B.7: "plus its own scheduled-job triggers for rent-expiry reminders").

export const NOTIFICATION_SENT = 'notification.sent';
export const NOTIFICATION_FAILED = 'notification.failed';

export const RENT_EXPIRY_FIRST_REMINDER_DUE = 'rent_expiry.first_reminder_due';
export const RENT_EXPIRY_SECOND_REMINDER_DUE = 'rent_expiry.second_reminder_due';
export const RENT_EXPIRY_DUE_TODAY = 'rent_expiry.due_today';
export const RENT_EXPIRY_OVERDUE = 'rent_expiry.overdue';

export interface NotificationSentEvent {
  notificationId: string;
  userId: string;
  eventType: string;
  channel: string;
}

export interface NotificationFailedEvent {
  notificationId: string;
  userId: string;
  eventType: string;
  channel: string;
  reason: string;
}
