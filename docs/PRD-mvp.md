# Product Requirements Document (PRD)
## Rental Platform — MVP Scope
**Version 1.0 | Cameroon Pilot Phase**

---

## 1. Product Vision

A trust-first digital platform connecting landlords and tenants in Cameroon, replacing the current WhatsApp/paper/cash-based rental workflow with verified listings, mobile-money rent collection, auditable payment records, and legally-grounded contract and notice generation — starting with a pilot cohort of landlords who have already expressed interest, expanding to broader Cameroonian and eventually pan-African adoption once the model is proven.

**Problem statement** (grounded in the market research from earlier in this project):
- Cameroon has a housing deficit of over 2.5 million units and a fast-urbanizing population, yet rental transactions remain largely informal, opaque, and vulnerable to fraud — fake listings and disappearing deposits are a named, common problem in this market.
- Landlords currently track occupancy, payment history, and tenant communication manually (WhatsApp, notebooks, memory), making disputes hard to resolve and multi-property management genuinely difficult.
- Tenants have no standard, trusted way to verify a listing or a landlord before handing over cash, and no digital record of what they've paid.

**Product thesis:** solving trust (verification, auditable records) and friction (mobile-money payment, generated contracts) simultaneously is what makes this different from a pure listings site (Jumia House/Lamudi) and gives it a real shot at the rent-collection value regional peers (Spleet, Shelta in Nigeria) have already validated.

---

## 2. Goals & Success Metrics (MVP phase)

| Goal | Metric | Target for pilot phase |
|---|---|---|
| Landlords actually use it, not just onboard | % of pilot landlords' units listed on-platform | >80% of units across the pilot cohort |
| Real payment behavior shifts on-platform | % of monthly rent (by pilot cohort) paid through the platform vs. reported as paid off-platform | Track from 0 — first target is simply a non-zero, growing trend |
| Landlords engage, not just sign up | Median time from visit request to landlord response | <24 hours |
| Payment reliability is real, not just theoretical | Payment failure/retry rate on the aggregator integration | Establish baseline; investigate anything >10% |
| Support burden is understood | Number of manual/support interventions per successful transaction | Track from day one — informs whether flows are actually self-serve |

These intentionally aren't growth-stage metrics (user counts, revenue) — at MVP stage with a known small landlord cohort, the question is behavioral validation, not scale.

---

## 3. Personas

**Landlord (primary)**
Owns 1–20+ rental units in Douala/Yaoundé (or elsewhere in Cameroon). Currently manages tenants via WhatsApp/phone calls, collects rent in cash or via personal mobile money, and has no systematic record of payment history across units. Bilingual (French primary, some English) or English-primary depending on region. Moderate smartphone literacy; may have data-cost sensitivity.

**Tenant (primary)**
Renting an apartment/house, currently finds housing via word-of-mouth, informal agents, or general listing sites. Pays rent in cash or informal mobile money transfer with no formal receipt. Wants to avoid fraud (fake listings, disappearing "agents") and wants proof of payment for disputes.

**Admin/Support (internal)**
Platform operator staff verifying landlord/property documents, resolving payment disputes, moderating listings. Small team at MVP stage — likely the founder(s) directly.

---

## 4. MVP Scope

### 4.1 In scope

1. Phone-based account creation and login (landlord + tenant, same app, role-based views)
2. Property and unit listing with geo-tagged photos
3. Visit request workflow (tenant requests, landlord accepts/declines/reschedules)
4. Occupancy dashboard (landlord view: which unit, which tenant, contract dates, balance)
5. Rent payment via mobile money (MTN MoMo + Orange Money, via CamPay or Monetbil)
6. Append-only payment ledger with auto-generated receipts
7. Rent-expiry reminders (2 weeks / 1 month default, configurable)
8. Bilingual (FR/EN) tenancy contract generation with basic e-signature
9. Termination notice workflow, enforcing statutory minimum notice period as a floor
10. Complaints submission (tenant) and aggregate view (landlord)
11. Admin console: KYC/ownership verification queue, payment dispute lookup, listing moderation
12. Multi-channel notifications: SMS (default-on for critical events) + WhatsApp + Push + In-app; Email for landlord statements

