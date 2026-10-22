#!/usr/bin/env bash
# Install only the signed transport coordinator; independent Web/backup follow.
set -euo pipefail
umask 077
[[ $EUID -eq 0 && $# -eq 4 ]] || { echo 'Usage: install-management-gateway.sh --plan|--install <binary> <sha256> <protected-config>' >&2; exit 1; }
mode=$1
binary=$2
expected=$3
config=$4
[[ "$mode" == --plan || "$mode" == --install ]] || exit 1
[[ "$expected" =~ ^[a-f0-9]{64}$ && "$binary" =~ ^/[A-Za-z0-9_./-]+$ && "$config" =~ ^/[A-Za-z0-9_./-]+$ && "$binary" != *'/../'* && "$config" != *'/../'* ]] || exit 1
[[ -f "$binary" && ! -L "$binary" && -x "$binary" && "$(sha256sum "$binary" | awk '{print $1}')" == "$expected" ]] || { echo 'Gateway binary or digest invalid.' >&2; exit 1; }
for tool in python3 wg ip; do command -v "$tool" >/dev/null; done
state=$(python3 - "$config" <<'PY'
import json, os, re, stat, sys
from pathlib import Path
path=Path(sys.argv[1])
for current in [path.parent, *path.parent.parents]:
    info=current.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022:
        raise ValueError('unsafe parent')
if stat.S_IMODE(path.parent.stat().st_mode)!=0o700:
    raise ValueError('private directory required')
fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
with os.fdopen(fd) as f:
    info=os.fstat(f.fileno())
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1 or info.st_size>16384:
        raise ValueError('unsafe config')
    config=json.load(f)
state=config['stateDirectory']
if not isinstance(state,str) or not re.fullmatch(r'/[A-Za-z0-9_./-]+',state) or str(Path(state))!=state:
    raise ValueError('unsafe state path')
info=Path(state).lstat()
if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or stat.S_IMODE(info.st_mode)!=0o700:
    raise ValueError('private state required')
print(state)
PY
)
if command -v systemctl >/dev/null; then init=systemd
elif command -v rc-service >/dev/null; then init=openrc
else echo 'Unsupported service manager.' >&2; exit 1; fi
if [[ "$mode" == --plan ]]; then
    printf 'Independent signed gateway transport: init=%s; config=%s; state=%s.\n' "$init" "$config" "$state"
    exit 0
fi
target=/usr/local/libexec/incudal-gateway
[[ ! -L /usr/local/libexec && ! -L "$target" ]] || exit 1
unit=/etc/systemd/system/incudal-gateway.service
if [[ "$init" == openrc ]]; then unit=/etc/init.d/incudal-gateway; fi
if [[ -e "$unit" ]]; then
    [[ ! -L "$unit" ]] && grep -Fxq '# payincus-gateway-transport-v1' "$unit" || { echo 'Unrelated existing gateway service.' >&2; exit 1; }
fi
"$binary" --apply "$config"
install -d -m 0755 /usr/local/libexec
install -m 0755 "$binary" "$target"
if [[ "$init" == systemd ]]; then
    cat > "$unit" <<EOF
# payincus-gateway-transport-v1
[Unit]
Description=Independent signed PayIncus gateway transport
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
ExecStartPre=$target --restore $config
ExecStart=$target --serve $config
Restart=on-failure
RestartSec=5
TimeoutStopSec=25
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$state
PrivateTmp=true
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_RAW
MemoryMax=128M
TasksMax=32
Environment=GOMAXPROCS=1

[Install]
WantedBy=multi-user.target
EOF
    chmod 0644 "$unit"
    systemctl daemon-reload
    systemctl enable incudal-gateway.service >/dev/null
    systemctl restart incudal-gateway.service
    systemctl is-active --quiet incudal-gateway.service
else
    cat > "$unit" <<EOF
#!/sbin/openrc-run
# payincus-gateway-transport-v1
description="Independent signed PayIncus gateway transport"
command="$target"
command_args="--serve $config"
command_background=true
pidfile="/run/incudal-gateway.pid"
output_log="/var/log/incudal-gateway.log"
error_log="/var/log/incudal-gateway.log"
depend() { need net; }
start_pre() { "$target" --restore "$config" || return 1; }
EOF
    chmod 0755 "$unit"
    rc-update add incudal-gateway default >/dev/null
    rc-service incudal-gateway restart
    rc-service incudal-gateway status
fi
echo 'Independent gateway transport is active; resource writer authorization remains separate.'
