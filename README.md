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
| Background jobs    | Standalone worker app (rent-expiry scheduler, payment reconciliation, notification dispatch) |
| Local dev          | Docker + Docker Compose                                |
| Deploy target      | Google Cloud Run (`africa-south1`, pending latency test) |
| Object storage     | Cloudflare R2 (zero egress fees)                        |
| Payments           | Mobile money aggregator — CamPay or Monetbil (final choice pending) |

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
      Covered by `properties.service.spec.ts`/`units.service.spec.ts` (mocked) and
      `apps/api/test/properties.e2e-spec.ts` (real Postgres).
- [x] **Visits** — tenant requests a visit (+48h expiry), landlord accepts/declines/
      proposes an alternate time, landlord inbox with status filtering. Expiry is
      enforced twice: lazily on the single-record respond path (so cron lag can never
      let a stale request be actioned) and by a periodic sweep in `apps/worker`.
      The spec has no follow-up endpoint for a tenant to respond to a "rescheduled"
      counter-proposal, and the DDL has no separate column for it — the landlord's
      proposed time is stored in `confirmed_slot`, disambiguated by `status`.
      "Tenant is notified" on expiry (PRD Epic 3 US-3.1 AC2) isn't implemented — no
      event bus is shared between the worker and api processes, and Notifications
      doesn't exist yet. Covered by `visits.service.spec.ts` (mocked) and
      `apps/api/test/visits.e2e-spec.ts` (real Postgres).
- [x] **Tenancies** — create tenancy on a vacant unit (rejects non-vacant units and a
      notice_period_days below the confirmed 90-day statutory floor), reminder-setting
      updates, termination notices (validates `effective_date` against the floor and
      returns the earliest valid date on rejection, generates a real bilingual FR/EN
      document), and a real notice-expiry sweep that terminates the tenancy and frees
      the unit once `effective_date` passes. Runs as an in-process `@nestjs/schedule`
      cron (not the worker) specifically so it shares the event bus Properties'
      `UnitOccupancyListener` subscribes to for `tenancy.created`/`tenancy.terminated`.
      Multi-channel notice delivery (PRD Epic 4 US-4.2 AC2) isn't implemented —
      Notifications (#7) doesn't exist yet. `current_balance`/`paid_through_date` are
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
      AC1) isn't implemented — Notifications (#7) doesn't exist yet. Two real bugs the
      e2e tests caught: a bare `setTimeout` in the simulated gateway kept Jest from
      exiting cleanly (fixed with `.unref()`), and that same timer firing well after a
      ~3s test suite finished corrupted later tests — fixed by overriding the gateway
      with a pure stub in tests (mirroring the SMS gateway pattern), same as the real
      gateway is swapped for a real aggregator in production. Covered by
      `payments.service.spec.ts` (mocked) and `apps/api/test/payments.e2e-spec.ts`
      (real Postgres, including a real signed webhook round-trip and the
      reconciliation sweep).
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
- [ ] **Notifications** — multi-channel routing incl. rent-expiry reminder scheduler
- [ ] **Complaints**
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
  worker/        Background jobs: rent-expiry scheduler, payment reconciliation, notification dispatch
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
