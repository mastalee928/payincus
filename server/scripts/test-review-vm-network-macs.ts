import assert from 'node:assert/strict'
import type { IncusClient } from '../src/lib/incus/incus-client.js'
import { generateCloudInitNetworkConfig, syncInstanceNetwork, removeInstanceIpv6 } from '../src/lib/network-payload-builder.js'

const primaryMac = '00:16:3e:11:22:33', secondaryMac = '00:16:3e:44:55:66'
const direct = generateCloudInitNetworkConfig({ ipv4Address: '10.10.1.23', ipv6List: ['2001:db8::23'], nicMacs: { eth0: primaryMac, eth1: secondaryMac } })
assert.match(direct, /match:\s*\n\s*macaddress: "00:16:3e:11:22:33"/, 'VM network config must actually consume the supplied primary MAC')
assert.match(direct, /match:\s*\n\s*macaddress: "00:16:3e:44:55:66"/, 'VM network config must actually consume the supplied IPv6 NIC MAC')

type Device = Record<string, string>
type State = { type: string; config: Record<string, string>; devices: Record<string, Device>; expanded_devices?: Record<string, Device>; profiles: string[]; description: string }
const base: State = { type: 'virtual-machine', config: { 'user.fixture': 'keep', 'volatile.uuid': 'original-identity' },
  devices: { eth0: { type: 'nic', nictype: 'bridged', parent: 'incusbr0', hwaddr: primaryMac, 'ipv4.address': '10.10.1.23' },
    eth1: { type: 'nic', nictype: 'routed', parent: 'ens3', hwaddr: secondaryMac, 'ipv6.address': '2001:db8::23', 'ipv6.routes': '2001:db8:1::/64' },
    root: { type: 'disk', path: '/', pool: 'original-pool' }, proxy: { type: 'proxy', listen: 'tcp:127.0.0.1:10022', connect: 'tcp:127.0.0.1:22' } },
  profiles: ['original-profile'], description: 'keep original description' }
