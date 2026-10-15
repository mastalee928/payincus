ALTER TABLE hosts ADD COLUMN port_protocol TEXT NOT NULL DEFAULT 'tcp_udp',
  ADD COLUMN port_protocol_revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN port_protocol_applied TEXT NOT NULL DEFAULT 'tcp_udp',
  ADD COLUMN port_protocol_applied_revision INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN port_protocol_error TEXT,
  ADD COLUMN pool_faulted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE hosts ADD CONSTRAINT host_port_protocol_valid CHECK (port_protocol IN ('tcp','tcp_udp') AND port_protocol_applied IN ('tcp','tcp_udp'));
ALTER TABLE instances ADD COLUMN dedicated_ipv4 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN dedicated_network_ready BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE instance_tasks ADD COLUMN replacement_state JSONB;
ALTER TYPE "InstanceTaskType" ADD VALUE IF NOT EXISTS 'replace_host';
UPDATE instances SET dedicated_ipv4 = true, monthly_traffic_limit = NULL, port_limit = 0,
  limits_ingress = '100000Mbit', limits_egress = '100000Mbit'
WHERE pool_price_id IS NOT NULL;
UPDATE package_plans SET port_limit = 0, traffic_limit_speed = '100000Mbit'
WHERE id IN (SELECT shadow_plan_id FROM host_pool_prices);
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
  IF new_assignment AND faulted AND NOT EXISTS (
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
CREATE OR REPLACE FUNCTION check_single_tenant_move() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE dedicated BOOLEAN;
BEGIN
  IF NEW.target_host_id IS NULL OR NEW.task_type::text NOT IN ('change_host', 'replace_host') OR NEW.status NOT IN ('PENDING', 'PROCESSING') THEN RETURN NEW; END IF;
  SELECT single_tenant INTO dedicated FROM hosts WHERE id = NEW.target_host_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HOST_NOT_FOUND' USING ERRCODE = '23514'; END IF;
  IF NOT dedicated THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM instances WHERE host_id = NEW.target_host_id AND id <> NEW.instance_id
       AND (status <> 'deleted' OR provisioning_cleanup_pending OR deletion_billing_pending))
     OR EXISTS (SELECT 1 FROM instance_tasks WHERE target_host_id = NEW.target_host_id AND id <> NEW.id
       AND task_type::text IN ('change_host', 'replace_host') AND status IN ('PENDING', 'PROCESSING')) THEN
    RAISE EXCEPTION 'HOST_SINGLE_TENANT_OCCUPIED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
