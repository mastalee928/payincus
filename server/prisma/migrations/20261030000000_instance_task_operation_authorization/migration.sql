ALTER TABLE "instance_tasks"
  ADD COLUMN "operation_owner_id" INTEGER,
  ADD COLUMN "actor_sid" TEXT,
  ADD COLUMN "actor_iat" INTEGER,
  ADD COLUMN "operation_entry" TEXT,
  ADD COLUMN "operation_identity" TEXT;

-- Older destructive tasks lack the original actor and machine authorization.
-- Keep their records; execution rejects them without synthesizing new consent.
