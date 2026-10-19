-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('UPLOADED', 'VALIDATING', 'READY', 'IMPORTING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "catalog_import_jobs" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'UPLOADED',
    "object_key" TEXT NOT NULL,
    "content_hash" VARCHAR(64),
    "total_rows" INTEGER,
    "valid_row_count" INTEGER,
    "error_row_count" INTEGER,
    "duplicate_of_job_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "catalog_import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_import_rows" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "seller_offer_id" UUID,
    "product_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_import_errors" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "field" VARCHAR(64) NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_import_errors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "catalog_import_jobs_seller_id_status_idx" ON "catalog_import_jobs"("seller_id", "status");

-- CreateIndex
CREATE INDEX "catalog_import_rows_job_id_idx" ON "catalog_import_rows"("job_id");

-- CreateIndex
CREATE INDEX "catalog_import_errors_job_id_created_at_idx" ON "catalog_import_errors"("job_id", "created_at");

-- AddForeignKey
ALTER TABLE "catalog_import_jobs" ADD CONSTRAINT "catalog_import_jobs_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_import_jobs" ADD CONSTRAINT "catalog_import_jobs_duplicate_of_job_id_fkey" FOREIGN KEY ("duplicate_of_job_id") REFERENCES "catalog_import_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_import_rows" ADD CONSTRAINT "catalog_import_rows_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "catalog_import_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_import_rows" ADD CONSTRAINT "catalog_import_rows_seller_offer_id_fkey" FOREIGN KEY ("seller_offer_id") REFERENCES "seller_offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_import_rows" ADD CONSTRAINT "catalog_import_rows_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_import_errors" ADD CONSTRAINT "catalog_import_errors_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "catalog_import_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Duplicate-upload dedup (api-contract-g2.md T-G2-8: "Unique (seller_id,
-- content_hash) partial ... only enforced where content_hash IS NOT NULL
-- AND status != 'FAILED'"). Not expressible as a Prisma @@unique (no WHERE
-- clause support in the schema DSL), same reasoning as seller_offers.price_minor's
-- CHECK constraint in migration 0008 — added as raw SQL here.
CREATE UNIQUE INDEX "catalog_import_jobs_seller_id_content_hash_active_key"
  ON "catalog_import_jobs"("seller_id", "content_hash")
  WHERE "content_hash" IS NOT NULL AND "status" != 'FAILED';

-- Rollback (manual, destructive — drops every table/index this migration creates):
--   DROP INDEX "catalog_import_jobs_seller_id_content_hash_active_key";
--   ALTER TABLE "catalog_import_errors" DROP CONSTRAINT "catalog_import_errors_job_id_fkey";
--   ALTER TABLE "catalog_import_rows" DROP CONSTRAINT "catalog_import_rows_product_id_fkey";
--   ALTER TABLE "catalog_import_rows" DROP CONSTRAINT "catalog_import_rows_seller_offer_id_fkey";
--   ALTER TABLE "catalog_import_rows" DROP CONSTRAINT "catalog_import_rows_job_id_fkey";
--   ALTER TABLE "catalog_import_jobs" DROP CONSTRAINT "catalog_import_jobs_duplicate_of_job_id_fkey";
--   ALTER TABLE "catalog_import_jobs" DROP CONSTRAINT "catalog_import_jobs_seller_id_fkey";
--   DROP TABLE "catalog_import_errors";
--   DROP TABLE "catalog_import_rows";
--   DROP TABLE "catalog_import_jobs";
--   DROP TYPE "ImportJobStatus";
