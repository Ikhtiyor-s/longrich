# G0 Design Notes — Auth Mechanics, Outbox Worker, Dev Infra

Companion to `docs/architecture/api-contract-g0.md` (the frozen contract) and `prisma/schema.prisma` (the frozen schema). This document holds the "how it actually works" detail backend-dev needs that doesn't belong in either frozen artifact, plus a single index of every place this architect pass deviated from or reconciled ambiguity in the TZ, so a reviewer doesn't have to hunt through every file to find them.

## 1. OTP: hashing, TTL, rate limits

**Hashing.** The OTP code is a 6-digit number — only 1,000,000 possible values. A plain unsalted/un-keyed hash (even SHA-256) of a 6-digit code is crackable offline in well under a second if the `otp_challenges` table ever leaks, because there's no secret involved, just a small keyspace. The code MUST be hashed with a **keyed** function: `HMAC-SHA256(secret=OTP_HMAC_SECRET, message=challenge_id + ":" + code)`, where `OTP_HMAC_SECRET` is an environment secret, never committed. Including `challenge_id` in the HMAC input prevents precomputing a single rainbow table that works across all challenges. This does not need bcrypt/argon2-style deliberate slowness — the security property we need here comes from the secret key + rate-limiting + attempt-count lockout + short TTL, not from hash cost.

**TTL.** Config value `OTP_TTL_SECONDS`, default `120`. **TZ §28 itself labels 120s a "proposal," not confirmed** — treat the default as an architecture placeholder, not a frozen business rule. The response (`expires_in_seconds` in `api-contract-g0.md`) always reflects the live config value, so a config change doesn't break the contract.