### 4.2 Explicitly out of scope for MVP

- Public SEO-optimized discovery site (pilot is relationship-led, not organic-discovery-led)
- In-app chat/messaging beyond the structured visit-request flow
- Tenant credit-scoring or rent-financing products
- Multi-currency/international payments
- Maintenance-vendor marketplace (complaint tracking only, not dispatch)
- USSD fallback channel (build once real usage patterns from the pilot are observed)
- Direct (non-aggregator) MTN/Orange API integration

### 4.3 Explicit dependencies / blockers to resolve before launch

These were flagged during architecture design and are **release blockers**, not nice-to-haves:
1. Legal review of the termination/notice workflow (exact statutory notice periods by region/lease type) — needed before the termination feature can go live with real tenancies.
2. Confirmation with a CEMAC/BEAC-aware advisor that the pass-through (non-custodial) payment model avoids e-money-institution licensing requirements.
3. Decision on basic vs. advanced-tier e-signature, per Cameroonian cybersecurity law, with counsel.
4. Confirmed aggregator choice (CamPay vs. Monetbil) after sandbox testing both.

---

## 5. Functional Requirements — User Stories & Acceptance Criteria

### Epic 1: Identity & Onboarding

**US-1.1** — *As a new user, I want to sign up with just my phone number, so that I don't need email or a complex registration process.*
- AC1: User enters phone number in E.164-compatible format; system sends OTP via SMS within 30 seconds under normal conditions.
- AC2: OTP is valid for 5 minutes and single-use; 3 failed attempts locks the challenge and requires a new OTP request.
- AC3: On successful verification, a user record is created with `kyc_tier = unverified` and the user can access basic browsing but not listing/paying actions.

**US-1.2** — *As a landlord, I want to verify my identity and property ownership, so that tenants trust my listings.*
- AC1: Landlord can upload a national ID/CNI and a property ownership document (title/land certificate reference) per property.
- AC2: Documents are stored encrypted and visible only to the user and admin reviewers.
- AC3: An admin reviews and approves/rejects within a defined SLA (target: 48 hours during pilot); rejection includes a reason.
- AC4: Approval advances `kyc_tier` to `ownership_verified` and unlocks publishing listings for that property.

**US-1.3** — *As a tenant, I want to see whether a landlord is verified, so that I can avoid scams.*
- AC1: A "Verified Landlord" badge is visibly displayed on any listing where the associated property has `ownership_verified_at` set.
- AC2: Unverified listings are visually distinguishable (not hidden, but clearly marked) — supports pilot-stage landlords still mid-verification without blocking them entirely.

### Epic 2: Listings

**US-2.1** — *As a landlord, I want to list a property with multiple units, so that I can manage an apartment block from one place.*
- AC1: A property can have 1..N units, each with independent rent amount, bedroom count, and status.
- AC2: Each unit requires at least one photo before it can be published (status moves from draft to `vacant`).

**US-2.2** — *As a landlord, I want photos to be geo-tagged automatically, so that fraudulent re-use of my photos elsewhere is discouraged and my listing is more credible.*
- AC1: Photo capture within the app records latitude/longitude and timestamp alongside the image.
- AC2: Geo-metadata is stored but not displayed publicly (privacy) — used for internal fraud review only.

**US-2.3** — *As a tenant, I want to search available units by city and price range, so that I can find housing that fits my budget.*
- AC1: Search supports filtering by city, price range, bedroom count, and status = `vacant`.
- AC2: Results load acceptably on a throttled 3G connection (performance NFR, see Section 6).

### Epic 3: Visits

**US-3.1** — *As a tenant, I want to request a visit to a unit, so that I can see it in person before committing.*
- AC1: Tenant proposes one or more time windows; landlord is notified per the multi-channel routing rules (push → WhatsApp → SMS waterfall for this event).
- AC2: If the landlord doesn't respond within 48 hours, the request auto-expires and the tenant is notified.

