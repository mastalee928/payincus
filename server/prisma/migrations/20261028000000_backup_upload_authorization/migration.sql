-- Legacy queued tasks have no verifiable original authorization/target. The
-- worker rejects them explicitly; do not synthesize consent from current rows.
ALTER TABLE "backup_upload_tasks"
  ADD COLUMN "actor_sid" TEXT,
  ADD COLUMN "actor_iat" INTEGER,
  ADD COLUMN "identity_hash" TEXT;
