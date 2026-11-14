#!/bin/sh
# Only the disposable GitHub Docker host created by the compatibility workflow.
set -eux
test "${INCUDAL_SYSINFO_COMPAT_TEST:-}" = disposable
test ! -e /var/lib/incus/database
ls -ld /proc /proc/self
cat /proc/self/status | head -n12
mount | head -n12
apk add --no-cache incus incus-client incus-openrc openrc apparmor-utils iproute2 python3
# The minirootfs has no interface configuration. OpenRC must validate a real
# networking dependency, without reconfiguring the runner's external link.
mkdir -p /etc/network
printf 'auto lo\niface lo inet loopback\n' > /etc/network/interfaces
mkdir -p /run/openrc /run/dbus
touch /run/openrc/softlevel
dbus-daemon --system --fork
/usr/sbin/incusd --group incus >/tmp/incusd-original.log 2>&1 &
old=$!
sleep 2
kill -0 "$old" || { wait "$old" || true; cat /tmp/incusd-original.log; exit 1; }
ps -o pid,ppid,args
ls -l /proc/$old/exe /run/incus /var/lib/incus || true
cat /tmp/incusd-original.log
if ! incus admin waitready --timeout=60; then cat /tmp/incusd-original.log; exit 1; fi
if test "${INCUDAL_COMPAT_RELOAD_SCENARIO:-}" = btrfs-rebuild; then
  apk add --no-cache btrfs-progs
  # Let Incus create and format its own disposable loop-backed block device.
  # A source=regular-file is treated as an existing mounted Btrfs directory.
  incus storage create default btrfs size=1GiB
else
  incus storage create default dir
fi
if test "${INCUDAL_COMPAT_RELOAD_SCENARIO:-}" = empty-pool; then
  printf '%s\n' "$old" > /run/incus/incusd.pid
  /out/provisioning-test -test.run '^TestNativeCompatibilityEmptyPoolReload$' -test.v
  echo 'PASS actual empty-pool operations response and automatic daemon reload'
  exit 0
fi
incus init images:alpine/3.24/tinycloud native-sysinfo -s default -c limits.memory=128MiB -c security.syscalls.intercept.sysinfo=true
if ! incus start native-sysinfo; then incus info --show-log native-sysinfo; cat /tmp/incusd-original.log; exit 1; fi
sleep 4
incus exec native-sysinfo -- sh -c 'printf preserved >/root/owner-marker'
incus query /1.0/instances/native-sysinfo > /tmp/identity-before.json
incus query /1.0/instances/native-sysinfo/state > /tmp/state-before.json
incus exec native-sysinfo -- cat /proc/sys/kernel/random/boot_id > /tmp/boot-before
cat >/tmp/sysinfo.go <<'GO'
package main
import("fmt";"syscall")
func main(){var i syscall.Sysinfo_t;if e:=syscall.Sysinfo(&i);e!=nil{panic(e)};fmt.Printf("SYSINFO_BYTES=%d\n",uint64(i.Totalram)*uint64(i.Unit))}
GO
CGO_ENABLED=0 go build -o /tmp/sysinfo /tmp/sysinfo.go
incus file push --mode=0700 /tmp/sysinfo native-sysinfo/root/sysinfo
timeout -s KILL 5 incus exec native-sysinfo -- timeout -s KILL 3 /root/sysinfo >/tmp/sysinfo-old || true
if test -x /out/provisioning-test; then
  # Preserve the actual daemon PID captured at launch. Alpine's original
  # process title can be empty, so pgrep would reproduce the sysinfo bug in
  # the fixture before the production reload even starts.
  printf '%s\n' "$old" > /run/incus/incusd.pid
  if ! /out/provisioning-test -test.run '^TestNativeCompatibilityAutomaticReload$' -test.v; then
    # These contain only this disposable test guest. Preserve the actual
    # OpenRC failure rather than inferring a dependency or rerunning blindly.
    rc-service incusd start || true
    rc-status -a || true
    cat /tmp/incusd-original.log || true
    test ! -f /var/log/incus/incusd.log || tail -n 60 /var/log/incus/incusd.log
    exit 1
  fi
