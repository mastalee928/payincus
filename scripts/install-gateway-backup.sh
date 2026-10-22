#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $EUID -eq 0 && $# -eq 4 ]] || { echo 'Usage: install-gateway-backup.sh --plan|--install <node> <entry> <protected-config>' >&2; exit 1; }
mode=$1
runtime=$2
entry=$3
config=$4
[[ "$mode" == --plan || "$mode" == --install ]] || exit 1
for path in "$runtime" "$entry" "$config"; do
    [[ "$path" =~ ^/[A-Za-z0-9_./-]+$ && "$path" != *'/../'* && -f "$path" && ! -L "$path" ]] || exit 1
done
command -v python3 >/dev/null
state=$(python3 - "$config" "$runtime" "$entry" <<'PY'
import json,stat,sys,re
from pathlib import Path
for filename in sys.argv[1:]:
    path=Path(filename)
    for ancestor in path.parents:
        info=ancestor.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022: raise ValueError('unsafe parent')
    info=path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022: raise ValueError('unsafe file')
path=Path(sys.argv[1])
if stat.S_IMODE(path.stat().st_mode)!=0o600 or stat.S_IMODE(path.parent.stat().st_mode)!=0o700: raise ValueError('private config required')
config=json.loads(path.read_text())
state=config['stateDirectory']
if not isinstance(state,str) or not re.fullmatch(r'/[A-Za-z0-9_./-]+',state) or str(Path(state))!=state: raise ValueError('state path')
info=Path(state).lstat()
if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or stat.S_IMODE(info.st_mode)!=0o700: raise ValueError('state permission')
print(state)
PY
)
if command -v systemctl >/dev/null; then init=systemd
elif command -v rc-service >/dev/null; then init=openrc
else exit 1; fi
if [[ "$mode" == --plan ]]; then printf 'Independent gateway OSS backup: init=%s; state=%s.\n' "$init" "$state"; exit 0; fi
if [[ "$init" == systemd ]]; then
    unit=/etc/systemd/system/incudal-gateway-backup.service
    if [[ -e "$unit" ]]; then [[ ! -L "$unit" ]] && grep -Fxq '# payincus-gateway-backup-v1' "$unit" || exit 1; fi
    cat > "$unit" <<EOF
# payincus-gateway-backup-v1
[Unit]
Description=Independent PayIncus gateway OSS backup
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
ExecStart=$runtime $entry --serve $config
Restart=on-failure
RestartSec=10
TimeoutStopSec=75
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$state
PrivateTmp=true
CapabilityBoundingSet=
MemoryMax=256M
TasksMax=32
Environment=NODE_OPTIONS=--max-old-space-size=128

[Install]
WantedBy=multi-user.target
EOF
    chmod 0644 "$unit"
    systemctl daemon-reload
    systemctl enable incudal-gateway-backup.service >/dev/null
    systemctl restart incudal-gateway-backup.service
    systemctl is-active --quiet incudal-gateway-backup.service
else
    unit=/etc/init.d/incudal-gateway-backup
    if [[ -e "$unit" ]]; then [[ ! -L "$unit" ]] && grep -Fxq '# payincus-gateway-backup-v1' "$unit" || exit 1; fi
    cat > "$unit" <<EOF
#!/sbin/openrc-run
# payincus-gateway-backup-v1
description="Independent PayIncus gateway OSS backup"
command="$runtime"
command_args="$entry --serve $config"
command_background=true
pidfile="/run/incudal-gateway-backup.pid"
output_log="/var/log/incudal-gateway-backup.log"
error_log="/var/log/incudal-gateway-backup.log"
depend() { need net; }
EOF
    chmod 0755 "$unit"
    rc-update add incudal-gateway-backup default >/dev/null
    rc-service incudal-gateway-backup restart
    rc-service incudal-gateway-backup status
fi
echo 'Independent gateway backup scheduler is active; OSS readback completion must be verified separately.'
