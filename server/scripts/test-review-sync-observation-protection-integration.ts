import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { randomUUID, X509Certificate } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:https'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'),
  'Use isolated local *_pool_test database')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: hostRoutes } = await import('../src/routes/hosts.js')
const { syncInstanceStatus } = await import('../src/services/status-scheduler.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const { HOST_OCCUPIED_INSTANCE_WHERE } = await import('../src/lib/host-resource-usage.js')
const { recordHostSuccess, getHostHealth } = await import('../src/lib/incus/host-health.js')
const { INSTANCE_OPERATION_LOCK_NAMESPACE, advisoryTransactionLock } = await import('../src/db/advisory-locks.js')
const tag = `sync-keep-${randomUUID().replaceAll('-', '').slice(0, 16)}`
const temp = await mkdtemp(join(tmpdir(), 'payincus-sync-observation-'))
const certPath = join(temp, 'cert.pem'), keyPath = join(temp, 'key.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=incus-fixture', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath],
{ stdio: 'pipe', windowsHide: true })
const certificate = await readFile(certPath, 'utf8')
const fingerprint = new X509Certificate(certificate).fingerprint256
type Scenario = { code: number; message: string; status?: string; beforeReply?: () => Promise<void>; mutation?: Promise<void> }
const scenarios = new Map<string, Scenario>()
const requests: string[] = []
const server = createServer({ key: await readFile(keyPath), cert: certificate, ca: certificate,
  requestCert: true, rejectUnauthorized: true }, async (request, response) => {
  try {
    requests.push(`${request.method} ${request.url}`)
    assert.equal(request.method, 'GET', 'status observation cannot issue remote mutations')
    assert.ok((request.socket as any).authorized, 'use actual authenticated TLS')
    response.setHeader('content-type', 'application/json')
    if (request.url === '/1.0') return response.end(JSON.stringify({ type: 'sync', metadata: { api_version: '1.0' } }))
    const name = request.url?.split('/')[3] || ''
    const scenario = scenarios.get(name)
    if (!scenario) throw new Error('unexpected fixture target')
    if (!scenario.mutation) scenario.mutation = scenario.beforeReply?.() || Promise.resolve()
    await scenario.mutation
    response.statusCode = scenario.code
    if (scenario.code === 200) return response.end(JSON.stringify({ type: 'sync', metadata: { status: scenario.status } }))
    response.end(JSON.stringify({ type: 'error', error_code: scenario.code, error: scenario.message }))
  } catch (error) {
    response.statusCode = 500
    response.end(JSON.stringify({ type: 'error', error: String(error) }))
  }

})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as { port: number }).port
const app = Fastify()
const userIds: number[] = [], hostIds: number[] = [], instanceIds: number[] = []
let actor: { id: number; username: string; role: string; sid: string; iat: number }
for (const name of ['authenticate', 'authenticateAdmin', 'authenticateUser']) app.decorate(name, async (request: any) => { request.user = { ...actor } })

