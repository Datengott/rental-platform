# Project Instructions for Claude Code

## What this is
A rental platform for Cameroon (landlords + tenants), MVP phase. Full product/technical
context lives in `/docs` — **read the relevant doc before implementing any module**, don't
work from memory of this file alone:

- `docs/PRD-mvp.md` — user stories + acceptance criteria (the spec for *what* to build)
- `docs/api-specification.md` — the exact REST contract (endpoints, request/response shapes, error codes)
- `docs/deployment-infrastructure-and-module-schemas.md` — SQL schemas per module, event names, deployment/hosting decisions
- `docs/notification-module-multichannel.md` — SMS/WhatsApp/Email/Push/In-app routing logic
- `docs/rental-platform-architecture.md` — original architecture rationale (why decisions were made, legal/market context)

## Stack
- NestJS (TypeScript) — modular monolith, one Nest module per bounded module below
- PostgreSQL via Prisma ORM
- Redis (Upstash-compatible) for cache/queues
- Docker + Docker Compose for local dev
- Deploy target: Google Cloud Run (`africa-south1`, pending latency test — see architecture doc Section A.2)

## The 9 bounded modules (folders under `apps/api/src/modules/`)
`auth` · `properties` (properties+units+listings) · `visits` · `tenancies` (includes termination
notices) · `payments` (includes the ledger) · `contracts` · `notifications` · `complaints` · `admin`

**Hard rule carried over from the architecture design: modules never read/write another
module's database tables directly.** Cross-module effects happen through the internal event
bus (`@nestjs/event-emitter` — see `common/events/`). This is what keeps a later
microservice-extraction (Payments is the flagged first candidate) a deployment change
instead of a rewrite. If you're implementing module A and need data that lives in module B,
call module B's service class through its public interface, or subscribe to its events —
never `import` its Prisma model directly from another module's code.

## Build order (matches the PRD's Epic sequence — build and test each before moving on)
1. `auth` — phone+OTP, roles, KYC tier (Epic 1)
2. `properties` — listings, units, photos (Epic 2)
3. `visits` — visit requests (Epic 3)
4. `tenancies` — occupancy, termination notices (Epic 4) — **note the statutory
   notice-period floor is a hard business rule, not a UI default; see PRD Epic 4 and
   API spec Section 6**
5. `payments` — ledger, mobile money integration (Epic 5) — highest engineering risk,
   see API spec Section 7 for the idempotency/reconciliation requirements
6. `contracts` — generation + e-signature (Epic 6)
7. `notifications` — multi-channel routing (Epic 8) — **includes the rent-expiry
   reminder scheduler; see the pseudocode in the schema doc's Section B.7, this is a
   named product requirement, don't simplify it away**
8. `complaints` (Epic 7)
9. `admin` — mostly thin wrappers over the other modules' own APIs, plus its own audit log

## Conventions
- Every Prisma model name and field matches the SQL DDL in the schema doc exactly —
  don't rename fields for "cleaner" TypeScript style, the DDL is the source of truth.
- Every endpoint's request/response shape matches `api-specification.md` exactly,
  including the error code strings (e.g. `NOTICE_PERIOD_BELOW_STATUTORY_MINIMUM`,
  `PAYMENT_EXCEEDS_ADVANCE_MONTHS_CAP`) — these are referenced by name in the PRD's
  acceptance criteria, so they're contract, not suggestion.
- All user-facing generated content (notifications, contracts, notices) needs both
  FR and EN variants — never ship a feature with only one locale's template.
- Money fields: `NUMERIC` in Postgres, never `FLOAT`. XAF has no minor unit — don't
  introduce cents/decimal handling that doesn't apply to this currency.
- The payment ledger (`payments`/`ledger_entries` tables) is APPEND-ONLY. Never write
  an UPDATE or DELETE against `ledger_entries` in application code, even for
  "corrections" — those are new offsetting rows. This is a legal/evidentiary
  requirement discussed at length in the architecture doc, not a style preference.

## What NOT to build yet (see PRD Section 4.2 — explicitly out of scope for MVP)
No chat/messaging beyond structured visit requests, no credit-scoring/financing, no
multi-currency, no maintenance-vendor dispatch, no USSD, no direct (non-aggregator)
MTN/Orange API integration, no public SEO listings site.

## Before writing code touching these areas, flag it to the human rather than guessing:
- Exact statutory notice-period defaults per region (pending lawyer confirmation —
  a placeholder of 90 days is in the schema, marked as needing legal sign-off)
- Whether e-signature needs to be "advanced tier" per Cameroon's cybersecurity law
- Final choice between CamPay and Monetbil as payment aggregator
