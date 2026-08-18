# Notification Module — Multi-Channel Design
### SMS + WhatsApp + Email + Push + In-App
### Extends Section B.7 (Notification Engine Module) of deployment-infrastructure-and-module-schemas.md

---

## 1. What changed, and why each channel earns its place

Five channels is the right number for this specific product, but each one solves a different problem — worth being explicit about that instead of treating them as interchangeable:

| Channel | Why it's in the mix | Evidence |
|---|---|---|
| **SMS** | Reaches the 96%-mobile-connection population even without a data connection — the universal floor. | Covered in the first document: 96.4% mobile connection penetration vs. 41.9% internet penetration in Cameroon. |
| **WhatsApp** | Near-universal among people who *do* have data, richer than SMS (receipts as documents, contract PDFs, images of a complaint), and meaningfully cheaper per message than SMS in most markets for template/utility-category messages. | WhatsApp adoption is described as "near universal among connected consumers" in Africa's largest digital economies — over 90% of internet users in Kenya (97%), South Africa (96%), and Nigeria (95%). **I did not find a Cameroon-specific WhatsApp penetration figure** — treat the above as a strong continental proxy, not a confirmed Cameroon number, and validate directly with your pilot landlords/tenants (a one-question survey: "do you use WhatsApp?" costs nothing and removes the guess). |
| **Email** | Weak reach with tenants (lower email literacy/usage as a daily tool in this market), but genuinely useful for **landlords** — monthly statements, payment summaries, formal documents (contracts, termination notices) that benefit from a permanent, searchable, attachable record outside the app. | No direct Cameroon email-usage statistic found in this research pass; this is inference from the general urban-professional-vs-general-population usage pattern seen across African markets, not a cited fact — flagging it as such rather than presenting it as confirmed. |
| **Push** | Free, instant, and the natural channel *while the app is open or recently used* — but only reaches someone with the app installed, session valid, and a live data connection. | Standard mobile-platform mechanic (FCM); not something that needed market-specific research. |
| **In-app** | The permanent record. Push notifications get dismissed and forgotten; the in-app notification center is where "what did I miss" gets answered, and it's the one channel with zero marginal cost per message. | — |

**The design implication:** these aren't five equal, parallel options — they form a **priority-and-fallback system**, not a broadcast list. Sending the same event to all five channels simultaneously would be both wasteful (cost) and annoying (notification fatigue). Section 4 below defines the actual routing logic.

---

## 2. Provider selection per channel

| Channel | Provider | Rationale |
|---|---|---|
| SMS | **Africa's Talking** (already selected in the deployment doc) | Confirmed Cameroon coverage. |
| WhatsApp | **Africa's Talking Chat API** (WhatsApp product) | This is the one genuinely useful consolidation opportunity: Africa's Talking's WhatsApp offering is itself a Meta Business Solution Provider (BSP) — templated messages pre-approved by Meta, delivery/read receipts, and a consent-management endpoint for opt-in/opt-out — meaning **one vendor relationship and one API pattern covers both SMS and WhatsApp**, rather than adding a second vendor (e.g., a dedicated BSP like Twilio, 360dialog, or going direct to Meta's Cloud API) purely for WhatsApp. Worth confirming Cameroon is inside Africa's Talking's *WhatsApp* coverage specifically (their SMS coverage list confirms Cameroon; I did not find an explicit country list for the WhatsApp product itself in this research pass) before committing — a quick sandbox test resolves this in an afternoon. |
| Email | **Resend, Postmark, or Amazon SES** — pick one after a deliverability check, not researched to a specific recommendation here | This wasn't covered in earlier research passes because it's a secondary channel for this product; general guidance: Postmark/Resend are simpler and have stronger out-of-the-box deliverability reputations for transactional email than raw SES, at a modest cost premium; SES is cheapest at volume but requires more deliverability tuning (SPF/DKIM/DMARC, warm-up). Given this product's email volume will be low (landlord statements, not mass marketing), **Postmark or Resend** is the pragmatic pick — the cost difference is negligible at this scale and the setup is materially simpler. |
| Push | **Firebase Cloud Messaging (FCM)** | Free, works across Android/iOS, and if the mobile client is built in React Native or Flutter (per the architecture doc) both have mature FCM integration. No paid alternative makes sense here. |
| In-app | Own `notifications` table (already in schema) + a lightweight WebSocket or polling endpoint for real-time badge updates | No external provider needed. |

