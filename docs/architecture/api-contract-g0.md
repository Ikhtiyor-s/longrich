# API Contract — G0 (Auth, Session, Profile)

**Status: FROZEN.** This is the single source of truth for `T-G0-4` (auth/OTP/sessions) and `T-G0-5` (RBAC enforcement points). Backend-dev implements against this exactly. Changing a request/response shape after this ships requires going back through the architect per the conflict-resolution protocol (minor clarification → `## Clarifications` entry below; real change → escalate to PM).

Source: TZ §04 (cross-cutting standards), §19 (API/security contract), §28 (forms/validation), §31 (API contract behavior), §34 (security/RBAC matrix). API root is `/v1`.

## Conventions (non-negotiable, copied faithfully from TZ)

- **JSON field names are snake_case**, not idiomatic-TS camelCase. This is a deliberate deviation from typical NestJS convention: TZ §04/§31 write the envelope itself in snake_case (`{data,meta:{request_id}}`), and every DB column in §18/§30 is snake_case. Keeping wire JSON, DB columns, and the Prisma-generated field names' `@map(...)` target all aligned to snake_case reduces mapping bugs across NestJS → Next.js → (later) Flutter, all of which consume the same JSON.
- **Success envelope:** `{ "data": <payload>, "meta": { "request_id": "<uuid>" } }`
- **Error envelope:** `{ "error": { "code": "<STRING>", "message": "<human string>", "details": {} }, "request_id": "<uuid>" }`
- **`request_id`** is always server-generated (even if the client sends no `X-Request-ID`), echoed in the response body per the shapes above, and additionally echoed as response header `X-Request-ID` for client-side correlation. It is NOT the same field as OpenTelemetry's `trace_id` — tracing correlation lives in response/log headers and spans, not the frozen JSON body, so this document doesn't widen the envelope beyond what §04/§31 literally specify. See `g0-design-notes.md` for how `trace_id` is carried instead.
- **HTTP status codes used in this document, per TZ §04's table:** `200`, `202`, `204`, `401` (unauthenticated), `403` (forbidden), `404` (not found), `409` (conflict), `422` (invalid business rule / validation), `429` (throttled), `503` (unavailable).
- **`Idempotency-Key` header:** none of the G0 endpoints below require it. The header/middleware mechanism (backed by `commerce.idempotency_keys`) should still exist generically per `g0-design-notes.md`, because G4 (checkout/orders) will need it, but no G0 endpoint's acceptance criteria depends on a client sending it — retrying any G0 POST below is already safe without it (see per-endpoint notes).
- All timestamps are ISO-8601 UTC strings (`"2026-10-17T10:00:00Z"`). All IDs are UUID v4 strings.

## Error code table (G0 scope)

| HTTP | `code` | Meaning | Used by |
|---|---|---|---|
| 422 | `VALIDATION_ERROR` | Request body failed schema/format validation (e.g. non-E.164 phone) | request, verify, refresh, PATCH /me |
| 401 | `UNAUTHENTICATED` | No/invalid/expired access token on a protected route | GET/PATCH /me, logout |
| 401 | `OTP_INVALID_OR_EXPIRED` | Wrong code, expired challenge, unknown `challenge_id`, or already-consumed challenge — deliberately one generic code for all four cases (anti-enumeration, TZ §28) | verify |
| 401 | `SESSION_INVALID` | Refresh token unknown, expired, revoked, or already-rotated (reuse detected) | refresh, logout |
| 429 | `OTP_LOCKED` | Max verify attempts exceeded for this `challenge_id` | verify |
| 429 | `RATE_LIMITED` | Per-phone/device/IP OTP request rate limit exceeded | request |
| 403 | `FORBIDDEN` | Authenticated but lacking required permission or resource ownership | any protected route (T-G0-5 guard) |
| 503 | `SMS_PROVIDER_UNAVAILABLE` | SMS adapter unreachable/misconfigured, no fallback (see note under `/auth/otp/request`) | request |