let state: State = structuredClone(base), calls: string[] = [], writeFailure = false
const fixtureRequest = async (method: string, path: string, body?: any) => {
  calls.push(`${method} ${path}`)
  assert.ok(path === '/1.0/instances/mac-fixture' || path === '/1.0/instances/mac-fixture/state')
  if (method === 'GET') return structuredClone(state)
  if (path.endsWith('/state')) { assert.equal(body.action, 'restart'); return {} }
  assert.equal(method, 'PUT')
  if (writeFailure) throw new Error('fixture-network-put-failure')
  assert.deepEqual(body.profiles, base.profiles); assert.equal(body.description, base.description)
  assert.deepEqual(body.devices.root, base.devices.root); assert.deepEqual(body.devices.proxy, base.devices.proxy)
  assert.equal(body.config['volatile.uuid'], base.config['volatile.uuid']); assert.equal(body.config['user.fixture'], 'keep')
  state = { ...state, ...structuredClone(body) }; return {}
}
let client = { request: fixtureRequest } as unknown as IncusClient
let closeTransport: (() => Promise<void>) | undefined
if (process.argv.includes('--mtls')) {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join, resolve, sep } = await import('node:path')
  const { execFileSync } = await import('node:child_process')
  const { X509Certificate } = await import('node:crypto')
  const { createServer } = await import('node:https')
  const { IncusClient: RealClient } = await import('../src/lib/incus/incus-client.js')
  const folder = await mkdtemp(join(tmpdir(), 'payincus-vm-macs-'))
  const keyPath = join(folder, 'key.pem'), certPath = join(folder, 'cert.pem')
  execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=vm-macs-fixture', '-keyout', keyPath, '-out', certPath], { stdio: 'pipe', windowsHide: true })
  const certificate = await readFile(certPath, 'utf8')
  const remote = createServer({ key: await readFile(keyPath), cert: certificate, ca: certificate, requestCert: true, rejectUnauthorized: true }, async (request, response) => {
    response.setHeader('content-type', 'application/json')
    try {
      assert.ok((request.socket as import('node:tls').TLSSocket).authorized)
      if (request.url === '/1.0') { response.end(JSON.stringify({ type: 'sync', metadata: { api_version: '1.0' } })); return }
      let body = ''; for await (const chunk of request) body += chunk
      const metadata = await fixtureRequest(request.method!, request.url!, body ? JSON.parse(body) : undefined)
      response.end(JSON.stringify({ type: 'sync', metadata }))
    } catch (error) {
      response.statusCode = 500
      response.end(JSON.stringify({ type: 'error', error: error instanceof Error ? error.message : 'fixture failure' }))
    }
  })
  await new Promise<void>(done => remote.listen(0, '127.0.0.1', done))
  client = new RealClient({ url: `https://127.0.0.1:${(remote.address() as { port: number }).port}`, certPath, keyPath,
    serverCertificate: certificate, serverFingerprint: new X509Certificate(certificate).fingerprint256 })
  closeTransport = async () => {
    await client.agent?.close()
    await new Promise<void>(done => remote.close(() => done()))
    assert.ok(resolve(folder).startsWith(resolve(tmpdir()) + sep), 'only remove this test temporary directory')
    await rm(folder, { recursive: true, force: true })
  }
  await client.connect()
}
try {
function reset() { state = structuredClone(base); calls = []; writeFailure = false }
function matchedMacs() { return [...state.config['user.network-config'].matchAll(/macaddress: "([0-9a-f:]+)"/g)].map(match => match[1]) }
const ipv6 = { primaryIp: '2001:db8::45', extraIps: ['2001:db8::46'] }
for (const origin of ['explicit', 'volatile', 'expanded', 'inherited-primary', 'new-secondary'] as const) {
  reset()
  if (origin === 'volatile') {
    delete state.devices.eth0.hwaddr; delete state.devices.eth1.hwaddr
    state.config['volatile.eth0.hwaddr'] = primaryMac; state.config['volatile.eth1.hwaddr'] = secondaryMac
  }
  if (origin === 'expanded') {
    state.expanded_devices = structuredClone(state.devices)
    delete state.devices.eth0.hwaddr; delete state.devices.eth1.hwaddr
  }
  if (origin === 'inherited-primary') {
    state.expanded_devices = structuredClone(state.devices)
    delete state.devices.eth0
  }
  if (origin === 'new-secondary') delete state.devices.eth1
  const original = structuredClone(state)
  await syncInstanceNetwork(client, 'mac-fixture', ipv6, 'ens3', true)
  assert.deepEqual(matchedMacs(), [primaryMac, origin === 'new-secondary' ? state.devices.eth1.hwaddr : secondaryMac], origin)
  assert.deepEqual(state.devices.eth0, original.devices.eth0)
  assert.equal(state.devices.eth1['ipv6.address'], '2001:db8::45,2001:db8::46')
  assert.equal(state.devices.eth1['ipv6.routes'], undefined)
  assert.match(state.config['user.network-config'], /10\.10\.1\.23\/22/)
  assert.match(state.config['user.network-config'], /2001:db8::46\/128/)
  assert.deepEqual(calls, ['GET /1.0/instances/mac-fixture', 'PUT /1.0/instances/mac-fixture', 'PUT /1.0/instances/mac-fixture/state'])
  calls = []
  await removeInstanceIpv6(client, 'mac-fixture', false)
  assert.deepEqual(matchedMacs(), [primaryMac]); assert.equal(state.devices.eth1, undefined)
  assert.ok(!state.config['user.network-config'].includes('2001:db8'))
  assert.deepEqual(state.devices.eth0, original.devices.eth0)
  assert.deepEqual(calls, ['GET /1.0/instances/mac-fixture', 'PUT /1.0/instances/mac-fixture'])
}
for (const operation of ['sync', 'remove'] as const) {
  reset(); delete state.devices.eth0.hwaddr
  const original = structuredClone(state)
  await assert.rejects(operation === 'sync' ? syncInstanceNetwork(client, 'mac-fixture', ipv6, 'ens3') : removeInstanceIpv6(client, 'mac-fixture'), /MAC/i)
  assert.deepEqual(state, original); assert.deepEqual(calls, ['GET /1.0/instances/mac-fixture'])
}
reset(); delete state.devices.eth1.hwaddr
await assert.rejects(syncInstanceNetwork(client, 'mac-fixture', ipv6, 'ens3'), /MAC/i)
assert.deepEqual(calls, ['GET /1.0/instances/mac-fixture'])
reset(); state.expanded_devices = structuredClone(state.devices); delete state.devices.eth1
await syncInstanceNetwork(client, 'mac-fixture', ipv6, 'ens3', false)
assert.deepEqual(matchedMacs(), [primaryMac, secondaryMac], 'inherited IPv6 device keeps its actual MAC when materialized')
assert.equal(state.devices.eth1.hwaddr, secondaryMac)
reset(); writeFailure = true
await assert.rejects(syncInstanceNetwork(client, 'mac-fixture', ipv6, 'ens3'), /fixture-network-put-failure/)
assert.deepEqual(state, base); assert.ok(!calls.some(call => call.endsWith('/state')))
reset(); state.type = 'container'; delete state.devices.eth0.hwaddr; delete state.devices.eth1.hwaddr
await syncInstanceNetwork(client, 'mac-fixture', ipv6, 'ens3', false)
assert.match(state.config['user.network-config'], /\n  eth0:\n/); assert.match(state.config['user.network-config'], /\n  eth1:\n/)
assert.deepEqual(matchedMacs(), [], 'unidentified container NICs retain the original named-interface configuration')
for (const mac of ['invalid', '00:16:3e:11:22:33\n    dhcp4: true', '00:16:3e:11:22:333']) {
  assert.throws(() => generateCloudInitNetworkConfig({ ipv4Address: '10.10.1.23', nicMacs: { eth0: mac } }), /MAC/i)
}
console.log('PASS supplied VM MACs bind real existing/volatile/profile NICs, new IPv6 NIC matches its assigned MAC, remove retains primary identity, missing identity and PUT failure never restart; containers remain compatible')
} finally { await closeTransport?.() }
