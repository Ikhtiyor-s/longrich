# T-G1-1 — Seller onboarding schema + migrations: sellers, applications, documents, members, bank accounts, contracts

**Requirement refs:** TZ §06 (MODUL M02 — SELLER ONBOARDING & PORTAL — DB table list), §28 (field validation: `legal_type` enum, `tax_id`/bank reference as strings with leading zeros retained, `legal_name` max255, public store name max120, bank info encrypted/masked), §29 (seller state transitions DRAFT→SUBMITTED→UNDER_REVIEW→APPROVED→ACTIVE; NEEDS_CHANGES/REJECTED/SUSPENDED), §30 (DB physical standard — UUID PK, timestamptz UTC, `updated_at`+`version`, tenant-scope-first composite index). Requirement IDs covered (schema only — behavior lands in later tickets): `SEL-001..009`, `ADM-002`. Milestone: G1.

**Migration:** NEW Prisma migration in this ticket. Every other G1 ticket builds on it and adds no migration of its own unless its own ticket text says otherwise.

## Goal
Write the first G1 migration adding the six seller-domain tables TZ §06 names (`sellers`, `seller_applications`, `seller_documents`, `seller_members`, `seller_bank_accounts`, `seller_contracts`) plus supporting enums and seed data, replacing the empty `sellers` module stub (`apps/api/src/modules/sellers/sellers.module.ts`, currently an ADR-001 placeholder) with real Prisma-backed providers — no controllers yet, those land in later G1 tickets.

## Files likely touched
- `prisma/schema.prisma` — six new models + `SellerStatus`, `SellerApplicationStatus`, `SellerMemberRole` (`OWNER`/`MANAGER`/`OPERATOR` per TZ §02), `DocumentVerificationStatus` enums
- `prisma/migrations/000X_seller_onboarding/migration.sql` (generated)
- `prisma/seed.ts` — extend G0's seed: (a) add a seeded admin member with the `MODERATOR` role (G0 only seeded `SUPER_ADMIN`/`SUPPORT_AGENT`/`SYSTEM_AUDITOR` — no moderator exists yet and G1's moderation ticket needs one to test against), (b) add new `admin_permissions` rows this milestone needs (e.g. `seller:moderate`, `seller:suspend`) wired to roles via the existing `admin_role_permissions` table/mechanism from `T-G0-3`/`T-G0-5`, no new mechanism invented
- `apps/api/src/modules/sellers/sellers.module.ts` — stops being an empty stub

## How we'll know it's done
- `prisma migrate dev` runs clean on a fresh Postgres and is idempotent on a second apply (same bar as `T-G0-3`).
- Schema matches TZ §30: UUID PK everywhere; `timestamptz` UTC on every timestamp column; `updated_at` + `version` on every mutable row (`sellers`, `seller_applications`, `seller_documents`, `seller_members`, `seller_bank_accounts` all mutate after creation); composite index `seller_members(seller_id, user_id)` exists exactly as TZ §30 names it.
- `sellers.tax_id` and `seller_bank_accounts.encrypted_reference` are string-typed columns, never numeric — proven by a round-trip test inserting a value with a leading zero and reading it back unchanged (TZ §28).
- `sellers.legal_type` is stored as an extensible lookup (string column validated against an app-level/config allowlist), **not** a closed Prisma native `enum`, per `docs/open-questions.md` #6 — the real set of Uzbekistan legal entity types is not legally confirmed yet, and a native DB enum would need a destructive migration to correct later.
- `seller_documents.object_key` stores only an object-storage reference, no file bytes in Postgres, consistent with ADR-001's S3/MinIO decision.
- Migration test passes on a fresh DB and on a DB with only `T-G0-3`'s migration already applied.
- Seed produces a fourth, distinct seeded admin member (`MODERATOR`) alongside G0's existing three.

## Owner role
`backend-dev`

## Depends on
T-G0-3
