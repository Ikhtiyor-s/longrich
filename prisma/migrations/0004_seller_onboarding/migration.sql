-- CreateEnum
CREATE TYPE "SellerStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'NEEDS_CHANGES', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SellerApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'NEEDS_CHANGES', 'REJECTED');

-- CreateEnum
CREATE TYPE "SellerMemberRole" AS ENUM ('OWNER', 'MANAGER', 'OPERATOR');

-- CreateEnum
CREATE TYPE "DocumentVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "sellers" (
    "id" UUID NOT NULL,
    "legal_name" VARCHAR(255) NOT NULL,
    "tax_id" VARCHAR(64) NOT NULL,
    "legal_type" VARCHAR(32) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "status" "SellerStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sellers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_applications" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "status" "SellerApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewer_id" UUID,
    "reason" TEXT,
    "contacts" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "seller_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_documents" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "object_key" TEXT NOT NULL,
    "file_name" VARCHAR(255),
    "mime_type" VARCHAR(128) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "verification_status" "DocumentVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "scanned_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "seller_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_members" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "SellerMemberRole" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "seller_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_bank_accounts" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "encrypted_reference" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "seller_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_contracts" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "signed_key" TEXT NOT NULL,
    "accepted_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sellers_status_idx" ON "sellers"("status");

-- CreateIndex
CREATE INDEX "seller_applications_seller_id_status_idx" ON "seller_applications"("seller_id", "status");

-- CreateIndex
CREATE INDEX "seller_documents_seller_id_type_idx" ON "seller_documents"("seller_id", "type");

-- CreateIndex
CREATE INDEX "seller_members_user_id_idx" ON "seller_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "seller_members_seller_id_user_id_key" ON "seller_members"("seller_id", "user_id");

-- CreateIndex
CREATE INDEX "seller_bank_accounts_seller_id_idx" ON "seller_bank_accounts"("seller_id");

-- CreateIndex
CREATE UNIQUE INDEX "seller_contracts_seller_id_version_key" ON "seller_contracts"("seller_id", "version");

-- AddForeignKey
ALTER TABLE "seller_applications" ADD CONSTRAINT "seller_applications_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_applications" ADD CONSTRAINT "seller_applications_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_documents" ADD CONSTRAINT "seller_documents_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_members" ADD CONSTRAINT "seller_members_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_members" ADD CONSTRAINT "seller_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_bank_accounts" ADD CONSTRAINT "seller_bank_accounts_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_contracts" ADD CONSTRAINT "seller_contracts_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
