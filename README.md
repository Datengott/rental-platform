# Rental Platform — MVP

Cameroon-first rental platform: verified listings, mobile-money rent collection, generated
tenancy contracts, compliant termination notices, multi-channel notifications.

**Full spec lives in `/docs`.** Read `docs/PRD-mvp.md` and `docs/api-specification.md`
before implementing any feature — this README only covers getting the environment running.

## Prerequisites
- Node.js 20+
- Docker + Docker Compose
- Git

## First-time setup

```bash
# 1. Clone and enter the repo
git clone <your-repo-url> rental-platform && cd rental-platform

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

The API will be available at `http://localhost:3000`. Confirm it's healthy, then start
implementing modules in the order specified in `CLAUDE.md`.

## Working with Claude Code on this repo

`CLAUDE.md` in the repo root gives Claude Code full project context automatically —
the module boundaries, build order, and hard rules (append-only ledger, cross-module
event-only communication, bilingual content requirements) are all there so you don't
need to re-explain them every session.

**Recommended way to work through the build:**
1. Open Claude Code in this repo directory.
2. Ask it to implement one module at a time, in the order in `CLAUDE.md` — e.g.
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
npm run test:e2e       # end-to-end tests (needs postgres running)
```

## Deployment
See `docs/deployment-infrastructure-and-module-schemas.md` Section A for the full
GCP Cloud Run + Cloudflare R2 deployment design and CI/CD pipeline. `.github/workflows/ci.yml`
implements the lint/test/build steps; the deploy step is left as a manual TODO until
GCP project credentials exist as repo secrets.

## Project structure
```
apps/
  api/           NestJS application — one module folder per bounded module (see CLAUDE.md)
  worker/        Background jobs: rent-expiry scheduler, payment reconciliation, notification dispatch
prisma/
  schema.prisma  Database schema — Auth + Properties modules modeled as the pattern to extend
docs/            Full product/technical specification (PRD, API spec, architecture, schemas)
.github/workflows/
  ci.yml         Lint, test, build on every PR
docker-compose.yml   Local dev environment (Postgres, Redis, api, worker)
.env.example         All required environment variables, grouped by provider
```
