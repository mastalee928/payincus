CREATE TABLE auto_snapshot_operations (
  id UUID PRIMARY KEY,
  instance_id INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  host_id INTEGER NOT NULL,
  incus_id TEXT NOT NULL,
  identity_hash TEXT NOT NULL,
  remote_uuid TEXT,
  snapshot_name TEXT NOT NULL UNIQUE,
  previous_snapshot JSONB,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','applying','retry','blocked','succeeded','cancelled')),
  stage TEXT NOT NULL DEFAULT 'prepared' CHECK (stage IN ('prepared','created','deleted','finalize')),
  attempt_id UUID,
  attempts INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMP(3),
  next_retry_at TIMESTAMP(3),
  error TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP(3)
);
CREATE INDEX auto_snapshot_operations_instance_id_state_idx ON auto_snapshot_operations(instance_id,state);
CREATE INDEX auto_snapshot_operations_state_next_retry_at_idx ON auto_snapshot_operations(state,next_retry_at);
CREATE UNIQUE INDEX auto_snapshot_operations_one_open_per_instance ON auto_snapshot_operations(instance_id)
  WHERE state IN ('pending','applying','retry','blocked');
