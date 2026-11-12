-- No backfill: existing instances keep their current pricing and paid ledger.
ALTER TABLE "instances" ADD COLUMN "renewal_price" DECIMAL(10,2);
ALTER TABLE "instances" ADD CONSTRAINT "instances_renewal_price_range"
  CHECK ("renewal_price" IS NULL OR ("renewal_price" >= 0 AND "renewal_price" <= 100000));
