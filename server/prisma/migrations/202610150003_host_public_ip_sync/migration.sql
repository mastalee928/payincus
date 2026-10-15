ALTER TABLE hosts
  ADD COLUMN public_ip_sync_blocked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN public_ip_sync JSONB;

-- Serialize with IP reconciliation and refuse allocation even if a caller used
-- a catalog snapshot from before an address change was detected.
CREATE FUNCTION check_dedicated_public_ip_ready() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target INTEGER; blocked BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'instances' THEN
    IF NEW.status = 'deleted' AND NOT NEW.provisioning_cleanup_pending AND NOT NEW.deletion_billing_pending THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' THEN
      IF OLD.host_id = NEW.host_id AND (OLD.status <> 'deleted' OR OLD.provisioning_cleanup_pending OR OLD.deletion_billing_pending) THEN RETURN NEW; END IF;
    END IF;
    target := NEW.host_id;
  ELSE
    IF NEW.target_host_id IS NULL OR NEW.task_type::text NOT IN ('change_host', 'replace_host') OR NEW.status NOT IN ('PENDING', 'PROCESSING') THEN RETURN NEW; END IF;
    target := NEW.target_host_id;
  END IF;
  SELECT single_tenant AND public_ip_sync_blocked INTO blocked FROM hosts WHERE id = target FOR UPDATE;
  IF blocked THEN
    RAISE EXCEPTION 'HOST_PUBLIC_IP_PENDING' USING ERRCODE = '23514', CONSTRAINT = 'hosts_public_ip_ready';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_dedicated_public_ip_ready
BEFORE INSERT OR UPDATE OF host_id, status, provisioning_cleanup_pending, deletion_billing_pending ON instances
FOR EACH ROW EXECUTE FUNCTION check_dedicated_public_ip_ready();
CREATE TRIGGER enforce_dedicated_move_public_ip_ready
BEFORE INSERT OR UPDATE OF target_host_id, task_type, status ON instance_tasks
FOR EACH ROW EXECUTE FUNCTION check_dedicated_public_ip_ready();
