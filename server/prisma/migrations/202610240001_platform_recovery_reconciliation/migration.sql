CREATE TABLE "platform_recovery_reconciliations" (
  "id" UUID NOT NULL PRIMARY KEY,
  "hold_task_id" UUID NOT NULL,
  "actor_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "reference" TEXT NOT NULL,
  "observed_at" TIMESTAMP(3) NOT NULL,
  "payload_hash" TEXT NOT NULL CHECK ("payload_hash" ~ '^[a-f0-9]{64}$'),
  "payload" JSONB NOT NULL,
  "result" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "platform_recovery_evidence_key"
  ON "platform_recovery_reconciliations"("hold_task_id", "user_id", "reference");
CREATE INDEX "platform_recovery_hold_created_idx"
  ON "platform_recovery_reconciliations"("hold_task_id", "created_at");
