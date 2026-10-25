#!/usr/bin/env bash
# Installs only the sealed worker launcher. Existing gateway identities and
# independent transport/console/backup services are not restarted or replaced.
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
action="${1:-}"
[[ $# -le 1 && ( -z "$action" || "$action" == --initialize || "$action" == --refresh || "$action" == --verify || "$action" == --initialize-release ) ]] || { echo 'Expected an explicit enrollment action.' >&2; exit 1; }
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
[[ "$root" == /opt/incudal || "$root" == /opt/incudal/releases/* ]] || { echo 'Unexpected install directory.' >&2; exit 1; }
source="$root/deploy/incudal-gateway-task@.service.example"
[[ -f "$source" && ! -L "$source" && $(stat -c %u "$source") == 0 ]] || { echo 'Untrusted gateway worker source.' >&2; exit 1; }
if find "$source" -perm /022 -print -quit | grep -q .; then exit 1; fi
for directory in /usr /usr/local /usr/local/libexec /usr/local/libexec/incudal; do
    [[ -d "$directory" && ! -L "$directory" && $(stat -c %u "$directory") == 0 ]] || exit 1
    if find "$directory" -maxdepth 0 -perm /022 -print -quit | grep -q .; then exit 1; fi
done
wrapper=/usr/local/libexec/incudal/systemctl
[[ -f "$wrapper" && ! -L "$wrapper" && $(stat -c '%u:%g:%a' "$wrapper") == 0:0:755 ]] || exit 1
cmp -s "$wrapper" "$root/deploy/incudal-systemctl-wrapper.sh.example" || { echo 'Gateway worker wrapper does not match the verified release.' >&2; exit 1; }
for target in /etc/systemd/system/incudal-gateway-task@.service /etc/sudoers.d/incudal-gateway-task; do
    if [[ -e "$target" || -L "$target" ]]; then
        [[ -f "$target" && ! -L "$target" && $(stat -c %u "$target") == 0 ]] && grep -Fxq '# payincus-gateway-task-v1' "$target" || { echo 'Unrelated gateway worker configuration.' >&2; exit 1; }
    fi
done
prepare_controller_state_directory() {
    local directory="$1"
    [[ ! -L "$directory" ]] || { echo 'Untrusted controller directory.' >&2; return 1; }
    if [[ -d "$directory" ]]; then
        [[ $(stat -c %u "$directory") == 0 ]] || { echo 'Untrusted controller directory owner.' >&2; return 1; }
        local mode
        mode=$(stat -c %a "$directory")
        if [[ "$mode" != 700 ]]; then
            # Older installations can leave an empty root-owned mkdir(0755).
            # Tighten only that empty state; never repair exposed identities,
            # writable directories, links or a partial enrollment implicitly.
            local contents
            contents=$(find "$directory" -mindepth 1 -maxdepth 1 -print -quit) || return 1
            [[ "$mode" == 755 && -z "$contents" ]] || {
                echo 'Controller directory permissions require review.' >&2; return 1;
            }
            chmod 0700 "$directory"
        fi
    else
        install -d -o root -g root -m 0700 "$directory"
    fi
}
prepare_controller_state_directory /var/lib/incudal-gateway-controller
prepare_controller_state_directory /var/lib/incudal-gateway-components
install -o root -g root -m 0644 "$source" /etc/systemd/system/incudal-gateway-task@.service
temporary=$(mktemp)
trap 'rm -f "$temporary"' EXIT
# The root-owned wrapper already validates the exact argument count and unit
# UUID. New sudo parsers reject shell wildcards in command arguments.
printf '%s\n' '# payincus-gateway-task-v1' 'incudal ALL=(root) NOPASSWD: /usr/local/libexec/incudal/systemctl' > "$temporary"
chmod 0440 "$temporary"
visudo -cf "$temporary" >/dev/null
install -o root -g root -m 0440 "$temporary" /etc/sudoers.d/incudal-gateway-task
/usr/bin/systemctl daemon-reload
if [[ "$action" == --initialize-release || ( -z "$action" && -f "$root/vendor/gateway/catalog.json" && -f /var/lib/incudal-gateway-controller/enrollment.json && ! -e /var/lib/incudal-backup/recovery-hold.json ) ]]; then
    tool="$root/scripts/provision-gateway-controller.py"
    [[ -f "$tool" && ! -L "$tool" && $(stat -c %u "$tool") == 0 ]] || exit 1
    if find "$tool" -perm /022 -print -quit | grep -q .; then exit 1; fi
    provision_action=--refresh
    [[ "$action" != --initialize-release ]] || provision_action=--initialize
    /usr/bin/python3 -I -B "$tool" "$provision_action" "$root"
elif [[ -n "$action" ]]; then
    # JSON is read directly from stdin by the fixed enrollment tool. It cannot
    # select a destination, shell command, service name, or a new trust on refresh.
    tool="$root/scripts/enroll-gateway-controller.py"
    [[ -f "$tool" && ! -L "$tool" && $(stat -c %u "$tool") == 0 ]] || exit 1
    if find "$tool" -perm /022 -print -quit | grep -q .; then exit 1; fi
    /usr/bin/python3 -I -B "$tool" "$action"
fi
