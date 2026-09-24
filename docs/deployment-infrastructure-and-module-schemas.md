# Deployment Infrastructure & Module Schemas
### Companion to rental-platform-architecture.md

---

## PART A — Deployment Infrastructure

### A.1 Constraints this has to satisfy (recap)

- Bootstrapped, early-stage: a handful of landlords, no meaningful traffic yet. Cost predictability and low fixed overhead matter more than hyperscale readiness.
- Users are bandwidth- and cost-sensitive (Section on connectivity in the first document) — so **image/object egress cost** is a real line item, not a rounding error, once the listings catalog grows.
- Financial data (payment ledger) needs strong durability and backup guarantees regardless of how lean everything else is.
- Everything should be containerized (Docker) from day one so the modular monolith can be split into independently deployed services later without a re-platform.

### A.2 What actually has an Africa presence today

This matters because it's the one factual point that changes the calculus versus a generic "best cloud provider" comparison:

| Provider | Africa region? | Nearest option |
|---|---|---|
| **AWS** | Yes — `af-south-1`, Cape Town, South Africa (3 Availability Zones, opened 2020) | — |
| **Google Cloud** | Yes — `africa-south1`, Johannesburg, South Africa (opened 2023, GA) | — |
| **DigitalOcean** | **No** — 15 datacenters / ~12 regions, none in Africa. There's an open, unresolved feature request from users explicitly asking for an African region, citing latency and submarine-cable-risk issues with relying on Europe/US. | Nearest: Amsterdam or London |
| **Hetzner** | **No** — datacenters only in Germany, Finland, and the US (Ashburn VA, Hillsboro OR) | Nearest: Falkenstein/Helsinki (EU) |
| **Azure** | Has South Africa North/West regions (Johannesburg/Cape Town) — comparable positioning to AWS/GCP here, not separately re-verified in this research pass | — |

**Important honesty check:** I don't have verified, current round-trip-latency numbers specifically for the Douala/Yaoundé-to-Johannesburg-or-Cape-Town corridor, nor Douala/Yaoundé-to-Paris/Frankfurt. Continental distance alone (Cameroon to South Africa is roughly comparable in great-circle distance to Cameroon to Western Europe) means neither option has an obvious geographic edge — the deciding factor in practice is which submarine cable/transit routes your actual ISPs (Camtel, MTN, Orange, Nexttel) use, which I can't determine without a live trace. **Before committing to a region, run `mtr`/`traceroute` and a simple HTTP latency test from a Cameroonian connection (or ask a contact in Douala/Yaoundé to run one) against both `africa-south1` and a European region like `europe-west1` (Belgium) or `europe-west3` (Frankfurt).** This is a 20-minute test that removes a real unknown — don't skip it.

### A.3 Per-service cost/quality comparison

Rather than picking one provider wholesale, here's the breakdown by service category — this is genuinely where costs diverge the most, and mixing providers ("frugal stack" pattern) is now a common, well-supported approach rather than an anti-pattern.

| Service | GCP-native option | Cheaper/alternative option | Recommendation for this project |
|---|---|---|---|
| **Compute (app containers)** | Cloud Run (serverless containers, pay-per-request, scales to zero) or GKE Autopilot | Hetzner CX-series VMs (e.g., ~€4–8/mo for 2–4 vCPU/4–8GB) or DigitalOcean Droplets (~$24/mo comparable spec) | **Cloud Run**, in `africa-south1` pending the latency test above. At MVP traffic levels it will likely run within or near the free tier, and "scales to zero" means you pay ~nothing during the quiet periods a pilot-stage product actually has. Hetzner is objectively cheaper per core, but has no African presence and requires you to self-manage the VM (OS patching, Docker daemon, reverse proxy) — not worth the ops burden yet for a small team validating product-market fit. |
| **Managed Postgres** | Cloud SQL for PostgreSQL | Supabase or Neon (generous free tiers, serverless-friendly, branch-per-environment) | **Cloud SQL**, same region as Cloud Run — keeping the DB and compute co-located avoids cross-provider network latency on every single query, which matters more than the DB bill itself at this stage. If pre-revenue cost is the binding constraint, Neon's free tier is a legitimate way to defer this cost for the first few months — just plan the migration back to Cloud SQL before you're handling real rent payments at volume, since Neon/Supabase's nearest regions are also not in Africa. |
| **Redis (cache/queues)** | Memorystore for Redis | Upstash Redis (serverless, pay-per-command, has a real free tier) | **Upstash** for MVP — Memorystore has a non-trivial fixed monthly cost even at the smallest tier and requires a VPC connector to reach from Cloud Run, adding both cost and setup complexity for a workload (job queues, session cache, OTP rate-limiting) that's genuinely light at pilot scale. |
| **Object storage (photos, docs, contracts)** | Cloud Storage | Cloudflare R2 (S3-compatible, **zero egress fees**) | **Cloudflare R2.** This is the one place I'd actively steer away from the GCP-native option: your product is photo-heavy (listing images) and served to bandwidth/cost-conscious mobile users, so **every image view is an egress event** — Cloud Storage bills for that egress, R2 doesn't. At real usage volume this difference compounds into a meaningful recurring cost, not a rounding error. |
| **CDN** | Cloud CDN | Cloudflare (free tier covers this) | **Cloudflare**, sitting in front of R2 — keeps the whole image-delivery path (storage + CDN) on one provider with no egress billing, and Cloudflare's edge network has strong African coverage independent of which cloud region you pick for compute. |
| **SMS** | (no native GCP product) | Africa's Talking (confirmed to serve Cameroon) or Orange's native SMS Cameroon API | **Africa's Talking** for the primary integration (broader carrier reach in one API); consider adding Orange's native API later specifically to improve delivery rates to Orange-network numbers if you see a gap. |
| **CI/CD** | Cloud Build | GitHub Actions (free tier is generous for a small team) | **GitHub Actions** — no reason to pay for Cloud Build minutes when GitHub Actions' free tier comfortably covers a small team's build volume, and it keeps your CI config next to your code regardless of where you eventually deploy. |
| **Container registry** | Artifact Registry | GitHub Container Registry (free for public/private within limits) | **Artifact Registry** — keeping images in the same project as Cloud Run avoids any cross-provider pull latency/auth complexity at deploy time; the cost is negligible at this scale. |
| **Secrets management** | Secret Manager | — | **Secret Manager** — this one's worth staying GCP-native regardless of cost, since Cloud Run integrates with it natively (secrets injected as env vars/mounted files without custom plumbing). |
| **Monitoring/logging** | Cloud Monitoring + Cloud Logging (bundled with Cloud Run) | Sentry (free tier) for error tracking specifically | **Both** — GCP's bundled monitoring for infra-level metrics (request latency, error rates, cold starts) at no extra setup cost, plus **Sentry** layered on top for application-level error tracking with stack traces, since that's a materially better debugging experience than log-mining for actual bugs. |
| **Infrastructure as Code** | — | Terraform (provider-agnostic) | **Terraform** regardless of provider choice — this is what makes the "start on GCP, move a piece to Hetzner later if costs demand it" strategy actually low-risk instead of a rewrite. |

