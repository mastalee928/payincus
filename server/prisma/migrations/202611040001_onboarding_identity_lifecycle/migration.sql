-- Explicit current-system inspection and durable, scoped gateway cleanup.
ALTER TABLE "host_onboarding_nodes" ADD COLUMN "identity_reset" JSONB;
ALTER TABLE "host_onboarding_nodes" ADD COLUMN "peer_retirement" JSONB;
