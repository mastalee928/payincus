-- Durable, non-secret receipts for automatic repair of established host records.
ALTER TABLE "hosts" ADD COLUMN "management_repair" JSONB;
ALTER TABLE "hosts" ADD COLUMN "install_pending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "host_agents" ADD COLUMN "install_token_keeps_identity" BOOLEAN NOT NULL DEFAULT false;
