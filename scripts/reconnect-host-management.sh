#!/usr/bin/env bash
# Run in the affected HOST's cloud console, never in a customer container.
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root in the host cloud console.' >&2; exit 1; }
config=/etc/wireguard/incudal-mgmt.conf
[[ -f /etc/incudal-onboarding-id && -f "$config" && ! -L "$config" ]] || { echo 'Managed host configuration was not found.' >&2; exit 1; }
command -v wg >/dev/null && command -v wg-quick >/dev/null
temporary=$(mktemp)
trap 'rm -f "$temporary"' EXIT
chmod 0600 "$temporary"
wg-quick strip "$config" > "$temporary"
if ! ip link show incudal-mgmt >/dev/null 2>&1; then
  if command -v systemctl >/dev/null 2>&1; then
    systemctl start wg-quick@incudal-mgmt
  else
    rc-service wg-quick.incudal-mgmt start
  fi
fi
wg syncconf incudal-mgmt "$temporary"
while read -r peer; do
  [[ -z "$peer" ]] || wg set incudal-mgmt peer "$peer" persistent-keepalive 25
done < <(wg show incudal-mgmt peers)
if command -v systemctl >/dev/null 2>&1; then
  systemctl restart incudal-agent
else
  rc-service incudal-agent restart
fi
echo 'Existing management identity reloaded. Check the panel after 30–60 seconds.'
echo 'No keys, public port assignments, instances or storage were changed.'
