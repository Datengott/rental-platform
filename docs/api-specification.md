# REST API Specification
## Rental Platform — v1
Consolidates the per-module endpoint tables from the architecture documents into a single formal contract. This is what a developer implements against directly.

---

## 1. Conventions

- **Base URL:** `https://api.{domain}/v1`
- **Format:** JSON request/response bodies; `Content-Type: application/json` except file uploads (`multipart/form-data`)
- **Auth:** Bearer token (`Authorization: Bearer {access_token}`), issued via the OTP flow (Section 3). Access tokens are short-lived (target: 1 hour); refresh via `/auth/refresh`.
- **Versioning:** URL-path versioned (`/v1/...`). Breaking changes get a new version prefix; non-breaking additions (new optional fields, new endpoints) don't require a version bump.
- **Pagination:** cursor-based on list endpoints — `?cursor={opaque_cursor}&limit={n}` (default `limit=20`, max `100`). Response includes `next_cursor` (null when no more pages).
- **Idempotency:** any endpoint that initiates a financial transaction or side-effect requiring exactly-once semantics accepts an `Idempotency-Key` header; the server returns the original response for a repeated key rather than re-executing.
- **Locale:** `Accept-Language: fr | en` header determines the language of any generated content (notification text, contract/notice documents) returned or triggered by that request; defaults to the user's stored `locale` if omitted.

