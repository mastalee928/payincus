#!/usr/bin/env bash
# Full new guest delivery only on empty, disposable GitHub runners.
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_ENVIRONMENT:-} == github-hosted && $EUID -eq 0 ]] || exit 1
[[ ! -e /opt/incudal && ! -d /var/lib/incus/containers ]] || exit 1
apt-get update -qq
apt-get install -y -qq incus openssl openssh-server apparmor squashfs-tools rsync xz-utils wireguard-tools nftables iptables
systemctl start ssh
test "$(cat /sys/module/apparmor/parameters/enabled)" = Y
aa-exec --help >/dev/null
systemctl start incus
incus admin waitready --timeout=60
incus storage create default dir
incus network create incusbr0 ipv4.address=10.10.0.1/22 ipv4.nat=true ipv6.address=none
# The PostgreSQL service container enables Docker's FORWARD drop policy on
# this disposable runner. Incus nft rules cannot override that iptables chain.
# Permit only the freshly created test bridge, leaving all other traffic intact.
iptables -S FORWARD
if iptables -n -L DOCKER-USER >/dev/null 2>&1; then
  iptables -I DOCKER-USER 1 -i incusbr0 -j ACCEPT
  iptables -I DOCKER-USER 1 -o incusbr0 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
fi
root=$(mktemp -d /root/incudal-provisioning-XXXXXX)
trap 'touch "$root/guard-stop"; if test -n "${guard_pid:-}"; then wait "$guard_pid" 2>/dev/null || true; fi; rm -rf -- "$root"' EXIT
native_interface=$(ip -4 route show default | awk 'NR==1 {print $5}')
ip address add 11.0.0.99/32 dev "$native_interface"
ip link add incudal-mgmt type wireguard
wg genkey > "$root/wg.key"
wg genkey > "$root/wg-peer.key"
wg set incudal-mgmt private-key "$root/wg.key" peer "$(wg pubkey < "$root/wg-peer.key")" endpoint 192.0.2.20:51820
ip link set incudal-mgmt up
printf '%s\n' 'native-isolated-enrollment' > /etc/incudal-onboarding-id
export INCUDAL_POOL_GUARD_REPORT="$root/guard-report.json" INCUDAL_POOL_GUARD_STOP="$root/guard-stop"
INCUDAL_POOL_DELIVERY_GUARD=disposable /tmp/incudal-pool-guard-tests -test.run '^TestNativePoolDeliveryGuard$' -test.v > "$root/guard.log" 2>&1 &
guard_pid=$!
for attempt in $(seq 1 40); do
  test -s "$INCUDAL_POOL_GUARD_REPORT" && break
  sleep 1
done
test -s "$INCUDAL_POOL_GUARD_REPORT" || { cat "$root/guard.log"; exit 1; }
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$root/client.key" -out "$root/client.crt" -days 1 -subj /CN=provisioning-test >/dev/null 2>&1
incus config trust add-certificate "$root/client.crt" --name provisioning-test
incus config set core.https_address 127.0.0.1:18443
export INCUDAL_PROVISIONING_CERT="$root/client.crt" INCUDAL_PROVISIONING_KEY="$root/client.key"
if [[ ${INCUDAL_NATIVE_IMAGE:-} == debian/11/cloud ]]; then
  export SYSTEM_IMAGE_CACHE_DIR="$root/image-cache"
  pnpm --filter server exec tsx scripts/prepare-system-image-cache.ts
  pnpm --filter server test:bundled-system-images
fi
pnpm --filter server exec tsx scripts/smoke-provisioning-six-incus.ts
incus list --format=json | python3 -c 'import json,sys; assert json.load(sys.stdin)==[]'
echo 'PASS six guest families: actual AppArmor unpack, current generator, Running, original password SSH and verified cleanup.'