### A.4 Definitive recommended stack

Given the comparison above, the resolved stack is a **GCP + Cloudflare hybrid**, not an all-in-one-provider choice:

```
Compute:            Docker containers → Google Cloud Run (region: TBD after latency test,
                     default assumption africa-south1)
Database:           Cloud SQL for PostgreSQL 15+ (same region as Cloud Run)
Cache/Queues:        Upstash Redis (serverless)
Object storage:      Cloudflare R2
CDN:                 Cloudflare (in front of R2 and the public listings site)
SMS:                 Africa's Talking (primary), Orange SMS Cameroon API (secondary, later)
Payments:            CamPay or Monetbil (aggregator, evaluate both in sandbox before choosing)
Secrets:             Google Secret Manager
CI/CD:               GitHub Actions → Artifact Registry → Cloud Run deploy
IaC:                 Terraform
Monitoring:          Cloud Monitoring/Logging + Sentry
Container registry:  Google Artifact Registry
```

**Why this over "just pick DigitalOcean/Hetzner, they're cheaper":** they're cheaper per compute-unit, genuinely — but neither has any African presence, both push the OS/Docker-daemon/reverse-proxy operational burden onto your (currently small) team, and neither offers the "scales to zero, pay only for actual requests" economics that Cloud Run gives you specifically during the low-and-uncertain-traffic MVP phase. If usage patterns later show compute is your dominant cost line (not the case yet, and not knowable yet), migrating the containerized services to Hetzner VMs is a Terraform-and-Docker-Compose change, not a rewrite — the containers themselves don't care what's running them.

### A.5 Containerization approach

