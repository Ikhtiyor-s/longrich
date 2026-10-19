-- CreateEnum
CREATE TYPE "CategoryStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'CHANGES_REQUESTED', 'REJECTED', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VariantStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'CHANGES_REQUESTED', 'REJECTED', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "IdentifierType" AS ENUM ('GTIN', 'EAN', 'UPC', 'MXIK');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MediaModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MergeCaseStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "slug" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "status" "CategoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "requires_certification" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_attributes" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "label" VARCHAR(255) NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "validation" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "category_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(255) NOT NULL,
    "logo_object_key" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "brand_id" UUID,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "canonical_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "options" JSONB NOT NULL,
    "options_hash" VARCHAR(64) NOT NULL,
    "status" "VariantStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_attribute_values" (
    "id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "category_attribute_id" UUID NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "product_attribute_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_identifiers" (
    "id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "type" "IdentifierType" NOT NULL,
    "value" VARCHAR(64) NOT NULL,
    "classification_version" VARCHAR(32),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_identifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_offers" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "sku" VARCHAR(128) NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "fulfillment_mode" VARCHAR(32) NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "seller_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_price_history" (
    "id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "old_price_minor" BIGINT,
    "new_price_minor" BIGINT NOT NULL,
    "changed_by" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_media" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "object_key" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "mime_type" VARCHAR(128) NOT NULL,
    "moderation_status" "MediaModerationStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "product_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_merge_cases" (
    "id" UUID NOT NULL,
    "winning_product_id" UUID NOT NULL,
    "losing_product_id" UUID NOT NULL,
    "identifier_type" VARCHAR(16) NOT NULL,
    "identifier_value" VARCHAR(64) NOT NULL,
    "status" "MergeCaseStatus" NOT NULL DEFAULT 'PENDING',
    "manual_resolution_required" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "product_merge_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_cases" (
    "id" UUID NOT NULL,
    "entity_type" VARCHAR(32) NOT NULL,
    "entity_id" UUID NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "moderation_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_decisions" (
    "id" UUID NOT NULL,
    "entity_type" VARCHAR(32) NOT NULL,
    "entity_id" UUID NOT NULL,
    "moderation_case_id" UUID,
    "outcome" VARCHAR(32) NOT NULL,
    "reason" TEXT,
    "decided_by" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "category_attributes_category_id_key_key" ON "category_attributes"("category_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "brands_name_key" ON "brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- CreateIndex
CREATE INDEX "products_category_id_status_idx" ON "products"("category_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_id_options_hash_key" ON "product_variants"("product_id", "options_hash");

-- CreateIndex
CREATE UNIQUE INDEX "product_attribute_values_variant_id_category_attribute_id_key" ON "product_attribute_values"("variant_id", "category_attribute_id");

-- CreateIndex
CREATE INDEX "product_identifiers_type_value_idx" ON "product_identifiers"("type", "value");

-- CreateIndex
CREATE INDEX "seller_offers_seller_id_variant_id_idx" ON "seller_offers"("seller_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "seller_offers_seller_id_sku_key" ON "seller_offers"("seller_id", "sku");

-- CreateIndex
CREATE INDEX "offer_price_history_offer_id_changed_at_idx" ON "offer_price_history"("offer_id", "changed_at");

-- CreateIndex
CREATE INDEX "product_media_product_id_idx" ON "product_media"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_merge_cases_winning_product_id_losing_product_id_id_key" ON "product_merge_cases"("winning_product_id", "losing_product_id", "identifier_value");

-- CreateIndex
CREATE INDEX "moderation_cases_entity_type_status_idx" ON "moderation_cases"("entity_type", "status");

-- CreateIndex
CREATE INDEX "moderation_decisions_entity_type_entity_id_idx" ON "moderation_decisions"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_canonical_id_fkey" FOREIGN KEY ("canonical_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_category_attribute_id_fkey" FOREIGN KEY ("category_attribute_id") REFERENCES "category_attributes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_identifiers" ADD CONSTRAINT "product_identifiers_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_offers" ADD CONSTRAINT "seller_offers_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_offers" ADD CONSTRAINT "seller_offers_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_price_history" ADD CONSTRAINT "offer_price_history_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "seller_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_merge_cases" ADD CONSTRAINT "product_merge_cases_winning_product_id_fkey" FOREIGN KEY ("winning_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_merge_cases" ADD CONSTRAINT "product_merge_cases_losing_product_id_fkey" FOREIGN KEY ("losing_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_moderation_case_id_fkey" FOREIGN KEY ("moderation_case_id") REFERENCES "moderation_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- seller_offers.price_minor > 0 (TZ §28) is not expressible in schema.prisma
-- DSL, same reasoning as admin_roles.scope's CHECK in 0001.
ALTER TABLE "seller_offers" ADD CONSTRAINT "seller_offers_price_minor_positive_check" CHECK ("price_minor" > 0);

-- Rollback (manual, destructive — drops every table this migration creates):
--   ALTER TABLE "moderation_decisions" DROP CONSTRAINT "moderation_decisions_moderation_case_id_fkey";
--   DROP TABLE "moderation_decisions";
--   DROP TABLE "moderation_cases";
--   DROP TABLE "product_merge_cases";
--   DROP TABLE "product_media";
--   DROP TABLE "offer_price_history";
--   DROP TABLE "seller_offers";
--   DROP TABLE "product_identifiers";
--   DROP TABLE "product_attribute_values";
--   DROP TABLE "product_variants";
--   DROP TABLE "products";
--   DROP TABLE "brands";
--   DROP TABLE "category_attributes";
--   DROP TABLE "categories";
--   DROP TYPE "MergeCaseStatus";
--   DROP TYPE "MediaModerationStatus";
--   DROP TYPE "OfferStatus";
--   DROP TYPE "IdentifierType";
--   DROP TYPE "VariantStatus";
--   DROP TYPE "ProductStatus";
--   DROP TYPE "CategoryStatus";