try {
  const owner = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
  const other = await prisma.user.create({ data: { username: `${tag}-other`, passwordHash: 'unusable-fixture' } })
  userIds.push(owner.id, other.id)
  actor = { id: owner.id, username: owner.username, role: 'user', sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
  await app.register(hostRoutes, { prefix: '/hosts' })
  for (const entry of ['host_batch', 'scheduler'] as const) {
    for (const kind of ['http500', 'http404', 'rename', 'old_host', 'changed_identity'] as const) {
      const label = `${tag}-${entry}-${kind}`
      const host = await prisma.host.create({ data: { userId: owner.id, name: label, url: `https://127.0.0.1:${port}`,
        certPath, keyPath, serverCertificate: certificate, serverFingerprint: fingerprint,
        status: 'online', singleTenant: true, cpuAllowanceMax: 400, memoryMax: 4096,
        cpuUsed: 100, memoryUsed: 512, diskUsed: 1024, natPortsUsedCount: 1 } })
      hostIds.push(host.id)
      const instance = await prisma.instance.create({ data: { userId: owner.id, hostId: host.id, name: label, incusId: label,
        image: 'fixture/debian', status: 'running', dedicatedIpv4: true, dedicatedNetworkReady: true,
        cpu: 100, memory: 512, disk: 1024, ipv4: `10.99.${hostIds.length}.2`, ipv6: `2001:db8::${host.id}`, billingPrice: 8,
        expiresAt: new Date(Date.now() + 86400000) } })
      instanceIds.push(instance.id)
      await prisma.portMapping.create({ data: { instanceId: instance.id, hostId: host.id, protocol: 'tcp', publicPort: 2222, privatePort: 22, systemManaged: true } })
      await prisma.ipAddress.create({ data: { instanceId: instance.id, hostId: host.id, address: instance.ipv4!, type: 'inet4', device: 'eth0', isPrimary: true } })
      await prisma.proxySite.create({ data: { instanceId: instance.id, hostId: host.id, domain: `${label}.fixture.test`, targetPort: 8080,
        enabled: true, status: 'active', ipv4SyncPending: true } })
      const candidate = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id }, include: { host: true, user: { select: { id: true } } } })
      const localHostIds = [host.id]
      const localInstanceIds = [instance.id]
      const snapshot = () => Promise.all([
        prisma.instance.findMany({ where: { id: { in: localInstanceIds } }, orderBy: { id: 'asc' } }),
        prisma.host.findMany({ where: { id: { in: localHostIds } }, select: { id: true, cpuUsed: true, memoryUsed: true, diskUsed: true, natPortsUsedCount: true }, orderBy: { id: 'asc' } }),
        prisma.portMapping.findMany({ where: { instanceId: { in: localInstanceIds } }, orderBy: { id: 'asc' } }),
        prisma.ipAddress.findMany({ where: { instanceId: { in: localInstanceIds } }, orderBy: { id: 'asc' } }),
        prisma.proxySite.findMany({ where: { instanceId: { in: localInstanceIds } }, orderBy: { id: 'asc' } }),
      ])
      let expected = await snapshot()
      scenarios.set(label, { code: kind === 'http500' ? 500 : 404, message: kind === 'http500' ? 'fixture gateway upstream not found' : 'Instance not found',
        beforeReply: async () => {
          if (kind === 'rename') await prisma.instance.update({ where: { id: instance.id }, data: { incusId: `${label}-new`, userId: other.id, version: { increment: 1 } } })
          if (kind === 'changed_identity') await prisma.host.update({ where: { id: host.id }, data: { serverFingerprint: 'fixture-changed-pin', userId: other.id } })
          if (kind === 'old_host') {
            const destination = await prisma.host.create({ data: { userId: owner.id, name: `${label}-new-host`, url: `https://127.0.0.1:${port}`,
              status: 'online', singleTenant: true, cpuAllowanceMax: 400, memoryMax: 4096,
              cpuUsed: 100, memoryUsed: 512, diskUsed: 1024, natPortsUsedCount: 1 } })
            hostIds.push(destination.id); localHostIds.push(destination.id)
            await prisma.instance.update({ where: { id: instance.id }, data: { hostId: destination.id, version: { increment: 1 } } })
            await prisma.portMapping.updateMany({ where: { instanceId: instance.id }, data: { hostId: destination.id } })
            await prisma.ipAddress.updateMany({ where: { instanceId: instance.id }, data: { hostId: destination.id } })
            await prisma.proxySite.updateMany({ where: { instanceId: instance.id }, data: { hostId: destination.id } })
            const replacement = await prisma.instance.create({ data: { userId: other.id, hostId: host.id, name: `${label}-other-tenant`,
              incusId: `${label}-other-tenant`, image: 'fixture/debian', status: 'running', dedicatedIpv4: true,
              dedicatedNetworkReady: true, cpu: 100, memory: 512, disk: 1024 } })
            instanceIds.push(replacement.id); localInstanceIds.push(replacement.id)
          }
          expected = await snapshot()
        } })
      if (entry === 'host_batch') {
        const response = await app.inject({ method: 'POST', url: `/hosts/${host.id}/instances/sync-status`, payload: { instanceIds: [instance.id] } })
        assert.equal(response.statusCode, 200, response.body)
        const result = response.json()
        assert.equal(result.failedCount, 1)
        assert.equal(result.syncedCount, 0)
        assert.equal(result.changedCount, 0)
        assert.equal(result.results[0].success, false)
        assert.match(result.results[0].error, /INSTANCE_SYNC_UNVERIFIED/)
      } else {
        const result = await syncInstanceStatus(candidate)
        assert.equal(result.changed, false)
        assert.match(result.error!, /INSTANCE_SYNC_UNVERIFIED/)
      }
      assert.deepEqual(await snapshot(), expected, `${entry}/${kind}: observation failure cannot change current tenant state or allocation`)
      for (const id of localHostIds) assert.equal(await prisma.instance.count({ where: { hostId: id, ...HOST_OCCUPIED_INSTANCE_WHERE } }), 1,
        'one-machine-one-sale inventory remains occupied')
      assert.ok(await prisma.log.findFirst({ where: { action: 'instance.sync_unverified', content: { contains: label }, result: 'failed' } }), 'failure has durable exact observed identity')
      console.log(`PASS ${entry}/${kind}: current instances, counters, ports, addresses, sites and occupied inventory retained`)
    }
  }
  for (const kind of ['same_state', 'changed_state', 'newer_same_state', 'suspended', 'owner_changed', 'host_pin_changed', 'transfer', 'operation_busy'] as const) {
    const label = `${tag}-success-${kind}`
    const host = await prisma.host.create({ data: { userId: owner.id, name: label, url: `https://127.0.0.1:${port}`,
      certPath, keyPath, serverCertificate: certificate, serverFingerprint: fingerprint, status: 'online', singleTenant: true,
      cpuAllowanceMax: 400, memoryMax: 4096,
      cpuUsed: 100, memoryUsed: 512, diskUsed: 1024, natPortsUsedCount: 1 } })
    hostIds.push(host.id)
    const instance = await prisma.instance.create({ data: { userId: owner.id, hostId: host.id, name: label, incusId: label,
      image: 'fixture/debian', status: 'running', dedicatedIpv4: true, dedicatedNetworkReady: true,
      cpu: 100, memory: 512, disk: 1024, billingPrice: 8, expiresAt: new Date(Date.now() + 86400000) } })
    instanceIds.push(instance.id)
    await prisma.portMapping.create({ data: { instanceId: instance.id, hostId: host.id, protocol: 'tcp', publicPort: 2222, privatePort: 22 } })
    const candidate = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id }, include: { host: true, user: { select: { id: true } } } })
    let unlock: (() => void) | undefined
    let lockTransaction: Promise<unknown> | undefined
    let expectedInstance = instance
    scenarios.set(label, { code: 200, message: '', status: kind === 'same_state' ? 'Running' : 'Stopped', beforeReply: async () => {
      if (kind === 'newer_same_state') await prisma.instance.update({ where: { id: instance.id }, data: {
        status: 'running', lastSyncedAt: new Date(), updatedAt: new Date(instance.updatedAt.getTime() + 1000) } })
      if (kind === 'suspended') await prisma.instance.update({ where: { id: instance.id }, data: { status: 'suspended' } })
      if (kind === 'owner_changed') await prisma.instance.update({ where: { id: instance.id }, data: { userId: other.id } })
      if (kind === 'host_pin_changed') await prisma.host.update({ where: { id: host.id }, data: { serverFingerprint: 'changed-fixture-pin' } })
      if (kind === 'transfer') await prisma.instanceTransfer.create({ data: {
        instanceId: instance.id, fromUserId: owner.id, toUserId: other.id, status: 'processing', fee: 0, snapshot: {} } })
      if (kind === 'operation_busy') {
        let acquired!: () => void
        const ready = new Promise<void>(resolve => { acquired = resolve })
        const release = new Promise<void>(resolve => { unlock = resolve })
        lockTransaction = prisma.$transaction(async tx => {
          await advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instance.id)
          acquired()
          await release
        }, { timeout: 20000 })
        await ready
      }
      expectedInstance = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
    } })
    recordHostSuccess(host.id, 1)
    try {
      const result = await syncInstanceStatus(candidate)
      const actual = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
      if (kind === 'same_state' || kind === 'changed_state') {
        assert.equal(result.changed, kind === 'changed_state')
        assert.equal(result.error, undefined)
        assert.equal(actual.status, kind === 'same_state' ? 'running' : 'stopped')
        assert.ok(actual.updatedAt > instance.updatedAt, 'successful observation advances its generation even when status is unchanged')
        assert.ok(actual.lastSyncedAt)
      } else {
        assert.equal(result.changed, false)
        assert.match(result.error!, /INSTANCE_SYNC_UNVERIFIED/)
        assert.deepEqual(actual, expectedInstance, `${kind}: late successful observation cannot mutate current instance`)
        assert.equal(getHostHealth(host.id)?.errorCount, 0, 'local observation conflicts must not mark a healthy host failed')
      }
      assert.equal(await prisma.portMapping.count({ where: { instanceId: instance.id } }), 1)
      const currentHost = await prisma.host.findUniqueOrThrow({ where: { id: host.id } })
      assert.deepEqual([currentHost.cpuUsed, currentHost.memoryUsed, currentHost.diskUsed, currentHost.natPortsUsedCount], [100, 512, 1024, 1])
      assert.equal(await prisma.instance.count({ where: { hostId: host.id, ...HOST_OCCUPIED_INSTANCE_WHERE } }), 1)
      console.log(`PASS scheduler/success/${kind}: generation/identity/operation checks retain allocation`)
    } finally {
      unlock?.()
      await lockTransaction
    }
  }
  assert.ok(requests.every(value => value.startsWith('GET ')))
  console.log('Status observation protection passed with real PostgreSQL/Fastify/mTLS: actual 404, HTTP 500 containing not found, old rename/owner/host observations and changed trust never delete or release allocations; explicit destruction and expiry paths unchanged')
} finally {
  await app.close()
  await closeAllClients()
  await new Promise<void>(resolve => server.close(() => resolve()))
  await prisma.log.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { action: 'instance.sync_unverified', content: { contains: tag } }] } })
  await prisma.instance.deleteMany({ where: { id: { in: instanceIds } } })
  await prisma.host.deleteMany({ where: { id: { in: hostIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await closePrismaDatabase()
  await rm(temp, { recursive: true, force: true })
}
process.exit(0)
