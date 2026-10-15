-- AlterTable
ALTER TABLE "hosts" ADD COLUMN     "customer_disk_gib" INTEGER,
ADD COLUMN     "machine_group" TEXT,
ADD COLUMN     "machine_group_id" INTEGER,
ADD COLUMN     "management_ssh_host" TEXT,
ADD COLUMN     "management_ssh_port" INTEGER,
ADD COLUMN     "management_ssh_user" TEXT,
ADD COLUMN     "region_group" TEXT,
ADD COLUMN     "region_group_id" INTEGER,
ADD COLUMN     "resource_preset" TEXT,
ADD COLUMN     "resource_snapshot" JSONB,
ADD COLUMN     "server_certificate" TEXT,
ADD COLUMN     "server_fingerprint" TEXT,
ADD COLUMN     "single_tenant" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "packages" ADD COLUMN     "hidden" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "instances" ADD COLUMN     "deletion_billing_pending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pool_price_id" INTEGER,
ADD COLUMN     "provisioning_cleanup_pending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "purchase_batch_id" TEXT;

-- AlterTable
ALTER TABLE "instance_billing_records" ADD COLUMN     "purchase_batch_id" TEXT;

-- CreateTable
CREATE TABLE "host_machine_groups" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "host_machine_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "host_region_groups" (
    "id" SERIAL NOT NULL,
    "machine_group_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "country_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "host_region_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "host_pool_prices" (
    "id" SERIAL NOT NULL,
    "machine_group_id" INTEGER NOT NULL,
    "resource_preset" TEXT NOT NULL,
    "region_group_id" INTEGER NOT NULL,
    "disk_gib" INTEGER NOT NULL,
    "name" TEXT,
    "monthly_price" DECIMAL(12,0) NOT NULL,
    "setup_fee" DECIMAL(12,0) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "shadow_plan_id" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "host_pool_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "host_onboarding_batches" (
    "id" TEXT NOT NULL,
    "created_by_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "account_label" TEXT NOT NULL,
    "defaults" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "host_onboarding_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "host_onboarding_nodes" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "host_id" INTEGER,
    "name" TEXT NOT NULL,
    "public_ip" TEXT NOT NULL,
    "machine_group" TEXT,
    "region_group" TEXT,
    "machine_group_id" INTEGER,
    "region_group_id" INTEGER,
    "resource_preset" TEXT,
    "customer_disk_gib" INTEGER,
    "resolved_resources" JSONB,
    "country_code" TEXT,
    "ssh_port" INTEGER NOT NULL DEFAULT 22,
    "ssh_fingerprint" TEXT,
    "credentials_encrypted" TEXT,
    "credentials_expire_at" TIMESTAMP(3) NOT NULL,
    "management_ip" TEXT,
    "node_public_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "step" TEXT NOT NULL DEFAULT 'queued',
    "error_code" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "lease_token" TEXT,
    "lease_until" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "host_onboarding_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pool_orders" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "request_hash" TEXT NOT NULL,
    "total_cents" DECIMAL(14,0) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pool_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "host_machine_groups_name_key" ON "host_machine_groups"("name");

-- CreateIndex
CREATE UNIQUE INDEX "host_region_groups_machine_group_id_name_key" ON "host_region_groups"("machine_group_id", "name");

-- CreateIndex
CREATE INDEX "host_pool_prices_region_group_id_idx" ON "host_pool_prices"("region_group_id");

-- CreateIndex
CREATE INDEX "host_pool_prices_active_idx" ON "host_pool_prices"("active");

-- CreateIndex
CREATE UNIQUE INDEX "host_pool_prices_pool_key" ON "host_pool_prices"("machine_group_id", "resource_preset", "region_group_id", "disk_gib");

-- CreateIndex
CREATE INDEX "host_onboarding_batches_created_at_idx" ON "host_onboarding_batches"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "host_onboarding_nodes_host_id_key" ON "host_onboarding_nodes"("host_id");

-- CreateIndex
CREATE UNIQUE INDEX "host_onboarding_nodes_public_ip_key" ON "host_onboarding_nodes"("public_ip");

-- CreateIndex
CREATE INDEX "host_onboarding_nodes_status_lease_until_idx" ON "host_onboarding_nodes"("status", "lease_until");

