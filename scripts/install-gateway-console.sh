#!/usr/bin/env bash
# Explicit standalone gateway console installer. No PayIncus backend instance.
set -euo pipefail
umask 077
[[ $EUID -eq 0 && $# -eq 4 ]] || { echo 'Usage: install-gateway-console.sh --plan|--install <node> <entry> <protected-config>' >&2; exit 1; }
mode=$1
runtime=$2
entry=$3
config=$4
[[ "$mode" == --plan || "$mode" == --install ]] || exit 1
for path in "$runtime" "$entry" "$config"; do
    [[ "$path" =~ ^/[A-Za-z0-9_./-]+$ && "$path" != *'/../'* && -f "$path" && ! -L "$path" ]] || { echo 'Protected absolute files are required.' >&2; exit 1; }
done
command -v python3 >/dev/null
auth=$(python3 - "$config" "$runtime" "$entry" <<'PY'
import json, os, stat, sys, re
from pathlib import Path
for filename in sys.argv[1:]:
    path=Path(filename)
    for ancestor in path.parents:
        info=ancestor.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022:
            raise ValueError('unsafe installation parent')
    info=path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022:
        raise ValueError('unsafe installation file')
path=Path(sys.argv[1])
info=path.stat()
if stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1 or stat.S_IMODE(path.parent.stat().st_mode)!=0o700:
    raise ValueError('private configuration required')
config=json.loads(path.read_text())
auth=config['authDirectory']
if not isinstance(auth,str) or not re.fullmatch(r'/[A-Za-z0-9_./-]+',auth) or str(Path(auth))!=auth:
    raise ValueError('unsafe auth directory')
info=Path(auth).lstat()
if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or stat.S_IMODE(info.st_mode)!=0o700:
    raise ValueError('unsafe auth directory')
if not Path(auth,'gateway-auth.json').is_file():
    raise ValueError('explicit account initialization required')
print(auth)
PY
)
if command -v systemctl >/dev/null; then init=systemd
elif command -v rc-service >/dev/null; then init=openrc
else echo 'Unsupported service manager.' >&2; exit 1; fi
if [[ "$mode" == --plan ]]; then
    printf 'Independent gateway console: init=%s; auth=%s; no business backend or database dependency.\n' "$init" "$auth"
    exit 0
fi
if [[ "$init" == systemd ]]; then
    unit=/etc/systemd/system/incudal-gateway-console.service
    if [[ -e "$unit" ]]; then
        [[ ! -L "$unit" ]] && grep -Fxq '# payincus-gateway-console-v1' "$unit" || { echo 'Unrelated existing console service.' >&2; exit 1; }
    fi
    cat > "$unit" <<EOF
# payincus-gateway-console-v1
[Unit]
Description=Independent PayIncus gateway console
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
ExecStart=$runtime $entry --serve $config
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$auth
PrivateTmp=true
CapabilityBoundingSet=CAP_NET_ADMIN
MemoryMax=256M
TasksMax=32
Environment=NODE_OPTIONS=--max-old-space-size=128

[Install]
WantedBy=multi-user.target
EOF
    chmod 0644 "$unit"
    systemctl daemon-reload
    systemctl enable incudal-gateway-console.service >/dev/null
    systemctl restart incudal-gateway-console.service
    systemctl is-active --quiet incudal-gateway-console.service
else
    unit=/etc/init.d/incudal-gateway-console
    if [[ -e "$unit" ]]; then
        [[ ! -L "$unit" ]] && grep -Fxq '# payincus-gateway-console-v1' "$unit" || { echo 'Unrelated existing console service.' >&2; exit 1; }
    fi
    cat > "$unit" <<EOF
#!/sbin/openrc-run
# payincus-gateway-console-v1
description="Independent PayIncus gateway console"
command="$runtime"
command_args="$entry --serve $config"
command_background=true
pidfile="/run/incudal-gateway-console.pid"
output_log="/var/log/incudal-gateway-console.log"
error_log="/var/log/incudal-gateway-console.log"
depend() { need net; }
EOF
    chmod 0755 "$unit"
    rc-update add incudal-gateway-console default >/dev/null
    rc-service incudal-gateway-console restart
    rc-service incudal-gateway-console status
fi
echo 'Independent gateway console service is active; validate HTTPS login and node status separately.'
