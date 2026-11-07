import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const installer = readFileSync(new URL('../server/templates/install-alpine.sh', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const start = installer.indexOf('configure_incus_memory_default() {')
const end = installer.indexOf('\ninstall_alpine()', start)
assert.ok(start >= 0 && end > start)
assert.ok(installer.indexOf('\n  configure_incus_memory_default\n') < installer.indexOf('\n  rc-service incusd status'))
const body = installer.slice(start, end)
assert.ok(!body.includes('rc-service') && !body.includes('sysctl') && !body.includes('/sys/kernel'))
const root = mkdtempSync(join(tmpdir(), 'incudal-memory-guard-'))
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
try {
  const fixture = body.replaceAll('/etc/conf.d/incusd', './incusd').replaceAll('/etc/conf.d/.incusd-memory.XXXXXX', './.memory.XXXXXX').replaceAll('/var/lib/incus/unix.socket', './unix.socket').replaceAll('/var/lib/incus/database', './database')
  const script = `set -euo pipefail
fail() { echo "$*" >&2; exit 1; }
${fixture}
memory=989388
running=false
awk() { printf '%s\\n' "$memory"; }
pgrep() { [[ "$running" == true ]]; }
stat() { if [[ "$1" == -c && "$2" == %u ]]; then echo 0; else command stat "$@"; fi; }
printf '%s\\n' '# official Incus options' 'INCUSD_OPTIONS=""' > incusd
chmod 640 incusd
original_mode=$(command stat -c %a incusd)
cp incusd default-original
unset INCUDAL_EXPERIMENTAL_INCUS_MEMORY
configure_incus_memory_default
cmp default-original incusd
export INCUDAL_EXPERIMENTAL_INCUS_MEMORY=1
configure_incus_memory_default
cp incusd configured
configure_incus_memory_default
cmp configured incusd
[[ "$(command stat -c %a incusd)" == "$original_mode" ]]
actual=$( (unset GODEBUG; . ./incusd; printf '%s' "$GODEBUG") )
[[ "$actual" == disablethp=1 ]]
actual=$( (export GODEBUG=madvdontneed=1; . ./incusd; printf '%s' "$GODEBUG") )
[[ "$actual" == madvdontneed=1,disablethp=1 ]]
actual=$( (export GODEBUG=disablethp=0,madvdontneed=1; . ./incusd; printf '%s' "$GODEBUG") )
[[ "$actual" == disablethp=0,madvdontneed=1 ]]
printf '%s\\n' 'INCUSD_OPTIONS=""' > incusd
cp incusd original
running=true
configure_incus_memory_default
cmp original incusd
running=false
mkdir database
configure_incus_memory_default
cmp original incusd
rmdir database
memory=4194304
configure_incus_memory_default
cmp original incusd
memory=989388
mv incusd original-file
ln -s original-file incusd
if [[ -L incusd ]]; then
  if (configure_incus_memory_default); then echo 'symlink should fail' >&2; exit 1; fi
  symlink_evidence=verified
else
  symlink_evidence=unavailable-on-this-filesystem
fi
cmp original original-file
printf '%s\\n' "PASS Incus memory experiment: opt-in required, environment preserved, idempotent, existing daemon/state and large host skipped, permissions retained; symlink=$symlink_evidence"
`
  const path = join(root, 'guard.sh')
  writeFileSync(path, script)
  if (process.env.INCUDAL_MEMORY_GUARD_DUMP) writeFileSync(process.env.INCUDAL_MEMORY_GUARD_DUMP, script)
  const result = spawnSync(bash, [process.env.INCUDAL_MEMORY_GUARD_TRACE ? '-x' : '--noprofile', './guard.sh'], { cwd: root, encoding: 'utf8', timeout: 15000 })
  process.stdout.write(result.stdout || '')
  if (result.status !== 0) process.stderr.write(result.stderr || result.error?.message || 'Bash guard failed')
  assert.equal(result.status, 0)
} finally {
  rmSync(root, { recursive: true, force: true })
}
