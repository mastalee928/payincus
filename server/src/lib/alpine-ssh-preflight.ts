import type { HardeningCheck } from './security-hardening.js'

/** Read-only BusyBox-compatible probe. Runs inside the original customer, so
 * host headroom never substitutes for a guest's own memory/disk availability. */
export const alpineSshPreflightScript = `set -eu
architecture=$(uname -m)
available=$(awk '$1=="MemAvailable:" {print $2; exit}' /proc/meminfo)
# Containers may see host MemAvailable when lxcfs is absent. Bound headroom by
# their actual cgroup limit/current instead of granting host memory to guests.
if [ -r /sys/fs/cgroup/memory.max ] && [ -r /sys/fs/cgroup/memory.current ]; then
  limit=$(cat /sys/fs/cgroup/memory.max)
  current=$(cat /sys/fs/cgroup/memory.current)
elif [ -r /sys/fs/cgroup/memory/memory.limit_in_bytes ] && [ -r /sys/fs/cgroup/memory/memory.usage_in_bytes ]; then
  limit=$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes)
  current=$(cat /sys/fs/cgroup/memory/memory.usage_in_bytes)
else
  limit=max
  current=0
fi
case "$limit" in max) ;; ''|*[!0-9]*) exit 1 ;; *)
  case "$current" in ''|*[!0-9]*) exit 1 ;; esac
  available=$(awk -v available="$available" -v limit="$limit" -v current="$current" 'BEGIN {remaining=int((limit-current)/1024); if(remaining<0) remaining=0; print remaining<available?remaining:available}')
;; esac
pressure=none
if [ -r /proc/pressure/memory ]; then
  pressure=$(awk '$1=="some" {sub(/^avg10=/,"",$2); print $2; exit}' /proc/pressure/memory)
fi
disk=$(df -Pk / | awk 'NR==2 {print $4; exit}')
inodes=$(df -Pi / | awk 'NR==2 {print $4; exit}')
readonly=$(awk '$2=="/" {if ($4 ~ /(^|,)ro(,|$)/) print 1; else print 0; exit}' /proc/mounts)
busy=0
for process in /proc/[0-9]*/comm; do
  [ -r "$process" ] || continue
  name=$(cat "$process" 2>/dev/null) || continue
  case "$name" in apk|apt|apt-get|dpkg|dnf|rpm) busy=1; break ;; esac
done
printf 'INCUDAL_SSH_PREFLIGHT %s %s %s %s %s %s %s\\n' "$architecture" "$available" "$pressure" "$disk" "$inodes" "$readonly" "$busy"
`

export function readAlpineSshPreflight(output: string): HardeningCheck {
  const match = /^INCUDAL_SSH_PREFLIGHT ([a-zA-Z0-9_-]{1,32}) (\d+) (none|\d+(?:\.\d+)?) (\d+) (\d+) ([01]) ([01])\s*$/.exec(output.trim())
  if (!match) throw new Error('HARDENING_PROBE_UNSUPPORTED')
  const [memory, diskKiB, inodes] = [match[2], match[4], match[5]].map(Number)
  const pressure = match[3] === 'none' ? null : Number(match[3])
  if (![memory, diskKiB, inodes].every(value => Number.isSafeInteger(value) && value >= 0) ||
    pressure !== null && (!Number.isFinite(pressure) || pressure < 0 || pressure > 100)) throw new Error('HARDENING_PROBE_UNSUPPORTED')
  if (!['x86_64', 'aarch64'].includes(match[1])) return { status: 'needs-maintenance', reason: 'HARDENING_ARCH_UNSUPPORTED' }
  if (match[6] === '1') return { status: 'needs-maintenance', reason: 'HARDENING_FILESYSTEM_READONLY' }
  if (match[7] === '1') return { status: 'retry', reason: 'HARDENING_PACKAGE_BUSY' }
  if (memory < 128 * 1024) return { status: 'retry', reason: 'HARDENING_MEMORY_LOW' }
  if (pressure !== null && pressure >= 5) return { status: 'retry', reason: 'HARDENING_MEMORY_PRESSURE' }
  if (diskKiB < 128 * 1024 || inodes < 512) return { status: 'retry', reason: 'HARDENING_DISK_LOW' }
  return { status: 'verified' }
}
