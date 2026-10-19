-- 0007_seller_bank_account_raw_reference_rename (G1 QA review major #4).
-- seller_bank_accounts.encrypted_reference (T-G1-1) is, and has always
-- been, plaintext — there is no real encryption-at-rest for this column,
-- only response-layer masking (bank-accounts.mapper.ts's
-- maskBankReference, which is correctly implemented and is NOT the problem
-- being fixed here). The old name misleadingly implied encryption already
-- happened. Renamed now, while there is zero real production data, to stop
-- a future reader of the schema from assuming otherwise. Encryption-at-rest
-- itself stays a known, tracked pre-production gap (docs/open-questions.md)
-- — explicitly NOT implemented by this migration.
--
-- A column RENAME is additive-safe: no data loss, no type change, every
-- existing row's value is preserved under the new name.
--
-- Rollback (manual — safe, renames the column back, no data loss):
--   ALTER TABLE "seller_bank_accounts" RENAME COLUMN "raw_reference" TO "encrypted_reference";

-- Written idempotently (guarded by an information_schema existence check,
-- since Postgres has no "RENAME COLUMN IF EXISTS") so a repeat run never
-- errors on an already-migrated environment, matching 0002/0003/0005/0006's
-- own pattern.

-- AlterTable
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'seller_bank_accounts' AND column_name = 'encrypted_reference'
  ) THEN
    ALTER TABLE "seller_bank_accounts" RENAME COLUMN "encrypted_reference" TO "raw_reference";
  END IF;
END $$;