**US-3.2** — *As a landlord, I want to accept, decline, or propose an alternate time for a visit request, so that I control my schedule.*
- AC1: All three actions are available from the visit-request notification/inbox.
- AC2: Once accepted, both parties receive a confirmation with the agreed date/time.

### Epic 4: Tenancy & Occupancy

**US-4.1** — *As a landlord, I want a dashboard showing which unit is occupied by whom and their payment status, so that I don't have to track this manually.*
- AC1: Dashboard lists every unit across the landlord's properties with current status (vacant/occupied/notice given), tenant name (if occupied), and current ledger balance.
- AC2: Data reflects the append-only ledger as source of truth — no manually-editable "paid" checkbox that could diverge from actual transaction records.

**US-4.2** — *As a landlord, I want to issue a termination notice with a legally-adequate lead time, so that I comply with Cameroonian tenancy law.*
- AC1: The system enforces a minimum `notice_period_days` (statutory default, region-aware) that cannot be reduced through the UI.
- AC2: On issuing notice, a formal bilingual notice document is generated and delivered via the fan-out notification pattern (SMS + WhatsApp + Email + Push + In-app).
- AC3: Delivery is logged with timestamp for evidentiary purposes.

**US-4.3** — *As a tenant, I should not be able to pay rent beyond my termination effective date or beyond my landlord's configured advance-months cap, so that the platform enforces the agreed boundaries automatically.*
- AC1: Payment initiation is validated server-side against both constraints before any charge request reaches the payment aggregator.
- AC2: A clear, non-technical error message explains why the payment was blocked (not a generic failure).

### Epic 5: Payments

**US-5.1** — *As a tenant, I want to pay my rent via MTN Mobile Money or Orange Money directly in the app, so that I don't need to visit an agent or hand over cash.*
- AC1: Tenant selects provider, confirms amount/period, and completes the mobile-money PIN confirmation on their own device.
- AC2: On confirmation, a ledger entry is written and a receipt is generated within an acceptable delay (target: under 60 seconds under normal network conditions).
- AC3: If the webhook confirmation doesn't arrive within a defined window, the reconciliation job polls the provider directly rather than leaving the payment stuck as ambiguous.

**US-5.2** — *As a landlord, I want an accurate, tamper-evident payment history per tenancy, so that I have proof in any dispute.*
- AC1: Ledger entries are append-only; corrections are new offsetting entries, never edits or deletes.
- AC2: Full ledger and receipts are exportable/viewable per tenancy.

**US-5.3** — *As a tenant, I want a receipt after every payment, so that I have proof independent of the app.*
- AC1: Receipt is generated as a document and delivered via at least SMS confirmation and WhatsApp (if opted in), not solely visible in-app.

### Epic 6: Contracts

**US-6.1** — *As a landlord and tenant, we want a proper tenancy contract generated automatically from our agreed terms, so that we don't need a separate lawyer-drafted document for a standard lease.*
- AC1: Contract is generated in the user's selected locale (FR/EN) from tenancy data.
- AC2: Both parties sign via OTP-verified e-signature; an audit trail (timestamp, IP, device) is stored.
- AC3: Signed contract is downloadable/re-accessible by both parties at any time.

### Epic 7: Complaints

**US-7.1** — *As a tenant, I want to report a maintenance issue with photos, so that my landlord has clear information to act on.*
- AC1: Complaint requires a category and description; photo/video attachment is optional but supported.
- AC2: Landlord is notified per the routing rules; tenant sees status updates (open/acknowledged/in progress/resolved).

**US-7.2** — *As a landlord managing multiple units, I want to see complaint patterns per unit, so that I can spot recurring problems.*
- AC1: Landlord's complaint view can be filtered/grouped by unit and by category.

### Epic 8: Notifications

**US-8.1** — *As a tenant, I want to be reminded before my paid-up period runs out, so that I don't fall into arrears by accident.*
- AC1: "Rent about to expire" is defined precisely as: the tenancy's `paid_through_date` (the last day currently covered by confirmed payments) is within the configured reminder window.
- AC2: Default reminder window is **1 month before** `paid_through_date`, with a second, more urgent reminder at **2 weeks before**, and a final reminder on the day itself if still unpaid — this matches the original product requirement ("2 weeks, or 1 month as default") interpreted as two staged reminders, not a single either/or setting.
- AC3: Reminder timing is landlord-configurable per property (a landlord managing student housing might want a longer runway than one managing month-to-month units).
- AC4: Reminder is delivered per the fan-out pattern (SMS + WhatsApp + Push + In-app) — this is a "don't want to risk someone missing it" event, not a waterfall/cost-optimized one.

