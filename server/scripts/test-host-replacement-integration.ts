import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'

const url = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
process.env.JWT_SECRET ||= 'host-replacement-integration-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { encryptSensitiveData } = await import('../src/lib/security.js')
const { requestHostReplacement, replacementCandidates, executeHostReplacement } = await import('../src/services/host-replacement.js')
const { default: routes } = await import('../src/routes/host-replacements.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')

const prefix = `replace-test-${randomUUID().slice(0, 8)}`
const owner = await prisma.user.create({ data: { username: `${prefix}-admin`, passwordHash: 'unusable-test-hash', role: 'admin' } })
const buyer = await prisma.user.create({ data: { username: `${prefix}-buyer`, passwordHash: 'unusable-test-hash', balance: 100 } })
const group = await prisma.hostMachineGroup.create({ data: { name: prefix } })
const region = await prisma.hostRegionGroup.create({ data: { name: prefix, machineGroupId: group.id, countryCode: 'de' } })
let sequence = 0
async function makeHost(extra: Record<string, unknown> = {}) {
  const host = await prisma.host.create({ data: {
    userId: owner.id, name: `${prefix}-${++sequence}`, url: 'https://127.0.0.1:1',
    status: 'online', isInstalled: true, singleTenant: true, machineGroupId: group.id,
    regionGroupId: region.id, resourcePreset: 'E2', architecture: 'x86_64',
    cpuAllowanceMax: 200, memoryMax: 768, storageSize: 38, customerDiskGiB: 30,
    natPublicIp: `192.0.2.${sequence}`, natPortStart: 20000, natPortEnd: 30000, ...extra
  } })
  await prisma.storagePool.create({ data: { hostId: host.id, name: 'test', driver: 'btrfs', purpose: 'instance_data' } })
  return host
}
const expiresAt = new Date('2030-01-01T00:00:00Z')
const instanceData = (hostId: number, name: string) => ({
  hostId, userId: buyer.id, name: `${prefix}-${name}`, incusId: `${prefix}-${name}`,
  status: 'running', image: 'images:debian/12', cpu: 200, memory: 768, disk: 30720,
  ipv4: '10.10.1.46', dedicatedIpv4: true, dedicatedNetworkReady: true,
  rootPassword: encryptSensitiveData(randomUUID()), billingPrice: 1, expiresAt
})
const app = Fastify()
app.decorate('authenticateAdmin', async (request: any, reply: any) => {
  if (request.headers['x-test-role'] !== 'admin') return reply.code(403).send({ code: 'FORBIDDEN' })
  request.user = { id: owner.id, username: owner.username, role: 'admin' }
})
await app.register(routes, { prefix: '/instances' })
let failure: unknown
try {
  const sourceA = await makeHost({ status: 'offline' })
  const sourceB = await makeHost({ status: 'offline' })
  const a = await prisma.instance.create({ data: instanceData(sourceA.id, 'a') })
  const b = await prisma.instance.create({ data: instanceData(sourceB.id, 'b') })
  const target = await makeHost()
  const quarantined = await makeHost({ poolFaulted: true })
  await makeHost({ architecture: 'aarch64' })
  await makeHost({ memoryMax: 512 })
  await makeHost({ status: 'offline' })
  assert.deepEqual((await replacementCandidates(a.id)).map(host => host.id), [target.id])
  for (const method of ['GET', 'POST'] as const) {
    const response = await app.inject({ method, url: `/instances/${a.id}/${method === 'GET' ? 'replacement-options' : 'replace-host'}`,
      headers: { 'x-test-role': 'user' }, ...(method === 'POST' ? { payload: { targetHostId: target.id, acknowledgeRebuild: true } } : {}) })
    assert.equal(response.statusCode, 403, 'only administrators may view or execute replacement')
  }
  const unconfirmed = await app.inject({ method: 'POST', url: `/instances/${a.id}/replace-host`, headers: { 'x-test-role': 'admin' }, payload: { targetHostId: target.id } })
  assert.equal(unconfirmed.statusCode, 400, 'rebuilding without a backup requires explicit acknowledgement')
  await assert.rejects(requestHostReplacement(a.id, target.id, owner.id, 2147483647), /备份/)
  await assert.rejects(() => prisma.instance.create({ data: instanceData(quarantined.id, 'must-not-sell') }), /HOST_POOL_FAULTED/)

  const results = await Promise.allSettled([
    requestHostReplacement(a.id, target.id, owner.id), requestHostReplacement(b.id, target.id, owner.id)
  ])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, 'two requests cannot reserve the same spare')
  const task = await prisma.instanceTask.findFirstOrThrow({ where: { targetHostId: target.id, taskType: 'replace_host' } })
  const before = task.instanceId === a.id ? a : b
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: target.id } })).cpuUsed, 200)
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: before.hostId } })).poolFaulted, true)
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: before.id } })).dedicatedNetworkReady, false)
  assert.equal((await replacementCandidates(before.id)).some(host => host.id === target.id), false)

  // Connection failure before any creation releases only the unused target.
  const processing = await prisma.instanceTask.update({ where: { id: task.id }, data: { status: 'PROCESSING' } })
  await assert.rejects(executeHostReplacement(processing))
  await prisma.instanceTask.update({ where: { id: task.id }, data: { status: 'FAILED' } })
  const released = await prisma.host.findUniqueOrThrow({ where: { id: target.id } })
  assert.equal(released.poolFaulted, false)
  assert.equal(released.cpuUsed, 0)
  assert.equal(released.memoryUsed, 0)
  assert.equal(released.diskUsed, 0)
  const preserved = await prisma.instance.findUniqueOrThrow({ where: { id: before.id } })
  assert.equal(preserved.hostId, before.hostId)
  assert.equal(preserved.userId, before.userId)
  assert.equal(preserved.billingPrice?.toString(), before.billingPrice?.toString())
  assert.equal(preserved.expiresAt?.toISOString(), before.expiresAt?.toISOString())
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), 100)
  assert.equal(await prisma.balanceLog.count({ where: { userId: buyer.id } }), 0)

  // After a process interruption, an uncertain remote target stays quarantined.
  const retry = await requestHostReplacement(before.id, target.id, owner.id)
  const uncertain = await prisma.instanceTask.update({ where: { id: retry.taskId }, data: { status: 'PROCESSING', replacementState: {
    sourceHostId: before.hostId, sourceIncusId: before.incusId, backupUploadId: null,
    targetIncusId: `${prefix}-uncertain`, stage: 'creating'
  } } })
  await assert.rejects(executeHostReplacement(uncertain))
  await prisma.instanceTask.update({ where: { id: retry.taskId }, data: { status: 'FAILED' } })
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: target.id } })).poolFaulted, true)
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: target.id } })).cpuUsed, 200)
  assert.equal((await replacementCandidates(before.id)).some(host => host.id === target.id), false)
  await assert.rejects(() => prisma.instance.create({ data: instanceData(target.id, 'unsafe-reuse') }), /HOST_POOL_FAULTED/)
  console.log('Host replacement: permissions, concurrent reservation, billing preservation, verified release and persistent quarantine passed')
} catch (error) {
  failure = error
} finally {
  await app.close()
  await prisma.instance.deleteMany({ where: { userId: buyer.id } })
  await prisma.host.deleteMany({ where: { userId: owner.id } })
  await prisma.hostRegionGroup.delete({ where: { id: region.id } })
  await prisma.hostMachineGroup.delete({ where: { id: group.id } })
  await prisma.user.deleteMany({ where: { id: { in: [buyer.id, owner.id] } } })
  await closeAllClients()
  await closePrismaDatabase()
}
if (failure) console.error(failure)
process.exit(failure ? 1 : 0)