Codes not reachable in G0 but reserved in the same enum per T-G0-6 (no endpoint emits them yet): `404`, `409`, `STALE_QUOTE`, `INSUFFICIENT_STOCK`, `FORBIDDEN_SELLER`, `INVALID_STATE_TRANSITION`, `PAYMENT_MISMATCH`, `DUPLICATE_REQUEST`, `UNSUPPORTED_REFUND`, `DELIVERY_ZONE_UNAVAILABLE`.

---

## `POST /v1/auth/otp/request`

**Auth:** none (public/guest). **Rate-limited:** per-phone, per-device, per-IP (see `g0-design-notes.md`).

Request:
```json
{ "phone": "+998901234567", "purpose": "LOGIN" }
```
- `phone`: string, required, MUST be valid E.164 (`+` followed by 7–15 digits).
- `purpose`: string, required. G0 only accepts `"LOGIN"` — this field exists as an open string (not a DB enum) because TZ §28 left its full value set undefined; any other value is rejected with `422` for now, not silently accepted.

Response `202 Accepted` (identical shape whether or not the phone is already registered — anti-enumeration):
```json
{
  "data": {
    "challenge_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "expires_in_seconds": 120,
    "resend_available_at": "2026-10-17T10:05:00Z"
  },
  "meta": { "request_id": "b6e1..." }
}
```
Note: `expires_in_seconds: 120` reflects the configured OTP TTL default. **TZ §28 itself flags 120s as a "proposal," not confirmed** — this is a config value (`OTP_TTL_SECONDS`), not a hardcoded contract guarantee of exactly 120; a client MUST read `expires_in_seconds` from the response rather than assume 120.

Errors:
- `422 VALIDATION_ERROR` — malformed phone or unsupported `purpose`.
- `429 RATE_LIMITED` — `details: { "retry_after_seconds": 45 }`.
- `503 SMS_PROVIDER_UNAVAILABLE` — SMS adapter completely unreachable/unconfigured with no queued-retry path available (expected to be rare; see design notes — most delivery failures are retried asynchronously by a worker and do NOT surface as a `503` to the original request).

Idempotency: safe to retry without an `Idempotency-Key`. Each call creates a new `otp_challenges` row; duplicate rapid calls are governed by the resend-cooldown rate limit, not request dedup — calling twice in quick succession returns `429`, not two live challenges.

Given/When/Then:
```
Given a phone number that has never registered
When POST /v1/auth/otp/request is called with that phone and purpose=LOGIN
Then HTTP 202 is returned with a challenge_id, and the response body is byte-for-byte
     the same shape as it would be for an already-registered phone
```

---

## `POST /v1/auth/otp/verify`

**Auth:** none (public/guest) — the *credential* being presented is the `challenge_id` + `code` pair.

Request:
```json
{ "challenge_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6", "code": "482913" }
```

Response `200 OK`:
```json
{
  "data": {
    "token_type": "Bearer",
    "access_token": "eyJhbGciOiJIUzI1NiIs...",
    "refresh_token": "8f14e45fceea167a5a36dedd4bea2543",
    "expires_in": 900,
    "user": {
      "id": "c3b1...",
      "phone": "+998901234567",
      "status": "ACTIVE",
      "locale": "uz",
      "phone_verified_at": "2026-10-17T10:00:12Z",
      "created_at": "2026-10-17T10:00:12Z"
    }
  },
  "meta": { "request_id": "..." }
}
```
Side effect (explicit design decision, since TZ §05 WEB-001 bundles "signup/login" as one requirement): if this is the first successful verify for this phone, a `users` row is created at this moment (status `ACTIVE`, `phone_verified_at = now()`) — there is no separate "register" step. A returning phone reuses its existing `users.id`.

Errors:
- `422 VALIDATION_ERROR` — malformed body (e.g. `code` not 6 digits).
- `401 OTP_INVALID_OR_EXPIRED` — wrong code, expired, unknown `challenge_id`, or challenge already consumed. One generic code/message for all four — do not add a more specific code later without an architect sign-off, since narrowing this is exactly the enumeration risk TZ §28 calls out.
- `429 OTP_LOCKED` — `attempts_count` on this challenge reached `max_attempts`; the challenge is dead, client must call `/otp/request` again.

