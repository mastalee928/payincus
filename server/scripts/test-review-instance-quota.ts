import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { Prisma } from '@prisma/client'
import Fastify from 'fastify'
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.JWT_SECRET ||= 'quota-fixture-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/instances.js')
const { default: siteRoutes } = await import('../src/routes/proxy-sites.js')
const { createBackupWithQuotaReservation } = await import('../src/db/backups.js')
const { withSnapshotMutation } = await import('../src/db/snapshot-operation-guards.js')
const { advisoryTransactionLock, INSTANCE_OPERATION_LOCK_NAMESPACE } = await import('../src/db/advisory-locks.js')
const { acquireLock, releaseLock } = await import('../src/lib/distributed-lock.js')
const prefix = `instance-quota-${randomUUID().slice(0, 8)}`
const admin = await prisma.user.create({ data: { username: `${prefix}-admin`, passwordHash: 'unusable-fixture', role: 'admin' } })
const owner = await prisma.user.create({ data: { username: `${prefix}-owner`, passwordHash: 'unusable-fixture' } })
const buyer = await prisma.user.create({ data: { username: `${prefix}-buyer`, passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: owner.id, name: prefix, url: 'https://127.0.0.1:1' } })
const replacement = await prisma.host.create({ data: { userId: owner.id, name: prefix + '-replacement', url: 'https://127.0.0.1:2' } })
const pkg = await prisma.package.create({ data: { userId: owner.id, name: prefix, cpuMax: 100, memoryMax: 512, diskMax: 1024, siteLimit: 1 } })
const instance = await prisma.instance.create({ data: { userId: buyer.id, hostId: host.id, name: prefix, incusId: prefix, image: 'fixture/debian',
  cpu: 50, memory: 256, disk: 1024, status: 'stopped', portLimit: 5, snapshotLimit: 5, backupLimit: 5, siteLimit: 5 } })
const app = Fastify()
app.decorate('authenticate', async (request: any) => {
  const actor = request.headers['x-test-role'] === 'owner' ? owner : request.headers['x-test-role'] === 'buyer' ? buyer : admin
  request.user = { id: actor.id, role: actor.role, username: actor.username, sid: prefix, iat: Math.floor(Date.now() / 1000) + 1 }
})
app.decorate('authenticateUser', app.authenticate)
app.decorate('authenticateAdmin', app.authenticate)
app.decorate('requireAdmin', async () => {})
const fields = ['portLimit', 'snapshotLimit', 'backupLimit', 'siteLimit'] as const
const limits = async () => {
  const row = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
  return fields.map(field => row[field])
}
const patch = (payload: object, role = 'admin') => app.inject({ method: 'PATCH', url: `/instances/${instance.id}/quota`, headers: { 'x-test-role': role }, payload })
const userIds = [admin.id, owner.id, buyer.id]
const reset = async () => {
  await prisma.tokenInvalidation.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { role: 'user', status: 'active' } })
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
  await prisma.instanceTask.deleteMany({ where: { instanceId: instance.id } })
  await prisma.instanceTransfer.deleteMany({ where: { instanceId: instance.id } })
  await prisma.autoSnapshotOperation.deleteMany({ where: { instanceId: instance.id } })
  await prisma.proxySiteOperation.deleteMany({ where: { instanceId: instance.id } })
  await prisma.proxySite.deleteMany({ where: { instanceId: instance.id } })
  await prisma.snapshot.deleteMany({ where: { instanceId: instance.id } })
  await prisma.backup.deleteMany({ where: { instanceId: instance.id } })
  await prisma.host.update({ where: { id: host.id }, data: { userId: owner.id, caddyEnabled: true } })
  await prisma.instance.update({ where: { id: instance.id }, data: { hostId: host.id, userId: buyer.id, incusId: prefix,
    status: 'stopped', packageId: null, portLimit: 5, snapshotLimit: 5, backupLimit: 5, siteLimit: 5,
    provisioningCleanupPending: false, deletionBillingPending: false, ipv4: '10.0.0.2' } })
}
const createSites = (count: number) => prisma.proxySite.createMany({ data: Array.from({ length: count }, (_, n) => ({
  instanceId: instance.id, hostId: host.id, domain: `${prefix}-${n}.example.invalid`, targetPort: 80 })) })
