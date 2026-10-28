ALTER TABLE "backup_upload_tasks"
  ADD COLUMN "attempt_id" UUID,
  ADD COLUMN "next_attempt_at" TIMESTAMP(3);
