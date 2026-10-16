import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
process.env.JWT_SECRET ||= 'ipv6-integration-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { syncHostPublicIpv6 } = await import('../src/services/host-public-ipv6-sync.js')
const { customerIpv6View } = await import('../src/lib/host-public-ipv6.js')
const { getPoolOrderResult } = await import('../src/services/pool-orders.js')
const { getHostById } = await import('../src/db/hosts.js')
const { getInstanceById } = await import('../src/db/instances.js')
const { getInstancesPaginated } = await import('../src/db/pagination.js')
const { default: routes } = await import('../src/routes/host-inventory.js')
const prefix = `ipv6-test-${randomUUID().slice(0, 8)}`
const owner = await prisma.user.create({ data: { username: `${prefix}-admin`, passwordHash: 'unusable-test-hash', role: 'admin' } })
const buyer = await prisma.user.create({ data: { username: `${prefix}-buyer`, passwordHash: 'unusable-test-hash', balance: 123 } })
const batchId = randomUUID()
await prisma.hostOnboardingBatch.create({ data: { id: batchId, createdById: owner.id, name: prefix, accountLabel: 'test', defaults: {} } })
const a = '2603:c020:802a:cc00::1', b = '2603:c020:802a:cc00::2'
const host = await prisma.host.create({ data: {
  userId: owner.id, name: prefix, url: 'https://10.253.240.2:8443', status: 'online', isInstalled: true,
  singleTenant: true, resourcePreset: 'E2', architecture: 'x86_64', cpuAllowanceMax: 200, memoryMax: 768, storageSize: 34, customerDiskGiB: 30,
  ipv6Mode: 3, natPublicIp: '8.8.8.8', natBindIp: '10.0.0.85', natPortStart: 1, natPortEnd: 65535,
  serverCertificate: 'isolated-fake-certificate', serverFingerprint: 'isolated-fake-pin',
  portProtocol: 'tcp', portProtocolApplied: 'tcp', portProtocolRevision: 1, portProtocolAppliedRevision: 1,
  agent: { create: { agentId: `${prefix}-agent`, secretHash: 'test-only-unusable', secretEncrypted: 'test-only-unusable',
    capabilities: ['dedicated-ipv6-v1'], enabled: true } },
  onboardingNode: { create: { batchId, name: prefix, publicIp: '8.8.8.8', managementIp: '10.253.240.2',
    sshPort: 22, sshFingerprint: 'SHA256:fixture', status: 'succeeded', credentialsExpireAt: new Date(0) } }
} })
let addresses = [a], readError = false, deliveries = 0
let remotes: Array<{ name: string; status: string; project: string }> = []
const deps: any = {
  connect: async () => ({ request: async (_method: string, path: string, _body: unknown, _timeout: number, signal: AbortSignal) => {
    assert.ok(signal, 'network reads have an abort signal')
    assert.equal(path, '/1.0/instances?recursion=1&all-projects=true')
    return remotes
  } }),
  discover: async () => { if (readError) throw new Error('offline'); return addresses },
  reconcile: async (_client: unknown, input: any) => {
    deliveries++
    return { version: 1, hostId: input.hostId, instanceName: input.name, primary: addresses[0] ?? null,
      status: addresses.length ? 'ready' : 'none', configured: true, checkedAt: new Date().toISOString(), error: null,
      mappings: addresses.map((publicIp, i) => ({ publicIp, privateIp: `fd42::${i + 2}`, ready: true })) }
  }
}
const app = Fastify()
app.decorate('authenticateAdmin', async (request: any, reply: any) => {
  if (request.headers['x-test-role'] !== 'admin') return reply.code(403).send({ code: 'FORBIDDEN' })
  request.user = { id: owner.id, username: owner.username, role: 'admin' }
})
await app.register(routes)
try {
  assert.equal((await app.inject({ method: 'POST', url: `/inventory/${host.id}/ipv6/sync` })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: '/inventory/not-an-id/ipv6/sync', headers: { 'x-test-role': 'admin' } })).statusCode, 400)
  const empty = await syncHostPublicIpv6(host.id, {}, deps)
  assert.equal(empty.status, 'synced'); assert.deepEqual(empty.addresses, [a])
  assert.equal(deliveries, 0, 'empty hosts discover addresses without creating a customer or changing the bridge')
  assert.deepEqual((await getHostById(host.id))!.public_ipv6_sync, { version: 1, addresses: [a], primary: a, status: 'synced', checkedAt: empty.checkedAt, changedAt: empty.changedAt, error: null })
  const orderId = randomUUID()
  await prisma.poolOrder.create({ data: { id: orderId, userId: buyer.id, requestHash: 'test-only', totalCents: 100 } })
  const instance = await prisma.instance.create({ data: { userId: buyer.id, hostId: host.id, incusId: `${prefix}-customer`, name: 'customer-kept', status: 'running',
    image: 'images:alpine/3.21', cpu: 200, memory: 768, disk: 30720, ipv4: '10.10.1.2', dedicatedIpv4: true, dedicatedNetworkReady: true,
    billingPrice: 1, expiresAt: new Date('2030-01-01T00:00:00Z'), purchaseBatchId: orderId, autoRenew: false } })
  remotes = [{ name: instance.incusId, status: 'Running', project: 'default' }]
  addresses = [a, b]
  assert.equal((await syncHostPublicIpv6(host.id, {}, deps)).status, 'synced')
  assert.deepEqual((await getPoolOrderResult(buyer.id, orderId))!.instances[0]!.publicIpv6Addresses, [a, b])
  assert.deepEqual(customerIpv6View((await getInstanceById(instance.id))!.dedicated_ipv6)?.addresses, [a, b])
  assert.deepEqual(customerIpv6View((await getInstancesPaginated({ userId: buyer.id })).items[0]!.dedicated_ipv6)?.addresses, [a, b])
  await prisma.instance.update({ where: { id: instance.id }, data: { ipv6: 'fd42::2' } })
  assert.deepEqual((await getPoolOrderResult(buyer.id, orderId))!.instances[0]!.publicIpv6Addresses, [a, b], 'agent-reported internal addresses do not replace public mappings')

  readError = true
  const unavailable = await syncHostPublicIpv6(host.id, {}, deps)
  assert.equal(unavailable.status, 'failed'); assert.deepEqual(unavailable.addresses, [a, b])
  assert.deepEqual((await getPoolOrderResult(buyer.id, orderId))!.instances[0]!.publicIpv6Addresses, [a, b], 'management offline cannot be interpreted as address removal')
  readError = false
  const task = await prisma.instanceTask.create({ data: { instanceId: instance.id, hostId: host.id, userId: buyer.id, taskType: 'restart' } })
  const beforeTask = deliveries
  addresses = [b]
  assert.equal((await syncHostPublicIpv6(host.id, {}, deps)).error, 'IPV6_INSTANCE_BUSY')
  assert.equal(deliveries, beforeTask, 'a running task owns network mutations')
  assert.deepEqual((await getPoolOrderResult(buyer.id, orderId))!.instances[0]!.publicIpv6Addresses, [b], 'withdrawn addresses are hidden while a task prevents cleanup')
  await prisma.instanceTask.delete({ where: { id: task.id } })
  await prisma.instance.update({ where: { id: instance.id }, data: { status: 'stopped' } })
  addresses = [a]
  assert.equal((await syncHostPublicIpv6(host.id, {}, deps)).error, 'IPV6_INSTANCE_STOPPED')
  assert.deepEqual((await getPoolOrderResult(buyer.id, orderId))!.instances[0]!.publicIpv6Addresses, [])
  await prisma.instance.update({ where: { id: instance.id }, data: { status: 'running' } })
  const first = syncHostPublicIpv6(host.id, {}, deps), second = syncHostPublicIpv6(host.id, {}, deps)
  assert.strictEqual(first, second, 'concurrent triggers share one reconciliation')
  assert.equal((await first).status, 'synced')
  assert.deepEqual((await getPoolOrderResult(buyer.id, orderId))!.instances[0]!.publicIpv6Addresses, [a])

  await prisma.host.update({ where: { id: host.id }, data: { poolFaulted: true } })
  const beforeQuarantine = deliveries
  addresses = []
  assert.equal((await syncHostPublicIpv6(host.id, {}, deps)).error, 'IPV6_HOST_QUARANTINED')
  assert.equal(deliveries, beforeQuarantine)
  assert.deepEqual((await getPoolOrderResult(buyer.id, orderId))!.instances[0]!.publicIpv6Addresses, [])
  await prisma.host.update({ where: { id: host.id }, data: { poolFaulted: false } })
  assert.equal((await syncHostPublicIpv6(host.id, {}, deps)).status, 'synced')
  const after = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
  assert.equal(after.ipv4, instance.ipv4); assert.equal(after.hostId, instance.hostId)
  assert.equal(after.billingPrice?.toString(), instance.billingPrice?.toString()); assert.deepEqual(after.expiresAt, instance.expiresAt)
  assert.equal(after.dedicatedNetworkReady, true, 'IPv6 failures never disable the working IPv4 delivery')
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), 123)
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).natPublicIp, host.natPublicIp)
  await prisma.host.update({ where: { id: host.id }, data: { ipv6Mode: 1, ipv6Subnet: '2603:c020:100::/64' } })
  await assert.rejects(syncHostPublicIpv6(host.id, {}, deps), /IPV6_SYNC_UNSUPPORTED/, 'explicit routed configurations remain administrator managed')
  console.log('Isolated IPv6 database, locks, add/change/remove, stopped/busy/quarantined hosts and customer endpoint checks passed')
} finally {
  await app.close()
  await prisma.instanceTask.deleteMany({ where: { hostId: host.id } })
  await prisma.instance.deleteMany({ where: { hostId: host.id } })
  await prisma.poolOrder.deleteMany({ where: { userId: buyer.id } })
  await prisma.hostOnboardingNode.deleteMany({ where: { batchId } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.hostOnboardingBatch.delete({ where: { id: batchId } })
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, buyer.id] } } })
  await closePrismaDatabase()
}
process.exit(0)
