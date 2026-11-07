import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { generateContainerConfig } from '../src/lib/incus-config-container.js'
import { generateVmConfig } from '../src/lib/incus-config-vm.js'
import { alpineSshSecurityScript, assertAlpineSshSecurityInspection } from '../src/lib/alpine-ssh-security.js'

for (const branch of ['3.19', '3.20', '3.21', '3.22', '3.23', '3.24']) {
  for (const generate of [generateContainerConfig, generateVmConfig]) {
    const data = generate({ instanceName: 'alpine-ssh-guard', imageAlias: `images:alpine/${branch}/cloud`, rootPassword: 'isolated-existing-password' }).configPayload['user.user-data']
    assert.ok(data.includes('alpine_ssh_security_update install') && data.includes('alpine_ssh_minimum'), 'both initializers install and verify the official patch')
    assert.ok(data.includes('PasswordAuthentication yes') && data.includes('ssh_pwauth: true'))
    assert.ok(!data.includes('--allow-untrusted') && !data.includes('s/https:/http:/'))
    assert.ok(!data.includes('echo "PasswordAuthentication no"') && !data.includes('PasswordAuthentication no/'))
    // VM's non-Alpine conditional remains in the generated shell; it must not
    // become an Alpine auth-mode migration in this fix.
    if (generate === generateVmConfig) assert.ok(data.includes('if [ "alpine" != "alpine" ]; then'))
  }
}
assert.doesNotThrow(() => assertAlpineSshSecurityInspection('INCUDAL_SSH_NOT_ALPINE\n'))
assert.doesNotThrow(() => assertAlpineSshSecurityInspection('INCUDAL_ALPINE_SSH_FIXED\n'))
for (const output of ['', 'apk unavailable', 'prefix INCUDAL_ALPINE_SSH_FIXED', 'INCUDAL_ALPINE_SSH_UNPATCHED']) {
  assert.throws(() => assertAlpineSshSecurityInspection(output))
}
assert.ok(alpineSshSecurityScript.includes('--repositories-file') && alpineSshSecurityScript.includes('openssh-server~'))
assert.ok(alpineSshSecurityScript.includes('rc-service sshd reload') && !alpineSshSecurityScript.includes('sshd restart'))
assert.ok(alpineSshSecurityScript.includes('flock -w 2 9'),'allow bounded acquisition after BusyBox watchdog exits, without releasing a live inherited lock')
assert.ok(alpineSshSecurityScript.includes('cmp -s') && !alpineSshSecurityScript.includes('chpasswd') && !/^\s*ssh-keygen\b/m.test(alpineSshSecurityScript))
const delivery = readFileSync(new URL('../src/services/dedicated-delivery.ts', import.meta.url), 'utf8')
assert.ok(delivery.indexOf('assertAlpineSshSecurityInspection(result.stdout)') < delivery.indexOf('await checkSshLogin(publicIp'))
const hostRoute = readFileSync(new URL('../src/routes/hosts.ts', import.meta.url), 'utf8')
assert.ok(hostRoute.includes("script.replace('# INJECT_ALPINE_SSH_SECURITY', () => securityScript)"))
// Exercise the same public tsx API and real preflight import as the native
// entry without requiring Docker. Node's raw register(tsx/esm) is rejected.
const nativeSource=readFileSync(new URL('../../scripts/test-alpine-ssh-native.mjs',import.meta.url),'utf8')
const nativeBootstrap=nativeSource.split("assert.equal(process.platform, 'linux'")[0]
const bootstrap=spawnSync(process.execPath,['--input-type=module','--eval',nativeBootstrap+
  '\nassert.ok(alpineSshPreflightScript.includes("MemAvailable"));assert.equal(readAlpineSshPreflight("INCUDAL_SSH_PREFLIGHT aarch64 262144 0 262144 1024 0 0").status,"verified")'],
  {cwd:new URL('../../scripts/',import.meta.url),encoding:'utf8',windowsHide:true})
assert.equal(bootstrap.status,0,bootstrap.stdout+bootstrap.stderr)
console.log('PASS Alpine SSH guards: signed same-branch patch, password policy, missing inspection refusal, reload and identity preservation')
