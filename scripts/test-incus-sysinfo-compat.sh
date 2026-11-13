#!/bin/sh
# Only the disposable GitHub Docker host created by the compatibility workflow.
set -eux
test "${INCUDAL_SYSINFO_COMPAT_TEST:-}" = disposable
test ! -e /var/lib/incus/database
ls -ld /proc /proc/self
cat /proc/self/status | head -n12
mount | head -n12
apk add --no-cache incus incus-client openrc apparmor-utils iproute2 python3
mkdir -p /run/openrc /run/dbus
touch /run/openrc/softlevel
dbus-daemon --system --fork
/usr/sbin/incusd --group incus >/tmp/incusd-original.log 2>&1 &
old=$!
sleep 2
kill -0 "$old" || { wait "$old"; cat /tmp/incusd-original.log; exit 1; }
ps -o pid,ppid,args
ls -l /proc/$old/exe /run/incus /var/lib/incus || true
cat /tmp/incusd-original.log
if ! incus admin waitready --timeout=60; then cat /tmp/incusd-original.log; exit 1; fi
incus storage create default dir
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
kill -TERM "$old"
for n in $(seq 1 60);do kill -0 "$old" 2>/dev/null || break;sleep 1;done
if kill -0 "$old" 2>/dev/null;then cat /tmp/incusd-original.log;exit 1;fi
cp /usr/sbin/incusd /tmp/incusd-original
install -m 0755 /out/incusd /usr/sbin/incusd
/usr/sbin/incusd --group incus >/tmp/incusd-fixed.log 2>&1 &
if ! incus admin waitready --timeout=60; then cat /tmp/incusd-fixed.log; exit 1; fi
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
incus delete --force native-sysinfo
echo 'PASS original Alpine daemon to fixed same version: UUID/PID/boot/disk retained and actual sysinfo=128MiB'
