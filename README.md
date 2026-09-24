# Rental Platform — MVP

A Cameroon-first rental platform connecting landlords and tenants: verified property
listings, visit scheduling, mobile-money rent collection, generated tenancy contracts,
statutory-compliant termination notices, and multi-channel (SMS/WhatsApp/Email/Push)
notifications.

**Full product and technical spec lives in `/docs`.** Read `docs/PRD-mvp.md` and
`docs/api-specification.md` before implementing any feature — this README only covers
getting the environment running and tracking where the build stands.

> This README is a living document — it gets updated as each module lands, not written
> once and left stale. If something below is out of date, fix it in the same PR.

## Tech stack

| Layer            | Choice                                              |
|-------------------|------------------------------------------------------|
| API                | NestJS (TypeScript) — modular monolith                |
| Database           | PostgreSQL via Prisma ORM                              |
| Cache / queues     | Redis (Upstash-compatible)                             |
| Background jobs    | Standalone worker app (visit-request expiry sweep) — the rent-expiry reminder scan, notice-expiry sweep, and payment reconciliation all run in-process instead (`@nestjs/schedule`), so they share the api's own event bus |
| Local dev          | Docker + Docker Compose                                |
| Deploy target      | Google Cloud Run (`africa-south1`, pending latency test) |
| Object storage     | Cloudflare R2 (zero egress fees)                        |
| Payments           | Mobile money aggregator — CamPay or Monetbil (final choice pending) |
| Notifications      | Africa's Talking (SMS + WhatsApp), Resend (email, recommended — see below), Firebase Cloud Messaging (push) — all behind dev-stub gateways for now, no real credentials wired up yet |

## Architecture at a glance

The API is split into 9 bounded modules under `apps/api/src/modules/`:

```
auth · properties · visits · tenancies · payments · contracts · notifications · complaints · admin
```

**Hard rule:** modules never read/write another module's database tables directly.
Cross-module effects go through an internal event bus (`@nestjs/event-emitter`). This
keeps a later microservice extraction (Payments is the flagged first candidate) a
deployment change instead of a rewrite.

See `docs/rental-platform-architecture.md` for the full rationale, and
`docs/deployment-infrastructure-and-module-schemas.md` for per-module SQL schemas and
event names.

## Current status

Build proceeds one module at a time, in dependency order. Checked = implemented and
tested; unchecked = not started or schema-only.

- [x] **Auth** — phone+OTP, roles, KYC tier: OTP request/verify, JWT access + opaque
      refresh tokens, `/users/me` profile, KYC document upload, admin KYC approval.
      Covered by `apps/api/src/modules/auth/auth.service.spec.ts` (mocked, fast) and
      `apps/api/test/auth.e2e-spec.ts` (real Postgres). SMS delivery and object storage
      are dev-only stubs (console log / local disk) behind swappable interfaces —
      real Africa's Talking / R2 wiring is still pending credentials.
- [x] **Properties** — create property (auto-grants the landlord role — there's no
      separate "become a landlord" flow in the spec), units, geo-tagged photo upload
      (first photo moves a unit `draft → vacant`, per PRD Epic 2 US-2.1 AC2), public
      search, landlord's own inventory, and a manual `vacant ↔ reserved` status
      transition (everything else is system-driven, pending Visits/Tenancies).
      `POST /properties/{id}/units` also takes an optional `quantity` (added
      2026-09-18, demo feedback) to bulk-create that many independent units in one
      call — each its own row/id/lifecycle, not a count field — returning
      `{ units: [...] }` instead of a single object only when `quantity > 1`, so
      every existing caller (which never sends it) keeps the exact response shape
      it always got. Covered by `properties.service.spec.ts`/`units.service.spec.ts`
      (mocked) and `apps/api/test/properties.e2e-spec.ts` (real Postgres).
