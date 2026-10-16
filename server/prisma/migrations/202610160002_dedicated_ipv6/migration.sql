-- Observed host addresses and verified customer mappings are kept separately.
ALTER TABLE "hosts" ADD COLUMN "public_ipv6_sync" JSONB;
ALTER TABLE "instances" ADD COLUMN "dedicated_ipv6" JSONB;
