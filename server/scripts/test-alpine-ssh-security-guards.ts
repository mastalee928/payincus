import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
assert.ok(alpineSshSecurityScript.includes('cmp -s') && !alpineSshSecurityScript.includes('chpasswd') && !/^\s*ssh-keygen\b/m.test(alpineSshSecurityScript))
const delivery = readFileSync(new URL('../src/services/dedicated-delivery.ts', import.meta.url), 'utf8')
assert.ok(delivery.indexOf('assertAlpineSshSecurityInspection(result.stdout)') < delivery.indexOf('await checkSshLogin(publicIp'))
const hostRoute = readFileSync(new URL('../src/routes/hosts.ts', import.meta.url), 'utf8')
assert.ok(hostRoute.includes("script.replace('# INJECT_ALPINE_SSH_SECURITY', () => securityScript)"))
console.log('PASS Alpine SSH guards: signed same-branch patch, password policy, missing inspection refusal, reload and identity preservation')
