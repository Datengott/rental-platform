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

- [ ] **Auth** — phone+OTP, roles, KYC tier (`User`, `UserRoleAssignment`, `OtpChallenge`,
      `Session` modeled in `prisma/schema.prisma`; endpoints not yet implemented)
- [ ] **Properties** — listings, units, photos (`Property`, `Unit`, `UnitPhoto` modeled;
      endpoints not yet implemented)
- [ ] **Visits** — visit requests
- [ ] **Tenancies** — occupancy, termination notices (statutory notice-period floor
      pending legal sign-off — see `docs/PRD-mvp.md` Epic 4)
- [ ] **Payments** — ledger (append-only), mobile money integration — highest
      engineering risk, aggregator choice still pending
- [ ] **Contracts** — generation + e-signature (tier decision pending)
- [ ] **Notifications** — multi-channel routing incl. rent-expiry reminder scheduler
- [ ] **Complaints**
- [ ] **Admin** — thin wrappers over other modules' APIs + audit log

Right now the repo has: a bootable NestJS API shell with a `/health` endpoint, a
worker process that verifies its DB/Redis connections on startup, Docker Compose for
local dev (Postgres + Redis + api + worker), and the Auth/Properties portion of the
Prisma schema. No module business logic has landed yet.

## Prerequisites
- Node.js 20+
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
start implementing modules in the order below.

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
npm run test          # unit tests, both apps
npm run test:e2e      # end-to-end tests (needs postgres running)
```

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
  schema.prisma  Database schema — Auth + Properties modules modeled so far
docs/            Full product/technical specification (PRD, API spec, architecture, schemas)
.github/workflows/
  ci.yml         Lint, test, build on every push/PR to main
docker-compose.yml   Local dev environment (Postgres, Redis, api, worker)
.env.example         All required environment variables, grouped by provider
```

## Known open decisions

These block implementation of specific modules and need a human call before code is
written against them (tracked in `docs/PRD-mvp.md` and `CLAUDE.md`):

- Exact statutory notice-period defaults per region (placeholder of 90 days in the
  schema, pending lawyer confirmation)
- Final choice between CamPay and Monetbil as payment aggregator
