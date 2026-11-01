#!/usr/bin/env bash
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_ENVIRONMENT:-} == github-hosted && $EUID -eq 0 ]] || exit 1
[[ ! -d /var/lib/incus/containers || -z $(ls -A /var/lib/incus/containers) ]] || { echo 'Disposable empty Incus host required'; exit 1; }
apt-get update -qq
apt-get install -y -qq incus busybox-static openssl
systemctl start incus
incus admin waitready --timeout=30
incus storage create cleanup-test dir
incus network create incusbr0 ipv4.address=10.199.0.1/24 ipv4.nat=true ipv6.address=none
incus profile device add default root disk path=/ pool=cleanup-test
incus profile device add default eth0 nic network=incusbr0 name=eth0
root=$(mktemp -d /root/incudal-incus-cleanup-XXXXXX)
trap 'rm -rf -- "$root"' EXIT
mkdir -p "$root/image/rootfs/"{bin,proc,sys,dev,tmp,run,etc}
cp /bin/busybox "$root/image/rootfs/bin/busybox"
ln -s busybox "$root/image/rootfs/bin/sh"
cat > "$root/image/rootfs/init" <<'INIT'
#!/bin/busybox sh
/bin/busybox mount -t proc proc /proc || true
exec /bin/busybox sleep 3600
INIT
chmod 755 "$root/image/rootfs/init"
printf 'architecture: x86_64\ncreation_date: 1700000000\nproperties:\n  description: Disposable cleanup fixture\n' > "$root/image/metadata.yaml"
tar -C "$root/image" -czf "$root/image.tar.gz" metadata.yaml rootfs
incus image import "$root/image.tar.gz" --alias cleanup-fixture
incus init cleanup-fixture cleanup-guest -c raw.lxc='lxc.init.cmd = /init'
incus start cleanup-guest
incus snapshot create cleanup-guest before-delete
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$root/client.key" -out "$root/client.crt" -days 1 -subj /CN=cleanup-test >/dev/null 2>&1
incus config trust add-certificate "$root/client.crt" --name cleanup-test
incus config set core.https_address 127.0.0.1:18443
export INCUDAL_CLEANUP_CLIENT_CERT="$root/client.crt" INCUDAL_CLEANUP_CLIENT_KEY="$root/client.key"
pnpm --filter server exec tsx scripts/smoke-pool-cleanup-incus.ts
incus init cleanup-fixture cleanup-guest -c raw.lxc='lxc.init.cmd = /init'
incus start cleanup-guest
incus snapshot create cleanup-guest before-delete
POOL_CLEANUP_WORKER=1 pnpm --filter server exec tsx scripts/smoke-pool-cleanup-incus.ts
incus init cleanup-fixture cleanup-guest -c raw.lxc='lxc.init.cmd = /init'
incus start cleanup-guest
incus snapshot create cleanup-guest before-delete
INSTANCE_DELETION_WORKER=1 pnpm --filter server exec tsx scripts/smoke-pool-cleanup-incus.ts
incus list --format=json | python3 -c 'import json,sys; assert json.load(sys.stdin)==[]'
echo 'Actual Incus running guest, snapshot, disk volume and forward deletion verified.'
