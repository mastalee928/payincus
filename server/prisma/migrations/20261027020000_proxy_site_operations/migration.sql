CREATE TYPE "ProxySiteOperationAction" AS ENUM ('upsert', 'disable', 'delete');
CREATE TYPE "ProxySiteOperationState" AS ENUM ('pending', 'applying', 'retry', 'blocked', 'succeeded');

ALTER TABLE proxy_sites ADD COLUMN site_key UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE proxy_sites ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE proxy_sites ADD COLUMN applied_revision INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX proxy_sites_site_key_key ON proxy_sites(site_key);

CREATE TABLE proxy_site_operations (
  id UUID PRIMARY KEY,
  site_id INTEGER NOT NULL,
  site_key UUID NOT NULL,
  instance_id INTEGER NOT NULL,
  host_id INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  actor_id INTEGER NOT NULL,
  actor_sid TEXT NOT NULL,
  actor_iat INTEGER NOT NULL,
  authority TEXT NOT NULL,
  lifecycle_claim JSONB,
  identity_hash TEXT NOT NULL,
  incus_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  action "ProxySiteOperationAction" NOT NULL,
  desired_config JSONB NOT NULL,
  request_hash TEXT NOT NULL,
  state "ProxySiteOperationState" NOT NULL DEFAULT 'pending',
  attempt_id UUID,
  started_at TIMESTAMP(3),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMP(3),
  error TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP(3)
);
CREATE UNIQUE INDEX proxy_site_operations_site_key_revision_key ON proxy_site_operations(site_key, revision);
CREATE INDEX proxy_site_operations_instance_id_state_idx ON proxy_site_operations(instance_id, state);
CREATE INDEX proxy_site_operations_host_id_state_idx ON proxy_site_operations(host_id, state);
CREATE INDEX proxy_site_operations_state_next_retry_at_idx ON proxy_site_operations(state, next_retry_at);
