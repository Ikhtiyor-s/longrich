-- 0003_mutable_entities_updated_at (G0 QA review major #7, TZ §30 "mutable
-- entities carry updated_at/version"). refresh_tokens and platform.outbox_events
-- are both mutated after creation (status/retry fields) but had no updated_at
-- column. Written idempotently so a repeat `prisma migrate deploy` run never
-- errors on an already-applied environment, and safe against tables that
-- already hold rows (backfills from each table's own creation timestamp before
-- the NOT NULL constraint is applied). No DB-level DEFAULT is added, matching
-- every other updated_at column in this schema (Prisma's @updatedAt always
-- supplies the value on create/update; see migration.sql for 0001/0002).
--
-- version columns (true optimistic-concurrency CAS) are explicitly NOT added
-- here — see docs/architecture/g0-design-notes.md and the QA review response
-- for why: Blocker #1's OTP attempt-counter race is fixed via a
-- compare-and-swap keyed on the existing attempts_count column itself (same
-- pattern refresh_tokens' own status-keyed CAS already used), not a separate
-- version counter, so no schema change was required for that fix. A
-- project-wide version-column standard is flagged as a follow-up, not decided
-- here, to avoid scope-creeping this migration into redesigning every G0
-- table's concurrency strategy.
--
-- Rollback (manual — safe, drops only the two added columns, no table/data loss):
--   ALTER TABLE "refresh_tokens" DROP COLUMN IF EXISTS "updated_at";
--   ALTER TABLE "platform"."outbox_events" DROP COLUMN IF EXISTS "updated_at";

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ;
UPDATE "refresh_tokens" SET "updated_at" = "issued_at" WHERE "updated_at" IS NULL;
ALTER TABLE "refresh_tokens" ALTER COLUMN "updated_at" SET NOT NULL;

-- AlterTable
ALTER TABLE "platform"."outbox_events" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ;
UPDATE "platform"."outbox_events" SET "updated_at" = COALESCE("published_at", "created_at") WHERE "updated_at" IS NULL;
ALTER TABLE "platform"."outbox_events" ALTER COLUMN "updated_at" SET NOT NULL;