**WhatsApp-specific integration requirement — this is not optional, and it changes the onboarding flow:** Meta's platform requires either (a) the user has messaged your WhatsApp Business number first, opening a free 24-hour service window, or (b) you send a pre-approved **template message**, billed per message and categorized (`utility`, `authentication`, `marketing`, `service`) — with utility/authentication priced significantly lower than marketing, and marketing being the category to avoid entirely for this product's use case. This means:
- **Rent reminders, payment receipts, visit confirmations, and termination notices should all be built and submitted to Meta as `utility` or `authentication` category templates** — never `marketing` — both because it's the accurate category and because it's meaningfully cheaper.
- **Explicit opt-in capture is required during onboarding** (a checkbox or a "message us on WhatsApp to activate" step) — this is both a Meta platform requirement and directly relevant to the Cameroonian data protection law consent obligations already flagged in the first document.
- I was not able to find Cameroon-specific per-message WhatsApp utility/authentication rates in this research pass — Meta's rate card is queried by recipient country and changes over time; **check the live rate for Cameroon in Meta's Business Platform pricing tool before budgeting**, rather than assuming SMS-comparable or cheaper — in some markets WhatsApp is cheaper than SMS, in others not, and I don't have the Cameroon figure to cite either way.

---

## 3. Updated schema

Builds directly on Section B.7's `notification_templates` / `notifications` / `notification_preferences` tables — extending rather than replacing them.

```sql
-- Replaces the single-table `notification_templates` with a channel-aware version
-- (superset of the original — 'channel' already existed, this adds category tracking
-- and per-channel template identifiers since WhatsApp templates are registered with
-- Meta under their own template name/ID, distinct from a freeform SMS/email body)

CREATE TABLE notification_templates (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type                VARCHAR(50) NOT NULL,        -- e.g. 'rent_due_reminder', 'visit_confirmed'
    locale                      VARCHAR(5) NOT NULL,        -- 'fr' | 'en'
    channel                       VARCHAR(15) NOT NULL,      -- 'sms' | 'whatsapp' | 'email' | 'push' | 'in_app'
    whatsapp_template_name           VARCHAR(100),            -- Meta-registered template name, only for channel='whatsapp'
    whatsapp_category                  VARCHAR(20),            -- 'utility' | 'authentication' | 'marketing' | 'service'
    subject_template                     TEXT,                 -- email only
    body_template                          TEXT NOT NULL,
    is_active                                BOOLEAN NOT NULL DEFAULT true,
    created_at                                TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(event_type, locale, channel)
);

-- Extends the original `notifications` table with channel-specific cost/status tracking
CREATE TABLE notifications (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                    UUID NOT NULL,
    event_type                   VARCHAR(50) NOT NULL,
    channel                        VARCHAR(15) NOT NULL,
    template_id                      UUID REFERENCES notification_templates(id),
    payload                            JSONB,
    status                              VARCHAR(20) NOT NULL DEFAULT 'queued',
                                        -- 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped'
    skip_reason                          VARCHAR(50),         -- e.g. 'user_opted_out', 'no_valid_channel', 'suppressed_by_higher_priority_channel'
    provider                               VARCHAR(20),        -- 'africastalking' | 'postmark' | 'fcm' | null (in_app)
    provider_message_id                      VARCHAR(100),
    whatsapp_category_billed                   VARCHAR(20),     -- recorded at send time, for cost auditing
    estimated_cost_xaf                           NUMERIC(8,2),   -- populated where the provider returns cost info
    scheduled_for                                  TIMESTAMPTZ,
    sent_at                                          TIMESTAMPTZ,
    delivered_at                                       TIMESTAMPTZ,
    read_at                                              TIMESTAMPTZ,  -- in-app read receipt, or WhatsApp read receipt if available
    created_at                                             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_scheduled ON notifications(scheduled_for) WHERE status = 'queued';
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read_at) WHERE channel = 'in_app';
CREATE INDEX idx_notifications_cost_audit ON notifications(channel, created_at) WHERE channel = 'whatsapp';

-- Per-user, per-channel opt-in/reachability state — this is new and load-bearing,
-- especially for WhatsApp consent and email deliverability
CREATE TABLE notification_channels (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                    UUID NOT NULL,
    channel                      VARCHAR(15) NOT NULL,        -- 'sms' | 'whatsapp' | 'email' | 'push'
    channel_identifier             VARCHAR(255) NOT NULL,      -- phone number / email address / FCM device token
    opted_in                         BOOLEAN NOT NULL DEFAULT false,
    opted_in_at                        TIMESTAMPTZ,
    opted_out_at                         TIMESTAMPTZ,
    verified                               BOOLEAN NOT NULL DEFAULT false,  -- e.g. email confirmed via link, WhatsApp confirmed via first inbound message
    last_known_good_at                       TIMESTAMPTZ,      -- last time this channel successfully delivered — used to auto-deprioritize a dead channel
    created_at                                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, channel)
);

-- Multiple device tokens per user (someone may have the app on more than one device)
CREATE TABLE push_device_tokens (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                    UUID NOT NULL,
    fcm_token                    TEXT NOT NULL,
    platform                       VARCHAR(10) NOT NULL,      -- 'android' | 'ios'
    last_seen_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at                         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(fcm_token)
);

-- Extends the original per-user preferences table with per-channel toggles
CREATE TABLE notification_preferences (
    user_id                  UUID PRIMARY KEY,
    rent_reminder_days_before   SMALLINT NOT NULL DEFAULT 14,
    preferred_channel_order        VARCHAR(100) NOT NULL DEFAULT 'push,whatsapp,sms,email',
                                    -- user- or landlord-configurable priority for non-critical events
    sms_enabled                      BOOLEAN NOT NULL DEFAULT true,   -- effectively locked "on" for critical events regardless — see Section 4
    whatsapp_enabled                   BOOLEAN NOT NULL DEFAULT false, -- defaults OFF until explicit opt-in captured
    email_enabled                        BOOLEAN NOT NULL DEFAULT true,
    push_enabled                           BOOLEAN NOT NULL DEFAULT true
);
```

