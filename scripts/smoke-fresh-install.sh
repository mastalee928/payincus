#!/usr/bin/env bash
# Runs only on disposable GitHub-hosted VMs, never on an existing control server.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted ]] || { echo 'Disposable GitHub runner required' >&2; exit 1; }
[[ $EUID -eq 0 && ! -e /opt/incudal ]] || { echo 'A clean root installation is required' >&2; exit 1; }
umask 077
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
package=${1:?Pass the release archive path}
test -s "$package"
# Exercise the ownership behavior of already installed root OTA workers, before the installer normalizes it.
python3 - "$package" <<'PY'
import sys, tarfile
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    for member in archive.getmembers():
        if member.uid != 0 or member.gid != 0:
            raise SystemExit('Release archive contains non-root ownership: ' + member.name)
print('Release archive ownership verified for legacy root OTA extraction.')
PY
install -d -m 755 /tmp/incudal
cp "$package" /tmp/incudal/
sha256sum "/tmp/incudal/$(basename "$package")" > "/tmp/incudal/$(basename "$package").sha256"

report_failure() {
  echo 'Fresh installation failed. Sanitized diagnostics follow.' >&2
  python3 - <<'PY'
import pathlib, re, urllib.parse
env = pathlib.Path('/opt/incudal/.env')
secrets = []
if env.exists():
    for line in env.read_text().splitlines():
        if '=' not in line or line.startswith('#'):
            continue
        key, value = line.split('=', 1)
        if value and re.search(r'PASSWORD|SECRET|TOKEN|ENCRYPTION_KEY|DATABASE_URL|REDIS_URL', key):
            secrets.append(value)
            try:
                password = urllib.parse.urlsplit(value).password
                if password:
                    secrets.append(password)
            except ValueError:
                pass
for name in ['/var/tmp/incudal-fresh-install.log', '/var/tmp/incudal-fresh-service.log']:
    path = pathlib.Path(name)
    if path.exists():
        text = '\n'.join(path.read_text(errors='replace').splitlines()[-45:])
        for secret in sorted(secrets, key=len, reverse=True):
            text = text.replace(secret, '[redacted]')
        print(text)
PY
}
trap 'journalctl -u incudal-backend --no-pager -n 35 > /var/tmp/incudal-fresh-service.log 2>&1 || true; report_failure' ERR

# The endpoint is a documentation DNS name; no customer host is contacted.
printf 'installer@example.invalid\n3\n' | ONBOARDING_PUBLIC_HOST=gateway.example.com \
  bash "$repo_dir/scripts/install-panel.sh" > /var/tmp/incudal-fresh-install.log 2>&1

for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/api/health >/dev/null; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1:3001/api/health >/dev/null
systemctl is-active --quiet incudal-backend
test "$(systemctl show incudal-backend -p NRestarts --value)" = 0
test "$(ss -ltnp 'sport = :3001' | tail -n +2 | wc -l)" = 1
systemctl is-active --quiet wg-quick@incudal-mgmt

for file in client/dist/user/index.html client/dist/admin/index.html server/dist/services/admin-instance-push.js \
  server/dist/workers/hostOnboardingWorker.js server/templates/install-alpine.sh scripts/ensure-host-swap.py \
  server/dist/services/host-public-ipv6-sync.js server/dist/lib/incus/dedicated-ipv6.js \
  server/dist/lib/agent-version.js server/dist/lib/upaypro.js \
  server/prisma/migrations/202610160002_dedicated_ipv6/migration.sql \
  scripts/probe-management-gateway.py scripts/onboarding-gateway.py scripts/setup-onboarding-control.py LICENSE; do
  test -s "/opt/incudal/$file"
done
expected_migrations=$(find /opt/incudal/server/prisma/migrations -name migration.sql -type f | wc -l)
actual_migrations=$(sudo -u postgres psql -d incudal -tAc 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')
test "$expected_migrations" = "$actual_migrations"
ipv6_columns=$(sudo -u postgres psql -d incudal -tAc "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND data_type = 'jsonb' AND (table_name, column_name) IN (('hosts', 'public_ipv6_sync'), ('instances', 'dedicated_ipv6'))")
test "$ipv6_columns" = 2
sudo -u incudal test -r /opt/incudal/server/certs/onboarding-gateway.key
sudo -u incudal test ! -r /root/.ssh/incudal-host-management

before=$(sha256sum /etc/wireguard/incudal-mgmt.conf /root/.ssh/incudal-host-management /opt/incudal/.env)
python3 /opt/incudal/scripts/setup-onboarding-control.py --public-host gateway.example.com
after=$(sha256sum /etc/wireguard/incudal-mgmt.conf /root/.ssh/incudal-host-management /opt/incudal/.env)
test "$before" = "$after"

apt-get install -y -qq nginx >/dev/null 2>&1
cat > /etc/nginx/conf.d/incudal-install-smoke.conf <<'NGINX'
server {
  listen 127.0.0.1:8080;
  root /opt/incudal/client/dist/user;
  location / { try_files $uri $uri/ /index.html; }
  location /api/ { proxy_pass http://127.0.0.1:3001; }
}
server {
  listen 127.0.0.1:8081;
  root /opt/incudal/client/dist/admin;
  location / { try_files $uri $uri/ /index.html; }
  location /api/ { proxy_pass http://127.0.0.1:3001; }
}
NGINX
nginx -t
systemctl restart nginx
node "$repo_dir/scripts/smoke-fresh-install.mjs"
node "$repo_dir/scripts/smoke-platform-backup.mjs"
RUN_BACKUP_INTEGRITY_DRILL=1 node "$repo_dir/scripts/smoke-platform-backup-integrity.mjs"
RUN_BACKUP_COMPATIBILITY_DRILL=1 node "$repo_dir/scripts/smoke-platform-backup-compatibility.mjs"
echo "Fresh install passed: $(uname -m), $actual_migrations migrations, IPv6 schema, one backend, both frontends, admin login, management gateway, published Agent downloads."
