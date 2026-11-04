-- Separate historical onboarding input from the effective address reservation.
BEGIN;
ALTER TABLE "host_onboarding_nodes" ADD COLUMN "active_public_ip" TEXT;
DROP INDEX "host_onboarding_nodes_public_ip_key";
CREATE INDEX "host_onboarding_nodes_public_ip_updated_at_idx" ON "host_onboarding_nodes"("public_ip", "updated_at");

UPDATE "host_onboarding_nodes" n SET "active_public_ip" =
  CASE WHEN n."host_id" IS NOT NULL THEN COALESCE(h."nat_public_ip", n."public_ip")
       WHEN n."deleted_at" IS NULL AND n."status" <> 'succeeded' THEN n."public_ip" ELSE NULL END
FROM (SELECT n2.id, h2.nat_public_ip FROM host_onboarding_nodes n2 LEFT JOIN hosts h2 ON h2.id = n2.host_id) h
WHERE h.id = n.id;
-- Do not guess an owner if existing effective addresses conflict: migration fails.
CREATE UNIQUE INDEX "host_onboarding_nodes_active_public_ip_key" ON "host_onboarding_nodes"("active_public_ip");

CREATE FUNCTION maintain_onboarding_active_public_ip() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.host_id IS NOT NULL THEN
    SELECT COALESCE(nat_public_ip, NEW.public_ip) INTO NEW.active_public_ip FROM hosts WHERE id = NEW.host_id;
  ELSIF NEW.deleted_at IS NULL AND NEW.status <> 'succeeded' THEN
    NEW.active_public_ip := NEW.public_ip;
  ELSE
    NEW.active_public_ip := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER onboarding_active_public_ip BEFORE INSERT OR UPDATE ON host_onboarding_nodes
FOR EACH ROW EXECUTE FUNCTION maintain_onboarding_active_public_ip();

CREATE FUNCTION propagate_host_public_ip() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE host_onboarding_nodes SET active_public_ip = COALESCE(NEW.nat_public_ip, public_ip)
  WHERE host_id = NEW.id;
  RETURN NEW;
END $$;
CREATE TRIGGER host_current_public_ip AFTER UPDATE OF nat_public_ip ON hosts
FOR EACH ROW WHEN (OLD.nat_public_ip IS DISTINCT FROM NEW.nat_public_ip)
EXECUTE FUNCTION propagate_host_public_ip();
COMMIT;