---

## 4. Routing logic — which events go through which channels

This is the actual design decision the schema exists to support. Two patterns, chosen per event based on how critical/time-sensitive it is:

### Pattern A — Fan-out (critical, time-bound events)
Send simultaneously across every channel the user has opted into and verified, because missing these has real consequences (a missed payment deadline, an unanswered legal notice).

| Event | Channels (fan-out) |
|---|---|
| `tenancy.notice_given` (termination notice issued) | SMS + WhatsApp + Email + Push + In-app — **all of them**, plus the formal notice document attached where the channel supports attachments (WhatsApp, Email) |
| `payment.confirmed` (rent received) | SMS + WhatsApp (receipt as a document) + In-app; Push as a supplementary nudge |
| `payment.failed` | SMS + Push + In-app (immediate); WhatsApp if opted in |
| `rent_expiry.first_reminder_due` (default 1 month out) | WhatsApp + SMS + Push + In-app — **sent to tenant AND landlord**, per tenancy |
| `rent_expiry.second_reminder_due` (default 2 weeks out) | WhatsApp + SMS + Push + In-app — **sent to tenant AND landlord** |
| `rent_expiry.due_today` | WhatsApp + SMS + Push + In-app — **sent to tenant AND landlord** |
| `rent_expiry.overdue` (day after `paid_through_date` with no new payment) | WhatsApp + SMS + Push + In-app — **sent to tenant AND landlord**; informational, does not itself trigger a termination notice |

### Pattern B — Waterfall (lower-urgency, cost-sensitive events)
Try the cheapest/richest available channel first; only escalate to the next if the user hasn't engaged, using `notification_channels.last_known_good_at` and read/delivery receipts to decide.

| Event | Waterfall order |
|---|---|
| `visit_request.created` (new request for landlord) | Push → (no response in 30 min) → WhatsApp → (no response in 2h) → SMS |
| `visit_request.responded` | Push → In-app (this one rarely needs escalation — tenant is actively looking for this answer) |
| `complaint.status_changed` | In-app + Push only (not urgent enough to spend SMS/WhatsApp budget on) |
| Monthly landlord statement | Email only (this is exactly the "permanent, attachable record" use case email is good for) |

