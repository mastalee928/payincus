#!/usr/bin/env bash
# Fixed endpoint refresh for an already enrolled host; no route/key replacement.
set -Eeuo pipefail
[[ $EUID -eq 0 && $# -eq 0 ]] || exit 1
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
source="$root/refresh-host-gateway-endpoint.py"
[[ -f "$source" && ! -L "$source" && $(stat -c %u "$source") == 0 ]] || exit 1
[[ -f /etc/incudal-onboarding-id && -f /etc/wireguard/incudal-mgmt.conf ]] || exit 1
for directory in "$root" /usr /usr/local /etc /etc/systemd /etc/systemd/system; do
    [[ -e "$directory" ]] || continue
    [[ -d "$directory" && ! -L "$directory" && $(stat -c %u "$directory") == 0 ]] || exit 1
    [[ -z $(find "$directory" -maxdepth 0 -perm /022 -print -quit) ]] || exit 1
done
[[ -z $(find "$source" -maxdepth 0 -perm /022 -print -quit) ]] || exit 1
if command -v systemctl >/dev/null 2>&1; then
    unit=/etc/systemd/system/incudal-gateway-dns.service
else
    command -v rc-service >/dev/null && command -v rc-update >/dev/null || exit 1
    unit=/etc/init.d/incudal-gateway-dns
fi
if [[ -e "$unit" || -L "$unit" ]]; then
    [[ -f "$unit" && ! -L "$unit" && $(stat -c %u "$unit") == 0 ]] && grep -Fxq '# payincus-host-gateway-dns-v1' "$unit" || exit 1
    [[ -z $(find "$unit" -maxdepth 0 -perm /022 -print -quit) ]] || exit 1
fi
target=/usr/local/libexec/incudal-gateway-dns
[[ ! -L /usr/local/libexec && ! -L "$target" ]] || exit 1
if [[ -e "$target" ]]; then
    [[ -f "$target" && $(stat -c %u "$target") == 0 && -z $(find "$target" -maxdepth 0 -perm /022 -print -quit) ]] || exit 1
    grep -Fq 'Refresh only the existing managed WireGuard peer' "$target" || exit 1
fi
install -d -o root -g root -m 0755 /usr/local/libexec
install -o root -g root -m 0755 "$source" "$target"
was_active=false
if command -v systemctl >/dev/null 2>&1; then
    if systemctl is-active --quiet incudal-gateway-dns.service; then
        was_active=true
        systemctl stop incudal-gateway-dns.service
    fi
else
    if rc-service incudal-gateway-dns status >/dev/null 2>&1; then
        was_active=true
        rc-service incudal-gateway-dns stop
    fi
fi
restore_service() {
    if [[ "$was_active" == true ]]; then
        if command -v systemctl >/dev/null 2>&1; then systemctl start incudal-gateway-dns.service; else rc-service incudal-gateway-dns start; fi
    fi
}
trap restore_service EXIT
/usr/bin/python3 -I -B "$target" --enroll
if command -v systemctl >/dev/null 2>&1; then
    cat > "$unit" <<'EOF'
# payincus-host-gateway-dns-v1
[Unit]
Description=Refresh enrolled PayIncus gateway DNS endpoint
After=network-online.target wg-quick@incudal-mgmt.service
Wants=network-online.target
[Service]
Type=simple
ExecStart=/usr/bin/python3 -I -B /usr/local/libexec/incudal-gateway-dns --serve
Restart=on-failure
RestartSec=10
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/run
PrivateTmp=true
CapabilityBoundingSet=CAP_NET_ADMIN
MemoryMax=64M
TasksMax=8
[Install]
WantedBy=multi-user.target
EOF
    chmod 0644 "$unit"
    systemctl daemon-reload
    systemctl enable incudal-gateway-dns.service >/dev/null
    systemctl restart incudal-gateway-dns.service
    systemctl is-active --quiet incudal-gateway-dns.service
else
    cat > "$unit" <<'EOF'
#!/sbin/openrc-run
# payincus-host-gateway-dns-v1
description="Refresh enrolled PayIncus gateway DNS endpoint"
command="/usr/bin/python3"
command_args="-I -B /usr/local/libexec/incudal-gateway-dns --serve"
supervisor="supervise-daemon"
respawn_delay=10
respawn_max=0
pidfile="/run/incudal-gateway-dns.pid"
output_log="/var/log/incudal-gateway-dns.log"
error_log="/var/log/incudal-gateway-dns.log"
depend() { need net; after wg-quick.incudal-mgmt; }
EOF
    chmod 0755 "$unit"
    rc-update add incudal-gateway-dns default >/dev/null
    rc-service incudal-gateway-dns restart
    rc-service incudal-gateway-dns status >/dev/null
fi
trap - EXIT
echo 'Existing gateway DNS refresh enabled; keys, routes and customer forwarding retained.'
