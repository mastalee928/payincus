import assert from 'node:assert/strict'
import { ensureDedicatedForward, removeDedicatedForward, removeObsoleteDedicatedForwards } from '../src/lib/incus/dedicated-network.js'
import { applyCustomerInstanceView, publicInstanceIpv6 } from '../src/lib/customer-instance-view.js'
import { readFileSync } from 'node:fs'
import { generateIncusConfig } from '../src/lib/incus-config-generator.js'
import { createHash } from 'node:crypto'
import ssh2 from 'ssh2'
import { checkSshLogin, DedicatedSshVerificationError } from '../src/lib/dedicated-ssh.js'

const forwards: Array<any> = []
const calls: string[] = []
const client = { request: async (method: string, path: string, body?: any) => {
  calls.push(`${method} ${path}`)
  if (method === 'GET') return forwards
  if (method === 'POST') forwards.push(body)
  if (method === 'DELETE') forwards.splice(forwards.findIndex(row => path.endsWith(row.listen_address)), 1)
} } as any
await ensureDedicatedForward(client, 'u1-test', '10.0.0.13', '10.10.1.2')
await ensureDedicatedForward(client, 'u1-test', '10.0.0.13', '10.10.1.2')
assert.equal(calls.filter(call => call.startsWith('POST')).length, 1, 'retries reuse their owned full-address forward')
assert.deepEqual(forwards[0].ports, [], 'all ports use one address forward')
await assert.rejects(ensureDedicatedForward(client, 'u2-other', '10.0.0.13', '10.10.1.3'), /already assigned/)
await assert.rejects(ensureDedicatedForward(client, 'u1-test', '::1', '10.10.1.2'), /Invalid/)
await removeDedicatedForward(client, 'u2-other')
assert.equal(forwards.length, 1, 'another instance cannot remove this address')
await removeDedicatedForward(client, 'u1-test')
assert.equal(forwards.length, 0)
await ensureDedicatedForward(client, 'u1-test', '10.0.0.13', '10.10.1.2')
await ensureDedicatedForward(client, 'u1-test', '10.0.0.14', '10.10.1.2')
await ensureDedicatedForward(client, 'another-system', '10.0.0.15', '10.10.1.3')
await removeObsoleteDedicatedForwards(client, 'u1-test', '10.0.0.14', '10.10.1.2')
assert.deepEqual(forwards.map(row => row.listen_address), ['10.0.0.14', '10.0.0.15'], 'address changes keep the new binding and other owners intact')
const legacyClient = { request: async (_method: string, path: string) => {
  if (path === '/1.0/networks') return ['/1.0/networks/other-bridge']
  throw new Error('Network not found')
} } as any
await removeDedicatedForward(legacyClient, 'legacy-instance')
const brokenForwardClient = { request: async (_method: string, path: string) => {
  if (path === '/1.0/networks') return ['/1.0/networks/incusbr0']
  throw new Error('Forward cleanup unavailable')
} } as any
await assert.rejects(removeDedicatedForward(brokenForwardClient, 'u1-test'), /unavailable/)
const data: Record<string, any> = { host: { name: 'internal-host-secret', ip_address: '10.253.240.2' },
  ipv4: '10.10.1.2', ipv6: 'fd00::2', nat_public_ip: '192.0.2.1', hostIpAddress: '10.253.240.2',
  monthlyTrafficLimit: '1152921504606846976', limitsIngress: '300Mbit', port_mappings: [{ public_port: 29048 }] }
