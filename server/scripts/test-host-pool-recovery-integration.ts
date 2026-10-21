import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
process.env.JWT_SECRET ||= 'host-recovery-integration-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { inspectHostRecovery, recoverPoolHost, HostRecoveryError } = await import('../src/services/host-pool-recovery.js')
const { default: routes } = await import('../src/routes/host-inventory.js')
const { PORT_PROTOCOL_CAPABILITY } = await import('../src/services/host-port-protocol.js')

const prefix = `recover-test-${randomUUID().slice(0, 8)}`
const owner = await prisma.user.create({ data: { username: `${prefix}-admin`, passwordHash: 'unusable-test-hash', role: 'admin' } })
const buyer = await prisma.user.create({ data: { username: `${prefix}-buyer`, passwordHash: 'unusable-test-hash', balance: 123 } })
let sequence = 0
async function makeHost(poolFaulted = true) {
  const id = ++sequence
  return prisma.host.create({ data: {
    userId: owner.id, name: `${prefix}-${id}`, url: 'https://127.0.0.1:1', status: 'online', isInstalled: true,
    singleTenant: true, poolFaulted, resourcePreset: 'E2', architecture: 'x86_64', cpuAllowanceMax: 200,
    memoryMax: 768, storageSize: 34, customerDiskGiB: 30, cpuUsed: poolFaulted ? 200 : 0,
    memoryUsed: poolFaulted ? 768 : 0, diskUsed: poolFaulted ? 30720 : 0,
    natPublicIp: `192.0.2.${id}`, natBindIp: `10.0.0.${id}`, natPortStart: 20000, natPortEnd: 30000,
    portProtocol: 'tcp_udp', portProtocolRevision: 1, portProtocolApplied: 'tcp_udp', portProtocolAppliedRevision: 1,
    agent: { create: { agentId: `${prefix}-${id}`, secretHash: 'unused', secretEncrypted: 'unused', lastSeenAt: new Date(), capabilities: [PORT_PROTOCOL_CAPABILITY] } },
    storagePools: { create: { name: 'default', driver: 'dir', purpose: 'instance_data' } }
  } })
}
const app = Fastify()
app.decorate('authenticateAdmin', async (request: any, reply: any) => {
  if (request.headers['x-test-role'] !== 'admin') return reply.code(403).send({ code: 'FORBIDDEN' })
  request.user = { id: owner.id, username: owner.username, role: 'admin' }
})
await app.register(routes)
let failure: unknown
try {
  const source = await makeHost()
  const target = await makeHost(false)
  const current = await prisma.instance.create({ data: { userId: buyer.id, hostId: target.id, name: `${prefix}-customer`,
    incusId: `${prefix}-new`, status: 'running', image: 'images:alpine/3.21', cpu: 200, memory: 768, disk: 30720,
    dedicatedIpv4: true, dedicatedNetworkReady: true, billingPrice: 1, expiresAt: new Date('2030-01-01T00:00:00Z') } })
  const oldName = `${prefix}-old`
  await prisma.instanceTask.create({ data: { instanceId: current.id, userId: owner.id, hostId: target.id, targetHostId: target.id,
    taskType: 'replace_host', status: 'COMPLETED', replacementState: {
      sourceHostId: source.id, sourceIncusId: oldName, targetIncusId: current.incusId, stage: 'delivered'
    } } })
  const oldCreated = '2026-01-01T00:00:00Z'
  let remote = [{ name: oldName, status: 'Stopped', created_at: oldCreated, project: 'default' }]
  let forwards = [{ listen_address: '10.0.0.1', description: `payincus-dedicated:${oldName}`, config: { target_address: '10.10.1.4' }, ports: [] }]
  let extraVolume = false
  let busy = false
  let failForward = false
  const deletions: string[] = []
  const fakeClient = {
    request: async (method: string, path: string) => {
      if (method === 'GET') {
        if (path.startsWith('/1.0/instances?')) return structuredClone(remote)
        if (path.startsWith('/1.0/instances/')) return structuredClone(remote.find(row => row.name === decodeURIComponent(path.split('/').pop()!)))
        if (path === '/1.0/projects?recursion=1') return [{ name: 'default' }]
        if (path === '/1.0/networks?recursion=1') return [{ name: 'incusbr0', type: 'bridge', managed: true }]
        if (path === '/1.0/operations?recursion=1') return { running: busy ? [{ id: 'busy' }] : [] }
        if (path === '/1.0/storage-pools?recursion=1') return [{ name: 'default', status: 'Created' }]
        if (path.includes('/volumes?')) return [...remote.map(row => ({ name: row.name, type: 'container' })), ...(extraVolume ? [{ name: 'important-data', type: 'custom' }] : [])]
        if (path === '/1.0/networks/incusbr0/forwards?recursion=1') return structuredClone(forwards)
      }
      if (method === 'DELETE' && path.startsWith('/1.0/instances/')) {
        const name = decodeURIComponent(path.split('/').pop()!)
        deletions.push(name); remote = remote.filter(row => row.name !== name); return {}
      }
      if (method === 'DELETE' && path.startsWith('/1.0/networks/incusbr0/forwards/')) {
        if (failForward) throw new Error('Simulated firewall API failure')
        const address = decodeURIComponent(path.split('/').pop()!)
        forwards = forwards.filter(row => row.listen_address !== address); return {}
      }
      throw new Error(`Unexpected remote request: ${method} ${path}`)
    }
  }
  const connect = async () => fakeClient as any
  for (const [method, path, payload] of [
    ['GET', `/inventory/${source.id}/recovery`, undefined],
    ['POST', `/inventory/${source.id}/recover`, { confirmation: '0'.repeat(64), acknowledgeCleanup: true }]
  ] as const) {
    const response = await app.inject({ method, url: path, headers: { 'x-test-role': 'user' }, payload })
    assert.equal(response.statusCode, 403, 'ordinary users cannot inspect or release quarantine')
  }
  const report = await inspectHostRecovery(source.id, connect)
  assert.equal(report.canRecover, true)
  assert.equal(report.needsCleanup, true)
  assert.deepEqual(report.instances.map(row => row.name), [oldName])
  assert.equal(deletions.length, 0, 'inspection is read-only')
  const rejects = async (options: { confirmation: string; acknowledgeCleanup: boolean }, code: string) => {
    await assert.rejects(recoverPoolHost(source.id, owner.id, options, connect), error => error instanceof HostRecoveryError && error.code === code)
    assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: source.id } })).poolFaulted, true)
  }
  await rejects({ confirmation: report.confirmation, acknowledgeCleanup: false }, 'HOST_RECOVERY_CONFIRM_REQUIRED')
  await rejects({ confirmation: '0'.repeat(64), acknowledgeCleanup: true }, 'HOST_RECOVERY_CHANGED')
  assert.equal(deletions.length, 0)
  for (const [change, undo, reason] of [
    [() => { remote[0].status = 'Running' }, () => { remote[0].status = 'Stopped' }, 'running-instance'],
    [() => { remote[0].name = 'unrelated-system' }, () => { remote[0].name = oldName }, 'unknown-instance'],
    [() => { remote[0].created_at = '2099-01-01T00:00:00Z' }, () => { remote[0].created_at = oldCreated }, 'unknown-instance'],
    [() => { extraVolume = true }, () => { extraVolume = false }, 'volumes'],
    [() => { busy = true }, () => { busy = false }, 'busy'],
    [() => { forwards[0].description = 'manual-forward' }, () => { forwards[0].description = `payincus-dedicated:${oldName}` }, 'unknown-forward']
  ] as const) {
    change()
    const blocked = await inspectHostRecovery(source.id, connect)
    assert.ok(blocked.blockers.includes(reason))
    await rejects({ confirmation: blocked.confirmation, acknowledgeCleanup: true }, 'HOST_RECOVERY_BLOCKED')
    undo()
  }
  assert.equal(deletions.length, 0, 'unknown, running and reused names must never be deleted')
  const assigned = await inspectHostRecovery(target.id, connect)
  assert.ok(assigned.blockers.includes('assigned-not-ready'), 'occupied hosts require completed delivery and storage mapping before preservation recovery')
  const task = await prisma.instanceTask.create({ data: { instanceId: current.id, userId: owner.id,
    hostId: source.id, targetHostId: source.id, taskType: 'replace_host', status: 'PROCESSING' } })
  assert.ok((await inspectHostRecovery(source.id, connect)).blockers.includes('busy'))
  await prisma.instanceTask.update({ where: { id: task.id }, data: { status: 'FAILED' } })
  await prisma.hostAgent.update({ where: { hostId: source.id }, data: { lastSeenAt: new Date(0) } })
  assert.ok((await inspectHostRecovery(source.id, connect)).blockers.includes('agent-offline'))
  await prisma.hostAgent.update({ where: { hostId: source.id }, data: { lastSeenAt: new Date() } })

  failForward = true
  const beforeFailure = await inspectHostRecovery(source.id, connect)
  await rejects({ confirmation: beforeFailure.confirmation, acknowledgeCleanup: true }, 'HOST_RECOVERY_FAILED')
  assert.deepEqual(deletions, [oldName])
  assert.equal(forwards.length, 1, 'failed network cleanup must keep the host quarantined')
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: source.id } })).cpuUsed, 200)
  failForward = false
  const retry = await inspectHostRecovery(source.id, connect)
  assert.equal(retry.canRecover, true)
  assert.equal(retry.instances.length, 0)
  assert.equal(retry.needsCleanup, true)
  const results = await Promise.allSettled([
    recoverPoolHost(source.id, owner.id, { confirmation: retry.confirmation, acknowledgeCleanup: true }, connect),
    recoverPoolHost(source.id, owner.id, { confirmation: retry.confirmation, acknowledgeCleanup: true }, connect)
  ])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, 'concurrent recovery can release the host only once')
  const recovered = await prisma.host.findUniqueOrThrow({ where: { id: source.id } })
  assert.equal(recovered.poolFaulted, false)
  assert.deepEqual([recovered.cpuUsed, recovered.memoryUsed, recovered.diskUsed], [0, 0, 0])
  assert.equal(forwards.length, 0)
  assert.deepEqual(await prisma.instance.findUniqueOrThrow({ where: { id: current.id } }), current, 'the replacement customer instance and billing remain untouched')
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), 123)
  const occupiedHost = await makeHost(false)
  const liveInstance = await prisma.instance.create({ data: { userId: buyer.id, hostId: occupiedHost.id, name: `${prefix}-occupied`,
    incusId: `${prefix}-occupied`, status: 'running', image: 'images:alpine/3.21', cpu: 200, memory: 768, disk: 30720,
    ipv4: '10.10.4.2', storagePoolName: 'default', dedicatedIpv4: true, dedicatedNetworkReady: true, billingPrice: 9.5,
    autoRenew: true, expiresAt: new Date('2030-01-01T00:00:00Z') } })
  const occupiedBefore = await prisma.host.update({ where: { id: occupiedHost.id }, data: { poolFaulted: true, cpuUsed: 200, memoryUsed: 768, diskUsed: 30720 } })
  let mismatchedInstance = false, mismatchedNetwork = false, extraDataVolume = false
  let ipv6ForwardPresent = false
  const occupiedConnect = async () => ({ request: async (method: string, path: string) => {
    assert.equal(method, 'GET', 'occupied recovery must never mutate customer systems, snapshots or network rules')
    if (path.startsWith('/1.0/instances?')) return [{ name: mismatchedInstance ? 'unknown' : liveInstance.incusId, status: 'Running', project: 'default' }]
    if (path.startsWith('/1.0/projects?')) return [{ name: 'default' }]
    if (path.startsWith('/1.0/networks?')) return [{ name: 'incusbr0', managed: true, type: 'bridge' }]
    if (path.startsWith('/1.0/operations?')) return { running: [] }
    if (path.startsWith('/1.0/storage-pools?')) return [{ name: 'default', status: 'Created' }]
    if (path.includes('/forwards?')) return [{ listen_address: occupiedHost.natBindIp, description: `payincus-dedicated:${liveInstance.incusId}`, config: { target_address: mismatchedNetwork ? '10.10.4.99' : liveInstance.ipv4 }, ports: [] }, ...(ipv6ForwardPresent ? [{ listen_address: '2603:c024::1234', description: `payincus-dedicated:${liveInstance.incusId}`, config: { target_address: 'fd00::2' }, ports: [] }] : [])]
    if (path.includes('/volumes?')) return [{ name: liveInstance.incusId, type: 'container' }, ...(extraDataVolume ? [{ name: 'private-data', type: 'custom' }] : [])]
    throw new Error('Unexpected occupied inspection endpoint')
  } }) as any
  for (const reason of ['assigned-mismatch', 'unknown-forward', 'volumes'] as const) {
    mismatchedInstance = reason === 'assigned-mismatch'; mismatchedNetwork = reason === 'unknown-forward'; extraDataVolume = reason === 'volumes'
    const blocked = await inspectHostRecovery(occupiedHost.id, occupiedConnect)
    assert.ok(blocked.blockers.includes(reason))
    await assert.rejects(recoverPoolHost(occupiedHost.id, owner.id, { confirmation: blocked.confirmation, acknowledgeCleanup: false }, occupiedConnect), error => error instanceof HostRecoveryError && error.code === 'HOST_RECOVERY_BLOCKED')
  }
  mismatchedInstance = false; mismatchedNetwork = false; extraDataVolume = false
  const occupiedReport = await inspectHostRecovery(occupiedHost.id, occupiedConnect)
  assert.equal(occupiedReport.mode, 'preserve')
  assert.equal(occupiedReport.canRecover, true)
  assert.equal(occupiedReport.needsCleanup, false)
  assert.deepEqual(occupiedReport.instances, [])
  await prisma.instance.update({ where: { id: liveInstance.id }, data: { dedicatedIpv6: {
    version: 1, hostId: occupiedHost.id, instanceName: liveInstance.incusId, status: 'pending', error: 'IPV6_HOST_QUARANTINED',
    mappings: []
  } } })
  assert.ok((await inspectHostRecovery(occupiedHost.id, occupiedConnect)).blockers.includes('assigned-not-ready'), 'quarantine cannot make unverified IPv6 mappings ready')
  await prisma.instance.update({ where: { id: liveInstance.id }, data: { dedicatedIpv6: {
    version: 1, hostId: occupiedHost.id, instanceName: liveInstance.incusId, status: 'pending', error: 'IPV6_HOST_QUARANTINED',
    mappings: [{ publicIp: '2603:c024::1234', privateIp: 'fd00::2', ready: true }]
  } } })
  assert.ok((await inspectHostRecovery(occupiedHost.id, occupiedConnect)).blockers.includes('unknown-forward'), 'paused IPv6 recovery must verify every retained mapping remotely')
  ipv6ForwardPresent = true
  const liveBeforeRecovery = await prisma.instance.findUniqueOrThrow({ where: { id: liveInstance.id } })
  const finalOccupiedReport = await inspectHostRecovery(occupiedHost.id, occupiedConnect)
  assert.equal(finalOccupiedReport.canRecover, true, 'verified retained IPv6 rules break the quarantine/reconciliation dependency cycle')
  await recoverPoolHost(occupiedHost.id, owner.id, { confirmation: finalOccupiedReport.confirmation, acknowledgeCleanup: false }, occupiedConnect)
  const occupiedAfter = await prisma.host.findUniqueOrThrow({ where: { id: occupiedHost.id } })
  assert.equal(occupiedAfter.poolFaulted, false)
  assert.deepEqual([occupiedAfter.cpuUsed, occupiedAfter.memoryUsed, occupiedAfter.diskUsed], [occupiedBefore.cpuUsed, occupiedBefore.memoryUsed, occupiedBefore.diskUsed])
  assert.deepEqual(await prisma.instance.findUniqueOrThrow({ where: { id: liveInstance.id } }), liveBeforeRecovery, 'occupied recovery must retain owner, billing, expiry, renewal and network records')
  console.log('Host pool recovery: authorization, confirmation, ownership, remote state, partial failure, retry, concurrency and billing preservation passed')
} catch (error) { failure = error }
finally {
  await app.close()
  await prisma.instance.deleteMany({ where: { userId: buyer.id } })
  await prisma.host.deleteMany({ where: { userId: owner.id } })
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, buyer.id] } } })
  await closePrismaDatabase()
}
if (failure) console.error(failure)
process.exit(failure ? 1 : 0)