async function blockWrite(mutate: (tx: Prisma.TransactionClient) => Promise<unknown>, request: () => PromiseLike<any>) {
  let release!: () => void, entered!: (pid: number) => void
  const hold = new Promise<void>(resolve => { release = resolve }), ready = new Promise<number>(resolve => { entered = resolve })
  const blocker = prisma.$transaction(async tx => {
    await mutate(tx)
    const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
    entered(row.pid); await hold
  }, { timeout: 15000 })
  const pid = await ready
  let settled = false, blocked = false
  const operation = Promise.resolve(request()).then(response => { settled = true; return response })
  try {
    const deadline = Date.now() + 3500
    while (!settled && Date.now() < deadline) {
      const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`
      if (Number(row.count) > 0) { blocked = true; break }
      await delay(20)
    }
  } finally { release(); await blocker }
  return { response: await operation, blocked }
}
let failure: unknown
try {
  await app.register(routes, { prefix: '/instances' })
  await app.register(siteRoutes)
  for (const role of ['admin', 'owner']) {
    for (const field of fields) {
      await prisma.instance.update({ where: { id: instance.id }, data: { portLimit: 5, snapshotLimit: 5, backupLimit: 5, siteLimit: 5 } })
      assert.equal((await patch({ [field]: null }, role)).statusCode, 200)
      assert.deepEqual(await limits(), fields.map(value => value === field ? null : 5), `${role}/${field}: explicit null clears only this override`)
      assert.equal((await patch({}, role)).statusCode, 200)
      assert.deepEqual(await limits(), fields.map(value => value === field ? null : 5), 'omitted fields retain their persisted values')
    }
  }
  await prisma.instance.update({ where: { id: instance.id }, data: { portLimit: 5, snapshotLimit: 5, backupLimit: 5, siteLimit: 5 } })
  for (const field of fields) {
    for (const invalid of [-1, 1001, 1.5, {}, []]) {
      assert.equal((await patch({ [field]: invalid })).statusCode, 400)
      assert.deepEqual(await limits(), [5, 5, 5, 5])
    }
  }
  assert.equal((await patch({ portLimit: 0 })).statusCode, 400)
  assert.equal((await patch({ snapshotLimit: 0, backupLimit: 0, siteLimit: 0 })).statusCode, 200)
  assert.deepEqual(await limits(), [5, 0, 0, 0], 'explicit zero remains zero')
  assert.equal((await patch({ portLimit: 1000, snapshotLimit: 1000, backupLimit: 1000, siteLimit: 1000 })).statusCode, 200)
  assert.deepEqual(await limits(), [1000, 1000, 1000, 1000])
  await prisma.proxySite.createMany({ data: [1, 2].map(n => ({ instanceId: instance.id, hostId: host.id,
    domain: `${prefix}-${n}.example.invalid`, targetPort: 80 })) })
  assert.equal((await patch({ siteLimit: 1 })).statusCode, 400, 'cannot lower site quota below existing sites')
  assert.deepEqual(await limits(), [1000, 1000, 1000, 1000])
  assert.equal((await patch({ siteLimit: 0 })).statusCode, 200, 'zero site quota remains unlimited')
  await prisma.proxySite.deleteMany({ where: { instanceId: instance.id } })
  assert.equal((await patch({ portLimit: null }, 'buyer')).statusCode, 403, 'instance ownership alone cannot change administrative quota')
  assert.deepEqual(await limits(), [1000, 1000, 1000, 0])
  await reset()
  await prisma.portMapping.createMany({ data: [false, false, true].map((systemManaged, n) => ({ instanceId: instance.id,
    hostId: host.id, protocol: 'tcp' as const, publicPort: 21000 + n, privatePort: 21000 + n, systemManaged })) })
  for (const value of [1, null]) assert.equal((await patch({ portLimit: value })).statusCode, 400, 'effective port limit must cover user mappings')
  assert.equal((await patch({ portLimit: 2 })).statusCode, 200, 'system managed port does not consume quota')
  await prisma.portMapping.deleteMany({ where: { instanceId: instance.id } })
  for (const field of ['snapshotLimit', 'backupLimit'] as const) {
    await reset()
    if (field === 'snapshotLimit') await prisma.snapshot.createMany({ data: [1, 2].map(n => ({ instanceId: instance.id, name: `s${n}`, incusName: `s${n}` })) })
    else await prisma.backup.createMany({ data: ['creating', 'ready', 'error', 'deleted'].map((status, n) => ({ instanceId: instance.id,
      name: `b${n}`, incusName: `b${n}`, status: status as 'creating' | 'ready' | 'error' | 'deleted' })) })
    for (const value of [0, 1, null]) assert.equal((await patch({ [field]: value })).statusCode, 400, `${field}: cannot bypass used quota with null/zero`)
    assert.equal((await patch({ [field]: 2 })).statusCode, 200, 'effective usage permits equal quota; failed/deleted backups excluded')
    assert.equal((await patch({ siteLimit: 1 })).statusCode, 200, 'omitted unrelated quotas remain unchanged')
  }
  await reset(); await createSites(2)
  await prisma.instance.update({ where: { id: instance.id }, data: { packageId: pkg.id } })
  assert.equal((await patch({ siteLimit: null })).statusCode, 400, 'inherited package limit checked against sites')
  await prisma.package.update({ where: { id: pkg.id }, data: { siteLimit: 0 } })
  assert.equal((await patch({ siteLimit: null })).statusCode, 200, 'inherited unlimited remains unlimited')
  await reset(); await createSites(11)
  assert.equal((await patch({ siteLimit: null })).statusCode, 400, 'without package null resolves to 10')
  await reset(); await createSites(10)
  assert.equal((await patch({ siteLimit: null })).statusCode, 200, 'default limit can equal current sites')
  console.log('PASS quota effective usage: ports/system, snapshots, active backups, sites/zero/package/default/null')

  for (const role of ['admin', 'owner'] as const) for (const mode of ['banned', 'session', 'all-sessions', ...(role === 'admin' ? ['demoted'] : [])]) {
    await reset()
    const actor = role === 'admin' ? admin : owner
    const result = await blockWrite(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.id} FOR UPDATE`
      if (mode === 'banned') await tx.user.update({ where: { id: actor.id }, data: { status: 'banned' } })
      if (mode === 'demoted') await tx.user.update({ where: { id: actor.id }, data: { role: 'user' } })
      if (mode === 'session' || mode === 'all-sessions') await tx.tokenInvalidation.create({ data: { userId: actor.id,
        sessionId: mode === 'session' ? prefix : '__USER_LEVEL__', invalidatedAt: Math.floor(Date.now() / 1000) + 100 } })
    }, () => patch({ portLimit: 8 }, role))
    assert.equal(result.blocked, true, `${role}/${mode} serializes with revocation`)
    assert.equal(result.response.statusCode, 403, result.response.body)
    assert.deepEqual(await limits(), [5, 5, 5, 5])
  }
  for (const mode of ['instance-owner', 'host', 'incus', 'deleted', 'host-owner'] as const) {
    await reset()
    const result = await blockWrite(async tx => {
      if (mode === 'host-owner') await tx.host.update({ where: { id: host.id }, data: { userId: buyer.id } })
      else await tx.instance.update({ where: { id: instance.id }, data: mode === 'instance-owner' ? { userId: owner.id }
        : mode === 'host' ? { hostId: replacement.id } : mode === 'incus' ? { incusId: prefix + '-changed' } : { status: 'deleted' } })
    }, () => patch({ portLimit: 8 }, mode === 'host-owner' ? 'owner' : 'admin'))
    assert.equal(result.blocked, true, mode)
    assert.equal(result.response.statusCode, mode === 'deleted' ? 404 : mode === 'host-owner' ? 403 : 409, result.response.body)
    assert.deepEqual(await limits(), [5, 5, 5, 5])
  }
  for (const mode of ['creating', 'cleanup', 'deletion-billing', 'task', 'transfer', 'auto-snapshot', 'proxy-operation']) {
    await reset()
    if (mode === 'task') await prisma.instanceTask.create({ data: { instanceId: instance.id, userId: buyer.id, hostId: host.id, taskType: 'rebuild' } })
    else if (mode === 'transfer') await prisma.instanceTransfer.create({ data: { instanceId: instance.id, fromUserId: buyer.id, toUserId: owner.id, snapshot: {} } })
    else if (mode === 'auto-snapshot') await prisma.autoSnapshotOperation.create({ data: { id: randomUUID(), instanceId: instance.id,
      ownerId: buyer.id, hostId: host.id, incusId: prefix, identityHash: 'fixture', snapshotName: randomUUID() } })
    else if (mode === 'proxy-operation') await prisma.proxySiteOperation.create({ data: { id: randomUUID(), siteId: 0, siteKey: randomUUID(),
      instanceId: instance.id, hostId: host.id, ownerId: buyer.id, actorId: buyer.id, actorSid: prefix, actorIat: 1,
      authority: 'user', identityHash: 'fixture', incusId: prefix, revision: 1, action: 'upsert', desiredConfig: {}, requestHash: 'fixture' } })
    else await prisma.instance.update({ where: { id: instance.id }, data: mode === 'creating' ? { status: 'creating' }
      : mode === 'cleanup' ? { provisioningCleanupPending: true } : { deletionBillingPending: true } })
    assert.equal((await patch({ portLimit: 8 })).statusCode, 409, mode)
    assert.deepEqual(await limits(), [5, 5, 5, 5])
  }
  await reset()
  await blockWrite(tx => advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instance.id), async () => {
    const response = await patch({ siteLimit: 1 }); assert.equal(response.statusCode, 409, 'shared instance operation rejects competing quota change'); return response
  })
  assert.deepEqual(await limits(), [5, 5, 5, 5])
  await prisma.instance.update({ where: { id: instance.id }, data: { status: 'suspended', suspendReason: 'manual' } })
  assert.equal((await patch({ snapshotLimit: 8 })).statusCode, 200, 'administrative quota changes remain possible during suspension')
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).status, 'suspended', 'quota edit never unsuspends an instance')
  console.log('PASS quota current actor/session, target identity, workflow and instance operation fences')

  await reset()
  const lockKey = `instance:${instance.id}:port-mappings`
  const lock = await acquireLock(lockKey)
  assert.ok(lock.success && lock.ownerId)
  let portSettled = false
  const portUpdate = patch({ portLimit: 1 }).then(response => { portSettled = true; return response })
  try {
    await delay(250); assert.equal(portSettled, false, 'quota shares manual port mutation lock')
    await prisma.portMapping.createMany({ data: [1, 2].map(n => ({ instanceId: instance.id, hostId: host.id,
      protocol: 'tcp' as const, publicPort: 22000 + n, privatePort: 22000 + n })) })
  } finally { await releaseLock(lockKey, lock.ownerId!) }
  assert.equal((await portUpdate).statusCode, 400, 'recounts mappings after lock wait')
  await prisma.portMapping.deleteMany({ where: { instanceId: instance.id } })

  for (const kind of ['backup', 'site', 'snapshot']) {
    await reset()
    const lowered = kind === 'backup' ? { backupLimit: 1 } : kind === 'site' ? { siteLimit: 1 } : { snapshotLimit: 1 }
    const create = async () => {
      if (kind === 'backup') return (await createBackupWithQuotaReservation({ instanceId: instance.id, name: randomUUID(), incusName: randomUUID() })).allowed
      if (kind === 'site') return (await app.inject({ method: 'POST', url: `/instances/${instance.id}/sites`, headers: { 'x-test-role': 'buyer' },
        payload: { domain: `${randomUUID()}.example.invalid`, targetPort: 80 } })).statusCode < 300
      try {
        return await withSnapshotMutation({ id: instance.id, user_id: buyer.id, host_id: host.id, incus_id: prefix },
          { id: buyer.id, sid: prefix, iat: Math.floor(Date.now() / 1000) + 1 }, false, async (tx, current) => {
            if (await tx.snapshot.count({ where: { instanceId: instance.id } }) >= (current.snapshotLimit ?? 0)) return false
            await tx.snapshot.create({ data: { instanceId: instance.id, name: randomUUID(), incusName: randomUUID() } }); return true
          })
      } catch { return false }
    }
    assert.equal(await create(), true, kind)
    const [changed, created] = await Promise.all([patch(lowered), create()])
    const row = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
    const used = kind === 'backup' ? await prisma.backup.count({ where: { instanceId: instance.id } })
      : kind === 'site' ? await prisma.proxySite.count({ where: { instanceId: instance.id } }) : await prisma.snapshot.count({ where: { instanceId: instance.id } })
    const limit = kind === 'backup' ? row.backupLimit : kind === 'site' ? row.siteLimit : row.snapshotLimit
    assert.ok(used <= limit!, `${kind} creation and lowering cannot overrun quota`)
    assert.ok(changed.statusCode !== 200 || !created, `${kind}: only one competing effect can succeed`)
    assert.equal((await patch(lowered)).statusCode, used > 1 ? 400 : 200)
    if (used === 1) assert.equal(await create(), false, `${kind}: create rereads committed lower quota`)
  }
  console.log('PASS manual port wait/recount and real site/backup plus snapshot transaction creation races')
  await reset()
  const mixed = await Promise.all([patch({ portLimit: 8 }), patch({ siteLimit: 9 })])
  assert.ok(mixed.every(response => response.statusCode === 200), mixed.map(response => response.body).join(';'))
  assert.deepEqual(await limits(), [8, 5, 5, 9], 'concurrent disjoint patches do not overwrite omitted fields')
  const constraint = `quota_${randomUUID().replaceAll('-', '')}`
  await prisma.$executeRawUnsafe(`ALTER TABLE instances ADD CONSTRAINT ${constraint} CHECK (id <> ${instance.id} OR site_limit <> 13) NOT VALID`)
  try {
    assert.equal((await patch({ portLimit: 10, siteLimit: 13 })).statusCode, 500)
    assert.deepEqual(await limits(), [8, 5, 5, 9], 'failed multi-field update rolls back every field')
  } finally { await prisma.$executeRawUnsafe(`ALTER TABLE instances DROP CONSTRAINT ${constraint}`) }
  assert.equal(await prisma.balanceLog.count({ where: { userId: { in: [admin.id, owner.id, buyer.id] } } }), 0)
  console.log('PASS actual quota PATCH: admin/host-owner explicit null, omission, zero, limits, invalid inputs and customer denial; isolated PostgreSQL, no remote I/O')
} catch (error) { failure = error } finally {
  await app.close()
  await prisma.autoSnapshotOperation.deleteMany({ where: { instanceId: instance.id } })
  await prisma.proxySiteOperation.deleteMany({ where: { instanceId: instance.id } })
  await prisma.instance.delete({ where: { id: instance.id } })
  await prisma.package.delete({ where: { id: pkg.id } })
  await prisma.host.deleteMany({ where: { id: { in: [host.id, replacement.id] } } }); await prisma.user.deleteMany({ where: { id: { in: userIds } } }); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
