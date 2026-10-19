# T-G0-3 — Initial Prisma schema + migrations: identity, RBAC, outbox/inbox, audit

**Requirement refs:** TZ §18 (DB design and migrations — "initial entity inventory, NOT final executable SQL schema... Claude must produce full Prisma schema"), §30 (DB physical standard — UUID PK, timestamptz UTC, money BIGINT minor units, hot indexes), §02 (personas/RBAC), §12/M08 table list (`admin_roles`, `admin_permissions`, `admin_role_permissions`, `admin_members`, `audit_logs`). Requirement IDs: `ADM-007` (Admin RBAC), `ADM-008` (Audit log). Milestone: G0.

## Goal
Write the first forward-only Prisma migration covering only the identity + RBAC + cross-cutting infra tables needed before any auth code runs: `users`, `admin_roles`, `admin_permissions`, `admin_role_permissions`, `admin_members`, `audit_logs`, plus the platform-wide `platform.outbox_events`, `commerce.idempotency_keys`, `platform.inbox_processed_events` tables mandated by TZ §30 for every later module to build on.

## Files likely touched
- `prisma/schema.prisma`
- `prisma/migrations/0001_identity_rbac_outbox/migration.sql` (generated)
- `prisma/seed.ts` — deterministic seed: one Super Admin, one System Auditor, baseline permission set (per TZ §36 "deterministic seed")

## How we'll know it's done
- `prisma migrate dev` runs clean on a fresh Postgres (via T-G0-2's compose) and again on a second run (idempotent/no-op second apply).
- Schema matches TZ §30 physical standard: UUID PK on every table, `timestamptz` UTC on every timestamp column, `users.phone` unique + indexed, composite index `seller_members(seller_id,user_id)` is **not** created here (seller tables are G1 scope) but the indexing *pattern* (tenant-scope-first composite index) is demonstrably followed on `admin_role_permissions(role_id, permission_id)`.
- `audit_logs` table is append-only by design: no `updated_at`, no delete cascade from any other table, and a DB-level check/trigger (or documented app-level guard, whichever the architect decides) preventing UPDATE/DELETE from the ORM layer — ticket must state which approach was chosen and why.
- `commerce.idempotency_keys` has composite PK `(scope, key)` exactly as specified in TZ §30.
- Migration test: run on fresh DB and on a DB that already has the previous migration applied (even if previous = none yet) — both succeed.

## Owner role
`backend-dev`

## Depends on
T-G0-1, T-G0-2
