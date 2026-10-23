#!/usr/bin/env bash
# Refresh only an already-installed local gateway; preserve keys and peers.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run gateway refresh as root.' >&2; exit 1; }
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [[ -f /etc/wireguard/incudal-mgmt.conf && -f /usr/local/sbin/incudal-onboarding-gateway ]]; then
  test -s "$script_dir/onboarding-gateway.py"
  install -o root -g root -m 0755 "$script_dir/onboarding-gateway.py" /usr/local/sbin/incudal-onboarding-gateway
  install -d -o root -g root -m 0755 /usr/local/libexec/incudal-onboarding-dns
  for tool in refresh-host-gateway-endpoint.py install-host-gateway-dns.sh; do
    [[ -f "$script_dir/$tool" && ! -L "$script_dir/$tool" ]] || exit 1
    install -o root -g root -m 0644 "$script_dir/$tool" "/usr/local/libexec/incudal-onboarding-dns/$tool"
  done
  echo 'Local management gateway code refreshed; keys and peers preserved.'
fi