- **Every module gets its own Dockerfile from day one**, even though they deploy together as one Cloud Run service in the monolith phase. This is what makes the later split into independent services (Section 3.2 of the first document flagged Payments as the likely first candidate) a deployment change, not a code change.
- **Multi-stage builds**: a `build` stage (installs dependencies, compiles/transpiles) and a slim `runtime` stage (only what's needed to run) — keeps images small, which matters for Cloud Run cold-start time.
- **`docker-compose.yml` for local development**, standing up Postgres, Redis, and the app container(s) together, so a new developer can `docker compose up` and have a working environment without touching any cloud credentials.
- **One image per environment tag** (`:dev`, `:staging`, `:prod`) pushed to Artifact Registry by the CI pipeline; Cloud Run pulls the tagged image for the corresponding environment/revision.

```
docker-compose.yml (local dev — abbreviated)
├── postgres:15        (local DB, seeded with test data)
├── redis:7             (local cache/queue)
├── api                 (the modular-monolith app container, hot-reload mounted)
└── worker               (background job processor — reminders, reconciliation)
```

### A.6 CI/CD pipeline

```
1. Push to `main` / open PR
      → GitHub Actions: lint, unit tests, build Docker image
2. Merge to `main`
      → Build production image → tag with git SHA → push to Artifact Registry
      → Run DB migrations (as a one-off Cloud Run job, not against prod on app boot)
      → Deploy new Cloud Run revision → route traffic gradually (canary: 10% → 100%)
3. Failure at any step
      → Deployment halts, previous revision keeps serving 100% of traffic (Cloud Run
        revisions are immutable and this rollback is a config change, not a redeploy)
```

### A.7 Environments

| Environment | Purpose | Notes |
|---|---|---|
| `dev` | Local Docker Compose | No cloud dependency required to develop |
| `staging` | Cloud Run, smallest tier, own Cloud SQL instance | Mirrors prod topology; payment aggregator in **sandbox mode** here |
| `production` | Cloud Run, Cloud SQL with automated daily backups + point-in-time recovery enabled | Payment aggregator in live mode; this is the only environment touching real mobile money transactions |

### A.8 Indicative MVP-stage cost estimate

These are **directional estimates for planning purposes only** — actual pricing should be confirmed against each provider's current published rates before budgeting, since cloud pricing changes and I don't have a live quote for your specific expected traffic:

| Line item | Rough monthly range at pilot scale (few landlords, low request volume) |
|---|---|
| Cloud Run (app + worker) | Likely within free tier or single-digit USD |
| Cloud SQL (smallest tier, e.g. shared-core) | ~$10–15 |
| Upstash Redis | Free tier likely sufficient initially |
| Cloudflare R2 + CDN | Near-$0 at low image volume (R2 free tier + no egress charge) |
| Africa's Talking SMS | Pay-per-message, no fixed fee — cost scales directly with reminders/notices sent |
| Domain + misc | ~$1–2 |
| **Total** | **Roughly $15–40/month at true pilot scale**, before payment-aggregator transaction fees (which are a % of rent collected, not an infra cost) |

This should climb gradually and predictably as usage grows — the point of the serverless-leaning choices above is that you're not pre-paying for capacity you don't yet need.

---

## PART B — Module / Microservice Schemas

Each module below is designed as an independently deployable unit **today**, even while running inside the monolith — it owns its own tables (no other module writes to them directly), exposes a versioned REST API, and communicates cross-module changes via internal events (published to a lightweight in-process event bus now; swappable for Pub/Sub or a message queue when/if a module is extracted into its own service).

---

### B.1 Auth & Identity Module

**Responsibility:** phone-based authentication, role management, KYC tier tracking.

```sql
CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number        VARCHAR(20) NOT NULL UNIQUE,   -- E.164 format, e.g. +2376XXXXXXXX
    full_name           VARCHAR(150),
    locale              VARCHAR(5) NOT NULL DEFAULT 'fr', -- 'fr' | 'en'
    id_document_type    VARCHAR(30),                    -- 'national_id' | 'passport' | 'cni'
    id_document_ref     VARCHAR(100),
    id_document_url     TEXT,                           -- pointer to R2 object
    kyc_tier            VARCHAR(20) NOT NULL DEFAULT 'unverified',
                        -- 'unverified' | 'id_verified' | 'ownership_verified'
    kyc_verified_at     TIMESTAMPTZ,
    kyc_verified_by     UUID REFERENCES users(id),      -- admin who approved
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deactivated_at      TIMESTAMPTZ
);

CREATE TABLE user_roles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role                VARCHAR(20) NOT NULL,            -- 'landlord' | 'tenant' | 'admin' | 'support_agent'
    granted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, role)
);

CREATE TABLE otp_challenges (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number        VARCHAR(20) NOT NULL,
    otp_hash            VARCHAR(255) NOT NULL,           -- never store plaintext OTP
    purpose             VARCHAR(20) NOT NULL,             -- 'login' | 'signup' | 'sensitive_action'
    expires_at          TIMESTAMPTZ NOT NULL,
    attempts            SMALLINT NOT NULL DEFAULT 0,
    consumed_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_otp_phone_active ON otp_challenges(phone_number) WHERE consumed_at IS NULL;

CREATE TABLE sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash  VARCHAR(255) NOT NULL,
    device_info         JSONB,
    issued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at          TIMESTAMPTZ NOT NULL,
    revoked_at          TIMESTAMPTZ
);
```

**Key endpoints**
| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/otp/request` | Send OTP to phone via SMS |
| POST | `/auth/otp/verify` | Verify OTP, issue session tokens |
| POST | `/auth/refresh` | Rotate access token using refresh token |
| POST | `/auth/logout` | Revoke session |
| GET | `/users/me` | Current user profile + roles + KYC tier |
| PATCH | `/users/me` | Update profile fields |
| POST | `/users/me/kyc-documents` | Upload ID/ownership documents |
| POST | `/admin/users/{id}/kyc/approve` | Admin: advance KYC tier |

**Events published:** `user.registered`, `user.kyc_tier_changed`, `user.role_granted`
**Events consumed:** none (this is a foundational module)

---

### B.2 Property & Listings Module

**Responsibility:** landlord property/unit inventory, photos, listing status.

```sql
-- property_type and facilities below aren't in this DDL originally — added
-- 2026-09-18 to the Prisma schema after live demo feedback asked for more
-- property detail than address+city+rent. Prisma is the source of truth
-- for these two columns; this DDL comment documents the deviation rather
-- than being kept byte-for-byte in sync (same pattern already used for the
-- units.status default discrepancy noted below).
CREATE TABLE properties (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    landlord_id         UUID NOT NULL,                   -- references users.id (Auth module, no FK across modules)
    name                VARCHAR(150),
    property_type       VARCHAR(20),                     -- 'residential' | 'commercial' | 'mixed_use', optional
    facilities          TEXT[] NOT NULL DEFAULT '{}',     -- freeform tags: 'gated', 'generator', 'borehole', 'security_personnel', ...
    address_line        TEXT NOT NULL,
    city                VARCHAR(80) NOT NULL,
    region              VARCHAR(80),                     -- e.g. 'Littoral', 'Centre'
    latitude             NUMERIC(9,6),
    longitude            NUMERIC(9,6),
    ownership_doc_url    TEXT,                            -- title/land certificate reference, R2 pointer
    ownership_verified_at TIMESTAMPTZ,
    ownership_verified_by UUID,                           -- admin user id
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE units (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id         UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    label               VARCHAR(50),                     -- e.g. "Unit 4B"
    bedrooms            SMALLINT,
    bathrooms           SMALLINT,
    facilities          TEXT[] NOT NULL DEFAULT '{}',     -- freeform tags: 'ac', 'wifi', 'hot_water', 'furnished', ... — added 2026-09-18, same reasoning as properties.facilities above
    size_sqm            NUMERIC(8,2),
    rent_amount         NUMERIC(12,0) NOT NULL,          -- XAF has no minor unit; store as integer-like numeric
    currency            CHAR(3) NOT NULL DEFAULT 'XAF',
    billing_cycle       VARCHAR(20) NOT NULL DEFAULT 'monthly', -- 'monthly' | 'quarterly' | 'biannual'
    status              VARCHAR(20) NOT NULL DEFAULT 'vacant',
                        -- 'vacant' | 'visit_requested' | 'reserved' | 'occupied' | 'notice_given'
    description         TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_units_status ON units(status);
CREATE INDEX idx_units_property ON units(property_id);

CREATE TABLE unit_photos (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id             UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    storage_url         TEXT NOT NULL,                   -- R2 object pointer
    geo_latitude        NUMERIC(9,6),                    -- captured at photo time (fraud countermeasure)
    geo_longitude       NUMERIC(9,6),
    captured_at         TIMESTAMPTZ,
    sort_order          SMALLINT NOT NULL DEFAULT 0,
    uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Added 2026-09-20. APPEND-ONLY audit trail of landlord edits to properties/units
-- (never UPDATE or DELETE from application code — same rule as ledger_entries).
-- Written in the same transaction as the edit it describes.
CREATE TYPE listing_entity_type AS ENUM ('property', 'unit');
CREATE TABLE listing_changes (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type                 listing_entity_type NOT NULL,
    property_id                 UUID NOT NULL,           -- always set: a unit change records its property too
    unit_id                     UUID,                    -- set when entity_type = 'unit'
    entity_label                TEXT,                    -- name/label at the time (either can be edited later)
    changed_by                  UUID NOT NULL,           -- users.id (no FK: audit rows outlive account changes)
    action                      TEXT NOT NULL,           -- 'updated' | 'photo_added' | 'photo_removed' | 'cover_photo_changed'
    changes                     JSONB NOT NULL,          -- [{ field, from, to }], only fields that actually changed
    note                        TEXT,                    -- landlord's stated reason
    occupied_unit_ids           UUID[] NOT NULL DEFAULT '{}',  -- affected units with a tenant living there (occupied / notice_given)
    property_verified_at_change BOOLEAN NOT NULL,        -- property had the ownership-verified badge at the time
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_listing_changes_property ON listing_changes(property_id, created_at);
CREATE INDEX idx_listing_changes_unit ON listing_changes(unit_id, created_at);
CREATE INDEX idx_listing_changes_actor ON listing_changes(changed_by, created_at);
CREATE INDEX idx_listing_changes_created ON listing_changes(created_at);
```

**Key endpoints**
| Method | Path | Purpose |
|---|---|---|
| POST | `/properties` | Landlord creates a property |
| PATCH | `/properties/{id}` | Landlord edits any property detail (recorded in `listing_changes`) |
| POST | `/properties/{id}/units` | Add a unit to a property |
| POST | `/units/{id}/photos` | Upload geo-tagged photo |
| DELETE | `/units/{id}/photos/{photoId}` | Remove a photo (recorded) |
| POST | `/units/{id}/photos/{photoId}/cover` | Make a photo the cover (recorded) |
| GET | `/units?status=vacant&city=Douala` | Public/tenant search |
| GET | `/landlords/me/units` | Landlord's occupancy grid source data |
| GET | `/landlords/me/properties` | Landlord's properties with unit / occupied-unit counts |
| PATCH | `/units/{id}` | Edit any unit detail (recorded in `listing_changes`) |
| GET | `/landlords/me/listing-changes` | Landlord's own edit history |
| GET | `/tenancies/{id}/listing-changes` | Edits to a tenancy's home since it began (landlord or tenant) |
| GET | `/admin/listing-changes` | Admin audit of all edits, filterable to "while a tenant lived there" |

**Events published:** `unit.listed`, `unit.status_changed`
**Events consumed:** `tenancy.created` (→ set unit status to `occupied`), `tenancy.terminated` (→ set unit status to `vacant`)

---

### B.3 Visit Requests Module

```sql
CREATE TABLE visit_requests (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id             UUID NOT NULL,                   -- references units.id
    tenant_id           UUID NOT NULL,                   -- references users.id
    landlord_id         UUID NOT NULL,                   -- denormalized for fast landlord-side queries
    requested_slots     JSONB,                            -- tenant's proposed time windows
    status              VARCHAR(20) NOT NULL DEFAULT 'pending',
                        -- 'pending' | 'accepted' | 'declined' | 'rescheduled' | 'expired' | 'completed'
    confirmed_slot       TIMESTAMPTZ,
    landlord_note        TEXT,
    expires_at            TIMESTAMPTZ NOT NULL,            -- auto-expire window (e.g. +48h)
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_visit_landlord_status ON visit_requests(landlord_id, status);
CREATE INDEX idx_visit_expiry ON visit_requests(expires_at) WHERE status = 'pending';

-- Not in the original DDL above — added 2026-09-18 after demo feedback: a
-- lighter-weight "I'm interested" signal than requesting a visit (no
-- scheduling), letting the landlord create a tenancy for an interested
-- tenant with one click instead of pasting their user id into the
-- existing POST /tenancies form (both paths coexist). Lives alongside
-- visit_requests in this same module for the same reasons that table
-- does: a tenant-initiated, unit-scoped signal ahead of a tenancy
-- existing, with the same denormalized landlord_id for inbox queries.
CREATE TABLE unit_interests (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id             UUID NOT NULL,                   -- references units.id
    tenant_id           UUID NOT NULL,                   -- references users.id
    landlord_id         UUID NOT NULL,                   -- denormalized for fast landlord-side queries
    status              VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending' | 'converted'
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (unit_id, tenant_id) -- one open interest per tenant per unit; re-expressing is idempotent
);
CREATE INDEX idx_unit_interest_landlord_status ON unit_interests(landlord_id, status);
```

`units.quantity` from the demo request that prompted the table above is deliberately **not** a
column anywhere — "add 50 units at once" is a `POST /properties/{id}/units` request-time
convenience (`quantity` in the request body, see api-specification.md Section 4) that creates
that many ordinary, independent `units` rows; there's nothing to persist beyond the rows
themselves.

**Key endpoints**
| Method | Path | Purpose |
|---|---|---|
| POST | `/units/{id}/visit-requests` | Tenant requests a visit |
| PATCH | `/visit-requests/{id}/respond` | Landlord accepts/declines/reschedules |
| GET | `/landlords/me/visit-requests?status=pending` | Landlord inbox |

**Events published:** `visit_request.created`, `visit_request.responded`, `visit_request.expired`, `unit_interest.created` (added 2026-09-18)
**Events consumed:** `tenancy.created` (added 2026-09-18, → mark a matching `unit_interests` row `converted`)

---

### B.4 Tenancy & Occupancy Module

**Responsibility:** the spine entity linking landlord, tenant, and unit; termination-notice workflow.

```sql
CREATE TABLE tenancies (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id                UUID NOT NULL,                -- references units.id
    tenant_id              UUID NOT NULL,                -- references users.id
    landlord_id             UUID NOT NULL,                -- references users.id
    start_date               DATE NOT NULL,
    rent_amount               NUMERIC(12,0) NOT NULL,
    currency                  CHAR(3) NOT NULL DEFAULT 'XAF',
    billing_cycle              VARCHAR(20) NOT NULL DEFAULT 'monthly',
    notice_period_days         INT NOT NULL DEFAULT 90,   -- statutory floor enforced at application layer,
                                                            -- not just DB default — see business rule below
    max_advance_months         SMALLINT NOT NULL DEFAULT 3, -- landlord-configurable cap on advance payment
    paid_through_date            DATE,                     -- denormalized: last day currently covered by
                                                              -- confirmed payments. Updated ONLY by the Payments
                                                              -- module's `payment.confirmed` event handler — never
                                                              -- written directly by this module. This is what the
                                                              -- rent-expiry reminder scheduler (Section B.7) scans.
    reminder_first_days_before    SMALLINT NOT NULL DEFAULT 30, -- "1 month" default per product requirement
    reminder_second_days_before   SMALLINT NOT NULL DEFAULT 14, -- "2 weeks" default per product requirement
    status                     VARCHAR(20) NOT NULL DEFAULT 'active',
                                -- 'active' | 'notice_given' | 'terminated' | 'expired'
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tenancies_landlord ON tenancies(landlord_id, status);
CREATE INDEX idx_tenancies_tenant ON tenancies(tenant_id, status);
CREATE INDEX idx_tenancies_paid_through ON tenancies(paid_through_date) WHERE status = 'active';
  -- supports the daily rent-expiry-reminder scan (Section B.7) without a full table scan

CREATE TABLE termination_notices (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenancy_id              UUID NOT NULL REFERENCES tenancies(id),
    issued_by                UUID NOT NULL,               -- references users.id (must be the landlord)
    reason                    VARCHAR(30),                 -- 'non_payment' | 'end_of_term' | 'other'
    reason_detail              TEXT,
    issued_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_date              DATE NOT NULL,             -- must be >= issued_at + tenancy.notice_period_days,
                                                              -- enforced in application logic
    document_url                TEXT,                       -- generated notice PDF, R2 pointer
    delivery_channel             VARCHAR(20),                -- 'sms' | 'app' | 'both'
    delivery_confirmed_at         TIMESTAMPTZ,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Critical business rule (application layer, not just schema):**
`effective_date` on a `termination_notices` row **must** be at least `tenancy.notice_period_days` days after `issued_at`. The API rejects any attempt to set it earlier — this is the direct implementation of the "platform enforces the statutory notice floor" principle from the architecture document. Similarly, once `status = 'notice_given'`, the Payments module (which subscribes to this module's events) rejects any rent payment covering a period beyond `effective_date`, and rejects any advance payment beyond `max_advance_months` regardless of tenancy status.

**Key endpoints**
| Method | Path | Purpose |
|---|---|---|
| POST | `/tenancies` | Create tenancy (typically after a visit → agreement) |
| GET | `/landlords/me/tenancies` | Occupancy dashboard data |
| GET | `/tenancies/{id}` | Full tenancy detail incl. payment status (aggregated from Payments module) |
| POST | `/tenancies/{id}/termination-notices` | Landlord issues notice; validates statutory floor |
| GET | `/tenancies/{id}/termination-notices` | History of notices on this tenancy |

**Events published:** `tenancy.created`, `tenancy.notice_given`, `tenancy.terminated`
**Events consumed:** `contract.signed` (→ activate tenancy), `payment.confirmed` (→ recompute and store `paid_through_date` as `MAX(period_end)` across confirmed payments for that tenancy). Note this field is a **derived cache, not a second source of truth** — the Payments ledger remains authoritative for balance/history; `paid_through_date` exists purely so the reminder scheduler can run a cheap indexed date-range query instead of aggregating the ledger for every active tenancy on every scheduler run.

---

### B.5 Payments & Ledger Module

**Responsibility:** the financial system of record. This is the module to be most conservative and rigorous with.

```sql
CREATE TABLE payments (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenancy_id                UUID NOT NULL,              -- references tenancies.id
    tenant_id                  UUID NOT NULL,
    amount                       NUMERIC(12,0) NOT NULL,
    currency                     CHAR(3) NOT NULL DEFAULT 'XAF',
    period_start                  DATE NOT NULL,           -- rent period this payment covers
    period_end                     DATE NOT NULL,
    provider                        VARCHAR(20) NOT NULL,   -- 'campay' | 'monetbil' | 'offline' ('offline' added 2026-09-20: rent the landlord records as already received, e.g. cash paid upfront at tenancy creation — written only by the Payments module, never accepted from a client request)
    provider_txn_ref                 VARCHAR(100),           -- external transaction id
    idempotency_key                    VARCHAR(100) NOT NULL UNIQUE, -- client-generated, prevents double-charge
    status                              VARCHAR(20) NOT NULL DEFAULT 'pending',
                                        -- 'pending' | 'confirmed' | 'failed' | 'reconciling'
    initiated_at                         TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at                          TIMESTAMPTZ,
    failure_reason                         TEXT,
    receipt_url                             TEXT           -- generated PDF, R2 pointer
);
CREATE UNIQUE INDEX idx_payments_idempotency ON payments(idempotency_key);
CREATE INDEX idx_payments_tenancy ON payments(tenancy_id, status);
CREATE INDEX idx_payments_pending_recon ON payments(status, initiated_at) WHERE status = 'pending';

-- Append-only. No UPDATE/DELETE in application code — corrections are new offsetting rows.
CREATE TABLE ledger_entries (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenancy_id                UUID NOT NULL,
    payment_id                 UUID REFERENCES payments(id),
    entry_type                   VARCHAR(10) NOT NULL,      -- 'debit' | 'credit'
    amount                        NUMERIC(12,0) NOT NULL,
    running_balance                NUMERIC(12,0) NOT NULL,   -- balance after this entry, for fast reads
    description                     TEXT,
    created_at                       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ledger_tenancy_time ON ledger_entries(tenancy_id, created_at);

CREATE TABLE payment_webhooks_raw (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider                  VARCHAR(20) NOT NULL,
    payload                     JSONB NOT NULL,             -- full raw payload, kept for audit/dispute resolution
    signature_verified           BOOLEAN NOT NULL,
    received_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at                    TIMESTAMPTZ
);
```

**Reconciliation job logic (runs every few minutes):**
```
SELECT * FROM payments
WHERE status = 'pending' AND initiated_at < now() - interval '5 minutes'
→ for each: poll provider's transaction-status endpoint directly
→ if confirmed: write ledger_entries row, update payment.status, emit payment.confirmed
→ if failed: update payment.status = 'failed', emit payment.failed
→ if still pending after N retries over a defined window: flag for manual admin review
```

**Key endpoints**
| Method | Path | Purpose |
|---|---|---|
| POST | `/tenancies/{id}/payments` | Tenant initiates a rent payment (validates against notice/advance-month rules first) |
| POST | `/webhooks/payments/{provider}` | Aggregator webhook receiver — verifies signature, writes raw payload, triggers processing |
| GET | `/tenancies/{id}/ledger` | Full payment history / running balance |
| GET | `/payments/{id}/receipt` | Download receipt PDF |
| GET | `/admin/payments?status=pending` | Ops dashboard for stuck/disputed payments |

**Events published:** `payment.initiated`, `payment.confirmed`, `payment.failed`
**Events consumed:** `tenancy.notice_given` (→ enforce payment cutoff at `effective_date`), `tenancy.created` (→ enforce `max_advance_months` cap)

---

### B.6 Contract Generation & e-Signature Module

```sql
CREATE TABLE contracts (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenancy_id             UUID NOT NULL,
    template_version         VARCHAR(20) NOT NULL,        -- track which contract template was used
    locale                     VARCHAR(5) NOT NULL,        -- 'fr' | 'en'
    document_url                 TEXT NOT NULL,            -- generated PDF, R2 pointer
    status                        VARCHAR(20) NOT NULL DEFAULT 'draft',
                                  -- 'draft' | 'pending_signatures' | 'fully_signed' | 'voided'
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contract_signatures (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id             UUID NOT NULL REFERENCES contracts(id),
    signer_id                 UUID NOT NULL,               -- references users.id
    signer_role                 VARCHAR(20) NOT NULL,       -- 'landlord' | 'tenant'
    signed_at                     TIMESTAMPTZ,
    otp_verification_id             UUID,                   -- links to the OTP challenge used to confirm identity
    ip_address                       INET,
    device_fingerprint                 TEXT,
    audit_trail                          JSONB               -- full record: timestamps, hashes, method — for evidentiary purposes
);
```

**Key endpoints**
| Method | Path | Purpose |
|---|---|---|
| POST | `/tenancies/{id}/contracts` | Generate contract from template + tenancy data |
| POST | `/contracts/{id}/sign` | Signer confirms (OTP re-verification required) |
| GET | `/contracts/{id}` | Fetch document + signature status |

**Events published:** `contract.generated`, `contract.signed` (once both parties have signed)
**Events consumed:** `tenancy.created`

*(As flagged in the first document: whether this module needs "basic" or "advanced"-tier e-signature integration per Cameroonian cybersecurity law is a decision to confirm with legal counsel before launch — the schema above supports either, since `audit_trail` is a flexible JSONB field.)*

---

### B.7 Notification Engine Module

```sql
CREATE TABLE notification_templates (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type              VARCHAR(50) NOT NULL,          -- e.g. 'rent_due_reminder', 'visit_confirmed'
    locale                     VARCHAR(5) NOT NULL,
    channel                      VARCHAR(10) NOT NULL,      -- 'sms' | 'push'
    body_template                  TEXT NOT NULL,
    UNIQUE(event_type, locale, channel)
);

CREATE TABLE notifications (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  UUID NOT NULL,
    event_type                 VARCHAR(50) NOT NULL,
    channel                      VARCHAR(10) NOT NULL,
    payload                        JSONB,
    status                          VARCHAR(20) NOT NULL DEFAULT 'queued',
                                    -- 'queued' | 'sent' | 'delivered' | 'failed'
    provider_message_id              VARCHAR(100),
    scheduled_for                      TIMESTAMPTZ,          -- for future-dated reminders
    sent_at                              TIMESTAMPTZ,
    created_at                            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_scheduled ON notifications(scheduled_for) WHERE status = 'queued';

CREATE TABLE notification_preferences (
    user_id                UUID PRIMARY KEY,
    rent_reminder_days_before  SMALLINT NOT NULL DEFAULT 14,  -- your "2 weeks / 1 month" default, per-landlord configurable
    push_enabled                 BOOLEAN NOT NULL DEFAULT true,
    sms_enabled                    BOOLEAN NOT NULL DEFAULT true  -- SMS default-on for critical events regardless
);
```

**Key endpoints**
| Method | Path | Purpose |
|---|---|---|
| GET | `/users/me/notifications` | In-app notification list |
| PATCH | `/users/me/notification-preferences` | Adjust reminder timing (2wk/1mo/custom) |
| POST | `/internal/notifications/dispatch` | Internal-only: called by other modules' event handlers |

**Events published:** `notification.sent`, `notification.failed`
**Events consumed:** *(subscribes to nearly everything)* `visit_request.created`, `visit_request.responded`, `unit_interest.created` (added 2026-09-18), `tenancy.notice_given`, `payment.confirmed`, `payment.failed`, `contract.generated`, plus its own scheduled-job triggers for rent-expiry reminders

> **Note:** the schema above (`notification_templates`, `notifications`, `notification_preferences`) is the single-channel version from initial design. It is **superseded** by the multi-channel schema in `notification-module-multichannel.md` (adds `whatsapp`/`email` channels, per-channel opt-in via `notification_channels`, and cost tracking) — that document is the current source of truth for this module's data model. It's kept here only so the scheduled-job logic below has full context inline.

**Rent-expiry reminder scheduler — concrete logic** (this is the job that actually implements the "notify tenant and landlord when rent is about to expire" requirement end to end; runs once daily, e.g. 07:00 local time so reminders land at a reasonable hour):

```
DAILY JOB: rent_expiry_reminder_scan

  candidates = SELECT id, tenant_id, landlord_id, unit_id, paid_through_date,
                      reminder_first_days_before, reminder_second_days_before
               FROM tenancies
               WHERE status = 'active'
                 AND paid_through_date IS NOT NULL
                 AND paid_through_date >= CURRENT_DATE   -- not already overdue, see overdue branch below
                 AND paid_through_date <= CURRENT_DATE + GREATEST(reminder_first_days_before,
                                                                    reminder_second_days_before)
               -- uses idx_tenancies_paid_through, cheap even at scale

  for each tenancy in candidates:
      days_remaining = tenancy.paid_through_date - CURRENT_DATE

      if days_remaining == tenancy.reminder_first_days_before
           AND NOT already_sent(tenancy.id, 'rent_expiry_first_reminder', today):
          emit event: rent_expiry.first_reminder_due
              → Notification module fans out to BOTH tenant_id and landlord_id
                (per US-8.2 — this is not optional, both parties get it)

      if days_remaining == tenancy.reminder_second_days_before
           AND NOT already_sent(tenancy.id, 'rent_expiry_second_reminder', today):
          emit event: rent_expiry.second_reminder_due
              → fans out to both parties, higher-urgency template wording

      if days_remaining == 0
           AND NOT already_sent(tenancy.id, 'rent_expiry_due_today', today):
          emit event: rent_expiry.due_today
              → fans out to both parties

  -- separate branch, same job run, catches the day after expiry:
  overdue_candidates = SELECT id, tenant_id, landlord_id
                        FROM tenancies
                        WHERE status = 'active'
                          AND paid_through_date = CURRENT_DATE - INTERVAL '1 day'

  for each tenancy in overdue_candidates:
      emit event: rent_expiry.overdue
          → fans out to both parties (US-8.3) — informational only,
            does NOT auto-create a termination_notices row; that remains
            a manual landlord action via POST /tenancies/{id}/termination-notices
```

The `already_sent(...)` guard is a simple existence check against the `notifications` table (`event_type` + `tenancy_id` in payload + date), not a separate table — it's what makes the job safely re-runnable/idempotent if it's retried after a partial failure, which matters once this is running as an unattended daily Cloud Run job rather than something a human triggers.

---

### B.8 Complaints & Maintenance Module

```sql
CREATE TABLE complaints (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenancy_id              UUID NOT NULL,
    unit_id                   UUID NOT NULL,               -- denormalized for landlord's per-unit aggregate view
    tenant_id                   UUID NOT NULL,
    landlord_id                   UUID NOT NULL,
    category                        VARCHAR(30) NOT NULL,   -- 'plumbing' | 'electrical' | 'security' | 'noise' | 'other'
    description                       TEXT NOT NULL,
    status                              VARCHAR(20) NOT NULL DEFAULT 'open',
                                        -- 'open' | 'acknowledged' | 'in_progress' | 'resolved' | 'closed'
    created_at                            TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at                         TIMESTAMPTZ,
    resolved_at                               TIMESTAMPTZ
);
CREATE INDEX idx_complaints_landlord ON complaints(landlord_id, status);
CREATE INDEX idx_complaints_unit ON complaints(unit_id);

CREATE TABLE complaint_media (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id             UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    storage_url                 TEXT NOT NULL,
    media_type                    VARCHAR(10) NOT NULL,     -- 'photo' | 'video'
    uploaded_at                     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE complaint_updates (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id             UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    author_id                  UUID NOT NULL,
    note                         TEXT,
    new_status                     VARCHAR(20),
    created_at                       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Key endpoints**
| Method | Path | Purpose |
|---|---|---|
| POST | `/tenancies/{id}/complaints` | Tenant submits complaint |
| GET | `/landlords/me/complaints?unit_id=&status=` | Landlord aggregate view |
| PATCH | `/complaints/{id}/status` | Landlord updates status + note |

**Events published:** `complaint.created`, `complaint.status_changed`
**Events consumed:** none

---

### B.9 Admin / Ops Module

Built 2026-09-24. Mostly a read/action layer over other modules rather than owning much independent data — but does own:

```sql
CREATE TABLE admin_actions_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id    UUID NOT NULL,               -- references users.id — no FK: an audit row outlives account changes
    action_type VARCHAR(50) NOT NULL,        -- 'kyc_approved' | 'listing_flagged' | 'listing_unflagged' | 'listing_removed'
    target_type VARCHAR(30) NOT NULL,        -- 'user' | 'unit'
    target_id   UUID NOT NULL,
    detail      JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_actions_target ON admin_actions_log(target_type, target_id, created_at);
CREATE INDEX idx_admin_actions_admin ON admin_actions_log(admin_id, created_at);
CREATE INDEX idx_admin_actions_created ON admin_actions_log(created_at);
```

Every admin action that touches another module's data goes through that module's own API (e.g., KYC approval calls the Auth module's endpoint) — this log is purely an audit trail, not a bypass mechanism, keeping the module data-ownership rule intact even for privileged operations. Two ways a row gets written, both ending up here: (1) this module's own endpoints (listing flag/unflag/remove) call `UnitsService`'s public methods, then log directly, in that order — not a single transaction, since the log table and the units table belong to different modules (see the disclosed risk note in `admin.service.ts`); (2) an existing action on *another* module's own endpoint (Auth's `POST /admin/users/{id}/kyc/approve`) is observed via an `@OnEvent` listener on `user.kyc_tier_changed` instead of Auth calling into Admin directly — keeps the dependency one-directional (Admin → Auth/Properties/Payments, never back), so no `forwardRef` is needed here unlike Tenancies↔Payments/Contracts.

Listing moderation reuses B.2's `units` table rather than a table of its own — three added columns (`flagged_at`, `flag_reason`, `flagged_by`), landlord-invisible-by-design (not on `PATCH /units/{id}`'s DTO) and cleared again on unflag/remove:
```sql
ALTER TABLE units
    ADD COLUMN flagged_at  TIMESTAMPTZ,
    ADD COLUMN flag_reason TEXT,
    ADD COLUMN flagged_by  UUID;          -- references users.id, the admin who flagged it
CREATE INDEX idx_units_flagged ON units(flagged_at);
```
A flagged unit is excluded from `GET /units` and `GET /units/{id}` regardless of `status` — that's the actual effect of flagging, not just a queue entry. There is no tenant/public "report a listing" flow feeding this queue in this MVP; flags are entirely admin-initiated (see api-specification.md Section 11).

**Key endpoints**
| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/kyc-queue` | Pending verification requests |
| GET | `/admin/listings/flagged` | Moderation queue |
| POST | `/admin/listings/{id}/flag` | Flag a unit (removes it from public listings) |
| POST | `/admin/listings/{id}/unflag` | Dismiss a flag |
| POST | `/admin/listings/{id}/remove` | Take a listing down for good (back to `draft`) |
| GET | `/admin/payments/disputes` | Payments needing manual review |
| GET | `/admin/audit-log` | Full admin action history |

---

## Cross-cutting note on the event bus

For the monolith phase, the "event bus" referenced throughout (`publishes`/`consumes`) can literally be an in-process pub/sub (e.g., a simple event emitter, or Postgres `LISTEN/NOTIFY` for durability across process restarts) — no need to stand up Pub/Sub or a message broker yet. The **contract** (event names, payload shapes) is what needs to be stable from day one; the transport underneath it is exactly the kind of thing that's cheap to swap later (in-process → Redis Streams → Google Pub/Sub, as volume justifies) precisely because you designed the module boundaries around events rather than direct cross-module function calls.
