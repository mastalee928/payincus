ALTER TABLE "management_gateway_tasks"
    ADD COLUMN "preparation_state" TEXT CHECK ("preparation_state" IN ('queued', 'running', 'ready', 'failed')),
    ADD COLUMN "installation" JSONB,
    ADD COLUMN "installation_preview" JSONB,
    ADD COLUMN "installation_receipt" JSONB,
    ADD COLUMN "bootstrap_encrypted" TEXT,
    ADD COLUMN "bootstrap_expires_at" TIMESTAMP(3),
    ADD COLUMN "approved_credential_hash" TEXT,
    ADD COLUMN "approved_session_id" TEXT,
    ADD CONSTRAINT "management_gateway_installation_preparation_kind" CHECK
      ("preparation_state" IS NULL OR ("kind" = 'install' AND "installation" IS NOT NULL)),
    ADD CONSTRAINT "management_gateway_installation_prepared" CHECK
      ("preparation_state" IS DISTINCT FROM 'ready' OR "installation_preview" IS NOT NULL),
    ADD CONSTRAINT "management_gateway_installation_bootstrap" CHECK
      (("bootstrap_encrypted" IS NULL AND "bootstrap_expires_at" IS NULL) OR
       ("bootstrap_encrypted" IS NOT NULL AND "bootstrap_expires_at" IS NOT NULL AND "kind" = 'install'));

CREATE TABLE "management_gateway_mfa_replays" (
    "user_id" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "step" BIGINT NOT NULL CHECK ("step" > 0),
    PRIMARY KEY ("user_id", "step")
);
