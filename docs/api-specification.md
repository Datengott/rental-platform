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
Public search. Query params: `city`, `region`, `min_price`, `max_price`, `bedrooms`, `status` (defaults to `vacant`), `cursor`, `limit`.
```json
{
  "results": [
    { "id": "uuid", "label": "Unit 4B", "bedrooms": 2, "bathrooms": 1, "facilities": ["ac", "wifi"], "rent_amount": 150000, "currency": "XAF",
      "property": { "city": "Douala", "verified": true, "property_type": "residential", "facilities": ["gated"] }, "cover_photo_url": "..." }
  ],
  "next_cursor": null
}
```

### `GET /landlords/me/units`
Landlord's own inventory (all statuses) — feeds the occupancy dashboard's unit list.

### `PATCH /units/{id}`
Update mutable fields (`rent_amount`, `description`, `status` where the transition is valid).

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
  "billing_cycle": "monthly", "max_advance_months": 3,
  "reminder_first_days_before": 30, "reminder_second_days_before": 14
}
```
`notice_period_days` is **not** client-settable below the statutory floor — server applies the region-appropriate default and rejects any request attempting to override it downward (`422 NOTICE_PERIOD_BELOW_STATUTORY_MINIMUM`). `reminder_first_days_before`/`reminder_second_days_before` default to 30/14 ("1 month" / "2 weeks", per the product requirement) if omitted and are freely landlord-configurable — these drive the rent-expiry reminder scheduler described in the architecture doc.

### `PATCH /tenancies/{id}/reminder-settings` *(landlord)*
```json
{ "reminder_first_days_before": 45, "reminder_second_days_before": 7 }
```
Adjusts reminder timing for an existing tenancy without needing to touch any other field.

### `GET /landlords/me/tenancies`
Occupancy dashboard data source — includes `current_balance` (derived from the ledger, not stored redundantly on the tenancy record itself) **and** `paid_through_date`, which is what the dashboard uses to visually flag units approaching expiry (e.g., amber/red badge) independent of whether a reminder notification has fired yet. Also includes `months_paid_ahead` (added 2026-09-18) — a simple whole-calendar-month count of how far `paid_through_date` sits ahead of today, so the landlord can see at a glance how many months a tenant has paid for without doing the date math themselves.

### `GET /tenants/me/tenancies` *(tenant)*
Added 2026-09-18 after live demo feedback — the tenant-side mirror of `GET /landlords/me/tenancies` above (same response shape, scoped to the requester's own tenancies as tenant instead of as landlord). Closes the gap where a tenant previously had no way to discover their own tenancies except being told the id out-of-band.

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
    { "id": "uuid", "type": "credit", "amount": 150000, "running_balance": 0, "created_at": "...", "payment_id": "uuid" }
  ],
  "next_cursor": null
}
```

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
