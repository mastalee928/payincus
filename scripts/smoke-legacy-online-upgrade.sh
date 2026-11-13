#!/usr/bin/env bash
# Destructive only inside a fresh disposable GitHub VM; never production.
set -Eeuo pipefail
[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_ENVIRONMENT:-} == github-hosted && $EUID == 0 && ! -e /opt/incudal ]] || exit 1
repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
candidate=$(readlink -f -- "${1:?new release archive required}")
old=$(readlink -f -- "${2:?official v1.8.9 archive required}")
scenario=${3:-clean}
[[ $scenario == clean || $scenario == migrated-atomic || $scenario == rollback ]] || exit 1
export UPGRADE_DRILL_SCENARIO="$scenario"
test -s "$candidate"; test -s "$old"; test -s "$old.sha256"
(cd "$(dirname "$old")"; sha256sum --check "$(basename "$old").sha256")
work=$(mktemp -d /root/incudal-upgrade-drill-XXXXXX)
export UPGRADE_DRILL_WORK="$work"
stage=legacy-install
report_failure() {
  echo "Legacy upgrade failed at $stage ($scenario). Sanitized diagnostics follow."
  journalctl -u incudal-backend --no-pager -n 60 > "$work/backend.log" 2>&1 || true
  # Raw logs stay on the disposable runner; redact generated credentials.
  python3 - <<'PY'
import pathlib,re,os,urllib.parse
secrets=[]
env=pathlib.Path('/opt/incudal/.env')
if env.exists():
    for line in env.read_text().splitlines():
        if '=' not in line or line.startswith('#'):continue
        key,value=line.split('=',1);value=value.strip().strip('\"\'')
        if value and re.search(r'PASSWORD|SECRET|TOKEN|ENCRYPTION_KEY|DATABASE_URL',key):
            secrets.append(value)
            try:
                password=urllib.parse.urlsplit(value).password
                if password:secrets.append(password)
            except ValueError:pass
work=pathlib.Path(os.environ['UPGRADE_DRILL_WORK'])
paths=[work/'old-install.log',work/'prior-migration.log',work/'worker.log',work/'retry-worker.log',work/'backend.log',*pathlib.Path('/opt/incudal/update-logs').glob('system-update-*.log')]
for p in paths:
    if not p.exists():continue
    text=p.read_text(errors='replace')
    for secret in sorted(secrets,key=len,reverse=True):text=text.replace(secret,'[redacted]')
    for line in text.splitlines()[-60:]:
        if re.search(r'ERROR|FATAL|Error|error|失败|PROVISIONING_REJECTED|Auto rollback|System update completed|Production readiness verification passed|Backend health is ready',line):
            print(p.name+': '+line[:500])
PY
}
trap report_failure ERR
[[ -d /opt && ! -L /opt && $(stat -c %u /opt) == 0 ]] || exit 1
chmod go-w /opt
install -d -m 755 /tmp/incudal
cp "$old" "$old.sha256" /tmp/incudal/
tar -xOf "$old" ./scripts/install-panel.sh > "$work/old-install.sh"
printf 'installer@example.invalid\n3\n' | ONBOARDING_PUBLIC_HOST=gateway.example.com \
  bash "$work/old-install.sh" > "$work/old-install.log" 2>&1
systemctl is-active --quiet incudal-backend

# Model both an original flat installation and the deployed atomic layout
# after a failed attempt has already committed the additive DB migration.
# All setup is confined to this disposable VM and uses the actual archives.
frontend_root=/opt/incudal
stage=prior-migration-setup
if [[ $scenario == migrated-atomic || $scenario == rollback ]]; then
  install -d -m 755 /opt/incudal/releases/v1.8.9-baseline "$work/candidate"
  tar --no-same-owner -xzf "$old" -C /opt/incudal/releases/v1.8.9-baseline
  cp -a /opt/incudal/server/certs /opt/incudal/releases/v1.8.9-baseline/server/
  ln -s /opt/incudal/releases/v1.8.9-baseline /opt/incudal/current
  frontend_root=/opt/incudal/current
  cat > /etc/systemd/system/incudal-backend.service.d/upgrade-drill.conf <<'EOF'
[Service]
WorkingDirectory=/opt/incudal/current
ExecStart=
ExecStart=/usr/bin/node /opt/incudal/current/server/dist/app.js
EOF
  tar --no-same-owner -xzf "$candidate" -C "$work/candidate"
  node "$repo/scripts/smoke-legacy-online-upgrade.mjs" migrate "$work/candidate" > "$work/prior-migration.log" 2>&1
fi

# Real local HTTPS origins exercise all normal post-OTA checks. Trust is local
# to this disposable runner; no production DNS/certificate is used.
stage=test-origins
apt-get install -y -qq nginx >/dev/null 2>&1
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=upgrade.test \
  -addext 'subjectAltName=DNS:user.upgrade.test,DNS:admin.upgrade.test' \
  -keyout "$work/site.key" -out /usr/local/share/ca-certificates/incudal-upgrade.crt >/dev/null 2>&1
