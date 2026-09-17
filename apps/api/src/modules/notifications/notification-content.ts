// Bilingual (FR/EN) notification copy per event type. Hardcoded rather
// than DB-driven — see the comment on notification_templates in
// schema.prisma for why. One shared body across sms/whatsapp/push/in_app
// (all short, near-identical channels); email gets its own subject and a
// marginally more formal body. Deliberately includes tenant name + unit
// label even in the tenant's own copy of a "both parties" event (rather
// than writing separate tenant/landlord-only variants) — harmless for the
// tenant to read their own name, and satisfies PRD Epic 8 US-8.2 AC2 (the
// landlord's copy must be actionable without looking anything up) without
// doubling the number of templates.

import {
  RENT_EXPIRY_DUE_TODAY,
  RENT_EXPIRY_FIRST_REMINDER_DUE,
  RENT_EXPIRY_OVERDUE,
  RENT_EXPIRY_SECOND_REMINDER_DUE,
} from '../../common/events/notification.events';

export interface NotificationContext {
  tenantName?: string;
  landlordName?: string;
  unitLabel?: string;
  periodEnd?: string;
  paidThroughDate?: string;
  effectiveDate?: string;
  reason?: string;
  visitAction?: string;
}

export interface RenderedContent {
  subject?: string;
  body: string;
}

export function renderNotificationContent(
  eventType: string,
  locale: 'fr' | 'en',
  context: NotificationContext,
): RenderedContent {
  const unit = context.unitLabel ?? (locale === 'fr' ? 'votre logement' : 'your unit');
  const tenant = context.tenantName ?? (locale === 'fr' ? 'le locataire' : 'the tenant');

  switch (eventType) {
    case 'tenancy.notice_given':
      return locale === 'fr'
        ? {
            subject: 'Avis de résiliation de bail',
            body: `Un avis de résiliation a été émis pour ${unit}, à effet du ${context.effectiveDate}. Consultez le document dans l'application.`,
          }
        : {
            subject: 'Termination notice issued',
            body: `A termination notice has been issued for ${unit}, effective ${context.effectiveDate}. See the document in the app.`,
          };

    case 'payment.confirmed':
      return locale === 'fr'
        ? {
            subject: 'Paiement de loyer confirmé',
            body: `Paiement reçu pour ${unit}. Loyer couvert jusqu'au ${context.periodEnd}. Reçu disponible dans l'application.`,
          }
        : {
            subject: 'Rent payment confirmed',
            body: `Payment received for ${unit}. Rent covered through ${context.periodEnd}. Receipt available in the app.`,
          };

    case 'payment.failed':
      return locale === 'fr'
        ? { body: `Votre paiement pour ${unit} a échoué (${context.reason}). Veuillez réessayer dans l'application.` }
        : { body: `Your payment for ${unit} failed (${context.reason}). Please retry in the app.` };

    case RENT_EXPIRY_FIRST_REMINDER_DUE:
      return locale === 'fr'
        ? { body: `Rappel : le loyer de ${tenant} pour ${unit} arrive à échéance le ${context.paidThroughDate}.` }
        : { body: `Reminder: ${tenant}'s rent for ${unit} is due on ${context.paidThroughDate}.` };

    case RENT_EXPIRY_SECOND_REMINDER_DUE:
      return locale === 'fr'
        ? { body: `Rappel urgent : le loyer de ${tenant} pour ${unit} arrive à échéance le ${context.paidThroughDate}.` }
        : { body: `Urgent reminder: ${tenant}'s rent for ${unit} is due on ${context.paidThroughDate}.` };

    case RENT_EXPIRY_DUE_TODAY:
      return locale === 'fr'
        ? { body: `Le loyer de ${tenant} pour ${unit} est dû aujourd'hui (${context.paidThroughDate}).` }
        : { body: `${tenant}'s rent for ${unit} is due today (${context.paidThroughDate}).` };

    case RENT_EXPIRY_OVERDUE:
      return locale === 'fr'
        ? {
            body: `Le loyer de ${tenant} pour ${unit} est en retard depuis le ${context.paidThroughDate}. Ceci est informatif uniquement.`,
          }
        : {
            body: `${tenant}'s rent for ${unit} is overdue since ${context.paidThroughDate}. This is informational only.`,
          };

    case 'visit_request.created':
      return locale === 'fr'
        ? { body: `Nouvelle demande de visite pour ${unit} de la part de ${tenant}.` }
        : { body: `New visit request for ${unit} from ${tenant}.` };

    case 'visit_request.responded':
      return locale === 'fr'
        ? { body: `Votre demande de visite pour ${unit} a été mise à jour : ${context.visitAction}.` }
        : { body: `Your visit request for ${unit} was updated: ${context.visitAction}.` };

    default:
      return locale === 'fr' ? { body: 'Vous avez une nouvelle notification.' } : { body: 'You have a new notification.' };
  }
}