**US-8.2** — *As a landlord, I want to be notified on the same schedule as my tenant when a unit's paid-up period is about to expire, so that I can follow up myself if needed and am never caught off guard by a lapse.*
- AC1: Every reminder fired under US-8.1 is sent to **both** the tenant and the landlord of that tenancy, not just the tenant — this was explicit in the original product requirement and is treated as a hard requirement, not a default that only applies to one side.
- AC2: The landlord's version of the reminder includes the tenant's name/unit so it's actionable without needing to look anything up.
- AC3: If `paid_through_date` passes with no new payment, the landlord additionally receives an "overdue" notification distinct from the pre-expiry reminders (see US-8.3).

**US-8.3** — *As a landlord, I want to know as soon as a unit becomes overdue, so that I can decide whether to follow up personally or move toward a formal notice.*
- AC1: The day after `paid_through_date` passes with no confirmed payment covering the next period, both parties receive an "overdue" notification (distinct in tone/urgency from the pre-expiry reminders).
- AC2: This is purely informational at this stage — it does **not** automatically trigger a termination notice (Epic 4); the landlord decides separately whether/when to issue one.

---

## 6. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Performance** | Core screens (listings search, occupancy dashboard, payment flow) must remain usable on throttled 3G — client-side image compression and lazy loading are mandatory, not optional polish. |
| **Offline resilience** | Landlord occupancy view and last-known payment status must be viewable with no live connection (cached); writes queue and sync on reconnect. |
| **Localization** | Full bilingual FR/EN support across UI, notifications, and generated documents — not just UI chrome, but contract and notice text specifically. |
| **Security** | ID/ownership documents encrypted at rest; payment webhook endpoints verify provider signatures; OTP endpoints rate-limited against toll-fraud abuse. |
| **Data protection compliance** | Consent capture, data minimization, and breach-notification readiness per Cameroon's Personal Data Protection Law (No. 2024/017), in force since June 2026. |
| **Auditability** | Payment ledger and termination-notice delivery must be provably accurate and timestamped — this is a legal/evidentiary requirement, not just good practice, given how Cameroonian tenancy disputes are adjudicated (see legal research: eviction claims have been dismissed for lack of proof of payment records). |
| **Availability** | Target 99.5% uptime for the payment and core tenancy flows during pilot (lower bar than production-scale SLA, but payment flows specifically should not have unannounced downtime). |

---

## 7. Release Criteria (Definition of Done for MVP launch)

The MVP is ready to launch to the pilot cohort when:
- [ ] All Epic 1–8 user stories above pass acceptance criteria in staging with the payment aggregator in sandbox mode
- [ ] At least one full end-to-end real-money transaction has been completed successfully in production with a test account
- [ ] Legal review of the termination/notice workflow is complete and any required changes implemented
- [ ] Payment licensing question (Section 4.3, blocker #2) is resolved
- [ ] Bilingual contract and notice templates are reviewed by a native speaker in both languages for legal and tonal accuracy
- [ ] Reconciliation job has been tested against simulated webhook failure/delay scenarios
- [ ] Each pilot landlord has completed onboarding (KYC + at least one property listed) before their tenants are invited

---

## 8. Open Questions

1. Final commission/fee structure — needs direct conversation with pilot landlords rather than assumption (flagged in earlier architecture discussion).
2. Whether "advanced" e-signature tier is required, pending legal counsel input.
3. Final choice between CamPay and Monetbil as payment aggregator, pending sandbox comparison.
4. Statutory notice-period defaults per region (Anglophone vs. Francophone, ordinary vs. AUDCG-applicable leases) — needs lawyer confirmation before Epic 4's enforcement logic is finalized.