Idempotency: a given `challenge_id` can only be successfully verified once (status transitions `PENDING → VERIFIED`); a second verify call with the same challenge, even with the correct code, returns `401 OTP_INVALID_OR_EXPIRED` because the challenge is no longer `PENDING`. No `Idempotency-Key` needed — the state machine itself prevents duplicate side effects.

Given/When/Then:
```
Given a PENDING otp_challenge with 0 prior attempts and a known code
When POST /v1/auth/otp/verify is called with the correct challenge_id and code
Then HTTP 200 is returned with access_token + refresh_token, the challenge transitions
     to VERIFIED, and a new session + refresh_token row is created

Given a PENDING otp_challenge whose attempts_count is already at max_attempts - 1
When POST /v1/auth/otp/verify is called with an incorrect code
Then HTTP 429 OTP_LOCKED is returned, the challenge transitions to LOCKED,
     and no further verify call against this challenge_id can succeed
```

---

## `POST /v1/auth/token/refresh`

**Auth:** none via header — the refresh token itself is the credential.

Request:
```json
{ "refresh_token": "8f14e45fceea167a5a36dedd4bea2543" }
```

Response `200 OK`:
```json
{
  "data": {
    "token_type": "Bearer",
    "access_token": "eyJhbGciOiJIUzI1NiIs...",
    "refresh_token": "a1b2c3d4e5f6...",
    "expires_in": 900
  },
  "meta": { "request_id": "..." }
}
```
Rotation: every successful refresh issues a brand-new refresh token and marks the presented one `ROTATED` (see `g0-design-notes.md` for the full chain mechanics). The old token is now unusable.

Errors:
- `401 SESSION_INVALID` — token unknown, expired, already `REVOKED`, or already `ROTATED` (presenting a rotated/used token is treated as possible theft: the entire session is revoked server-side as a side effect of this error, logged to `audit_logs` with a distinguishing internal `action`, but the client-facing error code/message stays the same generic `SESSION_INVALID` — do not leak "reuse detected" to the response body).

Idempotency: intentionally NOT idempotent by design — calling it twice with the same refresh token will make the second call fail with `401 SESSION_INVALID` (because the first call already rotated it). This is correct behavior, not a bug to "fix" with an `Idempotency-Key`.

Given/When/Then:
```
Given an ACTIVE refresh_token belonging to an ACTIVE session
When POST /v1/auth/token/refresh is called with that token
Then HTTP 200 returns a new access/refresh pair, the presented token's status
     becomes ROTATED, and a new refresh_token row is linked via rotated_to_id

Given a refresh_token whose status is already ROTATED
When POST /v1/auth/token/refresh is called with that same token value
Then HTTP 401 SESSION_INVALID is returned and the owning session's status
     becomes REVOKED
```

---

## `POST /v1/auth/logout`

**Auth:** `Authorization: Bearer <access_token>` required (must be currently valid/non-expired).

