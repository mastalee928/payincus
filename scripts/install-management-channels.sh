#!/usr/bin/env bash
# Explicit installer for independent signed management transport only.
set -euo pipefail
umask 077
[[ $EUID -eq 0 && $# -eq 4 ]] || { echo 'Usage: install-management-channels.sh --plan|--install <binary> <sha256> <protected-config>' >&2; exit 1; }
mode=$1
binary=$2
expected_sha=$3
config=$4
[[ "$mode" == --plan || "$mode" == --install ]] || exit 1
[[ "$expected_sha" =~ ^[a-f0-9]{64}$ && "$binary" =~ ^/[A-Za-z0-9_./-]+$ && "$config" =~ ^/[A-Za-z0-9_./-]+$ && "$binary" != *'/../'* && "$config" != *'/../'* ]] || { echo 'Explicit absolute paths and SHA256 are required.' >&2; exit 1; }
[[ -f "$binary" && ! -L "$binary" && -x "$binary" ]] || { echo 'A regular executable is required.' >&2; exit 1; }
[[ "$(sha256sum "$binary" | awk '{print $1}')" == "$expected_sha" ]] || { echo 'Binary hash mismatch.' >&2; exit 1; }
command -v python3 >/dev/null
command -v wg >/dev/null
command -v ip >/dev/null
# Parse only public local paths; do not echo identities, signed data or keys.
state=$(python3 - "$config" <<'PY'
import json, os, re, stat, sys
from pathlib import Path
path=Path(sys.argv[1])
def private_file(path):
    current=path.parent
    while True:
        info=current.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022:
            raise ValueError('unsafe parent')
        if current==path.parent and stat.S_IMODE(info.st_mode)!=0o700:
            raise ValueError('private directory required')
        if current==current.parent: break
        current=current.parent
    info=path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1:
        raise ValueError('unsafe file')
private_file(path)
raw=json.loads(path.read_text())
value=raw['stateDirectory']
if not isinstance(value,str) or not re.fullmatch(r'/[A-Za-z0-9_./-]+',value) or str(Path(value))!=value:
    raise ValueError('unsafe state path')
info=Path(value).lstat()
if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or stat.S_IMODE(info.st_mode)!=0o700:
    raise ValueError('private state required')
print(value)
PY
)
if command -v systemctl >/dev/null; then
    init=systemd
elif command -v rc-service >/dev/null; then
    init=openrc
else
    echo 'Unsupported service manager.' >&2
    exit 1
fi
if [[ "$mode" == --plan ]]; then
    printf 'Independent management channels: init=%s; config=%s; state=%s; no business service dependency.\n' "$init" "$config" "$state"
    exit 0
fi
target=/usr/local/libexec/incudal-channels
[[ ! -L /usr/local/libexec && ! -L "$target" ]] || { echo 'Unsafe installation target.' >&2; exit 1; }
# Own only marked units. Do not overwrite an unrelated local service.
if [[ "$init" == systemd && -e /etc/systemd/system/incudal-channels.service ]]; then
    [[ ! -L /etc/systemd/system/incudal-channels.service ]] && grep -Fxq '# payincus-management-channels-v1' /etc/systemd/system/incudal-channels.service || { echo 'Existing service is not owned by this installer.' >&2; exit 1; }
fi
if [[ "$init" == openrc && -e /etc/init.d/incudal-channels ]]; then
    [[ ! -L /etc/init.d/incudal-channels ]] && grep -Fxq '# payincus-management-channels-v1' /etc/init.d/incudal-channels || { echo 'Existing service is not owned by this installer.' >&2; exit 1; }
fi
# Verify/apply the signed network plan before enabling persistence. Refusal
# leaves existing routes intact and does not install a misleading service.
"$binary" --apply "$config"
install -d -m 0755 /usr/local/libexec
install -m 0755 "$binary" "$target"
if [[ "$init" == systemd ]]; then
    cat > /etc/systemd/system/incudal-channels.service <<EOF
# payincus-management-channels-v1
[Unit]
Description=Independent signed PayIncus management channels
Wants=network-online.target
After=network-online.target
Before=incudal-maintenance.service

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
Environment=GOMAXPROCS=2

[Install]
WantedBy=multi-user.target
EOF
    chmod 0644 /etc/systemd/system/incudal-channels.service
    systemctl daemon-reload
    systemctl enable incudal-channels.service >/dev/null
    systemctl restart incudal-channels.service
    systemctl is-active --quiet incudal-channels.service
else
    cat > /etc/init.d/incudal-channels <<EOF
#!/sbin/openrc-run
# payincus-management-channels-v1
description="Independent signed PayIncus management channels"
command="$target"
command_args="--serve $config"
command_background=true
pidfile="/run/incudal-channels.pid"
output_log="/var/log/incudal-channels.log"
error_log="/var/log/incudal-channels.log"
depend() {
    need net
    before incudal-maintenance
}
start_pre() {
    "$target" --restore "$config" || return 1
}
EOF
    chmod 0755 /etc/init.d/incudal-channels
    rc-update add incudal-channels default >/dev/null
    rc-service incudal-channels restart
    rc-service incudal-channels status
fi
echo 'Independent management channels service is running; resource write authority remains separate.'
