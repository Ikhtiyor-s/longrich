-- 0005_seller_profile_fields (T-G1-6, TZ §06 SEL-004 / spreadsheet AC-SEL-004
-- gloss "Profil, logotip, working hours, delivery terms"). T-G1-1's sellers
-- table only carries legal_name/tax_id/legal_type/display_name/status — none
-- of the shop-profile fields this ticket's GET/PATCH /v1/seller/profile
-- needs to read/write exist yet, so this is a small additive migration of
-- its own (not covered by 0004), exactly as the ticket's own "Migration"
-- note anticipates.
--
-- All four columns are nullable with no default: every existing sellers row
-- (T-G1-1 onward) has none of these set, and there is no sensible non-null
-- placeholder for free-text shop content. logo_object_key is an
-- object-storage reference only (ADR-001 "no file bytes in Postgres"), same
-- shape as seller_documents.object_key — no file upload endpoint is added by
-- this ticket.
--
-- Written idempotently (IF NOT EXISTS) so a repeat `prisma migrate deploy`
-- run never errors on an already-migrated environment, matching 0003's
-- pattern. No backfill needed (nullable, no NOT NULL constraint added).
--
-- Rollback (manual — safe, drops only the four added columns, no table/data loss):
--   ALTER TABLE "sellers" DROP COLUMN IF EXISTS "description";
--   ALTER TABLE "sellers" DROP COLUMN IF EXISTS "logo_object_key";
--   ALTER TABLE "sellers" DROP COLUMN IF EXISTS "working_hours";
--   ALTER TABLE "sellers" DROP COLUMN IF EXISTS "delivery_terms";

-- AlterTable
ALTER TABLE "sellers" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "sellers" ADD COLUMN IF NOT EXISTS "logo_object_key" TEXT;
ALTER TABLE "sellers" ADD COLUMN IF NOT EXISTS "working_hours" TEXT;
ALTER TABLE "sellers" ADD COLUMN IF NOT EXISTS "delivery_terms" TEXT;
