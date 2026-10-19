-- 0006_seller_bank_account_review (T-G1-8, TZ §06 SEL-008 / §28 / §34).
-- seller_bank_accounts (T-G1-1) only carries a `verified` boolean — no
-- reviewer attribution. This ticket's approve/reject review action reuses
-- T-G1-5's reviewer-recording convention (seller_applications.reviewer_id),
-- not seller_applications' own status enum — a bank account isn't an
-- application, see this ticket's own design note. No new status enum is
-- added here: verified stays a plain boolean, and reviewed_at IS NULL is
-- what distinguishes "never reviewed" (pending) from "reviewed"
-- (verified = true -> approved, verified = false -> rejected).
--
-- Both columns are nullable with no default: every existing
-- seller_bank_accounts row (T-G1-1 onward) has neither set, and there is no
-- sensible non-null default for either. reviewer_id is ON DELETE SET NULL,
-- the same FK behavior seller_applications.reviewer_id -> users.id (T-G1-1)
-- already uses: a reviewed row survives even if the reviewing admin's user
-- record is later removed.
--
-- Written idempotently (IF NOT EXISTS for columns, a DO block with a
-- duplicate_object exception guard for the constraint) so a repeat
-- `prisma migrate deploy` run never errors on an already-migrated
-- environment, matching 0002/0003/0005's own pattern.
--
-- Rollback (manual — safe, drops only the two added columns, no table/data loss):
--   ALTER TABLE "seller_bank_accounts" DROP CONSTRAINT IF EXISTS "seller_bank_accounts_reviewer_id_fkey";
--   ALTER TABLE "seller_bank_accounts" DROP COLUMN IF EXISTS "reviewer_id";
--   ALTER TABLE "seller_bank_accounts" DROP COLUMN IF EXISTS "reviewed_at";

-- AlterTable
ALTER TABLE "seller_bank_accounts" ADD COLUMN IF NOT EXISTS "reviewer_id" UUID;
ALTER TABLE "seller_bank_accounts" ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMPTZ;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "seller_bank_accounts" ADD CONSTRAINT "seller_bank_accounts_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
