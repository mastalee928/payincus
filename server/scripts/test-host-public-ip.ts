import assert from 'node:assert/strict'
import { chooseBindAddress, publicIpSettings, publicIpState, verifyPublicSshIdentity } from '../src/lib/host-public-ip.js'

assert.deepEqual(publicIpSettings({}), { mode: 'auto', publicIp: null, bindIp: null, sshPort: 22 })
assert.equal(publicIpSettings({ mode: 'manual', publicIp: '8.8.4.4', sshPort: 2222 }).sshPort, 2222)
for (const value of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1', '::1', 'host.example.com']) {
  assert.throws(() => publicIpSettings({ mode: 'manual', publicIp: value }), /IP_SETTINGS_INVALID/)
  await assert.rejects(verifyPublicSshIdentity(value, 22, ['SHA256:unused']), /IP_IDENTITY_UNAVAILABLE/)
}
assert.throws(() => publicIpSettings({ sshPort: 65536 }), /IP_SETTINGS_INVALID/)
assert.throws(() => publicIpSettings({ bindIp: '127.0.0.1' }), /IP_SETTINGS_INVALID/)
assert.equal(chooseBindAddress(['10.0.0.13', '10.0.0.14'], '10.0.0.13', null), '10.0.0.13')
assert.equal(chooseBindAddress(['10.0.0.14'], '10.0.0.13', null), '10.0.0.14')
assert.equal(chooseBindAddress(['10.0.0.13', '10.0.0.14'], null, '10.0.0.14'), '10.0.0.14')
assert.throws(() => chooseBindAddress(['10.0.0.13', '10.0.0.14'], null, null), /IP_BIND_AMBIGUOUS/)
assert.throws(() => chooseBindAddress(['10.0.0.13'], null, '10.0.0.15'), /IP_BIND_NOT_LOCAL/)
assert.throws(() => chooseBindAddress(['127.0.0.1'], null, null), /IP_BIND_AMBIGUOUS/)
assert.equal(publicIpState(null).status, 'idle')
console.log('Host public IP input, local binding selection and endpoint validation passed')