Request body: none required (the session to revoke is resolved from the access token's `sid` claim).

Response `200 OK`:
```json
{ "data": { "revoked": true }, "meta": { "request_id": "..." } }
```

Errors:
- `401 UNAUTHENTICATED` — missing/invalid/expired access token.

Idempotency: calling logout twice is safe — the second call still returns `200 { "revoked": true }` (revoking an already-revoked session is a no-op success, not an error).

Given/When/Then:
```
Given a valid access_token tied to an ACTIVE session
When POST /v1/auth/logout is called with that token in Authorization
Then HTTP 200 is returned, the session's status becomes REVOKED, and the session's
     current refresh_token's status becomes REVOKED — a subsequent
     /auth/token/refresh call with that refresh token returns 401 SESSION_INVALID
```

---

## `GET /v1/me`

**Auth:** `Authorization: Bearer <access_token>` required. Customer owns only their own profile (TZ §34) — the user is resolved from the token's `sub` claim; there is no `{id}` path parameter and never will be for this route (no "admin viewing another user's /me" — that's a future, separate admin endpoint, not this one).

Response `200 OK`:
```json
{
  "data": {
    "id": "c3b1...",
    "phone": "+998901234567",
    "status": "ACTIVE",
    "locale": "uz",
    "phone_verified_at": "2026-10-17T10:00:12Z",
    "created_at": "2026-10-17T10:00:12Z",
    "updated_at": "2026-10-17T10:00:12Z"
  },
  "meta": { "request_id": "..." }
}
```

Errors:
- `401 UNAUTHENTICATED` — missing/invalid/expired access token.

Given/When/Then:
```
Given no Authorization header
When GET /v1/me is called
Then HTTP 401 UNAUTHENTICATED is returned
```

## `PATCH /v1/me`

**Auth:** same as `GET /v1/me`.

**Scope note (read before building a frontend against this):** G0 can only mutate fields that live on the `users` table itself. `customer_profiles` (first/last name) does not exist until a later milestone (G7 per `docs/traceability.md`'s WEB module pin). This endpoint's request schema is designed to be **additively** extended when `customer_profiles` lands — a new optional field, not a breaking change — so build frontends against exactly this shape today, not against the eventual full profile shape.

Request:
```json
{ "locale": "ru" }
```
- `locale`: optional, one of `"uz" | "ru"`.

Response `200 OK`: same shape as `GET /v1/me`, reflecting the update.

Errors:
- `422 VALIDATION_ERROR` — `locale` present but not one of the allowed values.
- `401 UNAUTHENTICATED`.

Given/When/Then:
```
Given a valid access_token and body { "locale": "ru" }
When PATCH /v1/me is called
Then HTTP 200 is returned and GET /v1/me afterward reflects locale: "ru"
```

---

## RBAC enforcement baseline proven in G0 (T-G0-5)

No seller/warehouse/customer-resource-ownership scenarios exist yet (those tables don't exist until G1+), so the *full* TZ §34 matrix cannot be tested end-to-end in G0. What G0 proves, as the mechanism every later milestone builds on:

- A protected route decorated `@RequirePermission('test:read')` (a throwaway test route, not a real business endpoint — removed or repurposed once a real `admin-audit` read endpoint exists) returns `403 FORBIDDEN` for an authenticated admin member whose role lacks that permission, and `200` for one whose role has it.
- A resource-ownership check (`@RequireOwnership`), exercised against a fake fixture (no real owned resource exists in G0), rejects with `403 FORBIDDEN` when the caller's id doesn't match the fixture's owner field, even if the caller otherwise holds the required permission.

This baseline is intentionally not a public contract endpoint — see `g0-design-notes.md` for the guard/decorator design and the seed data (`SUPER_ADMIN` gets `test:read`, `SUPPORT_AGENT` does not) that makes T-G0-5's acceptance test concrete.

## Admin MFA — explicitly NOT part of this frozen contract yet

T-G0-5 asks for an MFA enrollment/verify *scaffold*. No HTTP endpoint for it is frozen here: there is no admin login flow endpoint yet to attach it to (admin login is the same `/v1/auth/otp/*` flow as everyone else in G0 — admin-specific MFA enforcement is a future gate on top of it once an admin web app exists). The scaffold is a service-layer interface only; see `g0-design-notes.md`. Freezing an HTTP shape for it now would risk an unnecessary contract change later.

## Clarifications

**`phone` input format actually accepted by `POST /v1/auth/otp/request` (G0 QA review minor #8).** The frozen line above ("MUST be valid E.164") describes the *stored/returned* format; the implementation (`apps/api/src/modules/identity/lib/phone.ts`'s `normalizePhone`) additionally accepts and normalizes these Uzbek local-format inputs to E.164 before validation, rather than rejecting them outright:
- a bare `998`-prefixed number (`998901234567` → `+998901234567`)
- a 9-digit local subscriber number with no prefix (`901234567` → `+998901234567`)
- a `0`-prefixed trunk-format number (`0901234567` → `+998901234567`)
- any of the above with spaces/dashes/parentheses, which are stripped before normalization

Anything that doesn't normalize to a valid E.164 number is still rejected with `422 VALIDATION_ERROR`, and the response/stored value is always the normalized E.164 form — only the *accepted input* surface is wider than the frozen line's literal wording suggests. This is a documentation amendment, not a behavior change: the implementation predates this entry and is left as-is per the conflict-resolution protocol's "judgment call" track.
