CREATE TABLE platform_recovery_batches (
  id UUID PRIMARY KEY, hold_task_id UUID NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('restore','rollback')),
  operator_id INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TIMESTAMP(3)
);
CREATE TABLE platform_recovery_hosts (
  batch_id UUID NOT NULL REFERENCES platform_recovery_batches(id), host_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','success','retry','blocked')),
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_token UUID, lease_until TIMESTAMP(3), checked_at TIMESTAMP(3), source_hash TEXT, result JSONB,
  PRIMARY KEY (batch_id, host_id)
);
CREATE INDEX platform_recovery_hosts_batch_id_next_attempt_at_idx ON platform_recovery_hosts(batch_id,next_attempt_at);
CREATE TABLE platform_recovery_evidence (
  id UUID PRIMARY KEY, batch_id UUID NOT NULL REFERENCES platform_recovery_batches(id), category TEXT NOT NULL,
  reference TEXT NOT NULL, evidence_hash TEXT NOT NULL, source_hash TEXT NOT NULL,
  observed_at TIMESTAMP(3) NOT NULL, actor_id INTEGER NOT NULL, payload JSONB NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(batch_id,category,reference)
);
CREATE INDEX platform_recovery_evidence_batch_id_category_idx ON platform_recovery_evidence(batch_id,category);

-- Recovery records remain outside ordinary checkout provisioning.
ALTER TABLE checkout_orders DROP CONSTRAINT checkout_orders_source_check;
ALTER TABLE checkout_orders ADD CONSTRAINT checkout_orders_source_check
  CHECK (source IN ('direct','cart','recovery'));
ALTER TABLE checkout_orders DROP CONSTRAINT checkout_orders_status_check;
ALTER TABLE checkout_orders ADD CONSTRAINT checkout_orders_status_check
  CHECK (status IN ('pending','paid','fulfilling','completed','partial','refund_pending','refunded','cancelled','expired','recovery_review'));

-- Only a transaction-bound, evidenced original-instance registration may enter quarantine.
CREATE OR REPLACE FUNCTION "check_single_tenant_host"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  dedicated BOOLEAN;
  faulted BOOLEAN;
  cap_cpu INTEGER;
  cap_memory INTEGER;
  cap_disk INTEGER;
  new_assignment BOOLEAN := true;
BEGIN
  IF NEW.status = 'deleted' AND NOT NEW.provisioning_cleanup_pending AND NOT NEW.deletion_billing_pending THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.host_id = NEW.host_id AND (OLD.status <> 'deleted' OR OLD.provisioning_cleanup_pending OR OLD.deletion_billing_pending) THEN
      new_assignment := false;
      IF NEW.cpu <= OLD.cpu AND NEW.memory <= OLD.memory AND NEW.disk <= OLD.disk THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;
  SELECT single_tenant, pool_faulted, cpu_allowance_max, memory_max, customer_disk_gib
    INTO dedicated, faulted, cap_cpu, cap_memory, cap_disk FROM hosts WHERE id = NEW.host_id FOR UPDATE;
  IF NOT dedicated THEN RETURN NEW; END IF;
  IF new_assignment AND faulted AND NOT (
    TG_OP='INSERT' AND EXISTS (
      SELECT 1 FROM platform_recovery_evidence e JOIN platform_recovery_batches b ON b.id=e.batch_id
      JOIN checkout_orders o ON o.id=NEW.purchase_batch_id
      WHERE e.id::text=current_setting('incudal.recovery_evidence_id',true)
        AND e.category='instance-registration-authorization' AND b.completed_at IS NULL AND b.mode='restore'
        AND e.actor_id=b.operator_id AND e.payload->>'transactionId'=txid_current()::text
        AND e.payload->>'userId'=NEW.user_id::text AND e.payload->>'hostId'=NEW.host_id::text
        AND e.payload->>'name'=NEW.incus_id AND e.payload->>'uuid'=NEW.snapshotted_specs->'recoveryIdentity'->>'uuid'
        AND e.payload->>'cpu'=NEW.cpu::text AND e.payload->>'memory'=NEW.memory::text AND e.payload->>'disk'=NEW.disk::text
        AND e.payload->>'orderId'=o.id AND o.user_id=NEW.user_id AND o.status='recovery_review'
        AND NEW.status IN ('running','stopped','suspended') AND NOT NEW.provisioning_cleanup_pending AND NOT NEW.deletion_billing_pending
    )
  ) AND NOT EXISTS (
    SELECT 1 FROM instance_tasks WHERE target_host_id = NEW.host_id AND instance_id = NEW.id
      AND task_type::text = 'replace_host' AND status = 'PROCESSING'
  ) THEN
    RAISE EXCEPTION 'HOST_POOL_FAULTED' USING ERRCODE = '23514', CONSTRAINT = 'hosts_pool_faulted';
  END IF;
  IF new_assignment AND EXISTS (SELECT 1 FROM instances WHERE host_id = NEW.host_id AND id <> NEW.id
    AND (status <> 'deleted' OR provisioning_cleanup_pending OR deletion_billing_pending)) THEN
    RAISE EXCEPTION 'HOST_SINGLE_TENANT_OCCUPIED' USING ERRCODE = '23514', CONSTRAINT = 'hosts_single_tenant_occupied';
  END IF;
  IF new_assignment AND EXISTS (SELECT 1 FROM instance_tasks WHERE target_host_id = NEW.host_id AND instance_id <> NEW.id
    AND task_type::text IN ('change_host', 'replace_host') AND status IN ('PENDING', 'PROCESSING')) THEN
    RAISE EXCEPTION 'HOST_SINGLE_TENANT_OCCUPIED' USING ERRCODE = '23514', CONSTRAINT = 'hosts_single_tenant_occupied';
  END IF;
  IF (new_assignment OR NEW.cpu > OLD.cpu) AND NEW.cpu > cap_cpu THEN
    RAISE EXCEPTION 'HOST_CUSTOMER_CPU_EXCEEDED' USING ERRCODE = '23514', CONSTRAINT = 'hosts_customer_cpu_limit';
  END IF;
  IF (new_assignment OR NEW.memory > OLD.memory) AND NEW.memory > cap_memory THEN
    RAISE EXCEPTION 'HOST_CUSTOMER_MEMORY_EXCEEDED' USING ERRCODE = '23514', CONSTRAINT = 'hosts_customer_memory_limit';
  END IF;
  -- Instances store disk in MiB, while the dedicated customer's disk is GiB.
  IF (new_assignment OR NEW.disk > OLD.disk) AND cap_disk IS NOT NULL AND NEW.disk::BIGINT > cap_disk::BIGINT * 1024 THEN
    RAISE EXCEPTION 'HOST_CUSTOMER_DISK_EXCEEDED' USING ERRCODE = '23514', CONSTRAINT = 'hosts_customer_disk_limit';
  END IF;
  RETURN NEW;
END;
$$;
