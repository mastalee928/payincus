#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || exit 1
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
source="$root/deploy/incudal-local-gateway@.service.example"
[[ -f "$source" && ! -L "$source" && $(stat -c %u "$source") == 0 ]] || exit 1
[[ -z $(find "$source" -perm /022 -print -quit) ]] || exit 1
install -d -o root -g incudal -m 0750 /var/lib/incudal-local-gateway
install -d -o incudal -g incudal -m 0700 /var/lib/incudal-local-gateway/inbox
install -d -o root -g incudal -m 0750 /var/lib/incudal-local-gateway/results
install -o root -g root -m 0644 "$source" /etc/systemd/system/incudal-local-gateway@.service
install -d -o root -g root -m 0755 /etc/systemd/system/incudal-backend.service.d
printf '%s\n' '[Service]' 'ReadWritePaths=/var/lib/incudal-local-gateway/inbox' > /etc/systemd/system/incudal-backend.service.d/local-gateway.conf
chmod 0644 /etc/systemd/system/incudal-backend.service.d/local-gateway.conf
/usr/bin/systemctl daemon-reload
