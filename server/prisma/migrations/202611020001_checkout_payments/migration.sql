CREATE TABLE checkout_orders (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 request_hash TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('direct','cart')),
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','fulfilling','completed','partial','refund_pending','refunded','cancelled','expired')),
 total_cents INTEGER NOT NULL CHECK (total_cents >= 0), snapshot TEXT NOT NULL, display JSONB NOT NULL,
 expires_at TIMESTAMP(3) NOT NULL, paid_at TIMESTAMP(3), payment_id TEXT, error TEXT,
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX checkout_orders_user_id_created_at_idx ON checkout_orders(user_id,created_at);
CREATE INDEX checkout_orders_status_next_attempt_at_idx ON checkout_orders(status,next_attempt_at);
CREATE TABLE checkout_reservations (
 host_id INTEGER PRIMARY KEY REFERENCES hosts(id) ON DELETE RESTRICT,
 order_id TEXT NOT NULL REFERENCES checkout_orders(id) ON DELETE RESTRICT, ordinal INTEGER NOT NULL,
 UNIQUE(order_id,ordinal)
);
CREATE TABLE checkout_payments (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES checkout_orders(id) ON DELETE RESTRICT,
 provider_id INTEGER NOT NULL REFERENCES payment_providers(id) ON DELETE RESTRICT,
 provider_type TEXT NOT NULL, provider_name TEXT NOT NULL, method TEXT NOT NULL,
 payable_cents INTEGER NOT NULL CHECK(payable_cents > 0), fee_cents INTEGER NOT NULL CHECK(fee_cents >= 0),
 config_snapshot TEXT NOT NULL, details JSONB NOT NULL, pay_url TEXT,
 status TEXT NOT NULL DEFAULT 'creating' CHECK(status IN ('creating','pending','paid','uncertain')),
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(order_id,provider_id,method)
);
CREATE TABLE checkout_receipts (
 id TEXT PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES checkout_payments(id) ON DELETE RESTRICT,
 provider_id INTEGER NOT NULL REFERENCES payment_providers(id) ON DELETE RESTRICT, trade_no TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), currency TEXT NOT NULL, proof JSONB NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(provider_id,trade_no)
);
CREATE TABLE checkout_refunds (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES checkout_orders(id) ON DELETE RESTRICT,
 payment_id TEXT NOT NULL REFERENCES checkout_payments(id) ON DELETE RESTRICT,
 receipt_id TEXT NOT NULL REFERENCES checkout_receipts(id) ON DELETE RESTRICT,
 instance_id INTEGER REFERENCES instances(id) ON DELETE RESTRICT,
 billing_record_id INTEGER REFERENCES instance_billing_records(id) ON DELETE RESTRICT,
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), principal_cents INTEGER NOT NULL CHECK(principal_cents >= 0), reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','refunded')),
 resolution TEXT, handled_by_id INTEGER, handled_at TIMESTAMP(3), created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX checkout_refunds_status_created_at_idx ON checkout_refunds(status,created_at);
CREATE INDEX checkout_refunds_billing_record_id_idx ON checkout_refunds(billing_record_id);

-- All allocation writers serialize on the same host row, including raw SQL.
CREATE FUNCTION check_checkout_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM id FROM hosts WHERE id=NEW.host_id AND single_tenant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'HOST_NOT_FOUND' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM instances WHERE host_id=NEW.host_id AND (status<>'deleted' OR provisioning_cleanup_pending OR deletion_billing_pending))
 OR EXISTS(SELECT 1 FROM instance_tasks WHERE target_host_id=NEW.host_id AND task_type::text IN ('change_host','replace_host') AND status IN ('PENDING','PROCESSING')) THEN
   RAISE EXCEPTION 'HOST_SINGLE_TENANT_OCCUPIED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER checkout_reservation_guard BEFORE INSERT OR UPDATE ON checkout_reservations FOR EACH ROW EXECUTE FUNCTION check_checkout_reservation();
CREATE FUNCTION check_checkout_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target INTEGER;
BEGIN
 IF TG_TABLE_NAME='instances' THEN
   IF NEW.status='deleted' AND NOT NEW.provisioning_cleanup_pending AND NOT NEW.deletion_billing_pending THEN RETURN NEW; END IF;
   IF TG_OP='UPDATE' THEN
     IF OLD.host_id=NEW.host_id AND (OLD.status<>'deleted' OR OLD.provisioning_cleanup_pending OR OLD.deletion_billing_pending) THEN RETURN NEW; END IF;
   END IF;
   target := NEW.host_id;
 ELSE
   IF NEW.target_host_id IS NULL OR NEW.task_type::text NOT IN ('change_host','replace_host') OR NEW.status NOT IN ('PENDING','PROCESSING') THEN RETURN NEW; END IF;
   target := NEW.target_host_id;
 END IF;
 PERFORM id FROM hosts WHERE id=target FOR UPDATE;
 IF EXISTS(SELECT 1 FROM checkout_reservations WHERE host_id=target) THEN
   RAISE EXCEPTION 'HOST_SINGLE_TENANT_OCCUPIED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER checkout_instance_guard BEFORE INSERT OR UPDATE ON instances FOR EACH ROW EXECUTE FUNCTION check_checkout_assignment();
CREATE TRIGGER checkout_move_guard BEFORE INSERT OR UPDATE ON instance_tasks FOR EACH ROW EXECUTE FUNCTION check_checkout_assignment();
