ALTER TABLE "proxy_sites"
ADD COLUMN "ipv4_sync_pending" BOOLEAN NOT NULL DEFAULT false;
