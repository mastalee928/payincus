ALTER TABLE "restore_tasks"
  ADD COLUMN "owner_id" INTEGER,
  ADD COLUMN "actor_sid" TEXT,
  ADD COLUMN "actor_iat" INTEGER,
  ADD COLUMN "identity_hash" TEXT,
  ADD COLUMN "attempt_id" UUID;