update-ca-certificates >/dev/null 2>&1
printf '127.0.0.1 user.upgrade.test admin.upgrade.test\n' >> /etc/hosts
cat > /etc/nginx/conf.d/incudal-upgrade-test.conf <<EOF
server {
 listen 127.0.0.1:443 ssl;
 server_name user.upgrade.test admin.upgrade.test;
 ssl_certificate /usr/local/share/ca-certificates/incudal-upgrade.crt;
 ssl_certificate_key $work/site.key;
 set \$frontend_root $frontend_root/client/dist/user;
 if (\$host = admin.upgrade.test) { set \$frontend_root $frontend_root/client/dist/admin; }
 root \$frontend_root;
 add_header Content-Security-Policy "default-src 'self'; frame-ancestors 'none'" always;
 add_header X-Content-Type-Options nosniff always;
 add_header X-Frame-Options DENY always;
 add_header Referrer-Policy strict-origin-when-cross-origin always;
 location /healthz { return 200 'ok'; }
 location / { try_files \$uri \$uri/ /index.html; }
 location /api/ { proxy_pass http://127.0.0.1:3001; proxy_http_version 1.1; proxy_set_header Upgrade \$http_upgrade; proxy_set_header Connection "upgrade"; }
}
EOF
nginx -t
systemctl restart nginx
python3 - <<'PY'
from pathlib import Path
import re
p=Path('/opt/incudal/.env');s=p.read_text()
values={'FRONTEND_URL':'https://user.upgrade.test','ADMIN_FRONTEND_URL':'https://admin.upgrade.test',
        'SITE_URL':'https://user.upgrade.test','PAYMENT_CALLBACK_BASE_URL':'https://user.upgrade.test',
        'PAYMENT_CALLBACK_SKIP_IP_WHITELIST':'false','PAYMENT_CALLBACK_IP_WHITELIST_REQUIRED':'false',
        'BACKEND_URL':'http://127.0.0.1:3001'}
for k,v in values.items():
    if re.search(r'^'+k+'=',s,re.M):s=re.sub(r'^'+k+'=.*$',k+'='+v,s,flags=re.M)
    else:s+='\n'+k+'='+v+'\n'
p.write_text(s)
if Path('/opt/incudal/current').is_symlink():
    import shutil
    shutil.copy2(p, '/opt/incudal/current/.env')
PY
systemctl daemon-reload
# The cloned old release must receive the real installer/OTA ownership before
# its service account reads .env or certs. copy2 preserves modes, not groups.
/usr/local/libexec/incudal/incudal-online-task seal
systemctl restart incudal-backend
curl -fsS --retry 20 --retry-delay 2 --retry-connrefused https://user.upgrade.test/api/health >/dev/null
node "$repo/scripts/smoke-legacy-online-upgrade.mjs" before "$candidate"
stage=old-worker-upgrade
if [[ $scenario == rollback ]]; then
  # The actual worker reaches its production verification only after installing
  # and registering new components. Fail that check once, leaving every other
  # command, migration, service operation and rollback on the original path.
  install -d -m 755 "$work/path"
  export UPGRADE_DRILL_ORIGINAL_PNPM
  UPGRADE_DRILL_ORIGINAL_PNPM=$(command -v pnpm)
  cat > "$work/path/pnpm" <<'EOF'
#!/usr/bin/env bash
if [[ $* == verify:production && ! -e "$UPGRADE_DRILL_WORK/failure-injected" ]]; then
  touch "$UPGRADE_DRILL_WORK/failure-injected"
  echo 'Injected post-install production-check failure for rollback verification' >&2
  exit 70
fi
exec "$UPGRADE_DRILL_ORIGINAL_PNPM" "$@"
EOF
  chmod 755 "$work/path/pnpm"
  export PATH="$work/path:$PATH"
fi
# Do not bypass the old worker's migration, production DB or health checks.
(
  cd /opt/incudal
  exec 9>/var/lib/incudal-platform-operation.lock
  flock -n 9
  # Refresh deliberately changed only the disposable test origin configuration.
  # Keep the same hardened filesystem and sealed source checks as real OTA.
  /usr/local/libexec/incudal/incudal-online-task seal
  if NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/incudal-upgrade.crt \
    node "$repo/scripts/smoke-legacy-online-upgrade.mjs" worker "$candidate" > "$work/worker.log" 2>&1; then
    [[ $scenario != rollback ]]
  else
    [[ $scenario == rollback && -f "$work/failure-injected" ]]
    node "$repo/scripts/smoke-legacy-online-upgrade.mjs" rolled-back "$candidate"
    UPGRADE_DRILL_RETRY=true node "$repo/scripts/smoke-legacy-online-upgrade.mjs" before "$candidate"
    NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/incudal-upgrade.crt \
      node "$repo/scripts/smoke-legacy-online-upgrade.mjs" worker "$candidate" > "$work/retry-worker.log" 2>&1
  fi
  /usr/local/libexec/incudal/incudal-online-task seal
)
stage=post-upgrade-verification
node "$repo/scripts/smoke-legacy-online-upgrade.mjs" after "$candidate"
test "$(ss -ltnp 'sport = :3001' | tail -n +2 | wc -l)" = 1
echo 'Legacy-to-current online upgrade passed with real old worker, signed archives and preserved controller/network identity.'
