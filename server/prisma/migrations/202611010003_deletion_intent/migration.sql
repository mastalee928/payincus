-- Preserve accepted deletion and its original authority/identity across outages.
ALTER TABLE "instances" ADD COLUMN "deletion_intent" JSONB;
CREATE INDEX "instances_deletion_retry_idx" ON "instances" ((deletion_intent->>'nextAttemptAt'))
  WHERE deletion_billing_pending AND deletion_intent IS NOT NULL;