**Max verify attempts.** Config value `OTP_MAX_ATTEMPTS`, default `5` (stored per-challenge in `otp_challenges.max_attempts`, so a config change doesn't retroactively affect challenges already issued). TZ §02/§28 require "maximum OTP attempts" without a number — this default is an architecture judgment call, same category as TZ's own 120s proposal, not something requiring business sign-off to pick a reasonable starting value. Exceeding it moves `status` to `LOCKED` (terminal — the challenge cannot be retried; the client must request a new one).

**Rate limits (Redis-backed, per T-G0-4's own file list).** Proposed defaults, all tunable via env/config, none frozen as business policy:
| Scope | Window | Limit |
|---|---|---|
| per phone | 15 min | 5 OTP requests |
| per phone | rolling | 60s minimum gap between consecutive requests (the `resend_available_at` in the response) |
| per device_id | 1 hour | 10 OTP requests |
| per IP | 1 hour | 20 OTP requests |

Implementation: fixed-window counters in Redis, `INCR` + `EXPIRE` (or a small Lua script if atomicity across the increment+expire matters — recommended), keyed as `otp:req:phone:<sha256(phone)>`, `otp:req:device:<device_id>`, `otp:req:ip:<sha256(ip)>`. Phone and IP are hashed before use as Redis key material (not for the OTP code's own security — just to avoid plaintext PII sitting in Redis `MONITOR` output / RDB dumps, consistent with TZ §19's redaction expectations). `device_id` is a client-supplied opaque string (not PII by itself), stored as-is.

**SMS delivery vendor — genuinely unresolved, not an architecture decision.** TZ §02/§28 require "SMS OTP" but never name a vendor, short-code, or confirm a contract exists for Uzbekistan SMS delivery. This is an external/business dependency of the exact kind `docs/open-questions.md` exists to hold — **added as a new entry there** (see §6 below), not decided here. The G0 design unblocks all engineering work regardless: OTP delivery sits behind a `SmsSenderAdapter` interface (`send(phone, body): Promise<void>`), with a mock implementation that logs to stdout/console in dev and CI (never logs the actual code in plaintext per TZ §19 — logs `"OTP sent to +998***4567"` with the code itself redacted even in the mock). `POST /v1/auth/otp/request` enqueues the send as a fire-and-forget async job (not awaited synchronously) so a slow/down SMS provider never blocks the HTTP response; the `503 SMS_PROVIDER_UNAVAILABLE` case in the frozen contract is reserved for the rare case where the adapter itself throws synchronously before enqueueing (e.g. missing config at boot), not for delivery failures after the fact (those retry via the job queue with backoff and do not surface to the original caller at all).

## 2. Session / refresh token rotation mechanics

Two tables, not one, specifically to support **reuse detection** (TZ: "session rotation, refresh revoke"):

- `sessions` — one row per logical login (one per device/browser that completed OTP verify). Carries `status` (`ACTIVE`/`REVOKED`/`EXPIRED`) and audit metadata (`device_id`, `user_agent`, `ip_hash`).
- `refresh_tokens` — one row **per issued token**, chained via `rotated_to_id` (self-FK, nullable, unique). Carries its own `status` (`ACTIVE`/`ROTATED`/`REVOKED`).

Flow:
1. **Verify success** → create `Session(status=ACTIVE)` + first `RefreshToken(status=ACTIVE, sessionId=...)`. Return `access_token` (short-lived JWT, see §4) + the raw refresh token value (only the **hash** is persisted as `token_hash`; the raw value is never stored).
2. **Refresh** → look up `RefreshToken` by `hash(presented_token)`.
   - Not found → `401 SESSION_INVALID`.
   - Found, `status=ACTIVE`, not expired → in one transaction: mark this row `status=ROTATED, usedAt=now()`; create a new `RefreshToken` row on the same `sessionId`; set `rotatedToId` on the old row to the new row's id; update `Session.lastUsedAt`. Return new access+refresh pair.
   - Found, `status=ROTATED` or `REVOKED` → **reuse detected**. This token was already consumed or explicitly revoked — someone is presenting a stale/stolen token. Revoke the entire session (`Session.status=REVOKED`, cascade: every `RefreshToken` under that session gets `status=REVOKED` too, regardless of its own current status) and write an `audit_logs` row with `action="auth.refresh_token_reuse_detected"`. Respond `401 SESSION_INVALID` — the same generic code as any other invalid-refresh case; do not leak "reuse detected" in the client-facing message.
3. **Logout** → resolve `sessionId` from the access token's `sid` claim, set `Session.status=REVOKED` + all its `refresh_tokens.status=REVOKED`. Idempotent (revoking twice is a no-op 200).

Config defaults (same "proposal, not frozen business rule" caveat as OTP TTL): access token TTL `900s` (15 min), refresh token TTL `30 days`.

## 3. Admin RBAC: scope extensibility and the guard/decorator shape

**Why `admin_roles.scope` is `TEXT` + a migration-SQL `CHECK`, not a Prisma enum.** G0 only ever assigns *global* roles (no `seller_id`/`center_id` scoping exists yet, since `seller_members`/warehouse-staff tables aren't built until G1/G3). A Prisma enum works fine for a fixed, known value set — but the eventual value set here isn't fully known yet (it'll gain `SELLER` in G1 and `WAREHOUSE` in G3). `TEXT` + a `CHECK` constraint added via raw migration SQL lets a later migration simply `DROP CONSTRAINT` + re-`ADD CONSTRAINT` with a wider allowed list — a trivially additive, non-destructive change, no `ALTER TYPE` needed, no data migration for existing rows. The G0 migration should append:
```sql
ALTER TABLE public.admin_roles
  ADD CONSTRAINT admin_roles_scope_g0_check CHECK (scope = 'GLOBAL');
```

**Relationship to the full persona list (TZ §02).** `admin_roles`/`admin_permissions`/`admin_role_permissions` is designed as the **one canonical role/permission catalog for the whole platform**, not an admin-web-only concept despite the table name (inherited as-is from TZ §12's M08 table list, kept to avoid diverging from the already-written T-G0-3 ticket). In G0 it is seeded with only the personas that have no tenant scope and operate purely at the platform level:

| `admin_roles.code` | Persona (TZ §02) |
|---|---|
| `SUPER_ADMIN` | Super Admin |
| `SYSTEM_AUDITOR` | System Auditor |
| `MODERATOR` | Moderator |
| `FINANCE_MANAGER` | Finance Manager |
| `SUPPORT_AGENT` | Support Agent |

The remaining personas in TZ §02's list are **not** `admin_members` rows and must never become one:
- **Customer** — no explicit role row at all. Any `users` row with `status=ACTIVE` can act as a customer; TZ's own Guest→Customer distinction is "did OTP verify happen," not an RBAC grant.
- **Seller Owner / Manager / Operator** — will be `seller_members.role_id` (G1), referencing a *future* widened `admin_roles` (scope `SELLER`) or a dedicated lookup — not decided here, out of scope per the task brief ("don't invent the sellers table"). What G0 *does* guarantee: `users.id` is a stable UUID PK, and no seller-role column is ever added onto `users` or `admin_members` in G0 — so when `seller_members(id, seller_id, user_id, role_id, status, ...)` lands in G1, it is a pure additive table + FK, requiring zero changes to any G0 table. This is how "won't need a breaking migration when it arrives" is satisfied without creating `seller_members` itself now (T-G0-3 explicitly says its composite index is "not created here").
- **Warehouse roles (Manager/Receiving/QC/Picker/Packer/Dispatcher/Inventory Auditor), Courier** — same story, deferred to G3/G6 (`warehouse_tasks`/assignment tables, carrier assignment), no G0 table.

**Guard/decorator shape (service-layer design for T-G0-5, pseudocode — not production code, backend-dev writes the actual files):**
```
@RequirePermission(code: string)           // decorator, sets Reflector metadata
class PermissionGuard implements CanActivate {
  canActivate(ctx): boolean {
    const required = this.reflector.get('permission', ctx.getHandler());
    if (!required) return true; // no decorator = no check (should not happen on any real route — lint/review rule, not a runtime guarantee)
    return request.user.permissions.includes(required);
    // else throw ForbiddenException({ code: 'FORBIDDEN', ... })
  }
}

@RequireOwnership(resolve: (req, resource) => string)  // returns the resource's owner id
class OwnershipGuard implements CanActivate {
  canActivate(ctx): boolean {
    const ownerId = this.resolveFn(request, loadedResource);
    return ownerId === request.user.sub; // or request.user.sellerId once that claim exists
  }
}
```
`request.user.permissions` is a flat array of `"resource:action"` strings embedded in the JWT at issuance (login/refresh), computed by flattening `admin_role_permissions` for all of the user's `admin_members` rows. **Tradeoff, noted explicitly:** a permission grant/revoke takes effect only on the user's next token refresh (≤ access-token TTL, 15 min default), unless their session is explicitly revoked to force immediate re-auth. Acceptable for G0; revisit only if a future milestone (e.g. G5 payout approval) needs immediate revocation.

**Seed data needed to make T-G0-5's own acceptance test concrete** (so backend-dev doesn't have to invent values): seed `AdminPermission(resource='test', action='read')` (the throwaway permission T-G0-5's own ticket text names, `test:read`). Grant it to `SUPER_ADMIN` (super admin gets every seeded permission as a baseline). Do **not** grant it to `SUPPORT_AGENT`. Seed one `AdminMember` with role `SUPER_ADMIN` and one with role `SUPPORT_AGENT` — these are T-G0-3's "one Super Admin, one System Auditor" seed requirement's actual stand-ins for the *two different roles* T-G0-5 needs to prove `403` vs `200`; `SYSTEM_AUDITOR` should also be seeded per T-G0-3's literal wording but doesn't need to participate in the `test:read` check itself.

## 4. Access token claims shape

JWT payload (not a DB table — stateless):
```json
{
  "sub": "<user.id>",
  "sid": "<session.id>",
  "admin_roles": ["SUPER_ADMIN"],
  "permissions": ["test:read", "..."],
  "iat": 1760000000,
  "exp": 1760000900,
  "jti": "<uuid>"
}
```
A user with no `admin_members` rows gets `admin_roles: []`, `permissions: []` — they're still a valid authenticated customer (`sub`/`sid` are what `GET/PATCH /v1/me` and `/auth/logout` rely on), just with no elevated grants.

## 5. Admin MFA scaffold (T-G0-5) — service interface only, no HTTP route frozen

```
class AdminMfaService {
  enroll(adminMemberId): { secretReference: string, qrCodeUri: string }
  verify(adminMemberId, totpCode): boolean
}
```
`secretReference` points at a secret manager entry (consistent with ADR-001's "secret reference, not plaintext" rule) — the actual TOTP secret is never returned in a log or stored in plaintext in the DB. No controller/route exists yet because there is no admin login flow to attach enforcement to in G0 (admin members log in via the same `/v1/auth/otp/*` flow as everyone else right now). Do not invent an HTTP shape for this ahead of need — freezing one now risks a contract change later for no present benefit.

## 6. New open question raised by this pass

Added to `docs/open-questions.md` as a new appended entry (append-only, dated, per the conflict-resolution protocol): **which SMS gateway/vendor is actually contracted for Uzbekistan OTP delivery** (TZ §02/§28 require SMS OTP but never name a vendor, unlike Click/Payme which at least have named candidate providers in TZ §24). Severity HIGH, not BLOCKER — the mock `SmsSenderAdapter` (§1 above) fully unblocks G0 engineering and CI; it only becomes blocking before a real staging/production rollout that needs to actually deliver an SMS to a real phone.

## 7. Outbox index reconciliation (the specific ambiguity the task asked to resolve)

TZ contains two different specifications for `outbox_events` that don't literally agree:
- **§18** (hot indexes list): `outbox_events(status,created_at)` — implies a `status` column and a `created_at` column exist.
- **§30** (DB physical standard): columns `id,aggregate_type,aggregate_id,event_type,payload,occurred_at,published_at` (no `status`, no `created_at`) and hot index `outbox_events(published_at)`.

**Decision: keep both.** `prisma/schema.prisma`'s `OutboxEvent` model has `status` (enum `PENDING/PROCESSING/PUBLISHED/FAILED/DEAD_LETTER`), `created_at`, AND `published_at`, with both indexes (`[status, created_at]` and `[publishedAt]`) created.

**Why, not just "because the task said to reconcile":** TZ §19 requires a dead-letter queue + admin alert for poison messages ("Retry failed event processing via queue; poison messages to dead-letter queue and admin alert"). A nullable `published_at` timestamp alone can only express two states — "published" (non-null) vs "not yet published" (null) — it cannot distinguish "never attempted," "failed once, will retry," and "permanently dead-lettered," which §19's own dead-letter requirement needs to represent. §30's leaner column list is therefore read as an under-specification relative to §18 and §19's own requirements in the same document, not as an instruction to drop the richer model. The reconciliation keeps every column/index either section names and adds the few extra columns (`retry_count`, `next_attempt_at`, `last_error`, `locked_by`, `locked_at`) needed to make the worker design in §8 below actually implementable — these four are an architect addition beyond TZ's literal text, justified by standard transactional-outbox-worker practice (claim-with-lock, bounded retry, dead-letter), not a business fact requiring escalation.

## 8. Outbox drain worker design

Runs inside `worker.main.ts` (see `repo-structure.md`), as a BullMQ repeatable job (`outbox-dispatcher`, interval config e.g. 2s) — polling, not `LISTEN/NOTIFY`, for G0 simplicity (NOTIFY-based low-latency dispatch is a valid future optimization, not required now).

Each tick:
1. **Claim a batch**, same transaction:
   ```sql
   UPDATE platform.outbox_events
   SET status = 'PROCESSING', locked_by = $workerId, locked_at = now()
   WHERE id IN (
     SELECT id FROM platform.outbox_events
     WHERE status = 'PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= now())
     ORDER BY created_at
     LIMIT 100
     FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
   ```
   `FOR UPDATE SKIP LOCKED` is what makes this safe to run from multiple worker replicas later without a redesign.
2. For each claimed row, enqueue a corresponding BullMQ job onto a queue named after `event_type` (or one shared `domain-events` queue with `event_type` as job name — either works; pick one and keep it consistent) for in-process consumers (other NestJS modules within the same monolith, per ADR-001's module-boundary rule: this is *the* sanctioned path for async cross-module side effects).
3. On successful enqueue (not necessarily on consumer completion — enqueue-ack is "dispatched," consumer-ack is a separate concern handled by the inbox pattern, §9 below): `status='PUBLISHED', published_at=now()`.
4. On failure: `retry_count += 1`, `last_error=<message>`, `next_attempt_at = now() + backoff(retry_count)` (exponential, capped), `status` back to `PENDING`. After `retry_count` exceeds a configured max (default 10): `status='DEAD_LETTER'`. No dedicated alert channel exists yet (no Slack/email/Telegram integration confirmed anywhere in the TZ or open-questions.md) — the "admin alert" TZ §19 asks for is implemented as a Prometheus counter (`outbox_dead_letter_total`) + a structured error log line, both already wired by T-G0-6's observability stack; actual paging/notification on top of that metric is an ops-tooling decision outside this document's scope, not invented here.

## 9. Inbox dedup pattern (consumer side)

Every consumer handler for an outbox-sourced job, before doing its side effect:
```
beginTransaction():
  if exists InboxProcessedEvent(consumer=<this consumer's name>, eventId=<outbox event id>):
    commit (no-op); return  // already processed, at-least-once delivery handled safely
  <perform the side effect's DB writes here>
  insert InboxProcessedEvent(consumer, eventId)
commit()
```
The side effect and the inbox-row insert MUST be in the **same** transaction — this is what converts "the queue might redeliver this job" (at-least-once) into "the side effect happens at most once" (effectively-once processing). A consumer that does its side effect and then crashes before the inbox insert will simply redo the side effect on redelivery and insert the inbox row correctly the second time — but a consumer that does the insert outside the side-effect's transaction can end up "marked processed" without having actually done the work, which is the bug this pattern exists to prevent.

## 10. Docker Compose dev service list (requirements for T-G0-2 to satisfy; this document does not write the compose file itself)

| Service | Image/base | Notes |
|---|---|---|
| `postgres` | `postgres:16` (or current LTS) | Healthcheck required. No extension strictly required for G0 — Prisma generates UUIDs client-side (`@default(uuid())`), not via `gen_random_uuid()`/`pgcrypto` — so `init.sql` can be empty for G0, enabling `pgcrypto` preemptively is harmless but not required. |
| `redis` | `redis:7` | Backs OTP rate limiting (§1) and BullMQ (§8). |
| `minio` | `minio/minio` | Stood up per TZ §20 baseline even though no G0 endpoint uses object storage yet — document upload lands in G1. |
| `opensearch` | `opensearchproject/opensearch` | Behind a Compose **profile** (e.g. `--profile search`), per TZ §03's "when resource permitting" wording and T-G0-2's own "may be toggled" note — not started by default `docker compose up`. No G0 endpoint needs it. |
| `api` | built from `infra/docker/api.Dockerfile`, entrypoint `main.ts` | Depends on `postgres` (healthy) and `migration-runner` (completed). |
| `worker` | same image as `api`, built from `infra/docker/worker.Dockerfile`, entrypoint `worker.main.ts` | Depends on `postgres` (healthy), `redis` (healthy), `migration-runner` (completed). |
| `migration-runner` | same image as `api` | One-shot: `pnpm prisma migrate deploy`. `restart: "no"`. `api`/`worker` use `depends_on: migration-runner: condition: service_completed_successfully` (Compose v2 supports this condition natively). |
| `grafana`, `loki`, `prometheus` | standard images | Added by T-G0-6, extending this same compose file — not re-specified here, see that ticket. |

## 11. Index of every reconciliation/extension decision in this pass (for quick review)

1. Outbox `status`/`created_at` vs `published_at` — kept both (§7 above).
2. `admin_roles.scope` as `TEXT`+migration `CHECK`, not a Prisma enum — extensibility for G1/G3 (§3 above).
3. `audit_logs` immutability via a **DB-level trigger**, not an app-level guard only — chosen because audit integrity must survive any code path that touches the table directly (raw SQL, a careless future migration, admin tooling bypassing the service layer), which an app-level-only guard cannot promise. Migration SQL to append:
   ```sql
   CREATE OR REPLACE FUNCTION public.audit_logs_block_mutation()
   RETURNS trigger AS $$
   BEGIN
     RAISE EXCEPTION 'audit_logs is append-only: % not permitted', TG_OP;
   END;
   $$ LANGUAGE plpgsql;

   CREATE TRIGGER audit_logs_no_update
     BEFORE UPDATE ON public.audit_logs
     FOR EACH ROW EXECUTE FUNCTION public.audit_logs_block_mutation();

   CREATE TRIGGER audit_logs_no_delete
     BEFORE DELETE ON public.audit_logs
     FOR EACH ROW EXECUTE FUNCTION public.audit_logs_block_mutation();
   ```
4. `audit_logs.actor_id` has no FK constraint — deliberate, to support non-user actors (`SYSTEM`/`SERVICE`) and to never block/cascade on a future user anonymization/deletion flow (ties to open-questions.md #9, data residency/privacy).
5. `inbox_processed_events` composite PK interpreted as `(consumer, event_id)`, with `processed_at` as a plain non-key column — the only reading of TZ §30's phrasing that makes functional sense for a dedup table (see schema comments).
6. New open-questions.md entry: SMS OTP delivery vendor (§6 above).
