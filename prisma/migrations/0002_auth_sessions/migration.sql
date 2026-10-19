-- T-G0-4: otp_challenges, sessions, refresh_tokens (see docs/architecture/g0-design-notes.md §2).
-- Written idempotently (IF NOT EXISTS / duplicate_object-safe DO blocks) so a repeat
-- `prisma migrate deploy` run never errors on an already-applied environment.
--
-- Rollback (manual — run only if this migration must be reverted; destroys OTP/session
-- data, do not run against an environment with live sessions without a backup):
--   DROP TABLE IF EXISTS "refresh_tokens" CASCADE;
--   DROP TABLE IF EXISTS "sessions" CASCADE;
--   DROP TABLE IF EXISTS "otp_challenges" CASCADE;
--   DROP TYPE IF EXISTS "RefreshTokenStatus";
--   DROP TYPE IF EXISTS "SessionStatus";
--   DROP TYPE IF EXISTS "OtpChallengeStatus";

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "OtpChallengeStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'LOCKED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "RefreshTokenStatus" AS ENUM ('ACTIVE', 'ROTATED', 'REVOKED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "otp_challenges" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "phone" VARCHAR(20) NOT NULL,
    "purpose" VARCHAR(32) NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "status" "OtpChallengeStatus" NOT NULL DEFAULT 'PENDING',
    "device_id" TEXT,
    "ip_hash" TEXT,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "verified_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" TEXT,
    "user_agent" TEXT,
    "ip_hash" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_used_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "revoked_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "RefreshTokenStatus" NOT NULL DEFAULT 'ACTIVE',
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "rotated_to_id" UUID,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "otp_challenges_phone_status_created_at_idx" ON "otp_challenges"("phone", "status", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "otp_challenges_expires_at_idx" ON "otp_challenges"("expires_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "sessions_user_id_status_idx" ON "sessions"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_rotated_to_id_key" ON "refresh_tokens"("rotated_to_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "refresh_tokens_session_id_status_idx" ON "refresh_tokens"("session_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_rotated_to_id_fkey" FOREIGN KEY ("rotated_to_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
