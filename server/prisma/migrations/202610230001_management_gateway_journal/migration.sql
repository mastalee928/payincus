CREATE TABLE "management_gateways" (
    "id" TEXT PRIMARY KEY,
    "platform_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL CHECK ("mode" IN ('local', 'remote', 'existing')),
    "target" JSONB NOT NULL,
    "target_hash" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL UNIQUE,
    "revision" BIGINT NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
    "retired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "management_gateways_platform_id_created_at_idx" ON "management_gateways" ("platform_id", "created_at");

CREATE TABLE "management_gateway_tasks" (
    "id" TEXT PRIMARY KEY,
    "gateway_id" TEXT NOT NULL REFERENCES "management_gateways" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "created_by_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL CHECK ("kind" IN ('inspect', 'install', 'attach', 'update')),
    "plan" JSONB NOT NULL,
    "plan_hash" TEXT NOT NULL,
    "based_on_revision" BIGINT NOT NULL CHECK ("based_on_revision" >= 0),
    "status" TEXT NOT NULL DEFAULT 'awaiting_confirmation' CHECK ("status" IN ('awaiting_confirmation', 'queued', 'running', 'needs_review', 'succeeded', 'failed', 'cancelled')),
    "approved_by_id" INTEGER,
    "approved_at" TIMESTAMP(3),
    "approval_expires_at" TIMESTAMP(3),
    "credentials_encrypted" TEXT,
    "credentials_expire_at" TIMESTAMP(3),
    "lease_token" TEXT,
    "lease_until" TIMESTAMP(3),
    "attempt" INTEGER NOT NULL DEFAULT 0 CHECK ("attempt" >= 0),
    "error_code" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CHECK ("status" <> 'running' OR ("lease_token" IS NOT NULL AND "lease_until" IS NOT NULL)),
    CHECK ("kind" = 'inspect' OR "status" NOT IN ('queued', 'running', 'succeeded') OR ("approved_by_id" IS NOT NULL AND "approved_at" IS NOT NULL AND "approval_expires_at" IS NOT NULL))
);
CREATE INDEX "management_gateway_tasks_status_lease_until_created_at_idx" ON "management_gateway_tasks" ("status", "lease_until", "created_at");
CREATE INDEX "management_gateway_tasks_gateway_id_created_at_idx" ON "management_gateway_tasks" ("gateway_id", "created_at" DESC);
-- An interrupted intent keeps the machine reserved until it is reconciled.
CREATE UNIQUE INDEX "management_gateway_tasks_one_active_target" ON "management_gateway_tasks" ("gateway_id") WHERE "status" IN ('queued', 'running', 'needs_review');

CREATE TABLE "management_gateway_steps" (
    "task_id" TEXT NOT NULL REFERENCES "management_gateway_tasks" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "key" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL CHECK ("ordinal" >= 0),
    "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'started', 'succeeded')),
    "operation_id" TEXT NOT NULL UNIQUE,
    "receipt" JSONB,
    "receipt_hash" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    PRIMARY KEY ("task_id", "key"),
    UNIQUE ("task_id", "ordinal"),
    CHECK ("status" <> 'succeeded' OR ("receipt" IS NOT NULL AND "receipt_hash" IS NOT NULL AND "completed_at" IS NOT NULL))
);
