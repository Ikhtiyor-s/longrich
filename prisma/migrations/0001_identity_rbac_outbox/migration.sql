-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "commerce";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "platform";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('UZ', 'RU');

-- CreateEnum
CREATE TYPE "AdminMemberStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "platform"."OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "commerce"."IdempotencyKeyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "phone_verified_at" TIMESTAMPTZ,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "locale" "Locale" NOT NULL DEFAULT 'UZ',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_roles" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" TEXT NOT NULL,
    "scope" VARCHAR(32) NOT NULL DEFAULT 'GLOBAL',
    "description" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_permissions" (
    "id" UUID NOT NULL,
    "resource" VARCHAR(64) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "admin_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "admin_role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "admin_members" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "status" "AdminMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "admin_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_type" VARCHAR(16) NOT NULL,
    "action" VARCHAR(128) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" VARCHAR(64),
    "before_json" JSONB,
    "after_json" JSONB,
    "request_id" TEXT,
    "trace_id" TEXT,
    "ip_hash" TEXT,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."outbox_events" (
    "id" UUID NOT NULL,
    "aggregate_type" VARCHAR(64) NOT NULL,
    "aggregate_id" VARCHAR(64) NOT NULL,
    "event_type" VARCHAR(128) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "platform"."OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "locked_by" TEXT,
    "locked_at" TIMESTAMPTZ,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."inbox_processed_events" (
    "consumer" VARCHAR(128) NOT NULL,
    "event_id" UUID NOT NULL,
    "processed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_processed_events_pkey" PRIMARY KEY ("consumer","event_id")
);

-- CreateTable
CREATE TABLE "commerce"."idempotency_keys" (
    "scope" VARCHAR(64) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_payload" JSONB,
    "status" "commerce"."IdempotencyKeyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("scope","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "admin_roles_code_key" ON "admin_roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "admin_permissions_resource_action_key" ON "admin_permissions"("resource", "action");

-- CreateIndex
CREATE INDEX "admin_members_user_id_idx" ON "admin_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_members_user_id_role_id_key" ON "admin_members"("user_id", "role_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_occurred_at_idx" ON "audit_logs"("occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "outbox_events_status_created_at_idx" ON "platform"."outbox_events"("status", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_published_at_idx" ON "platform"."outbox_events"("published_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "commerce"."idempotency_keys"("expires_at");

-- AddForeignKey
ALTER TABLE "admin_role_permissions" ADD CONSTRAINT "admin_role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "admin_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_role_permissions" ADD CONSTRAINT "admin_role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "admin_permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_members" ADD CONSTRAINT "admin_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_members" ADD CONSTRAINT "admin_members_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "admin_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform"."inbox_processed_events" ADD CONSTRAINT "inbox_processed_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "platform"."outbox_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- G0 only ever assigns GLOBAL-scope admin roles (seller_members/warehouse-staff
-- scoping tables don't exist until G1/G3). scope is TEXT, not a Prisma enum, so
-- a later migration can widen this list (ADD 'SELLER', 'WAREHOUSE', ...) via a
-- plain DROP/ADD CONSTRAINT instead of an ALTER TYPE + data migration.
-- See docs/architecture/g0-design-notes.md §3.
ALTER TABLE "admin_roles"
  ADD CONSTRAINT "admin_roles_scope_g0_check" CHECK (scope = 'GLOBAL');

-- audit_logs is append-only by design (ADM-008). A DB-level trigger is used
-- instead of relying on application discipline alone, because audit integrity
-- must survive raw SQL, admin tooling, or a careless future migration that
-- bypasses the service layer. See docs/architecture/g0-design-notes.md §11.3.
CREATE OR REPLACE FUNCTION audit_logs_block_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();

CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();
