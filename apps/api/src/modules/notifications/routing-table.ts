import { NotificationChannelType } from '@prisma/client';
import {
  RENT_EXPIRY_DUE_TODAY,
  RENT_EXPIRY_FIRST_REMINDER_DUE,
  RENT_EXPIRY_OVERDUE,
  RENT_EXPIRY_SECOND_REMINDER_DUE,
} from '../../common/events/notification.events';

// docs/notification-module-multichannel.md Section 4's routing table,
// translated to code. Not DB-driven — same "no admin UI yet" reasoning as
// notification-content.ts; this is the one place that needs to change to
// add a new routed event.
export type RecipientRule = 'tenant' | 'landlord' | 'both';

export interface RoutingRule {
  pattern: 'fan_out' | 'waterfall';
  // Fan-out: every channel here is attempted (subject to opt-in/reachability).
  // Waterfall: attempted in this priority order; the first reachable one
  // wins. Section 4's waterfall also specifies a timed escalation to the
  // next channel on no delivery/read confirmation — deliberately NOT
  // built here (no job-queue/scheduled-recheck infra exists in this
  // project yet, and nothing marks it "don't simplify away" the way the
  // rent-expiry scheduler itself is marked in CLAUDE.md). Sending to the
  // single best available channel is the simplification; revisit if a
  // real cost/UX need for escalation shows up.
  channels: NotificationChannelType[];
  recipients: RecipientRule;
}

export const ROUTING_TABLE: Record<string, RoutingRule> = {
  'tenancy.notice_given': {
    pattern: 'fan_out',
    channels: ['sms', 'whatsapp', 'email', 'push', 'in_app'],
    recipients: 'tenant',
  },
  'payment.confirmed': {
    pattern: 'fan_out',
    channels: ['sms', 'whatsapp', 'in_app', 'push'],
    recipients: 'tenant',
  },
  'payment.failed': {
    pattern: 'fan_out',
    channels: ['sms', 'push', 'in_app', 'whatsapp'],
    recipients: 'tenant',
  },
  [RENT_EXPIRY_FIRST_REMINDER_DUE]: {
    pattern: 'fan_out',
    channels: ['whatsapp', 'sms', 'push', 'in_app'],
    recipients: 'both',
  },
  [RENT_EXPIRY_SECOND_REMINDER_DUE]: {
    pattern: 'fan_out',
    channels: ['whatsapp', 'sms', 'push', 'in_app'],
    recipients: 'both',
  },
  [RENT_EXPIRY_DUE_TODAY]: {
    pattern: 'fan_out',
    channels: ['whatsapp', 'sms', 'push', 'in_app'],
    recipients: 'both',
  },
  [RENT_EXPIRY_OVERDUE]: {
    pattern: 'fan_out',
    channels: ['whatsapp', 'sms', 'push', 'in_app'],
    recipients: 'both',
  },
  'visit_request.created': {
    pattern: 'waterfall',
    channels: ['push', 'whatsapp', 'sms'],
    recipients: 'landlord',
  },
  'visit_request.responded': {
    pattern: 'waterfall',
    channels: ['push', 'in_app'],
    recipients: 'tenant',
  },
  // complaint.created has no entry in the multichannel doc's Section 4
  // table (an apparent oversight — that doc predates Complaints existing),
  // but PRD Epic 7 US-7.1 AC2 explicitly requires the landlord be notified
  // on creation. Routed by analogy to the structurally identical
  // visit_request.created (tenant-initiated, landlord needs to know).
  'complaint.created': {
    pattern: 'waterfall',
    channels: ['push', 'whatsapp', 'sms'],
    recipients: 'landlord',
  },
  // complaint.status_changed DOES have a documented entry: "In-app + Push
  // only (not urgent enough to spend SMS/WhatsApp budget on)".
  'complaint.status_changed': {
    pattern: 'waterfall',
    channels: ['push', 'in_app'],
    recipients: 'tenant',
  },
  // visit_request.expired is NOT routed: the multichannel doc's own
  // Section 4 table has no entry for it, and it fires from apps/worker — a
  // separate process from this module's in-process event bus — so there's
  // no event to subscribe to yet regardless. See README.md's Visits entry.
};

// Meta requires WhatsApp sends to reference a pre-approved template name
// and be billed under a category — 'utility'/'authentication' only for
// this product (Section 2: never 'marketing', both for accuracy and cost).
export const WHATSAPP_TEMPLATE_INFO: Record<string, { templateName: string; category: string }> = {
  'tenancy.notice_given': { templateName: 'termination_notice_v1', category: 'utility' },
  'payment.confirmed': { templateName: 'payment_receipt_v1', category: 'utility' },
  'payment.failed': { templateName: 'payment_failed_v1', category: 'utility' },
  [RENT_EXPIRY_FIRST_REMINDER_DUE]: { templateName: 'rent_reminder_v1', category: 'utility' },
  [RENT_EXPIRY_SECOND_REMINDER_DUE]: { templateName: 'rent_reminder_v1', category: 'utility' },
  [RENT_EXPIRY_DUE_TODAY]: { templateName: 'rent_reminder_v1', category: 'utility' },
  [RENT_EXPIRY_OVERDUE]: { templateName: 'rent_overdue_v1', category: 'utility' },
  'visit_request.created': { templateName: 'visit_request_v1', category: 'utility' },
  'complaint.created': { templateName: 'complaint_created_v1', category: 'utility' },
};
