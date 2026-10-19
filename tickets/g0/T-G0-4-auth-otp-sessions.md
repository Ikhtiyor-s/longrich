# T-G0-4 — Auth: SMS OTP request/verify, sessions, refresh rotation

**Requirement refs:** TZ §02 ("Auth: SMS OTP, normalized phone, hashed OTP, TTL, per-phone/device/IP rate limits, session rotation, refresh revoke, admin MFA"), §19 (API contract: `POST /v1/auth/otp/request`, `/verify`), §28 (forms/validation: E.164 phone, OTP TTL proposal 120s, anti-enumeration error, max attempts/resend rate limit). Requirement ID: `WEB-001` (OTP authentication) — shared by `MOB-002` later at G8, same backend. Milestone: G0.

## Goal
Implement phone-OTP login end to end: request OTP (rate-limited, hashed storage, generic response to prevent phone enumeration), verify OTP (issues session/access+refresh tokens), and refresh/revoke/logout, with no OTP or token ever logged in plaintext.

## Files likely touched
- `apps/api/src/modules/identity/` — `auth.controller.ts`, `auth.service.ts`, `otp.service.ts`, `session.service.ts`
- `apps/api/src/modules/identity/dto/` — request/verify DTOs
- Reuses `users` table from T-G0-3; adds `otp_challenges` and `sessions`/`refresh_tokens` tables via a new migration in this ticket (`prisma/migrations/0002_auth_sessions/`)
- Redis-backed rate limiter config (per-phone, per-device, per-IP) — depends on T-G0-2's Redis container

## How we'll know it's done
- `POST /v1/auth/otp/request {phone, purpose}` returns generic `202` regardless of whether the phone exists (anti-enumeration, per TZ §28), with normalized E.164 validation rejecting malformed numbers with `422`.
- `POST /v1/auth/otp/verify {challenge_id, code}` with correct code returns session tokens; wrong code is rejected and counted against a max-attempt lockout; exceeding resend rate returns `429` per TZ §04 error code table.
- OTP is stored hashed with a TTL (not plaintext) and expires server-side even if never verified.
- Refresh token rotation works: using a refresh token issues a new pair and invalidates the old one; logout revokes the session so the old refresh token is rejected afterward.
- Contract test (allow/deny) proves: unauthenticated request to a protected `/v1/me`-style stub returns `401` (TZ §19 AuthZ test matrix baseline, full matrix is later milestones' job once protected resources exist).
- No OTP code, token, or phone appears in plaintext in logs (grep test against log output during integration test run).

## Owner role
`backend-dev`

## Depends on
T-G0-3
