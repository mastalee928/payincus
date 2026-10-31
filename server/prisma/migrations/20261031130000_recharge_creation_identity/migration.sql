ALTER TABLE "recharge_records" ADD COLUMN "creation_request_id" TEXT;
ALTER TABLE "recharge_records" ADD COLUMN "creation_request_hash" TEXT;
CREATE UNIQUE INDEX "recharge_records_user_id_creation_request_id_key"
  ON "recharge_records"("user_id", "creation_request_id");
