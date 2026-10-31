ALTER TABLE "recharge_records" ADD COLUMN "cancel_reason" TEXT;
CREATE TABLE "recharge_late_payments" (
  "id" SERIAL PRIMARY KEY,
  "recharge_id" INTEGER NOT NULL REFERENCES "recharge_records"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "provider_id" INTEGER NOT NULL,
  "gateway_order_no" TEXT NOT NULL,
  "trade_no" TEXT NOT NULL,
  "received_amount" TEXT,
  "currency" TEXT,
  "eligible" BOOLEAN NOT NULL DEFAULT FALSE,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "proof" JSONB NOT NULL,
  "expected_payment_details" JSONB,
  "note" TEXT,
  "handled_by_id" INTEGER,
  "handled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "recharge_late_payments_recharge_id_gateway_order_no_trade_no_key" ON "recharge_late_payments"("recharge_id", "gateway_order_no", "trade_no");
CREATE INDEX "recharge_late_payments_status_created_at_idx" ON "recharge_late_payments"("status", "created_at");
CREATE INDEX "recharge_late_payments_provider_id_trade_no_idx" ON "recharge_late_payments"("provider_id", "trade_no");
