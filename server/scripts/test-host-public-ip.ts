import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { Client } from 'ssh2'
import { createServer } from 'node:http'
import { Agent } from 'undici'
import { IncusClient } from '../src/lib/incus/incus-client.js'
import { chooseBindAddress, publicIpSettings, publicIpState, publicIpFailureCode, publicIpRetryPolicy, verifyPublicSshIdentity } from '../src/lib/host-public-ip.js'

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
assert.equal(chooseBindAddress(['8.8.4.4', '8.8.8.8'], '8.8.8.8', null, '8.8.4.4'), '8.8.4.4', 'direct public assignment selects the new interface address')
assert.equal(chooseBindAddress(['10.0.0.13', '10.0.0.14'], null, '10.0.0.14'), '10.0.0.14')
assert.throws(() => chooseBindAddress(['10.0.0.13', '10.0.0.14'], null, null), /IP_BIND_AMBIGUOUS/)
assert.throws(() => chooseBindAddress(['10.0.0.13'], null, '10.0.0.15'), /IP_BIND_NOT_LOCAL/)
assert.throws(() => chooseBindAddress(['127.0.0.1'], null, null), /IP_BIND_AMBIGUOUS/)
assert.equal(publicIpState(null).status, 'idle')
assert.equal(publicIpState({ observedIp: '10.0.0.1' }).observedIp, null)
assert.equal(publicIpState(null).retryAttempts, 0)
assert.equal(publicIpState({ retryAttempts: -1 }).retryAttempts, 0)
assert.equal(publicIpState({ retryAttempts: 1.5 }).retryAttempts, 0)
assert.equal(publicIpState({ retryAttempts: 1000001 }).retryAttempts, 1000000)
for (const code of ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET']) {
  assert.equal(publicIpFailureCode(new Error('wrapped', { cause: Object.assign(new Error('socket'), { code }) })), 'IP_MANAGEMENT_OFFLINE')
}
for (const code of ['INCUS_CERTIFICATE_MISMATCH', 'INCUS_FINGERPRINT_MISMATCH', 'IP_IDENTITY_MISMATCH']) {
  assert.equal(publicIpFailureCode(new Error('wrapped', { cause: Object.assign(new Error('identity'), { code }) })), 'IP_IDENTITY_MISMATCH')
  assert.equal(publicIpFailureCode(Object.assign(new Error('outer socket'), { code: 'ECONNRESET', cause: Object.assign(new Error('identity'), { code }) })), 'IP_IDENTITY_MISMATCH', 'identity failure wins over a wrapping socket error')
}
for (const code of ['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']) {
  assert.equal(publicIpFailureCode(Object.assign(new Error('outer socket'), { code: 'ECONNRESET', cause: Object.assign(new Error('certificate'), { code }) })), 'IP_CHECK_FAILED', 'certificate expiry/trust must not be misreported as a temporary network error or changed identity')
}
assert.equal(publicIpFailureCode(new Error('unknown implementation failure')), 'IP_CHECK_FAILED')
assert.equal(publicIpFailureCode(new Error('Incus request timeout (8000 ms)')), 'IP_MANAGEMENT_OFFLINE')
assert.equal(publicIpFailureCode(Object.assign(new Error('busy upstream'), { statusCode: 503 })), 'IP_MANAGEMENT_OFFLINE')
assert.equal(publicIpFailureCode(Object.assign(new Error('not authorized'), { statusCode: 401 })), 'IP_CHECK_FAILED')
const cyclic = Object.assign(new Error('unknown'), { cause: null as unknown }); cyclic.cause = cyclic
assert.equal(publicIpFailureCode(cyclic), 'IP_CHECK_FAILED')
assert.deepEqual([1, 2, 3, 4, 1000000].map(attempt => publicIpRetryPolicy('IP_SSH_UNREACHABLE', attempt).delayMs), [60000, 120000, 240000, 300000, 300000])
assert.equal(publicIpRetryPolicy('IP_SSH_UNREACHABLE', 1).status, 'pending')
assert.equal(publicIpRetryPolicy('IP_INSTANCE_STOPPED', 1000000).delayMs, 60000, 'starting a guest is observed on the regular cycle')
assert.equal(publicIpRetryPolicy('IP_ALREADY_ASSIGNED', 1).status, 'failed')
assert.equal(publicIpRetryPolicy('IP_IDENTITY_MISMATCH', 1000000).delayMs, 1800000)
const aborted = new AbortController(); aborted.abort()
await assert.rejects(verifyPublicSshIdentity('8.8.4.4', 22, ['SHA256:unused'], 8000, aborted.signal), /IP_SYNC_DEADLINE/)
// A controller/gateway with the IPv6 stack disabled must select authenticated
// guest verification. A real IPv4 reachability failure must keep its own error.
for (const code of ['ENETUNREACH', 'EAFNOSUPPORT', 'EADDRNOTAVAIL', 'ECONNREFUSED', 'ETIMEDOUT']) for (const synchronous of [false, true]) {
  const connection = mock.method(Client.prototype, 'connect', function (this: Client) {
    const error = Object.assign(new Error('isolated socket failure'), { code })
    if (synchronous) throw error
    this.emit('error', error)
    return this
  })
  try {
    await assert.rejects(verifyPublicSshIdentity('2603:c020:802a:cc00::1', 22, ['SHA256:unused']),
      ['ECONNREFUSED', 'ETIMEDOUT'].includes(code) ? /IP_SSH_UNREACHABLE/ : /IPV6_CONTROLLER_NO_ROUTE/)
    await assert.rejects(verifyPublicSshIdentity('8.8.4.4', 22, ['SHA256:unused']), /IP_SSH_UNREACHABLE/)
  } finally { connection.mock.restore() }
}
console.log('Host public IP input, local binding selection and endpoint validation passed')
// Actual socket read is aborted; the scan must not leave a 120s Incus read behind.
const sockets = new Set<import('node:net').Socket>()
const slow = createServer(() => {})
slow.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
await new Promise<void>(resolve => slow.listen(0, '127.0.0.1', resolve))
const transport = mock.method(IncusClient.prototype, 'createTransport', () => new Agent())
const incus = new IncusClient({ url: `http://127.0.0.1:${(slow.address() as import('node:net').AddressInfo).port}`, certPath: null, keyPath: null })
try {
  const started = Date.now()
  await assert.rejects(incus.connect(100), (error: unknown) => {
    assert.match(String(error), /无法连接到 Incus/)
    assert.equal(publicIpFailureCode(error), 'IP_MANAGEMENT_OFFLINE', 'real aborted HTTP reads enter the persisted retry path')
    return true
  })
  assert.ok(Date.now() - started < 2000, 'connect honors its scan deadline')
  assert.equal(incus.connected, false)
  console.log('PASS actual Incus socket deadline; aborted stalled HTTP response')
} finally {
  await incus.close(); transport.mock.restore()
  for (const socket of sockets) socket.destroy()
  await new Promise<void>(resolve => slow.close(() => resolve()))
}