-- CreateIndex
CREATE INDEX "host_onboarding_nodes_deleted_at_created_at_idx" ON "host_onboarding_nodes"("deleted_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "host_onboarding_nodes_batch_id_name_key" ON "host_onboarding_nodes"("batch_id", "name");

-- CreateIndex
CREATE INDEX "pool_orders_user_id_created_at_idx" ON "pool_orders"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "instance_tasks_target_host_id_status_idx" ON "instance_tasks"("target_host_id", "status");

-- CreateIndex
CREATE INDEX "hosts_machine_group_id_region_group_id_idx" ON "hosts"("machine_group_id", "region_group_id");

-- CreateIndex
CREATE INDEX "instances_purchase_batch_id_idx" ON "instances"("purchase_batch_id");

-- CreateIndex
CREATE INDEX "instance_billing_records_purchase_batch_id_idx" ON "instance_billing_records"("purchase_batch_id");

-- AddForeignKey
ALTER TABLE "hosts" ADD CONSTRAINT "hosts_machine_group_id_fkey" FOREIGN KEY ("machine_group_id") REFERENCES "host_machine_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosts" ADD CONSTRAINT "hosts_region_group_id_fkey" FOREIGN KEY ("region_group_id") REFERENCES "host_region_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instances" ADD CONSTRAINT "instances_pool_price_id_fkey" FOREIGN KEY ("pool_price_id") REFERENCES "host_pool_prices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_region_groups" ADD CONSTRAINT "host_region_groups_machine_group_id_fkey" FOREIGN KEY ("machine_group_id") REFERENCES "host_machine_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_pool_prices" ADD CONSTRAINT "host_pool_prices_machine_group_id_fkey" FOREIGN KEY ("machine_group_id") REFERENCES "host_machine_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_pool_prices" ADD CONSTRAINT "host_pool_prices_region_group_id_fkey" FOREIGN KEY ("region_group_id") REFERENCES "host_region_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_onboarding_nodes" ADD CONSTRAINT "host_onboarding_nodes_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "host_onboarding_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_onboarding_nodes" ADD CONSTRAINT "host_onboarding_nodes_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_onboarding_nodes" ADD CONSTRAINT "host_onboarding_nodes_machine_group_id_fkey" FOREIGN KEY ("machine_group_id") REFERENCES "host_machine_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_onboarding_nodes" ADD CONSTRAINT "host_onboarding_nodes_region_group_id_fkey" FOREIGN KEY ("region_group_id") REFERENCES "host_region_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_orders" ADD CONSTRAINT "pool_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Serialize assignments on each dedicated host, including alternate creation paths.
CREATE FUNCTION "check_single_tenant_host"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  dedicated BOOLEAN;
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
  SELECT single_tenant, cpu_allowance_max, memory_max, customer_disk_gib
    INTO dedicated, cap_cpu, cap_memory, cap_disk FROM hosts WHERE id = NEW.host_id FOR UPDATE;
  IF NOT dedicated THEN RETURN NEW; END IF;
  IF new_assignment AND EXISTS (SELECT 1 FROM instances WHERE host_id = NEW.host_id AND id <> NEW.id
    AND (status <> 'deleted' OR provisioning_cleanup_pending OR deletion_billing_pending)) THEN
    RAISE EXCEPTION 'HOST_SINGLE_TENANT_OCCUPIED' USING ERRCODE = '23514', CONSTRAINT = 'hosts_single_tenant_occupied';
  END IF;
  IF new_assignment AND EXISTS (SELECT 1 FROM instance_tasks WHERE target_host_id = NEW.host_id AND instance_id <> NEW.id
    AND task_type = 'change_host' AND status IN ('PENDING', 'PROCESSING')) THEN
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
CREATE TRIGGER "enforce_single_tenant_host" BEFORE INSERT OR UPDATE OF host_id, status, provisioning_cleanup_pending, deletion_billing_pending, cpu, memory, disk
ON "instances" FOR EACH ROW EXECUTE FUNCTION "check_single_tenant_host"();

-- A move reserves a whole dedicated host before the instance changes host_id.
CREATE FUNCTION check_single_tenant_move() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE dedicated BOOLEAN;
BEGIN
  IF NEW.target_host_id IS NULL OR NEW.task_type <> 'change_host' OR NEW.status NOT IN ('PENDING', 'PROCESSING') THEN RETURN NEW; END IF;
  SELECT single_tenant INTO dedicated FROM hosts WHERE id = NEW.target_host_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HOST_NOT_FOUND' USING ERRCODE = '23514'; END IF;
  IF NOT dedicated THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM instances WHERE host_id = NEW.target_host_id AND id <> NEW.instance_id
       AND (status <> 'deleted' OR provisioning_cleanup_pending OR deletion_billing_pending))
     OR EXISTS (SELECT 1 FROM instance_tasks WHERE target_host_id = NEW.target_host_id AND id <> NEW.id
       AND task_type = 'change_host' AND status IN ('PENDING', 'PROCESSING')) THEN
    RAISE EXCEPTION 'HOST_SINGLE_TENANT_OCCUPIED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_single_tenant_move BEFORE INSERT OR UPDATE OF target_host_id, task_type, status
ON instance_tasks FOR EACH ROW EXECUTE FUNCTION check_single_tenant_move();

CREATE FUNCTION check_dedicated_host_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW.single_tenant THEN RETURN NEW; END IF;
  IF (SELECT COUNT(*) FROM instances WHERE host_id = NEW.id
      AND (status <> 'deleted' OR provisioning_cleanup_pending OR deletion_billing_pending)) > 1 THEN
    RAISE EXCEPTION 'HOST_SINGLE_TENANT_OCCUPIED' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM instances WHERE host_id = NEW.id
      AND (status <> 'deleted' OR provisioning_cleanup_pending OR deletion_billing_pending)
      AND (cpu > NEW.cpu_allowance_max OR memory > NEW.memory_max
           OR (NEW.customer_disk_gib IS NOT NULL AND disk::BIGINT > NEW.customer_disk_gib::BIGINT * 1024))) THEN
    RAISE EXCEPTION 'HOST_CUSTOMER_QUOTA_EXCEEDED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_dedicated_host_configuration BEFORE UPDATE OF single_tenant, cpu_allowance_max, memory_max, customer_disk_gib
ON hosts FOR EACH ROW EXECUTE FUNCTION check_dedicated_host_configuration();

INSERT INTO host_machine_groups (name) VALUES ('E2'), ('ARM') ON CONFLICT DO NOTHING;
