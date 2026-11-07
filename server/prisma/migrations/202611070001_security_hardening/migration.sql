-- Non-secret, durable per-host security maintenance queue and verification receipt.
ALTER TABLE "hosts" ADD COLUMN "security_hardening" JSONB;