else
kill -TERM "$old"
for n in $(seq 1 60);do kill -0 "$old" 2>/dev/null || break;sleep 1;done
if kill -0 "$old" 2>/dev/null;then cat /tmp/incusd-original.log;exit 1;fi
cp /usr/sbin/incusd /tmp/incusd-original
install -m 0755 /out/incusd /usr/sbin/incusd
/usr/sbin/incusd --group incus >/tmp/incusd-fixed.log 2>&1 &
if ! incus admin waitready --timeout=60; then cat /tmp/incusd-fixed.log; exit 1; fi
fi
incus query /1.0/instances/native-sysinfo > /tmp/identity-after.json
incus query /1.0/instances/native-sysinfo/state > /tmp/state-after.json
incus exec native-sysinfo -- cat /proc/sys/kernel/random/boot_id > /tmp/boot-after
cmp /tmp/boot-before /tmp/boot-after
incus exec native-sysinfo -- sh -c 'test "$(cat /root/owner-marker)" = preserved'
python3 - <<'PY'
import json
b=json.load(open('/tmp/identity-before.json'));a=json.load(open('/tmp/identity-after.json'))
assert a['config']['volatile.uuid']==b['config']['volatile.uuid']
b=json.load(open('/tmp/state-before.json'));a=json.load(open('/tmp/state-after.json'))
assert a['status']==b['status']=='Running' and a['pid']==b['pid']
PY
timeout -s KILL 5 incus exec native-sysinfo -- timeout -s KILL 3 /root/sysinfo | tee /tmp/sysinfo-fixed
grep -q '^SYSINFO_BYTES=134217728$' /tmp/sysinfo-fixed
if test "${INCUDAL_COMPAT_RELOAD_SCENARIO:-}" = btrfs-rebuild; then
  for round in 1 2 3; do
    incus stop native-sysinfo --force
    # Keep a real stopped-instance file helper active before destructive
    # replacement, matching the customer initialization file access path.
    incus file pull native-sysinfo/etc/os-release /tmp/compat-os-release
    incus rebuild native-sysinfo images:alpine/3.24/tinycloud --force
    incus start native-sysinfo
    timeout -s KILL 10 incus exec native-sysinfo -- cat /etc/os-release
  done
  incus stop native-sysinfo --force
  target=/var/lib/incus/storage-pools/default/containers/native-sysinfo
  # Inject only the exact empty-directory remnant observed after a failed
  # rebuild in this disposable storage pool. Keep the original instance DB.
  forkpid=/var/lib/incus/logs/native-sysinfo/forkfile.pid
  if test -f "$forkpid"; then
    child=$(cat "$forkpid")
    kill -INT "$child"
    for n in $(seq 1 20); do kill -0 "$child" 2>/dev/null || break; sleep 1; done
    if kill -0 "$child" 2>/dev/null; then exit 1; fi
  fi
  btrfs subvolume delete "$target"
  mkdir -m 0100 "$target"
  printf preserve > "$target/owner-data"
  if incus rebuild native-sysinfo images:alpine/3.24/tinycloud --force; then
    echo 'Nonempty ordinary directory must not be wiped automatically'; exit 1
  fi
  test "$(cat "$target/owner-data")" = preserve
  rm "$target/owner-data"
  incus rebuild native-sysinfo images:alpine/3.24/tinycloud --force
  incus start native-sysinfo
  timeout -s KILL 10 incus exec native-sysinfo -- cat /etc/os-release
  incus query /1.0/instances/native-sysinfo > /tmp/identity-rebuild-final.json
  python3 - <<'PY'
import json
b=json.load(open('/tmp/identity-before.json'));a=json.load(open('/tmp/identity-rebuild-final.json'))
assert a['config']['volatile.uuid']==b['config']['volatile.uuid']
assert a['config']['limits.memory']=='128MiB'
PY
  echo 'PASS native Btrfs repeated rebuild and original empty-directory recovery'
fi
incus delete --force native-sysinfo
echo 'PASS original Alpine daemon to fixed same version: UUID/PID/boot/disk retained and actual sysinfo=128MiB'