**The routing engine's core logic, in plain terms:**
```
for a given event:
  1. Look up the event's pattern (fan-out or waterfall) and its channel list/order
  2. For each candidate channel, check notification_channels: is the user opted in AND verified?
  3. Fan-out: send to every qualifying channel immediately (each gets its own `notifications` row)
  4. Waterfall: send to the first qualifying channel; schedule a delayed check;
     if no delivery/read confirmation by the timeout, send to the next channel,
     marking the first as effectively superseded (not "failed" — it may still arrive late)
  5. SMS is the one channel that's never fully gated by opt-in for *critical* events —
     Cameroon's ~96% mobile-connection reach makes it the reliability floor, and the
     legal weight of a termination notice (Section on notice periods, first document)
     means "the tenant didn't opt into the right channel" shouldn't be how a legal
     notice fails to reach someone. WhatsApp/Email/Push remain opt-in; SMS defaults
     to on and requires an explicit opt-out action from the user to disable, for the
     *notice and payment* event categories specifically (not for lower-stakes ones).
```

---

## 5. Channel adapter pattern (implementation shape)

Each channel implements the same interface so the routing engine (Section 4) never needs channel-specific branching logic:

```
interface NotificationChannelAdapter {
  send(user: User, template: NotificationTemplate, payload: object): Promise<{
    status: 'sent' | 'failed',
    providerMessageId?: string,
    estimatedCost?: number,
    failureReason?: string
  }>
  supportsAttachments(): boolean
  isUserReachable(user: User): Promise<boolean>   // checks notification_channels for opt-in + verified
}
```

Concrete adapters: `SmsAdapter` (Africa's Talking), `WhatsAppAdapter` (Africa's Talking Chat API), `EmailAdapter` (Postmark/Resend), `PushAdapter` (FCM), `InAppAdapter` (writes directly to `notifications` + pushes a WebSocket event for badge updates, no external call).

This is what keeps the Notification module's later extraction (per the "modular monolith → microservices" migration path from the deployment doc) clean — the routing engine and the five adapters are already separated by this interface, so pulling the whole module out is a deployment change, and even swapping one provider (e.g., moving off Africa's Talking for WhatsApp specifically, keeping it for SMS) only touches one adapter.

---

## 6. Updated API surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/users/me/notifications?unread=true` | In-app notification list/badge count |
| PATCH | `/users/me/notifications/{id}/read` | Mark as read |
| GET | `/users/me/notification-channels` | Current opt-in status per channel |
| POST | `/users/me/notification-channels/{channel}/opt-in` | Explicit opt-in (required before WhatsApp/email/push are used for non-critical events) |
| POST | `/users/me/notification-channels/{channel}/opt-out` | Opt-out (SMS opt-out for critical/legal events requires a confirmation step, given the reliability-floor role described above) |
| PATCH | `/users/me/notification-preferences` | Reminder timing, preferred channel order |
| POST | `/users/me/push-tokens` | Register/refresh an FCM device token |
| POST | `/webhooks/whatsapp/inbound` | Receives inbound WhatsApp messages — used both for two-way support and to detect first-contact opt-in confirmation |
| POST | `/webhooks/whatsapp/status` | Delivery/read receipt callbacks from Africa's Talking |
| POST | `/webhooks/email/status` | Bounce/complaint/delivery callbacks — critical for keeping `notification_channels.verified` accurate for email (a bounced address should auto-deprioritize, not keep silently failing every month) |

---

## 7. Cost governance — worth building in from day one, not bolting on later

Given WhatsApp and SMS both carry real per-message cost (unlike push/in-app/most email at this volume):

- The `estimated_cost_xaf` and `whatsapp_category_billed` fields on `notifications` exist specifically so you can build a simple per-month cost dashboard in the Admin module (Section B.9 of the deployment doc) — "how much did notifications cost us this month, broken down by channel and event type" — before this becomes a surprise line item.
- **Never let a template drift into the `marketing` WhatsApp category by accident** — this is both a cost issue (marketing is the most expensive tier across every market researched) and a platform-policy issue (Meta re-classifies unclear/mixed-purpose templates as marketing automatically, and a business's message quality rating can be affected by users blocking/reporting marketing-classified messages that don't feel like marketing to them). Keep every rent/notice/receipt template narrowly and clearly worded as a utility notification.
- The **waterfall pattern (Section 4)** is itself a cost control, not just a UX choice — it's specifically designed to avoid paying for SMS *and* WhatsApp *and* push for the same low-urgency event when push alone would have worked.