- [x] **Visits** — tenant requests a visit (+48h expiry), landlord accepts/declines/
      proposes an alternate time, landlord inbox with status filtering. Expiry is
      enforced twice: lazily on the single-record respond path (so cron lag can never
      let a stale request be actioned) and by a periodic sweep in `apps/worker`.
      The spec has no follow-up endpoint for a tenant to respond to a "rescheduled"
      counter-proposal, and the DDL has no separate column for it — the landlord's
      proposed time is stored in `confirmed_slot`, disambiguated by `status`.
      "Tenant is notified" on expiry (PRD Epic 3 US-3.1 AC2) isn't implemented —
      the expiry sweep runs in `apps/worker`, a separate process from the api's
      in-process event bus Notifications listens on, so there's no event for it to
      subscribe to yet even though Notifications (#7) itself now exists; the
      multichannel doc's own routing table (Section 4) also has no entry for
      `visit_request.expired` specifically. `visit_request.created`/`.responded`
      (handled entirely within the api process) ARE wired — see Notifications
      below.

      **Unit interest** (added 2026-09-18, demo feedback) — a lighter-weight
      alternative to requesting a visit: `POST /units/{id}/interest` (tenant, no
      body, idempotent per (unit, tenant) pair) and `GET /landlords/me/interests`
      (landlord inbox, each row enriched with the tenant's name/phone and the
      unit's label). Lets a landlord create a tenancy for an interested tenant with
      one click — an *alternative* path alongside the existing paste-the-tenant-id
      `POST /tenancies` form, not a replacement for it; both create a tenancy
      through the same endpoint. A `unit_interests` row flips from `pending` to
      `converted` automatically via a `tenancy.created` listener (this module's own
      reaction to Tenancies' event, not a direct read of its tables), regardless of
      which of the two paths actually created the tenancy. `unit_interest.created`
      notifies the landlord the same way `visit_request.created` does — routed by
      the same "structurally identical, and the doc predates this event" reasoning
      already used for `complaint.created`.

      Covered by `visits.service.spec.ts` (mocked) and
      `apps/api/test/visits.e2e-spec.ts` (real Postgres, including the interest →
      tenancy → converted round trip).
- [x] **Tenancies** — create tenancy on a vacant unit (rejects non-vacant units and a
      notice_period_days below the confirmed 90-day statutory floor), reminder-setting
      updates, termination notices (validates `effective_date` against the floor and
      returns the earliest valid date on rejection, generates a real bilingual FR/EN
      document), and a real notice-expiry sweep that terminates the tenancy and frees
      the unit once `effective_date` passes. Runs as an in-process `@nestjs/schedule`
      cron (not the worker) specifically so it shares the event bus Properties'
      `UnitOccupancyListener` subscribes to for `tenancy.created`/`tenancy.terminated`.
      Multi-channel notice delivery (PRD Epic 4 US-4.2 AC2) is now wired via the
      Notifications module (#7, see below) — issuing a notice fans out to the tenant
      over SMS/WhatsApp/Email/Push/in-app. `current_balance`/`paid_through_date` are
      now live (see Payments below), pulled from Payments' ledger via a real
      cross-module call. A genuine bug the e2e tests caught: `EventEmitter2.emit()` is
      fire-and-forget, so a client could see stale unit status immediately after
      creating a tenancy — fixed with `emitAsync()` on the events with an active
      cross-module listener. Covered by `tenancies.service.spec.ts` (mocked) and
      `apps/api/test/tenancies.e2e-spec.ts` (real Postgres, including the sweep).
- [x] **Payments** — append-only ledger, idempotent payment initiation validated
      against the notice-effective-date cutoff and advance-months cap (both exact
      contract error codes), plus an amount-vs-billing-cycle check that isn't
      spec-required but CLAUDE.md calls this "the module to be most conservative and
      rigorous with." **The aggregator is simulated, by explicit direction** — CamPay/
      Monetbil credentials don't exist yet, so `charge()` returns an immediate ack and
      confirmation arrives ~4s later via a genuinely separate, HMAC-signed HTTP call to
      this app's own `/webhooks/payments/{provider}` endpoint (not an in-process
      shortcut), so the real signature-verification and webhook-processing code a real
      provider would hit is actually exercised. A periodic in-process reconciliation
      sweep is the real safety net if that self-call is ever lost (e.g. a restart),
      not decorative. Swapping in a real CamPay/Monetbil gateway later only means
      registering a different class for the same `PaymentGateway` interface — nothing
      else changes. `ledger_entries.running_balance` is a simple cumulative sum of
      confirmed payments (total paid to date) — there's no recurring rent-invoicing/
      debit-generation engine anywhere in the docs, so "amount owed" isn't a number
      this MVP can honestly compute yet. `current_balance` on the Tenancies dashboard
      and Payments' own notice/advance-cap checks are a genuine bidirectional read
      between the two modules, wired with `forwardRef()` (NestJS's supported pattern
      for this) rather than deferred. Multi-channel receipt delivery (PRD Epic 5 US-5.3
      AC1) is now wired via the Notifications module (#7, see below) — `payment.confirmed`
      fans out to the tenant over SMS/WhatsApp/in-app/push. Two real bugs the
      e2e tests caught: a bare `setTimeout` in the simulated gateway kept Jest from
      exiting cleanly (fixed with `.unref()`), and that same timer firing well after a
      ~3s test suite finished corrupted later tests — fixed by overriding the gateway
      with a pure stub in tests (mirroring the SMS gateway pattern), same as the real
      gateway is swapped for a real aggregator in production. Covered by
      `payments.service.spec.ts` (mocked) and `apps/api/test/payments.e2e-spec.ts`
      (real Postgres, including a real signed webhook round-trip and the
      reconciliation sweep).
      **Rent paid upfront (added 2026-09-20):** `POST /tenancies` takes an optional
      `prepaid_months` — rent the tenant already paid the landlord in cash. It is
      recorded through this module as a real confirmed payment with provider
      `offline` (append-only ledger credit, receipt, `payment.confirmed` →
      `paid_through_date` advances and the tenant is notified), never by writing
      to the ledger or `paid_through_date` directly. `PaymentsService.
      planPrepaidRent` validates first (Tenancies calls it before creating
      anything, so a bad value can't leave a half-created tenancy) and
      `recordPrepaidRent` records after. Not capped by `max_advance_months` (that
      limits what a tenant may pay through the platform; this is the landlord
      stating money they received) and `offline` is rejected on the tenant-facing
      payment endpoint, so a tenant can't mark their own rent paid. The tenant
      and landlord dashboards show it as a "Paid upfront" entry in the payment
      history plus the paid-through date and months ahead.
      **What a payment "says" (added 2026-09-20):** every confirmed payment now
      states when it was made (`paid_at`), which month(s) it covers
      (`period_start`/`period_end`/`months_covered`, worded like "September –
      November 2026 · 3 months") and when the next payment is due
      (`next_payment_due_date` on every tenancy response — the start date until
      something is paid, then the day after `paid_through_date`). The same three
      facts are in the ledger API, both dashboards, the `payment.confirmed`
      notification (FR/EN) and the receipt, all worded by one shared helper
      (`common/format/period.ts`). Billing starts on the tenancy's `start_date`,
      which the landlord can set to something other than the creation day
      (`422 PAYMENT_BEFORE_TENANCY_START` for earlier periods). For rent recorded
      as paid upfront, an optional `prepaid_paid_on` lets the landlord say the day
      the tenant actually paid (e.g. move-in day) rather than the day it was
      recorded; the ledger row's own `created_at` still records when it was
      entered. The first period follows the existing calendar-month convention: a
      mid-month start date is priced as that whole month.
- [x] **Contracts** — document generation only. `POST /tenancies/{id}/contracts`
      generates a single-locale lease document (FR or EN, defaulting to the
      requester's own stored locale) from the tenancy/unit/party data, accessible
      by either the landlord or the tenant; `GET /contracts/{id}` re-fetches it.
      **E-signature (PRD Epic 6 AC2/AC3) is deliberately not built** — by explicit
      direction, matching the same demo-first choice as Payments' simulated
      aggregator. The still-open "basic vs. advanced e-signature tier" question
      (Cameroon's cybersecurity law) is what has to be answered before
      `POST /contracts/{id}/sign` can be built at all, so a contract stays in
      `draft` status forever for now — there's no code path to
      `pending_signatures`/`fully_signed`, and the `contract_signatures` table from
      the schema doc wasn't created (it would be dead schema with no writer).
      Tenancies' own `GET /tenancies/{id}` surfaces the tenancy's most recent
      contract's status via a genuine bidirectional read wired with `forwardRef()`,
      same pattern as the Tenancies↔Payments dependency. Covered by
      `contracts.service.spec.ts` (mocked) and `apps/api/test/contracts.e2e-spec.ts`
      (real Postgres).
- [x] **Notifications** — real multi-channel routing engine (SMS/WhatsApp/Email/
      Push/in-app) per `docs/notification-module-multichannel.md`, with **every
      provider behind a swappable dev-stub gateway** (console-log, same pattern as
      Auth's SMS) since no real Africa's Talking/Resend/FCM credentials exist yet —
      SMS reuses Auth's existing `SmsGateway` directly rather than a second
      implementation. Two real patterns from the doc, both built for real:
      - **Fan-out** (`tenancy.notice_given`, `payment.confirmed`, `payment.failed`,
        all four `rent_expiry.*` stages) sends to every channel the user has opted
        into, each recorded as its own row in `notifications`.
      - **Waterfall** (`visit_request.created`, `visit_request.responded`) sends to
        the first reachable channel in priority order only. The doc's timed
        escalation-to-the-next-channel-on-no-response behavior is **not** built —
        no job-queue/scheduled-recheck infra exists in this project, and nothing
        marks it protected the way the reminder scheduler is — so this is "single
        best channel," not the full waterfall. Disclosed in `routing-table.ts`.

      **The rent-expiry reminder scheduler is fully built**, per CLAUDE.md's explicit
      "don't simplify away" instruction and the exact pseudocode in the schema doc's
      Section B.7 — a daily `@Cron` scan (also callable directly, like Tenancies'/
      Payments' own sweeps) that fires first/second/due-today/overdue reminders to
      **both** tenant and landlord (PRD Epic 8 US-8.2 AC1, a hard requirement), reading
      each tenancy's own landlord-configurable `reminder_first_days_before`/
      `reminder_second_days_before` (already built in Tenancies) rather than a
      redundant per-user setting. Idempotent via the doc's own `already_sent()` guard
      (a same-day existence check against `notifications`), so a retried/re-run scan
      never double-sends.

      Other deliberate scope decisions, each disclosed in code:
      - `notification_templates` isn't a persisted table — no admin UI exists to
        manage templates yet (Admin is #9), so it would be seed data nothing edits.
        Bilingual copy is hardcoded per event type (`notification-content.ts`),
        mirroring `contract-document.ts`/`notice-document.ts`/`receipt-document.ts`.
      - `notification_preferences.rent_reminder_days_before` (the doc's older,
        single-stage, per-user field) is dropped — Tenancies' real two-stage,
        per-tenancy fields are what the scheduler actually reads.
      - `contract.generated`, `visit_request.expired`, and `complaint.status_changed`
        are **not** routed: the first two have no entry in the doc's own routing
        table, and Complaints (build order #8) doesn't exist yet to emit the third.
      - The monthly landlord statement (email-only, per the doc's Pattern B table)
        isn't built — it's a new aggregation job, not a listener on an existing
        event, and nothing marks it protected the way the reminder scheduler is.

      A real bug the e2e tests caught: fan-out dispatches to every channel
      concurrently (`Promise.all`), and the first-ever notification for a user
      raced two concurrent inserts of the same `notification_preferences` row —
      fixed by ensuring that row exists once, before the concurrent fan-out, rather
      than relying on each channel's own upsert to be atomic enough on its own.
      Covered by `notifications.service.spec.ts` (mocked, 15 cases) and
      `apps/api/test/notifications.e2e-spec.ts` (real Postgres, including the
      reminder scheduler's idempotency and a real webhook status-update round-trip).
- [x] **Complaints** — tenant files a complaint on their own tenancy (category +
      description + up to 10 photo/video attachments via `multipart/form-data`),
      landlord gets a filterable aggregate view (`unit_id`/`status`/`category`) and
      updates status with an optional note (audit-logged in `complaint_updates`,
      never overwritten). `acknowledged_at`/`resolved_at` are stamped once, the
      first time each is reached — a status that bounces back and forth doesn't
      re-stamp an already-recorded milestone. A `closed` complaint is terminal
      (`422 COMPLAINT_ALREADY_CLOSED` on any further update).

      Two notification-routing gaps are resolved rather than left open:
      `complaint.created` has no entry in the multichannel doc's own routing
      table (an apparent oversight, since it predates this module existing) —
      routed by analogy to the identical `visit_request.created` shape (waterfall
      push → whatsapp → sms to the landlord), since PRD Epic 7 US-7.1 AC2
      explicitly requires the landlord be notified. `complaint.status_changed`
      *is* documented (in-app + push to the tenant) and wired as specified.
      There's no tenant-facing `GET /complaints` endpoint in api-specification.md
      Section 10 — "tenant sees status updates" (AC2) is satisfied via that
      in-app notification instead, not a dedicated detail endpoint.

      A real ordering bug the e2e tests caught: media files were validated
      *after* the Complaint row was already created, so an unsupported file
      type left an orphaned complaint with no media — fixed by classifying every
      file's type before creating anything. Covered by `complaints.service.spec.ts`
      (mocked) and `apps/api/test/complaints.e2e-spec.ts` (real Postgres,
      including the fan-out to the landlord and the status-change notification
      to the tenant).
- [x] **Web frontend** (`apps/web/`) — a lightweight Next.js (App Router) app, a
      separate deployable service in this same monorepo, built specifically to let
      a stakeholder demo run in a browser against the real API rather than curl/
      Swagger. No UI framework/component library — hand-written CSS with a small
      set of utility classes, and no client-side dependency beyond React/Next
      itself, per the "as lightweight as possible" direction. Covers: OTP login,
      landlord property/unit/photo/tenancy creation, the landlord occupancy
      dashboard (units, tenancies with balance/paid-through/contract status,
      visit-request inbox, complaints inbox), and the tenant side (browse public
      units, request a visit, pay rent, generate a contract, file a complaint).
      Session storage is `localStorage` — a deliberate demo simplification
      (disclosed in `lib/api.ts`); a production build would use httpOnly cookies
      instead. Two real gaps this UI work caught live and fixed on the backend:
      `GET /landlords/me/tenancies` was missing `contract_status` (only
      `GET /tenancies/{id}` had it), and there was no tenant-facing "my
      tenancies" endpoint at all (`GET /tenants/me/tenancies`, added 2026-09-18,
      mirrors the landlord one) — before that, a tenant could only find their own
      tenancy by having the id read out to them.

      **Landing page and listings (2026-09-20)** — `/` is now the public listings
      browser instead of a redirect: hero + search (city, type, bedrooms, max rent;
      accent-insensitive, so "Yaounde" finds "Yaoundé"), type filter pills, sort,
      and a card grid with cover photos, price, verified/type badges, amenities and
      an **"I'm interested"** button. `/units/[id]` is the detail page (photo
      gallery + lightbox, amenities, sticky booking card with "I'm interested" and
      "Request a visit"). A signed-out visitor who clicks "I'm interested" is sent
      to sign in and the click is remembered, so the interest is sent
      automatically when they land back — they don't have to find the button
      again. The sign-in page shows a "Demo accounts" helper (only when
      `NEXT_PUBLIC_SHOW_DEMO_LOGINS=true`, set in `docker-compose.yml`). The
      landlord dashboard is now tabbed (Properties & units / Tenants & tenancies /
      Requests) with photo thumbnails, and the tenant dashboard replaced its
      "browse" card with a link to the landing page plus a "Homes you're
      interested in" list. Backend additions: public `GET /units/{id}`, `total` +
      `min_bedrooms` + `property_type` on search, `GET /tenants/me/interests`,
      static serving of listing photos at `/media/unit-photos/` (only that folder),
      the seed script, and a guarded demo login code — see
      `docs/api-specification.md` Sections 4-5 and "Sample data" above. Design is
      hand-written CSS (no framework, no web-font download).

      **Editing listings, with a tamper-evident change history (2026-09-20)** —
      landlords can edit everything about their properties (name, type, address,
      region, coordinates, facilities) and units (label, listed rent, billing cycle,
      beds/baths, size, description, facilities, vacant/reserved) plus remove photos
      and pick the cover, from inline editors on the landlord dashboard
      (`PATCH /properties/{id}`, `PATCH /units/{id}`, `DELETE /units/{id}/photos/{id}`,
      `POST /units/{id}/photos/{id}/cover`). Every real change is written to a new
      **append-only** `listing_changes` table in the *same transaction* as the edit
      (field-level before/after, who, when, an optional reason), together with
      whether a tenant was living in the affected unit(s) at the time — so a
      landlord quietly changing details after move-in is visible. Three views:
      the landlord's own "Change history" tab (with a while-a-tenant-lived-there
      filter), a "Changes to your home" section on each tenancy in the tenant's
      dashboard (`GET /tenancies/{id}/listing-changes`, edits since the tenancy was
      created, landlord identity omitted), and an admin page at `/dashboard/admin`
      (`GET /admin/listing-changes`, with who made each change). Decisions worth
      knowing, each also noted in the API spec:
      - "Living there" = unit status `occupied` or `notice_given`; Properties owns
        unit status (driven by tenancy events), so this needs no cross-module read.
      - Editing a unit's **listed** rent does not touch an existing tenancy's agreed
        `rent_amount`; the editor says so and the change is logged.
      - Editing an ownership-verified property does **not** clear its verification
        (that is an admin decision) — the record carries `property_verified_at_change`
        so a reviewer can spot e.g. an address change on a verified property.
      - Photo *additions* are only logged while a tenant is living in the unit (the
        first photos of a new listing are setup, not edits). Removed photos keep
        their file in storage so the record still points at what the listing showed.
      - An edit that changes nothing writes no record; unchanged values in a PATCH
        are ignored. Not built: notifying the tenant when their landlord edits
        (they can see it in the dashboard; pushing it would be a new notification
        template + routing entry).
      - `UnitStatus` transitions are unchanged — landlords may only toggle
        `vacant ⇄ reserved`; removing the last photo of a vacant unit sends it back
        to `draft`, the mirror of the existing first-photo rule.
      Migration `20260920093733_add_listing_changes`; schema in the schema doc's B.2.

      Added 2026-09-18, after a stakeholder-demo pass surfaced further product
      feedback:
      - **Property/unit detail**: `property_type` (`residential`/`commercial`/
        `mixed_use`) and freeform `facilities` tags (gated compound, generator,
        borehole, security personnel, ...) on properties; freeform `facilities`
        tags (AC, Wi-Fi, hot water, furnished, ...) on units, alongside the
        already-existing `bedrooms`/`bathrooms`. Both are optional columns with
        empty/`null` defaults, so every row created before this migration stays
        valid — see the schema doc's B.2 section for the added-column note.
      - **Landlord-set advance-payment cap**: `max_advance_months` already existed
        end-to-end on the backend (`api-specification.md` Section 6) but had no
        field in the tenancy-creation form — added there, and the tenancy list now
        shows it.
      - **Multi-month rent payment**: the tenant's "pay rent" action is now a
        cycle-count selector (1..that tenancy's `max_advance_months`, in units of
        its own `billing_cycle`), not a single hardcoded month — the amount and
        period sent to `POST /tenancies/{id}/payments` scale accordingly, still
        landing on the whole-calendar-month boundaries `PaymentsService.
        expectedAmountFor()` requires. A new `months_paid_ahead` field on the
        tenancy response (both landlord and tenant views) surfaces "how many
        months ahead is this tenant paid" without either side doing the date math
        themselves — a simple whole-month count against today, not a billing
        calculation in its own right.
      - Visual polish: a small stats row on the landlord dashboard (unit/occupied/
        pending-visit/open-complaint counts), chip-style facility pickers, and tag/
        badge styling for the values above.
- [ ] **Admin** — thin wrappers over other modules' APIs + audit log

Right now the repo has: a bootable NestJS API shell with a `/health` endpoint, a
worker process that verifies its DB/Redis connections on startup (plus a real 15-minute
visit-request expiry sweep), Docker Compose for local dev (Postgres + Redis + api +
worker), and the Auth, Properties, Visits, Tenancies, and Payments modules fully
implemented per `docs/api-specification.md` Sections 3–7 — enough to demo the full
landlord + tenant flow end to end (auth, list a property, tenant pays simulated rent,
landlord sees it land on their dashboard). Interactive API docs (Swagger UI, generated
from the same controllers/DTOs) are served at `/docs` in dev.

## Prerequisites
- Node.js 24+
- Docker + Docker Compose
- Git

## First-time setup

```bash
# 1. Clone and enter the repo
git clone git@github.com:Datengott/rental-platform.git && cd rental-platform

# 2. Copy environment template and fill in real values
cp .env.example .env
# At minimum for local dev you can leave the external provider keys (CamPay, Africa's
# Talking, etc.) blank — those integrations will simply no-op / log instead of calling
# out until you add sandbox credentials. DATABASE_URL and REDIS_URL are pre-filled to
# match docker-compose's service names and don't need editing for local dev.

# 3. Install dependencies
npm install

# 4. Start Postgres + Redis (and api/worker, once they have real code)
docker compose up -d postgres redis

# 5. Generate the Prisma client and run the first migration
npm run prisma:generate
npm run prisma:migrate -- --name init

# 6. Start the API and worker in watch mode
docker compose up
```

### Sample data and demo accounts

`docker compose up` gives you an empty database. To see the platform with real-looking
content, load the demo data (idempotent — safe to re-run, e.g. after the e2e suite, which
wipes the shared dev database):

```bash
npm run seed
```

This creates **7 properties / 15 units** across Douala, Yaoundé, Buea and Limbe (homes and
offices, with real photos from `apps/api/seed-assets/`, credited in `CREDITS.md`), plus two
demo accounts. Sign in at `http://localhost:3001` with a phone number and a one-time code:

| Account | Phone | One-time code |
|---|---|---|
| Admin (also the landlord who owns the sample listings) | `+237600000001` | `123456` |
| Demo tenant (has a tenancy and one expressed interest) | `+237600000002` | `123456` |

The fixed code is a dev/demo convenience, not a real credential: it only applies to the
two numbers listed in `DEMO_ACCOUNT_PHONES`, only when `DEMO_STATIC_OTP` is set (it is, in
`docker-compose.yml`), and the API **refuses it outright when `NODE_ENV=production`**.
Every other number still gets a random code (printed by the SMS stub — `docker compose
logs api`). Never set `DEMO_STATIC_OTP` anywhere real users exist.

The API will be available at `http://localhost:3000`. Confirm `/health` responds, then
open `http://localhost:3000/docs` for interactive Swagger docs — use the "Authorize"
button with an access token from `/v1/auth/otp/verify` to try protected endpoints.

### Alpine/Prisma note

Both Dockerfiles install `openssl` explicitly in every Alpine-based stage. Without it
the Prisma query engine binary fails to load (`Error loading shared library
libssl.so.1.1`) on Alpine images that don't ship OpenSSL by default. If you add a new
Dockerfile stage based on `node:*-alpine`, carry that line over.

## Working with Claude Code on this repo

The repo root has a `CLAUDE.md` file with full project context (module boundaries,
build order, hard rules like the append-only ledger and cross-module event-only
communication, bilingual content requirements). It's intentionally **not committed**
(see `.gitignore`) since it's local working context, not project documentation — copy
it to a fresh clone if you're picking up this repo on another machine.

**Recommended way to work through the build:**
1. Open Claude Code in this repo directory (with `CLAUDE.md` present locally).
2. Ask it to implement one module at a time, in build order — e.g.
   *"Implement the auth module: OTP request/verify endpoints, JWT session issuance,
   and the KYC document upload endpoint. Follow docs/api-specification.md Section 3
   exactly for the request/response shapes."*
3. After each module, actually run it (`docker compose up`) and hit the endpoints
   (Postman/curl/Thunder Client) before moving to the next — don't let three modules
   get built unverified before you find out the first one has a bug.
4. For anything flagged in `CLAUDE.md`'s "flag it to the human" list (notice periods,
   e-signature tier, payment aggregator choice), Claude Code should stop and ask
   rather than picking one — make sure it actually does, and if it doesn't, tell it to.

## Running tests
```bash
npm run test          # unit tests — mocked, no DB, sub-second
npm run test:e2e      # real HTTP + real Postgres, no mocking of the thing under test
```

`test:e2e` needs `DATABASE_URL` plus the `JWT_*`/`OTP_*` vars from `.env.example` set in
the shell (or already in `.env`, which docker-compose picks up but a bare `npm run`
from the host won't) — see the `env:` block in `.github/workflows/ci.yml` for the exact
set CI uses against its ephemeral Postgres.

CI (`.github/workflows/ci.yml`) runs lint, unit tests, and e2e tests against a Postgres
service container on every push/PR to `main`, then builds the production Docker images
once those pass.

## Deployment
See `docs/deployment-infrastructure-and-module-schemas.md` Section A for the full
GCP Cloud Run + Cloudflare R2 deployment design and CI/CD pipeline. The deploy step in
`ci.yml` is left as a manual TODO until GCP project credentials exist as repo secrets.

## Project structure
```
apps/
  api/           NestJS application — one module folder per bounded module
  worker/        Background jobs that need a separate process: visit-request expiry sweep, DB/Redis
                 startup checks. Rent-expiry reminders, payment reconciliation, and notification
                 dispatch all run in-process inside the api instead (they share its event bus).
  web/           Next.js demo frontend — a separate deployable service, calling the api over HTTP
prisma/
  schema.prisma  Database schema — Auth, Properties, Visits, Tenancies, Payments modeled and implemented
docs/            Full product/technical specification (PRD, API spec, architecture, schemas)
.github/workflows/
  ci.yml         Lint, test, build on every push/PR to main
docker-compose.yml   Local dev environment (Postgres, Redis, api, worker)
.env.example         All required environment variables, grouped by provider
```

## Known open decisions

These need a human call before the corresponding real integration is built (tracked in
`docs/PRD-mvp.md` and `CLAUDE.md`):

- Final choice between CamPay and Monetbil as payment aggregator — the Payments module
  itself is fully built and demoable behind a simulated gateway (see above) per explicit
  direction, so this no longer blocks the module; it blocks swapping in the real one.
- Whether e-signature needs to be "advanced tier" per Cameroon's cybersecurity law — the
  Contracts module's document *generation* is fully built (see above) per explicit
  direction, so this no longer blocks that; it blocks building `POST /contracts/{id}/sign`
  at all, which doesn't exist yet.
- Whether Cameroon is inside Africa's Talking's *WhatsApp* (Chat API) coverage
  specifically — their SMS coverage is confirmed, but the multichannel doc couldn't
  confirm WhatsApp coverage in this research pass and recommends a sandbox check
  before committing. Doesn't block anything today: the Notifications module is fully
  built behind a `WhatsAppGateway` interface with a console-log dev stub (see above);
  this only matters once real Africa's Talking credentials are being wired up.
