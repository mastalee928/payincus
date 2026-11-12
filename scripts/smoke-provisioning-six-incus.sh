#!/usr/bin/env bash
# Full new guest delivery only on empty, disposable GitHub runners.
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_ENVIRONMENT:-} == github-hosted && $EUID -eq 0 ]] || exit 1
[[ ! -e /opt/incudal && ! -d /var/lib/incus/containers ]] || exit 1
apt-get update -qq
apt-get install -y -qq incus openssl apparmor squashfs-tools rsync xz-utils
test "$(cat /sys/module/apparmor/parameters/enabled)" = Y
aa-exec --help >/dev/null
systemctl start incus
incus admin waitready --timeout=60
incus storage create default dir
incus network create incusbr0 ipv4.address=10.198.0.1/24 ipv4.nat=true ipv6.address=none
# The PostgreSQL service container enables Docker's FORWARD drop policy on
# this disposable runner. Incus nft rules cannot override that iptables chain.
# Permit only the freshly created test bridge, leaving all other traffic intact.
iptables -S FORWARD
if iptables -n -L DOCKER-USER >/dev/null 2>&1; then
  iptables -I DOCKER-USER 1 -i incusbr0 -j ACCEPT
  iptables -I DOCKER-USER 1 -o incusbr0 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
fi
root=$(mktemp -d /root/incudal-provisioning-XXXXXX)
trap 'rm -rf -- "$root"' EXIT
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$root/client.key" -out "$root/client.crt" -days 1 -subj /CN=provisioning-test >/dev/null 2>&1
incus config trust add-certificate "$root/client.crt" --name provisioning-test
incus config set core.https_address 127.0.0.1:18443
export INCUDAL_PROVISIONING_CERT="$root/client.crt" INCUDAL_PROVISIONING_KEY="$root/client.key"
pnpm --filter server exec tsx scripts/smoke-provisioning-six-incus.ts
incus list --format=json | python3 -c 'import json,sys; assert json.load(sys.stdin)==[]'
echo 'PASS six guest families: actual AppArmor unpack, current generator, Running, original password SSH and verified cleanup.'