### 1.1 Standard error format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable, locale-aware message",
    "field_errors": [
      { "field": "rent_amount", "message": "must be a positive integer" }
    ]
  }
}
```

Standard HTTP status codes apply: `400` validation, `401` unauthenticated, `403` unauthorized (authenticated but not permitted), `404` not found, `409` conflict (e.g., idempotency key reused with different payload), `422` business-rule rejection (e.g., payment blocked by notice-period rule — see Section 6), `429` rate-limited, `5xx` server error.

---

## 2. Resource overview

| Resource | Owning module |
|---|---|
| `users`, `sessions` | Auth & Identity |
| `properties`, `units`, `unit-photos` | Property & Listings |
| `visit-requests` | Visit Requests |
| `tenancies`, `termination-notices` | Tenancy & Occupancy |
| `payments`, `ledger` | Payments & Ledger |
| `contracts` | Contract Generation |
| `notifications`, `notification-channels`, `notification-preferences` | Notification Engine |
| `complaints` | Complaints & Maintenance |
| `admin/*` | Admin / Ops |

---

## 3. Auth & Identity

### `POST /auth/otp/request`
Request an OTP for login/signup.
```json
// Request
{ "phone_number": "+237670000000", "purpose": "login" }
// Response 200
{ "challenge_id": "uuid", "expires_in_seconds": 300 }
```

### `POST /auth/otp/verify`
```json
// Request
{ "challenge_id": "uuid", "otp": "123456" }
// Response 200
{
  "access_token": "jwt",
  "refresh_token": "opaque",
  "expires_in": 3600,
  "user": { "id": "uuid", "phone_number": "+237670000000", "roles": ["tenant"], "kyc_tier": "unverified" }
}
```
Errors: `400 INVALID_OTP`, `429 TOO_MANY_ATTEMPTS` (per Section 6, NFR on OTP rate-limiting).

### `POST /auth/refresh`
```json
{ "refresh_token": "opaque" } → { "access_token": "jwt", "expires_in": 3600 }
```

### `POST /auth/logout`
Revokes the current session. `204 No Content`.

### `GET /users/me`
```json
{
  "id": "uuid", "full_name": "...", "phone_number": "...", "locale": "fr",
  "roles": ["landlord", "tenant"], "kyc_tier": "ownership_verified"
}
```

### `PATCH /users/me`
Partial update (`full_name`, `locale`).

### `POST /users/me/kyc-documents`
`multipart/form-data`: `document_type`, `document_ref`, `file`. Returns `202 Accepted` (queued for admin review).

### `POST /admin/users/{id}/kyc/approve` *(admin only)*
```json
{ "new_tier": "ownership_verified", "note": "optional" }
```

---

## 4. Property & Listings

### `POST /properties` *(landlord)*
```json
// Request
{ "name": "Résidence Bonapriso", "property_type": "residential", "facilities": ["gated", "generator", "borehole", "security_personnel"],
  "address_line": "...", "city": "Douala", "region": "Littoral", "latitude": 4.05, "longitude": 9.7 }
// Response 201 → property object with id, ownership_verified_at: null
```
`property_type` (`residential`|`commercial`|`mixed_use`) and `facilities` (freeform string tags) are both optional — added 2026-09-18 after live demo feedback; every property created before that date just has them as `null`/`[]`.

### `POST /properties/{id}/units`
```json
{ "label": "Unit 4B", "bedrooms": 2, "bathrooms": 1, "facilities": ["ac", "wifi", "hot_water"], "size_sqm": 65, "rent_amount": 150000, "currency": "XAF", "billing_cycle": "monthly", "description": "..." }
```
Response includes `status: "draft"` until at least one photo is attached (Epic 2, US-2.1 AC2). `facilities` is the same freeform-tags pattern as the property's, added 2026-09-18.

An optional `quantity` (1-100, added 2026-09-18) bulk-creates that many **independent** units in one call — e.g. 50 identical studio units in the same building, instead of submitting this form 50 times. Each created unit gets its own id/status/photos/tenancy lifecycle; `quantity` is a creation-time convenience, not a count stored anywhere. Response shape branches on it: omitted or `1` returns the single unit object shown above (unchanged, so every existing caller keeps working); `quantity > 1` returns `{ "units": [ ...N unit objects... ] }` instead. When a `label` is given alongside `quantity > 1`, each unit's label is auto-numbered (`"Studio #1"`, `"Studio #2"`, ...); omitted, every created unit's `label` is `null`, same as a single unit created without one.

### `POST /units/{id}/photos`
`multipart/form-data`: `file`, `geo_latitude`, `geo_longitude`, `captured_at`. Returns photo object; first successful upload transitions unit `draft → vacant`.

### `GET /units`
Public search (no authentication). Query params: `city`, `region` (both case-insensitive exact match), `property_type`, `min_price`, `max_price`, `bedrooms` (exact), `min_bedrooms` ("N or more"), `status` (defaults to `vacant`), `cursor`, `limit`. `property_type`, `min_bedrooms` and the fields below marked *(added 2026-09-20)* exist because the public landing page is a real listings browser, not just a search endpoint.
```json
{
  "results": [
    { "id": "uuid", "label": "Unit 4B", "description": "...", "bedrooms": 2, "bathrooms": 1, "size_sqm": 78, "facilities": ["ac", "wifi"],
      "rent_amount": 150000, "currency": "XAF", "billing_cycle": "monthly",
      "property": { "name": "Résidence Bonapriso", "city": "Douala", "region": "Littoral", "verified": true, "property_type": "residential", "facilities": ["gated"] },
      "cover_photo_url": "http://localhost:3000/media/unit-photos/<file>.jpg" }
  ],
  "total": 14,
  "next_cursor": null
}
```
`total` is the count of *all* matches for the filters (not just this page). `cover_photo_url` is a browser-loadable URL (see "Media" below), not the internal storage reference.

### `GET /units/{id}` *(public, added 2026-09-20)*
Public detail for one **vacant** unit — what a prospective tenant sees before signing in. Same fields as a search result plus `photos: [{ "id", "url", "sort_order" }]` (all photos, in order) and `created_at`. Deliberately omits the street address and any landlord identity (shared after a visit is confirmed), and returns `404` for a unit that is a draft, reserved, occupied, or doesn't exist, so unlisted units can't be enumerated.

### Media *(added 2026-09-20)*
Listing photos are served as static files at `/media/unit-photos/<file>` (outside the `/v1` prefix), from the dev-only local-disk storage. **Only** that folder is served — KYC documents and complaint media live in sibling folders and are never exposed. The absolute base URL comes from `API_PUBLIC_URL`; a real R2 backend would store https URLs directly and they pass through unchanged.

### `GET /landlords/me/units`
Landlord's own inventory (all statuses) — feeds the occupancy dashboard's unit list.

### `GET /landlords/me/properties` *(landlord, added 2026-09-20)*
Landlord's own properties, newest first — each is the property object plus `unit_count` and `occupied_unit_count` (units with a tenant living in them: status `occupied` or `notice_given`). `GET /landlords/me/units` now also returns `photos: [{ "id", "url", "sort_order" }]`, `size_sqm`, `billing_cycle` and `description` per unit, so an editor has everything it needs.

### `PATCH /properties/{id}` *(landlord, added 2026-09-20)*
Edit any of `name`, `property_type`, `facilities`, `address_line`, `city`, `region`, `latitude`, `longitude`, plus an optional `change_note` (≤300 chars, the reason). Ownership-verification fields are **not** landlord-editable (an admin action). `404` for a property that isn't yours.

**PATCH semantics** (same for units below): a field that is left out is untouched; `null` clears a field that may be empty (`name`, `property_type`, `region`, `latitude`, `longitude`; for units `label`, `bedrooms`, `bathrooms`, `size_sqm`, `description`); `null` is rejected with `400` for fields a record can't be without (`address_line`, `city`; `rent_amount`, `currency`, `billing_cycle`). A value equal to what is already stored is ignored, and an edit that changes nothing writes **no** change record.

### `PATCH /units/{id}` *(landlord)*
Edit any of `label`, `bedrooms`, `bathrooms`, `facilities`, `size_sqm`, `rent_amount`, `currency`, `billing_cycle`, `description`, `status` (only the manual transitions `vacant ⇄ reserved`; `occupied`/`notice_given` are driven by Tenancies), plus an optional `change_note`. **Editing `rent_amount` changes the *listed* rent only** — an existing tenancy keeps the `rent_amount` agreed when it was created.

### `DELETE /units/{id}/photos/{photoId}` and `POST /units/{id}/photos/{photoId}/cover` *(landlord, added 2026-09-20)*
Remove a photo (remaining photos are re-sequenced; the cover moves to the next one), or make a photo the cover (`sort_order` 0). Removing the last photo of a `vacant` unit returns it to `draft`, i.e. off the public listings. `DELETE` returns `{ "unit_status", "photos": [...] }`. The underlying file is kept in storage — the change record still references it as evidence of what the listing used to show.

### Listing change log *(added 2026-09-20)*
Every landlord edit to a property or unit is recorded in the **append-only** `listing_changes` table (never updated or deleted — offsetting edits are new rows, same principle as the ledger) in the *same transaction* as the edit, so an edit can't happen without its record. Recorded: `PATCH /properties/{id}`, `PATCH /units/{id}`, photo removal, cover change, and photo **additions while a tenant is living in the unit** (the first photos of a new listing are setup, not edits, so they aren't logged). One record:
```json
{ "id": "uuid", "entity_type": "unit", "property_id": "uuid", "unit_id": "uuid", "entity_label": "Studio A",
  "action": "updated",                       // updated | photo_added | photo_removed | cover_photo_changed
  "changes": [ { "field": "rent_amount", "from": "150000", "to": "175000" } ],
  "note": "Market adjustment",               // the change_note, if given
  "while_occupied": true,                    // a tenant was living in an affected unit at that moment
  "occupied_unit_ids": ["uuid"],
  "property_verified_at_change": false,      // the property was ownership-verified when it was edited
  "changed_by": "uuid", "created_at": "2026-09-20T10:00:00Z" }
```
For a property edit, `while_occupied` is true when *any* of its units had a tenant. "Living there" means unit status `occupied` or `notice_given`. Photo values in `changes` are browser-loadable URLs. Editing an ownership-verified property does not clear its verification (that's an admin decision) — the record just carries `property_verified_at_change: true` so a reviewer can see it.

- `GET /landlords/me/listing-changes?property_id=&unit_id=&while_occupied=&cursor=&limit=` *(landlord)* — edits to your own properties/units, newest first: `{ "results": [...], "next_cursor" }`.
- `GET /tenancies/{id}/listing-changes` *(landlord or tenant of that tenancy)* — edits to that tenancy's unit and its property **since the tenancy was created**, so a tenant sees what changed after moving in. Omits `changed_by`.
- `GET /admin/listing-changes?property_id=&unit_id=&while_occupied=&cursor=&limit=` *(admin)* — every landlord's edits; each record also carries `changed_by_profile: { "name", "phone_number" }`. `403` for non-admins.

---

## 5. Visit Requests

### `POST /units/{id}/visit-requests` *(tenant)*
```json
{ "requested_slots": [{ "start": "2026-08-15T10:00:00Z" }, { "start": "2026-08-16T14:00:00Z" }] }
```
`201` → status `pending`, `expires_at` set (+48h).

### `PATCH /visit-requests/{id}/respond` *(landlord)*
```json
{ "action": "accept", "confirmed_slot": "2026-08-15T10:00:00Z" }
// or
{ "action": "decline" }
// or
{ "action": "reschedule", "proposed_slot": "2026-08-17T09:00:00Z" }
```

### `GET /landlords/me/visit-requests?status=pending`
List with pagination.

### `POST /units/{id}/interest` *(tenant)*
Added 2026-09-18 after demo feedback: a lighter-weight signal than requesting a visit — no
scheduling, just "I'm interested in this unit." No request body. `201` → the interest object
(`id`, `unit_id`, `tenant_id`, `landlord_id`, `status: "pending"`, `created_at`, `updated_at`).
Idempotent: calling it again for the same unit as the same tenant returns the same existing
row rather than erroring or creating a duplicate (a tenant re-clicking the button, or the
frontend re-rendering, is harmless). Notifies the landlord the same way `visit_request.created`
does (waterfall: push → whatsapp → sms).

### `GET /tenants/me/interests` *(tenant, added 2026-09-20)*
The tenant's own expressed interests (`{ "results": [ { id, unit_id, status, created_at, updated_at, ... } ] }`, newest first, unpaginated — a person's own list is small). Lets the public listing pages mark cards "Interested" after a reload and powers the tenant dashboard's "Homes you're interested in" list.

### `GET /landlords/me/interests?status=pending`
Added 2026-09-18. Landlord inbox of tenants who expressed interest in any of their units —
this is what the "add tenancy by the click of a button, for any interested tenant" flow reads
from, as an alternative to the existing paste-the-tenant-id `POST /tenancies` form (both paths
create a tenancy through the same endpoint; this just removes the copy/paste step for a tenant
who already raised their hand). Each result is enriched beyond the bare interest row with
`tenant_name`, `tenant_phone_number`, and `unit_label`, so the landlord can act on the list
without a separate lookup per row:
```json
{
  "results": [
    { "id": "uuid", "unit_id": "uuid", "tenant_id": "uuid", "landlord_id": "uuid",
      "status": "pending", "tenant_name": "Jean Dupont", "tenant_phone_number": "+237699500001",
      "unit_label": "Studio A", "created_at": "...", "updated_at": "..." }
  ],
  "next_cursor": null
}
```
`status` is `pending` until a tenancy is created for that same `(unit_id, tenant_id)` pair
(through either path above), at which point it flips to `converted` automatically — there is
no manual "dismiss"/"convert" action on this resource itself.

---

## 6. Tenancy & Occupancy

### `POST /tenancies`
```json
{
  "unit_id": "uuid", "tenant_id": "uuid",
  "start_date": "2026-09-01", "rent_amount": 150000, "currency": "XAF",
  "billing_cycle": "monthly", "max_advance_months": 3, "prepaid_months": 3,
  "reminder_first_days_before": 30, "reminder_second_days_before": 14
}
```
**`start_date`** is when **billing starts** — the tenancy's first rent falls due on that date, not on the day the tenancy was created. It may be today (the web UI's default), in the future (tenant moves in later: nothing is due until then) or in the past (backdated). Payments can't be made for any period before it (`422 PAYMENT_BEFORE_TENANCY_START`, see Section 7), and `next_payment_due_date` on the tenancy is the start date until something has been paid.

**`prepaid_months`** *(optional, 1-24, added 2026-09-20)* — months of rent the tenant already paid the landlord outside the platform (typically cash upfront). It is recorded as a real **confirmed payment** with provider `offline`: an append-only ledger credit of `rent_amount × prepaid_months` (for a quarterly/biannual tenancy, `prepaid_months` must be a whole number of cycles — `422 PREPAID_MONTHS_INVALID_FOR_BILLING_CYCLE` otherwise), a receipt, and a `payment.confirmed` event, which advances `paid_through_date` and notifies the tenant exactly as a mobile-money payment would. It covers `start_date` through the last day of the Nth calendar month (the same calendar-month convention `POST /tenancies/{id}/payments` uses). The response already carries the updated `paid_through_date`. Validation happens **before** anything is created, so a bad value never leaves a half-created tenancy behind. Deliberately **not** limited by `max_advance_months` — that cap limits what a tenant may pay *through the platform*; a landlord recording cash they actually received is stating a fact, not requesting a permission (the tenant simply can't pay further ahead through the platform until they're back under the cap). `offline` is never accepted as a `provider` on `POST /tenancies/{id}/payments`, so a tenant can't mark their own rent as paid.

**`prepaid_paid_on`** *(optional, `YYYY-MM-DD`, requires `prepaid_months`, added 2026-09-20)* — the day the tenant actually handed over that rent (e.g. move-in day), when that isn't the day the landlord is recording it. Defaults to now; a future date is rejected (`422 PREPAID_PAID_ON_INVALID`). It becomes the payment's confirmation date — the "Paid on …" that dashboards, the receipt and the tenant's notification show — while the ledger entry's own `created_at` still records when it was entered, so the audit trail stays honest.
`notice_period_days` is **not** client-settable below the statutory floor — server applies the region-appropriate default and rejects any request attempting to override it downward (`422 NOTICE_PERIOD_BELOW_STATUTORY_MINIMUM`). `reminder_first_days_before`/`reminder_second_days_before` default to 30/14 ("1 month" / "2 weeks", per the product requirement) if omitted and are freely landlord-configurable — these drive the rent-expiry reminder scheduler described in the architecture doc.

### `PATCH /tenancies/{id}/reminder-settings` *(landlord)*
```json
{ "reminder_first_days_before": 45, "reminder_second_days_before": 7 }
```
Adjusts reminder timing for an existing tenancy without needing to touch any other field.

### `GET /landlords/me/tenancies`
Occupancy dashboard data source — includes `current_balance` (derived from the ledger, not stored redundantly on the tenancy record itself) **and** `paid_through_date`, which is what the dashboard uses to visually flag units approaching expiry (e.g., amber/red badge) independent of whether a reminder notification has fired yet. Also includes `next_payment_due_date` (added 2026-09-20) — when the next rent payment is expected: the day after `paid_through_date`, or the tenancy's `start_date` until anything has been paid; `null` once the tenancy has terminated/expired (nothing further is owed). It is on every tenancy response (list and detail, landlord and tenant). Also includes `months_paid_ahead` (added 2026-09-18) — a simple whole-calendar-month count of how far `paid_through_date` sits ahead of today, so the landlord can see at a glance how many months a tenant has paid for without doing the date math themselves.

### `GET /tenants/me/tenancies` *(tenant)*
Added 2026-09-18 after live demo feedback — the tenant-side mirror of `GET /landlords/me/tenancies` above (same response shape, scoped to the requester's own tenancies as tenant instead of as landlord). Closes the gap where a tenant previously had no way to discover their own tenancies except being told the id out-of-band. Both list endpoints (this and the landlord's) also include `recent_ledger_entries` (last 5, same shape as `GET /tenancies/{id}`) so a dashboard can show payment history — including rent recorded as paid upfront — on first load.

### `GET /tenancies/{id}`
Full detail including `paid_through_date`, reminder settings, linked contract status, and last 5 ledger entries (full ledger via `/tenancies/{id}/ledger`).

### `POST /tenancies/{id}/termination-notices` *(landlord)*
```json
{ "reason": "non_payment", "reason_detail": "...", "effective_date": "2026-12-01" }
```
Server validates `effective_date >= issued_at + tenancy.notice_period_days`; rejects otherwise with `422 NOTICE_PERIOD_TOO_SHORT` and returns the earliest valid date in the error body. On success: generates the bilingual notice document, transitions tenancy to `notice_given`, triggers the fan-out notification (Epic 4, US-4.2).

### `GET /tenancies/{id}/termination-notices`
History (a tenancy could in principle have a notice withdrawn/reissued — full audit trail).

---

## 7. Payments & Ledger

### `POST /tenancies/{id}/payments` *(tenant)*
Requires `Idempotency-Key` header.
```json
{ "amount": 150000, "currency": "XAF", "period_start": "2026-09-01", "period_end": "2026-09-30", "provider": "campay" }
```
**Server-side validation before contacting the aggregator** (this is where Epic 4's US-4.3 is enforced):
- Reject `422 PAYMENT_BEYOND_NOTICE_EFFECTIVE_DATE` if `period_end` > the tenancy's active termination notice `effective_date`.
- Reject `422 PAYMENT_EXCEEDS_ADVANCE_MONTHS_CAP` if this payment would cover more months ahead than `max_advance_months` allows.
- Reject `422 PAYMENT_BEFORE_TENANCY_START` if `period_start` is before the tenancy's `start_date` (added 2026-09-20) — billing starts on the start date, which the landlord sets and which needn't be the day the tenancy was created.

`202 Accepted` (payment status `pending` — actual confirmation is async via webhook/reconciliation):
```json
{ "payment_id": "uuid", "status": "pending" }
```

### `POST /webhooks/payments/{provider}` *(aggregator callback, not client-facing)*
Verifies provider signature; `200` acknowledged regardless of business outcome (per aggregator best practice — retries are the aggregator's problem to manage on their side, not something we want to induce by returning non-200 for a business-logic reason).

### `GET /tenancies/{id}/ledger`
```json
{
  "current_balance": 0,
  "entries": [
    { "id": "uuid", "type": "credit", "amount": 150000, "running_balance": 150000, "description": "Rent payment for 2026-09-01 to 2026-09-30",
      "provider": "campay", "created_at": "...", "payment_id": "uuid" }
  ],
  "next_cursor": null
}
```

Each entry also says *when it was paid and what it covers* *(added 2026-09-20)*: `paid_at` (when the payment was made/confirmed), `period_start`/`period_end` (the period covered) and `months_covered` (calendar months that period touches, inclusive — e.g. 2026-09-20 → 2026-11-30 is 3). The next payment is due the day after the latest `period_end`, i.e. the tenancy's `next_payment_due_date`. The same three facts — paid on, month(s) covered, next payment due — are stated, in the recipient's language, in the `payment.confirmed` notification and in the receipt document.

`description` and `provider` *(added 2026-09-20)*: `provider` is `campay`, `monetbil`, or `offline` (rent the landlord recorded as paid upfront at tenancy creation — its description reads "Rent paid upfront (recorded by landlord) for …"), so a UI can label those entries without parsing text.

### `GET /payments/{id}/receipt`
Returns a signed, time-limited download URL for the receipt PDF (object in Cloudflare R2).

### `GET /admin/payments?status=pending` *(admin)*
Feeds the reconciliation/dispute review queue.

---

## 8. Contracts

### `POST /tenancies/{id}/contracts`
```json
{ "locale": "fr" }
```
`201` → contract in `draft`/`pending_signatures` status with `document_url`.

### `POST /contracts/{id}/sign`
Requires a fresh OTP re-verification (separate `challenge_id`/`otp` pair from login, per Epic 6 AC2 — signing identity confirmation is a distinct action from session auth).
```json
{ "challenge_id": "uuid", "otp": "123456" }
```
Response includes updated `status` (`pending_signatures` until both parties have signed, then `fully_signed`).

### `GET /contracts/{id}`
Returns document URL + full signature status/audit trail.

---

## 9. Notifications

### `GET /users/me/notifications?unread=true&cursor=&limit=`
In-app list.

### `PATCH /users/me/notifications/{id}/read`
`204`.

### `GET /users/me/notification-channels`
```json
[
  { "channel": "sms", "opted_in": true, "verified": true },
  { "channel": "whatsapp", "opted_in": false, "verified": false },
  { "channel": "email", "opted_in": true, "verified": true },
  { "channel": "push", "opted_in": true, "verified": true }
]
```

### `POST /users/me/notification-channels/{channel}/opt-in`
```json
{ "channel_identifier": "+237670000000" } // or email address; push uses device token endpoint instead
```

### `POST /users/me/notification-channels/{channel}/opt-out`
For `sms` specifically on critical event categories, requires `{ "confirm": true }` given its reliability-floor role (per the multi-channel design doc) — the API returns `422 SMS_OPT_OUT_REQUIRES_CONFIRMATION` if omitted.

### `PATCH /users/me/notification-preferences`
```json
{ "rent_reminder_days_before": 14, "preferred_channel_order": "push,whatsapp,sms,email" }
```

### `POST /users/me/push-tokens`
```json
{ "fcm_token": "...", "platform": "android" }
```

### `POST /webhooks/whatsapp/inbound`, `POST /webhooks/whatsapp/status`, `POST /webhooks/email/status`
Provider callbacks, not client-facing — documented here for completeness of the module's external contract surface.

---

## 10. Complaints

### `POST /tenancies/{id}/complaints` *(tenant)*
`multipart/form-data`: `category`, `description`, `media[]` (optional).
`201` → complaint in `open` status.

### `GET /landlords/me/complaints?unit_id=&status=&category=`
Aggregate/filterable view (Epic 7, US-7.2).

### `PATCH /complaints/{id}/status` *(landlord)*
```json
{ "new_status": "acknowledged", "note": "Plumber scheduled for Thursday" }
```

---

## 11. Admin

### `GET /admin/kyc-queue`
### `GET /admin/listings/flagged`
### `GET /admin/payments/disputes`
### `GET /admin/audit-log?target_type=&target_id=&cursor=`

All admin endpoints require `role = admin`; every state-changing admin action writes to `admin_actions_log` per the schema in the deployment/module doc — this happens server-side automatically, not something the client needs to separately call.

---

## 12. Rate limits (indicative — tune based on observed pilot traffic)

| Endpoint class | Limit |
|---|---|
| `/auth/otp/request` | 3 per phone number per 10 minutes |
| `/auth/otp/verify` | 5 attempts per challenge |
| Payment initiation | 10 per tenancy per hour (generous ceiling — legitimate use is ~monthly; this catches abuse/bugs, not real usage) |
| General authenticated GET | 120 requests/min per user |
| Public search (`GET /units`) | 60 requests/min per IP (unauthenticated) |

---

## 13. What's deliberately not in this spec yet

Per the MVP PRD's out-of-scope list: no chat/messaging endpoints, no financing/credit endpoints, no multi-currency parameters, no USSD-specific endpoints (USSD, if built later, would likely front this same API through a separate gateway service rather than needing new endpoints). Extending the spec for those is a fast-follow exercise once the MVP surface above is validated in the pilot.