applyCustomerInstanceView(data, { dedicated_ipv4: true, dedicated_network_ready: true }, false)
assert.equal(data.host.name, '')
assert.equal(data.hostIpAddress, undefined)
assert.equal(data.ipv4, '192.0.2.1')
assert.equal(data.ipv6, null)
assert.equal(data.ssh_port, 22)
assert.equal(data.monthlyTrafficLimit, null)
assert.deepEqual(data.port_mappings, [])
applyCustomerInstanceView(data, { dedicated_ipv4: true, dedicated_network_ready: false }, false)
assert.equal(data.ipv4, null, 'pending setup must not advertise a working SSH address')
assert.equal(data.ssh_port, null)
const updating: Record<string, any> = { host: { nat_public_ip: '192.0.2.1' }, natPublicIp: '192.0.2.1', ipv4: '192.0.2.1' }
applyCustomerInstanceView(updating, { dedicated_ipv4: true, dedicated_network_ready: true, public_ip_sync_blocked: true }, false)
assert.equal(updating.publicIpUpdating, true)
assert.equal(updating.dedicatedNetworkReady, false)
assert.equal(updating.host.nat_public_ip, null)
assert.equal(updating.ipv4, null, 'a detected address change must hide stale customer endpoints until verification')
assert.equal(publicInstanceIpv6('2a01:4f8::2'), '2a01:4f8::2')
assert.equal(publicInstanceIpv6('fe80::1'), null)
const admin: Record<string, any> = { host: { name: 'internal-host-secret' } }
applyCustomerInstanceView(admin, { dedicated_ipv4: true }, true)
assert.equal(admin.host.name, 'internal-host-secret', 'administrators retain the host name')
const fault: Record<string, any> = { status: 'running', host: { name: 'internal-host-secret' }, natPublicIp: '192.0.2.1' }
applyCustomerInstanceView(fault, { dedicated_ipv4: true, dedicated_network_ready: true, service_fault: true }, false)
assert.equal(fault.status, 'running', 'connection failure must not rewrite persisted instance lifecycle or billing state')
assert.equal(fault.serviceFault, true, 'customer list and detail must receive an explicit fault presentation flag')
assert.equal(fault.host.name, '', 'fault responses must not expose infrastructure names')
applyCustomerInstanceView(fault, { dedicated_ipv4: true, dedicated_network_ready: true, service_fault: false }, false)
assert.equal(fault.serviceFault, false, 'a fresh healthy connection must clear the presentation fault')
for (const file of ['InstancesView.vue', 'InstanceDetailView.vue']) {
  const page = readFileSync(new URL(`../../client/src/views/${file}`, import.meta.url), 'utf8')
  assert.ok(page.includes("getStatusInfo(instance.serviceFault ? 'fault' : instance.status, t)"), 'customer list and detail must render fault instead of stale running')
}
const formatters = readFileSync(new URL('../../client/src/utils/formatters.ts', import.meta.url), 'utf8')
assert.ok(formatters.includes("fault: { labelKey: 'instance.status.fault', class: 'badge-error'"), 'fault has a customer-facing translation and failure color')
for (const type of ['container', 'virtual-machine'] as const) {
  const password = 'local-guard-password-123'
  const result = generateIncusConfig({ instanceName: 'rebuild-guard', imageAlias: 'images:debian/12', rootPassword: password, type, networkMode: 'nat' })
  const config = JSON.stringify(result.configPayload)
  assert.ok(config.includes(password) && config.includes('PasswordAuthentication yes') && !config.includes('ssh_authorized_keys:'), 'password-only rebuild configuration must enable root login without a key')
  const withKey = generateIncusConfig({ instanceName: 'rebuild-guard', imageAlias: 'images:debian/12', rootPassword: password, sshKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestOnly guard', type, networkMode: 'nat' })
  assert.ok(JSON.stringify(withKey.configPayload).includes('ssh_authorized_keys:'), 'an explicitly chosen key must be included')
}
const rebuildModal = readFileSync(new URL('../../client/src/components/instance/modals/RebuildModal.vue', import.meta.url), 'utf8')
assert.ok(rebuildModal.includes('sshKeyId: selectedSshKeyId.value ?? undefined') && rebuildModal.includes('rebuildModal.passwordOnly') && !rebuildModal.includes('selectedSshKeyId.value = keys[0].id') && !rebuildModal.includes('loading || !selectedImage || !selectedSshKeyId'), 'rebuild UI must default to password login without requiring saved keys')
const worker = readFileSync(new URL('../src/workers/instanceTaskWorker.ts', import.meta.url), 'utf8')
const rebuild = worker.slice(worker.indexOf('async function executeRebuildTask('), worker.indexOf('async function executeRecreateTask('))
assert.ok(!rebuild.includes('getSSHKeysByUserId') && rebuild.includes('SSH_KEY_NOT_OWNED') && rebuild.indexOf('SSH_KEY_NOT_OWNED') < rebuild.indexOf('deleting_snapshots'), 'rebuild must validate only the selected key before destructive steps and never silently inject another key')
console.log('Dedicated address ownership, idempotency and customer privacy checks passed')
const osPasswordMatrix = [
  ['alpine/3.21/cloud', 'sshd', 'apk'], ['alpine/3.23/cloud', 'sshd', 'apk'],
  ['alpine/3.24/cloud', 'sshd', 'apk'], ['alpine/3.24/tinycloud', 'sshd', 'apk'],
  ['debian/10/cloud', 'ssh', 'apt-get'], ['debian/11/cloud', 'ssh', 'apt-get'],
  ['debian/12/cloud', 'ssh', 'apt-get'], ['debian/13/cloud', 'ssh', 'apt-get'],
  ['ubuntu/20.04/cloud', 'ssh', 'apt-get'], ['ubuntu/22.04/cloud', 'ssh', 'apt-get'], ['ubuntu/24.04/cloud', 'ssh', 'apt-get'],
  ['rockylinux/8/cloud', 'sshd', 'yum'], ['rockylinux/9/cloud', 'sshd', 'dnf'],
  ['almalinux/8/cloud', 'sshd', 'yum'], ['almalinux/9/cloud', 'sshd', 'dnf'],
  ['centos/7/cloud', 'sshd', 'yum'], ['centos/8-Stream/cloud', 'sshd', 'yum'], ['centos/9-Stream/cloud', 'sshd', 'dnf']
] as const
const optionalSshKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestOnly guard'
for (const [alias, service, packageManager] of osPasswordMatrix) {
  for (const type of ['container', 'virtual-machine'] as const) {
    for (const sshKey of [undefined, optionalSshKey]) {
      const imageAlias = `images:${alias}`
      const generated = generateIncusConfig({ instanceName: 'password-policy-guard', imageAlias,
        rootPassword: 'local-password-policy-guard', type, networkMode: 'nat', sshKey })
      const cloudConfig = generated.configPayload['user.user-data']
      const label = `${imageAlias}/${type}/${sshKey ? 'key-and-password' : 'password-only'}`
      assert.match(cloudConfig, /^ssh_pwauth: true$/m, `${label}: cloud-init must enable the advertised password`)
      assert.ok(cloudConfig.includes('PermitRootLogin yes') && cloudConfig.includes('PasswordAuthentication yes'), label)
      assert.equal(cloudConfig.includes('ssh_authorized_keys:'), Boolean(sshKey), `${label}: never invent a customer key`)
      assert.ok(cloudConfig.includes(type === 'container' ? '/etc/ssh/sshd_config.d/00-incus.conf' : '/etc/ssh/sshd_config.d/00-incudal-force.conf'),
        `${label}: platform policy loads before cloud defaults`)
      assert.ok(cloudConfig.includes('-T -f /dev/stdin'), `${label}: detect server-side Include through a real config, not unsupported command-line Include`)
      assert.ok(!cloudConfig.includes('-o "Include /dev/null"'), `${label}: Include is not a valid sshd command-line option`)
      assert.ok(cloudConfig.includes(packageManager === 'apk' ? 'apk add' : `${packageManager} install`), `${label}: correct package manager`)
      if (type === 'virtual-machine' && ['yum', 'dnf'].includes(packageManager)) {
        assert.ok(cloudConfig.includes('openssh-clients'), `${label}: IPv4-only controller IPv6 probes need ssh and ssh-keyscan in the guest`)
      }
      if (type === 'virtual-machine' && packageManager === 'apk') {
        assert.ok(cloudConfig.includes('qemu-guest-agent openssh curl'), `${label}: Alpine must install both server and client tooling`)
      }
      assert.ok(cloudConfig.includes(packageManager === 'apk' ? 'rc-service sshd restart' : `systemctl restart ${service}`),
        `${label}: restart the distribution's SSH service`)
    }
  }
}
console.log(`Customer password policy passed: ${osPasswordMatrix.length} OS/version aliases × container/VM × password-only/key-and-password`)

// Exercise real SSH negotiation/authentication so failures remain actionable
// without accepting another host key or exposing a password in the error.
const testKey = ssh2.utils.generateKeyPairSync('ed25519')
const parsedKey = ssh2.utils.parseKey(testKey.private)
assert.ok(!(parsedKey instanceof Error))
const fingerprint = `SHA256:${createHash('sha256').update(parsedKey.getPublicSSH()).digest('base64').replace(/=+$/, '')}`
const testPassword = 'local-ssh-login-guard-password'
let authenticatedAttempts = 0, reportedUid = '0', reportedExitCode = 0
const sshServer = new ssh2.Server({ hostKeys: [testKey.private] }, connection => {
  connection.on('error', () => {}) // A rejected host key deliberately closes negotiation.
  connection.on('authentication', context => {
    authenticatedAttempts++
    if (context.method === 'password' && context.username === 'root' && context.password === testPassword) context.accept()
    else context.reject(['password'])
  })
  connection.on('ready', () => connection.on('session', accept => {
    const session = accept()
    session.on('exec', (acceptExec, rejectExec, info) => {
      if (info.command !== 'id -u') { rejectExec(); return }
      const channel = acceptExec()
      channel.write(`${reportedUid}\n`)
      channel.exit(reportedExitCode)
      channel.end()
    })
  }))
})
await new Promise<void>(resolve => sshServer.listen(0, '127.0.0.1', resolve))
const address = sshServer.address()
assert.ok(address && typeof address === 'object')
const testPort = address.port
try {
  await checkSshLogin('127.0.0.1', testPassword, fingerprint, testPort)
  await checkSshLogin('127.0.0.1', testPassword, ['SHA256:other-registered-key', fingerprint], testPort)
  await assert.rejects(checkSshLogin('127.0.0.1', 'wrong-password', fingerprint, testPort),
    error => error instanceof DedicatedSshVerificationError && error.reason === 'authentication' && !error.message.includes(testPassword))
  const attemptsBeforeWrongIdentity = authenticatedAttempts
  await assert.rejects(checkSshLogin('127.0.0.1', testPassword, 'SHA256:untrusted', testPort),
    error => error instanceof DedicatedSshVerificationError && error.reason === 'identity')
  assert.equal(authenticatedAttempts, attemptsBeforeWrongIdentity, 'a wrong public identity must fail before sending the customer password')
  reportedUid = '1000'
  await assert.rejects(checkSshLogin('127.0.0.1', testPassword, fingerprint, testPort),
    error => error instanceof DedicatedSshVerificationError && error.reason === 'root')
  reportedUid = '0'; reportedExitCode = 1
  await assert.rejects(checkSshLogin('127.0.0.1', testPassword, fingerprint, testPort),
    error => error instanceof DedicatedSshVerificationError && error.reason === 'command')
} finally {
  await new Promise<void>((resolve, reject) => sshServer.close(error => error ? reject(error) : resolve()))
}
await assert.rejects(checkSshLogin('127.0.0.1', testPassword, fingerprint, testPort),
  error => error instanceof DedicatedSshVerificationError && error.reason === 'unreachable')
console.log('Real SSH checks passed: correct root login, rejected password, identity pinning, non-root login, command failure and unreachable endpoint')

for (const keyType of ['ecdsa', 'rsa'] as const) {
  const pair = keyType === 'ecdsa' ? ssh2.utils.generateKeyPairSync('ecdsa', { bits: 256 }) : ssh2.utils.generateKeyPairSync('rsa', { bits: 2048 })
  const parsed = ssh2.utils.parseKey(pair.private)
  assert.ok(!(parsed instanceof Error))
  const keyFingerprint = `SHA256:${createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '')}`
  const compatibleServer = new ssh2.Server({ hostKeys: [pair.private] }, connection => {
    connection.on('error', () => {})
    connection.on('authentication', context => {
      if (context.method === 'password' && context.username === 'root' && context.password === testPassword) context.accept()
      else context.reject(['password'])
    })
    connection.on('ready', () => connection.on('session', accept => {
      accept().on('exec', acceptExec => { const channel = acceptExec(); channel.write('0\n'); channel.exit(0); channel.end() })
    }))
  })
  await new Promise<void>(resolve => compatibleServer.listen(0, '127.0.0.1', resolve))
  const endpoint = compatibleServer.address()
  assert.ok(endpoint && typeof endpoint === 'object')
  try { await checkSshLogin('127.0.0.1', testPassword, [fingerprint, keyFingerprint], endpoint.port) }
  finally { await new Promise<void>((resolve, reject) => compatibleServer.close(error => error ? reject(error) : resolve())) }
}
console.log('Legacy image SSH negotiation passed: ECDSA and RSA require their Incus-registered key')
