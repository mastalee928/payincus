#!/usr/bin/env bash
# Invoked by verified installation/update code, or explicitly by the owner.
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
[[ "$root" == /opt/incudal || "$root" == /opt/incudal/releases/* ]] || { echo 'Unexpected install directory.' >&2; exit 1; }
for file in "$root/deploy/incudal-online-task.sh.example" "$root/deploy/incudal-systemctl-wrapper.sh.example" "$root/deploy/incudal-platform-backup@.service.example"; do
  [[ -f "$file" && ! -L "$file" && $(stat -c %u "$file") == 0 ]] || { echo 'Untrusted helper source.' >&2; exit 1; }
done
install -d -o root -g incudal -m 0750 /var/lib/incudal-backup
install -d -o incudal -g incudal -m 0700 /var/lib/incudal-backup/inbox
install -d -o root -g incudal -m 0750 /var/lib/incudal-backup/results
install -d -o root -g root -m 0700 /var/lib/incudal-backup/private
install -o root -g root -m 0755 "$root/deploy/incudal-online-task.sh.example" /usr/local/libexec/incudal/incudal-online-task
install -o root -g root -m 0755 "$root/deploy/incudal-systemctl-wrapper.sh.example" /usr/local/libexec/incudal/systemctl
install -o root -g root -m 0644 "$root/deploy/incudal-platform-backup@.service.example" /etc/systemd/system/incudal-platform-backup@.service
temporary=$(mktemp)
trap 'rm -f "$temporary"' EXIT
printf '%s\n' 'incudal ALL=(root) NOPASSWD: /usr/local/libexec/incudal/systemctl start --no-block incudal-platform-backup@*.service' > "$temporary"
chmod 0440 "$temporary"
visudo -cf "$temporary" >/dev/null
install -o root -g root -m 0440 "$temporary" /etc/sudoers.d/incudal-platform-backup
install -d -o root -g root -m 0755 /etc/systemd/system/incudal-backend.service.d
work_dir=/opt/incudal
[[ ! -L /opt/incudal/current ]] || work_dir=/opt/incudal/current
cat > /etc/systemd/system/incudal-backend.service.d/platform-backup.conf <<EOF
[Service]
ReadWritePaths=/var/lib/incudal-backup/inbox
ExecStartPre=
ExecStartPre=/usr/bin/bash -lc 'if [ ! -e /var/lib/incudal-backup/recovery-hold.json ]; then cd $work_dir/server && pnpm exec prisma migrate deploy; fi'
EOF
chmod 0644 /etc/systemd/system/incudal-backend.service.d/platform-backup.conf
systemctl daemon-reload
