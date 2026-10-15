import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
process.env.JWT_SECRET ||= 'public-ip-integration-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { syncHostPublicIp } = await import('../src/services/host-public-ip-sync.js')
const { PublicIpSyncError } = await import('../src/lib/host-public-ip.js')
const { getPoolOrderResult } = await import('../src/services/pool-orders.js')
const { getHostById } = await import('../src/db/hosts.js')
const { getInstancesPaginated } = await import('../src/db/pagination.js')
const { dedicatedHostReadyWhere } = await import('../src/lib/host-resource-usage.js')
const { default: routes } = await import('../src/routes/host-inventory.js')

const prefix = `ip-test-${randomUUID().slice(0, 8)}`
const owner = await prisma.user.create({ data: { username: `${prefix}-admin`, passwordHash: 'unusable-test-hash', role: 'admin' } })
const buyer = await prisma.user.create({ data: { username: `${prefix}-buyer`, passwordHash: 'unusable-test-hash', balance: 123 } })
const batchId = randomUUID()
await prisma.hostOnboardingBatch.create({ data: { id: batchId, createdById: owner.id, name: prefix, accountLabel: 'test', defaults: {} } })
let sequence = 0
async function makeHost() {
  const seq = ++sequence
  return prisma.host.create({ data: {
    userId: owner.id, name: `${prefix}-${seq}`, url: `https://10.253.240.${seq + 1}:8443`, status: 'online', isInstalled: true,
    singleTenant: true, resourcePreset: 'E2', architecture: 'x86_64', cpuAllowanceMax: 200, memoryMax: 768, storageSize: 34, customerDiskGiB: 30,
    natPublicIp: `8.8.8.${seq}`, natBindIp: '10.0.0.13', natPortStart: 1, natPortEnd: 65535,
    serverCertificate: 'isolated-fake-certificate', serverFingerprint: 'isolated-fake-pin', managementSshHost: `10.253.240.${seq + 1}`,
    portProtocol: 'tcp', portProtocolApplied: 'tcp', portProtocolRevision: 1, portProtocolAppliedRevision: 1,
    storagePools: { create: { name: 'default', driver: 'dir', purpose: 'instance_data' } },
    agent: { create: { agentId: `${prefix}-${seq}`, secretHash: 'unused', secretEncrypted: 'unused', lastSeenAt: new Date(), capabilities: ['ingress-port-protocol-v1'] } },
    onboardingNode: { create: { batchId, name: `${prefix}-${seq}`, publicIp: `8.8.8.${seq}`, managementIp: `10.253.240.${seq + 1}`,
      sshPort: 2200, sshFingerprint: 'SHA256:host-fixture', status: 'succeeded', credentialsExpireAt: new Date(0) } }
  }, include: { onboardingNode: true } })
}
const app = Fastify()
app.decorate('authenticateAdmin', async (request: any, reply: any) => {
  if (request.headers['x-test-role'] !== 'admin') return reply.code(403).send({ code: 'FORBIDDEN' })
  request.user = { id: owner.id, username: owner.username, role: 'admin' }
})
await app.register(routes)
let failure: unknown
try {
  const host = await makeHost()
  let candidate = '8.8.4.4', bind = '10.0.0.13', handshake = Math.floor(Date.now() / 1000)
  let remoteInstances: Array<{ name: string; status: string; project: string }> = []
  let forwards: Array<{ listen_address: string; description: string; config: { target_address: string }; ports: unknown[] }> = []
  let identityError = false, connections = 0, extraAddresses: string[] = []
  const writes: string[] = []
  const verifications: Array<{ host: string; port: number; fingerprints: string[] }> = []
  const client: any = { request: async (method: string, path: string, body?: any, _timeout?: number, signal?: AbortSignal) => {
    assert.ok(signal, 'network requests have an actual abort signal')
    if (method === 'GET') {
      if (path === '/1.0/networks?recursion=1') return [{ name: 'eth0', type: 'physical', managed: false }, { name: 'incusbr0', type: 'bridge', managed: true }]
      if (path === '/1.0/networks/eth0/state') return { state: 'up', addresses: [bind, ...extraAddresses].map(address => ({ family: 'inet', scope: 'global', address })) }
      if (path === '/1.0/instances?recursion=1&all-projects=true') return structuredClone(remoteInstances)
      if (path === '/1.0/networks/incusbr0/forwards?recursion=1') return structuredClone(forwards)
    }
    if (path.startsWith('/1.0/networks/incusbr0/forwards')) {
      writes.push(`${method} ${path}`)
      if (method === 'POST') { forwards.push(structuredClone(body)); return {} }
      const address = decodeURIComponent(path.split('/').pop()!)
      if (method === 'PUT') { Object.assign(forwards.find(row => row.listen_address === address)!, body); return {} }
      if (method === 'DELETE') { forwards = forwards.filter(row => row.listen_address !== address); return {} }
    }
    throw new Error(`Unexpected network request: ${method} ${path}`)
  } }
  const deps = {
    peers: async () => [{ nodeId: host.onboardingNode!.id, managementIp: host.onboardingNode!.managementIp!, publicIp: candidate, lastHandshakeAt: handshake }],
    connect: async () => { connections++; return client },
    fingerprints: async () => ['SHA256:customer-fixture'],
    verify: async (address: string, port: number, fingerprints: string[]) => {
      verifications.push({ host: address, port, fingerprints })
      if (identityError) throw new PublicIpSyncError('IP_IDENTITY_MISMATCH')
    }
  }
  for (const [method, path, payload] of [
    ['GET', `/inventory/${host.id}/public-ip`, undefined],
    ['POST', `/inventory/${host.id}/public-ip/sync`, {}]
  ] as const) {
    const response = await app.inject({ method, url: path, headers: { 'x-test-role': 'user' }, payload })
    assert.equal(response.statusCode, 403, 'ordinary customers cannot inspect management or change public addresses')
  }
  const invalid = await app.inject({ method: 'POST', url: `/inventory/${host.id}/public-ip/sync`, headers: { 'x-test-role': 'admin' },
    payload: { settings: { mode: 'manual', publicIp: '169.254.169.254' } } })
  assert.equal(invalid.json().code, 'IP_SETTINGS_INVALID', 'manual input cannot probe link-local or private services')

  const emptyResult = await syncHostPublicIp(host.id, {}, deps)
  assert.equal(emptyResult.status, 'synced')
  assert.equal(emptyResult.currentIp, candidate)
  assert.equal(emptyResult.blocked, false)
  assert.deepEqual(verifications[0], { host: candidate, port: 2200, fingerprints: ['SHA256:host-fixture'] }, 'empty hosts verify their pinned management SSH identity')
  assert.equal(writes.length, 0, 'empty host reconciliation must not create a customer or forwarding')
  const initial = await prisma.host.findUniqueOrThrow({ where: { id: host.id }, include: { onboardingNode: true } })
  assert.equal(initial.url, host.url)
  assert.equal(initial.managementSshHost, host.managementSshHost)
  assert.equal(initial.onboardingNode!.publicIp, host.onboardingNode!.publicIp, 'the original onboarding address remains historical evidence')

  const orderId = randomUUID()
  await prisma.poolOrder.create({ data: { id: orderId, userId: buyer.id, requestHash: 'test-only', totalCents: 100 } })
  const instance = await prisma.instance.create({ data: { userId: buyer.id, hostId: host.id, incusId: `${prefix}-customer`, name: 'customer-kept', status: 'running',
    image: 'images:alpine/3.21', cpu: 200, memory: 768, disk: 30720, ipv4: '10.10.1.2', dedicatedIpv4: true, dedicatedNetworkReady: true,
    billingPrice: 1, expiresAt: new Date('2030-01-01T00:00:00Z'), purchaseBatchId: orderId, autoRenew: false } })
  remoteInstances = [{ name: instance.incusId, status: 'Running', project: 'default' }]
  const ownerDescription = `payincus-dedicated:${instance.incusId}`
  forwards = [{ listen_address: bind, description: ownerDescription, config: { target_address: instance.ipv4! }, ports: [] },
    { listen_address: '10.0.0.99', description: 'unrelated-rule', config: { target_address: '10.10.1.99' }, ports: [] }]
  candidate = '1.1.1.1'; bind = '10.0.0.85'; identityError = true
  const failed = await syncHostPublicIp(host.id, {}, deps)
  assert.equal(failed.error, 'IP_IDENTITY_MISMATCH')
  assert.equal(failed.blocked, true)
  assert.equal(failed.currentIp, emptyResult.currentIp, 'unverified new public addresses are never committed')
  assert.equal(failed.currentBindIp, '10.0.0.13')
  assert.ok(forwards.some(row => row.listen_address === '10.0.0.13'), 'the previous owned binding stays until verification succeeds')
  assert.equal((await getHostById(host.id))!.public_ip_sync_blocked, true, 'detail mapper preserves the pending-address flag')
  const listed = await getInstancesPaginated({ userId: buyer.id })
  assert.equal((listed.items[0] as any).public_ip_sync_blocked, true, 'list mapper preserves the pending-address flag')
  assert.equal((await getPoolOrderResult(buyer.id, orderId))!.instances[0]!.host, null, 'completed order pages hide a stale address too')
  identityError = false
  const retried = await syncHostPublicIp(host.id, {}, deps)
  assert.equal(retried.status, 'synced')
  assert.equal(retried.blocked, false)
  assert.equal(retried.currentIp, candidate)
  assert.equal(retried.currentBindIp, bind)
  assert.equal(writes.filter(row => row.startsWith('POST')).length, 1, 'lost verification can retry without duplicate forward creation')
  assert.deepEqual(forwards.map(row => row.listen_address).sort(), ['10.0.0.85', '10.0.0.99'])
  assert.equal((await getPoolOrderResult(buyer.id, orderId))!.instances[0]!.host, candidate)
  assert.deepEqual(await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } }), instance, 'IP changes do not rewrite the instance, credentials, price or expiry')
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), 123)

  const beforeStale = connections
  handshake -= 500
  assert.equal((await syncHostPublicIp(host.id, { force: true }, deps)).error, 'IP_MANAGEMENT_OFFLINE')
  assert.equal(connections, beforeStale, 'stale WireGuard endpoints cannot trigger remote mutations')
  handshake = Math.floor(Date.now() / 1000)
  const manual = await syncHostPublicIp(host.id, { settings: { mode: 'manual', publicIp: '9.9.9.9', sshPort: 2222 } }, deps)
  assert.equal(manual.currentIp, '9.9.9.9')
  assert.equal(verifications.at(-1)!.port, 2222, 'changed customer SSH ports are supported without storing their password')
  candidate = '1.0.0.1'
  assert.equal((await syncHostPublicIp(host.id, {}, deps)).currentIp, '9.9.9.9', 'manual ingress remains stable when egress is different')

  await prisma.instance.update({ where: { id: instance.id }, data: { status: 'stopped' } })
  remoteInstances[0]!.status = 'Stopped'
  const stopped = await syncHostPublicIp(host.id, { settings: { mode: 'auto' } }, deps)
  assert.equal(stopped.error, 'IP_INSTANCE_STOPPED')
  assert.equal(stopped.blocked, true)
  await prisma.instance.update({ where: { id: instance.id }, data: { status: 'running' } })
  remoteInstances[0]!.status = 'Running'
  assert.equal((await syncHostPublicIp(host.id, {}, deps)).currentIp, candidate, 'starting later resumes a persisted pending address')

  const busyTask = await prisma.instanceTask.create({ data: { instanceId: instance.id, userId: buyer.id, hostId: host.id, taskType: 'restart', status: 'PENDING' } })
  candidate = '1.0.0.2'
  const beforeBusy = writes.length
  assert.equal((await syncHostPublicIp(host.id, {}, deps)).error, 'IP_INSTANCE_BUSY')
  assert.equal(writes.length, beforeBusy, 'in-flight instance operations are not disturbed')
  await prisma.instanceTask.update({ where: { id: busyTask.id }, data: { status: 'COMPLETED' } })
  assert.equal((await syncHostPublicIp(host.id, {}, deps)).status, 'synced')

  const other = await makeHost()
  candidate = other.natPublicIp!
  assert.equal((await syncHostPublicIp(host.id, {}, deps)).error, 'IP_ALREADY_ASSIGNED')
  candidate = '1.0.0.3'; bind = '10.0.0.86'; extraAddresses = ['10.0.0.87']
  assert.equal((await syncHostPublicIp(host.id, {}, deps)).error, 'IP_BIND_AMBIGUOUS')
  extraAddresses = []
  forwards.push({ listen_address: bind, description: 'other-owner', config: { target_address: '10.10.1.99' }, ports: [] })
  assert.equal((await syncHostPublicIp(host.id, {}, deps)).status, 'failed')
  assert.equal(forwards.find(row => row.listen_address === bind)!.description, 'other-owner', 'owned-address conflicts are never overwritten')
  forwards = forwards.filter(row => row.listen_address !== bind)

  let entered!: () => void, release!: () => void
  const reached = new Promise<void>(resolve => { entered = resolve })
  const barrier = new Promise<void>(resolve => { release = resolve })
  const gated = { ...deps, verify: async (...args: Parameters<typeof deps.verify>) => { await deps.verify(...args); entered(); await barrier } }
  const first = syncHostPublicIp(host.id, {}, gated)
  await reached
  assert.equal(syncHostPublicIp(host.id, {}, gated), first, 'duplicate requests join the same reconciliation')
  await assert.rejects(syncHostPublicIp(host.id, { settings: { mode: 'auto' } }, gated), /IP_SYNC_BUSY/)
  release()
  assert.equal((await first).status, 'synced')
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).ipAddress, candidate, 'node address follows the verified public IP')

  await prisma.host.update({ where: { id: other.id }, data: { publicIpSyncBlocked: true } })
  assert.equal(await prisma.host.count({ where: { ...dedicatedHostReadyWhere(), id: other.id } }), 0, 'pending-address hosts are excluded from inventory allocation')
  await assert.rejects(prisma.instance.create({ data: { userId: buyer.id, hostId: other.id, name: 'blocked-allocation', incusId: `${prefix}-blocked`,
    image: 'images:alpine/3.21', status: 'creating', cpu: 200, memory: 768, disk: 30720 } }), /HOST_PUBLIC_IP_PENDING/, 'DB guard rejects stale-catalog allocations')
  await assert.rejects(prisma.instanceTask.create({ data: { instanceId: instance.id, userId: buyer.id, hostId: other.id, targetHostId: other.id, taskType: 'replace_host' } }), /HOST_PUBLIC_IP_PENDING/, 'replacement cannot reserve a host with an unverified IP')
  console.log('Host IP integration: authorization, real DB allocation guards, discovery, public+private changes, identity failure, retry, ownership, offline/busy states, custom ports, concurrency and billing preservation passed')
} catch (error) { failure = error }
finally {
  await app.close()
  await prisma.instance.deleteMany({ where: { userId: buyer.id } })
  await prisma.host.deleteMany({ where: { userId: owner.id } })
  await prisma.hostOnboardingBatch.delete({ where: { id: batchId } })
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, buyer.id] } } })
  await closePrismaDatabase()
}
if (failure) console.error(failure)
process.exit(failure ? 1 : 0)
