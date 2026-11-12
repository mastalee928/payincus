import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { prepareKeyScript, installerStartScript, installerPollScript, preflightScript } from '../src/services/onboarding-scripts.js'
import { canAutomaticallyResumeOnboarding, onboardingRetryDelay } from '../src/lib/onboarding-retry.js'
import { sanitizeObject } from '../src/lib/log-sanitizer.js'
import { shellQuote } from '../src/lib/host-onboarding.js'
const interval = globalThis.setInterval
globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => interval(...args).unref()) as typeof setInterval
const { encryptSensitiveData, decryptSensitiveDataStrict } = await import('../src/lib/security.js')
const { readOnboardingCredentials } = await import('../src/lib/onboarding-credentials.js')
globalThis.setInterval = interval

const originalKey = process.env.ENCRYPTION_KEY
process.env.ENCRYPTION_KEY = 'local-onboarding-bootstrap-guard-only'
const payload = JSON.stringify({ password: 'private-fixture-password-$()' })
try {
  const first = encryptSensitiveData(payload), second = encryptSensitiveData(payload)
  assert.notEqual(first, second, 'random GCM nonce must prevent equal ciphertext for equal passwords')
  assert.equal(decryptSensitiveDataStrict(first), payload)
  assert.equal(readOnboardingCredentials(first).password, JSON.parse(payload).password)
  for (const invalid of [payload, 'plaintext', first.slice(0, -2) + (first.endsWith('00') ? 'ff' : '00'), first + 'zz']) {
    assert.equal(decryptSensitiveDataStrict(invalid), null)
    assert.throws(() => readOnboardingCredentials(invalid), /SSH_CREDENTIALS_INVALID/)
  }
  process.env.ENCRYPTION_KEY = 'different-key-fixture'
  assert.equal(decryptSensitiveDataStrict(first), null, 'wrong key never returns plaintext or untrusted input')
  const redacted = JSON.stringify(sanitizeObject({ credentials: { password: JSON.parse(payload).password, privateKey: 'private-fixture' }, credentialsEncrypted: first }))
  assert.ok(!redacted.includes('private-fixture') && !redacted.includes(first))
} finally { if (originalKey === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = originalKey }
const pending = { status: 'running', deletedAt: null, credentialsEncrypted: 'fixture', credentialsExpireAt: new Date(Date.now() + 60000) }
for (const code of ['HOST_DEPENDENCIES_PENDING', 'HOST_TIME_SYNC_PENDING', 'HOST_BBR_PENDING', 'HOST_SWAP_PENDING', 'SSH_COMMAND_TIMEOUT', 'INSTALL_DOWNLOAD_FAILED', 'INSTALL_DEPENDENCIES_PENDING', 'INSTALL_BUSY', 'AGENT_NOT_READY']) {
  assert.equal(canAutomaticallyResumeOnboarding(pending, code), true)
  assert.equal(canAutomaticallyResumeOnboarding({ ...pending, credentialsExpireAt: new Date(0) }, code), false)
}
for (const code of ['SSH_HOST_KEY_CHANGED', 'SSH_AUTH_FAILED', 'HOST_HAS_INSTANCES', 'INSTALL_FAILED', 'INSTALL_INTERRUPTED', 'ONBOARDING_STEP_FAILED']) {
  assert.equal(canAutomaticallyResumeOnboarding(pending, code), false, 'unknown/unsafe installer failures are never blindly replayed')
}
assert.equal(onboardingRetryDelay(1), 15000); assert.equal(onboardingRetryDelay(100), 300000)
const id = randomUUID(), generated = prepareKeyScript(id)
assert.ok(generated.indexOf('date -u -s') < generated.indexOf('apk add'), 'clock bootstrap precedes signed HTTPS package checks')
assert.ok(generated.includes('chronyc waitsync') && generated.includes('flock -w 15'))
assert.doesNotMatch(generated, /--allow-untrusted|--allow-unauthenticated|curl\s+-k|swapoff|security\.privileged.*true/)
for (const osId of ['debian', 'ubuntu', 'alpine']) {
  const script = installerStartScript(id, 1, 'https://panel.example/api/hosts/install.sh/fixture', { storageSize: 34, osId })
  assert.ok(script.includes('bash ./install.sh --mode nat --port 8443' + (osId === 'alpine' ? ' </dev/null' : ' --yes </dev/null')))
}
const directory = mkdtempSync(join(tmpdir(), 'onboarding-bootstrap-'))
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
try {
  for (const path of ['etc/apk', 'etc/sysctl.d', 'etc/modules-load.d', 'usr/local/libexec', `root/.incudal-onboarding/${id}`]) mkdirSync(join(directory, path), { recursive: true })
  for (const [os, arch] of [['alpine', 'x86_64'], ['alpine', 'aarch64'], ['debian', 'x86_64'], ['debian', 'aarch64']]) {
    writeFileSync(join(directory, 'etc/os-release'), `ID=${os}\nVERSION_ID=${os === 'alpine' ? '3.22.2' : '13'}\n`)
    writeFileSync(join(directory, 'etc/apk/repositories'), 'https://dl-cdn.alpinelinux.org/alpine/v3.22/main\n')
    const fixture = generated.replaceAll('/etc/', './etc/').replaceAll('/usr/local/', './usr/local/').replaceAll('/root/', './root/')
    const code = `set -eu
id() { echo 0; }
uname() { echo '${arch}'; }
date() { if [ "$1" = -u ] && [ "$2" = +%s ]; then echo 1; else echo clock-set >> actions; fi; }
timeout() { shift; "$@"; }
apk() { echo apk >> actions; [ "\${FAIL_PACKAGES:-0}" != 1 ]; }
aa-exec() { [ "\${FAIL_TOOLS:-0}" != 1 ]; }
apt-get() { echo apt >> actions; [ "\${FAIL_PACKAGES:-0}" != 1 ]; }
dpkg() { return 0; }
modprobe() { :; }
sysctl() {
  if [ "$1" = -n ]; then
    [ "\${FAIL_BBR:-0}" != capability ] || return 1
    if [ "\${FAIL_BBR:-0}" = unsupported ]; then echo cubic; else echo bbr; fi
  else echo bbr-set >> actions; [ "\${FAIL_BBR:-0}" != apply ]; fi
}
python3() { echo timezone >> actions; }
rc-update() { :; }
rc-service() { :; }
systemctl() { :; }
chronyc() { echo synchronized >> actions; [ "\${FAIL_TIME:-0}" != 1 ]; }
flock() { :; }
wg() { if [ "$1" = genkey ]; then echo generated >> actions; echo private-fixture-key; [ "\${FAIL_KEY:-0}" != 1 ]; else cat >/dev/null; echo public-fixture-key; fi; }
ip() { echo '1.1.1.1 via 192.0.2.1 dev eth0 src 192.0.2.2'; }
${fixture}
`
    const path = join(directory, 'fixture.sh'); writeFileSync(path, code)
    const run = (env: Record<string, string> = {}) => spawnSync(bash, [path], { cwd: directory, encoding: 'utf8', timeout: 20000, windowsHide: true, env: { ...process.env, ...env } })
    writeFileSync(join(directory, 'actions'), '')
    const first = run(); assert.equal(first.status, 0, first.stdout + first.stderr)
    const second = run(); assert.equal(second.status, 0, second.stdout + second.stderr)
    const settings = join(directory, 'etc/sysctl.d/90-incudal-bbr.conf')
    writeFileSync(settings, '# administrator original\nnet.ipv4.tcp_keepalive_time=123\n')
    for (const failure of ['capability', 'unsupported', 'apply']) {
      const result = run({ FAIL_BBR: failure })
      assert.equal(result.status, 0, 'optional BBR cannot interrupt onboarding: ' + result.stdout + result.stderr)
      assert.match(result.stdout, failure === 'unsupported' ? /INCUDAL_BBR:kernel-unavailable/ : /INCUDAL_BBR:pending/)
      assert.equal(readFileSync(settings, 'utf8'), '# administrator original\nnet.ipv4.tcp_keepalive_time=123\n')
    }
    const key = readFileSync(join(directory, `root/.incudal-onboarding/${id}/wg.key`), 'utf8')
    assert.equal(key.trim(), 'private-fixture-key')
    assert.ok(readFileSync(join(directory, 'actions'), 'utf8').includes('timezone'))
    const failure = run({ FAIL_PACKAGES: '1' }); assert.equal(failure.status, 1); assert.match(failure.stdout, /HOST_DEPENDENCIES_PENDING/)
    const unsynced = run({ FAIL_TIME: '1' }); assert.equal(unsynced.status, 1); assert.match(unsynced.stdout, /HOST_TIME_SYNC_PENDING/)
    assert.ok(!first.stdout.includes('private-fixture-key'))
    const keyPath = join(directory, `root/.incudal-onboarding/${id}/wg.key`)
    rmSync(keyPath)
    const partialKey = run({ FAIL_KEY: '1' })
    assert.equal(partialKey.status, 1); assert.match(partialKey.stdout, /HOST_DEPENDENCIES_PENDING/)
    assert.equal(existsSync(keyPath), false, 'a partially written key is never published')
    const resumedKey = run(); assert.equal(resumedKey.status, 0, resumedKey.stdout + resumedKey.stderr)
    assert.equal(readFileSync(keyPath, 'utf8').trim(), key.trim(), 'the next attempt can generate a valid key')
    console.log(`PASS generated ${os}/${arch}: clock before packages, timezone, BBR, time sync, original key, classified dependency/time failures`)
  }
  const installDirectory = join(directory, `root/.incudal-onboarding/${id}`)
  const scriptPath = join(directory, 'journal.sh')
  const runJournal = (script: string, rewritePaths = true) => {
    // Git Bash has no native Linux flock. This fixture executes the journal
    // decisions; actual process-lock inheritance remains native acceptance.
    writeFileSync(scriptPath, (process.platform === 'win32' ? 'flock() { return 0; }\n' : '') + (rewritePaths ? script.replaceAll('/root/', './root/') : script))
    return spawnSync(bash, [scriptPath], { cwd: directory, encoding: 'utf8', timeout: 10000, windowsHide: true })
  }
  writeFileSync(join(installDirectory, 'install.attempt'), '4')
  for (const [code, marker] of [['0', 'done'], ['75', 'INSTALL_DEPENDENCIES_PENDING'], ['1', 'INSTALL_FAILED'], ['124', 'INSTALL_FAILED']]) {
    writeFileSync(join(installDirectory, 'install.exit'), code)
    const result = runJournal(installerPollScript(id))
    assert.equal(result.status, code === '0' ? 0 : 1)
    assert.ok(result.stdout.includes(marker), result.stdout + result.stderr)
  }
  writeFileSync(join(installDirectory, 'install.exit'), '75')
  const start = (attempt: number) => installerStartScript(id, attempt, 'https://panel.example/install/fixture', { osId: 'debian', storageSize: 34 })
  assert.match(runJournal(start(4)).stdout, /INSTALL_DEPENDENCIES_PENDING/, 'lost response retains the retry classification')
  const next = runJournal('curl() { echo DOWNLOAD_RETRIED; return 1; }\n' + start(5))
  assert.equal(next.status, 1)
  assert.match(next.stdout, /DOWNLOAD_RETRIED/)
  assert.match(next.stdout, /INSTALL_DOWNLOAD_FAILED/)
  writeFileSync(join(installDirectory, 'install.exit'), '1')
  const automatic = installerStartScript(id, 6, 'https://panel.example/install/fixture', { storageSize: 34, retryFailedInstall: false })
  assert.match(runJournal('curl() { echo UNEXPECTED_DOWNLOAD; exit 99; }\n' + automatic).stdout, /INSTALL_FAILED/)
  mkdirSync(join(installDirectory, 'install.lock'))
  rmSync(join(installDirectory, 'install.exit'))
  writeFileSync(join(installDirectory, 'install.phase'), 'installing')
  assert.match(runJournal(automatic).stdout, /INSTALL_INTERRUPTED/, 'an unrelated SSH retry cannot replay an unknown interrupted installation')
  writeFileSync(join(installDirectory, 'install.phase'), 'downloading')
  const downloadRecovery = runJournal('curl() { echo RESUMED_DOWNLOAD; return 1; }\n' + automatic)
  assert.match(downloadRecovery.stdout, /RESUMED_DOWNLOAD/)
  assert.match(downloadRecovery.stdout, /INSTALL_DOWNLOAD_FAILED/)
  const busy = runJournal('flock() { return 1; }\ncurl() { echo UNEXPECTED_DOWNLOAD; exit 99; }\n' + automatic)
  assert.match(busy.stdout, /INSTALL_BUSY/)
  assert.doesNotMatch(busy.stdout, /UNEXPECTED_DOWNLOAD/)
  assert.equal(runJournal('flock() { return 1; }\n' + installerPollScript(id)).stdout.trim(), 'running', 'startup window without PID receipt is still covered by the live installer gate')
  writeFileSync(join(installDirectory, 'install.pid'), '-1')
  writeFileSync(join(installDirectory, 'install.boot'), 'fixture')
  assert.match(runJournal('kill() { echo UNEXPECTED_KILL; exit 99; }\n' + installerPollScript(id)).stdout, /INSTALL_INTERRUPTED/)
  for (const name of ['install.pid', 'install.boot', 'install.phase', 'install.attempt']) rmSync(join(installDirectory, name), { force: true })
  const preparedRunner = runJournal('curl() { :; }\nnohup() { :; }\n' + automatic)
  assert.equal(preparedRunner.status, 0, preparedRunner.stdout + preparedRunner.stderr)
  const runner = readFileSync(join(installDirectory, 'run.sh'), 'utf8')
  writeFileSync(join(installDirectory, 'install.sh'), 'if ( : >&8 ) 2>/dev/null; then echo INHERITED_GATE; exit 99; fi\necho INSTALLER_EXECUTED\nexit 0\n')
  const runDetached = () => runJournal(`cat() { if [ "$1" = /proc/sys/kernel/random/boot_id ]; then echo fixture-boot; else command cat "$@"; fi; }
sed() { echo fixture-stat; }
awk() { echo 123; }
timeout() { shift; "$@"; }
exec 8>>${shellQuote(join(directory, 'fixture-gate').replaceAll('\\', '/'))}
${runner}`, false)
  for (const name of ['install.pid', 'install.boot', 'install.ticks']) {
    rmSync(join(installDirectory, name), { force: true })
    mkdirSync(join(installDirectory, name))
    const failedReceipt = runDetached()
    assert.notEqual(failedReceipt.status, 0, name + ' write failure must stop the runner')
    assert.doesNotMatch(failedReceipt.stdout, /INSTALLER_EXECUTED/, 'no installer without durable process identity')
    rmSync(join(installDirectory, name), { recursive: true })
  }
  mkdirSync(join(installDirectory, 'install.exit.tmp'))
  const failedExit = runDetached()
  assert.notEqual(failedExit.status, 0, 'a failed completion receipt cannot report success')
  assert.match(failedExit.stdout, /INSTALLER_EXECUTED/, failedExit.stderr)
  assert.match(runJournal(automatic).stdout, /INSTALL_INTERRUPTED/, 'unknown completion remains protected')
  rmSync(join(installDirectory, 'install.exit.tmp'), { recursive: true })
  const completed = runDetached()
  assert.equal(completed.status, 0, completed.stdout + completed.stderr)
  assert.match(runJournal(installerPollScript(id)).stdout, /done/)
  console.log('PASS detached runner stops before install on receipt write failures; failed completion stays protected; valid completion is durable')
  console.log('PASS actual installer journal: package-only exit is resumable, unknown/time-limit exits stay blocked, next attempt performs a fresh download')
  const preflightPath = join(directory, 'preflight.sh')
  writeFileSync(join(directory, 'etc/incudal-onboarding-id'), id)
  mkdirSync(join(directory, 'var/lib/incus'), { recursive: true })
  const preflight = 'id() { echo 0; }\nincus() { return 1; }\n' + preflightScript(id)
    .replaceAll('/etc/', './etc/').replaceAll('/root/', './root/').replaceAll('/var/lib/', './var/lib/')
  writeFileSync(preflightPath, preflight)
  const runPreflight = () => spawnSync(bash, [preflightPath], { cwd: directory, encoding: 'utf8', timeout: 10000, windowsHide: true })
  assert.equal(runPreflight().status, 0, 'an installed CLI with no daemon/state can resume package setup')
  mkdirSync(join(directory, 'var/lib/incus/database'))
  assert.match(runPreflight().stdout, /INCUS_CHECK_FAILED/, 'inaccessible existing state is never guessed empty')
  console.log('PASS actual preflight distinguishes partial package installation from inaccessible Incus state')
} finally { rmSync(directory, { recursive: true, force: true }) }
for (const name of ['test-host-timezone.py', 'test-host-swap.py']) {
  const python = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['../scripts/' + name], { encoding: 'utf8', windowsHide: true })
  assert.equal(python.status, 0, python.stdout + python.stderr)
  console.log(`${name}: ${python.stderr.trim()}`)
}
console.log('PASS strict encrypted SSH credentials, no secret logging, bounded retry classification, ipinfo zone parsing and failure preservation; host commands are isolated fixtures')
