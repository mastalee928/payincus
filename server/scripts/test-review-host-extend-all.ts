import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Writable } from 'node:stream'
import type { Prisma } from '@prisma/client'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.JWT_SECRET ||= 'extend-all-fixture-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/hosts.js')
const { performRenewal } = await import('../src/db/billing-operations.js')
const { withInstanceBillingMutation } = await import('../src/lib/instance-billing-mutation.js')
const { advisoryTransactionLock, INSTANCE_OPERATION_LOCK_NAMESPACE } = await import('../src/db/advisory-locks.js')
const prefix = `extend-all-${randomUUID().slice(0, 8)}`
const owner = await prisma.user.create({ data: { username: prefix, passwordHash: 'unusable-fixture', role: 'admin' } })
const buyer = await prisma.user.create({ data: { username: prefix + '-buyer', passwordHash: 'unusable-fixture', balance: 100 } })
const other = await prisma.user.create({ data: { username: prefix + '-other', passwordHash: 'unusable-fixture' } })
const ids = [owner.id, buyer.id, other.id]
const host = await prisma.host.create({ data: { userId: owner.id, name: prefix, url: 'https://127.0.0.1:1' } })
const replacement = await prisma.host.create({ data: { userId: other.id, name: prefix + '-replacement', url: 'https://127.0.0.1:2' } })
const pkg = await prisma.package.create({ data: { userId: owner.id, name: prefix, cpuMax: 100, memoryMax: 512, diskMax: 2048 } })
const plan = await prisma.packagePlan.create({ data: { packageId: pkg.id, name: prefix, cpu: 100, memory: 512, disk: 2048,
  portLimit: 1, snapshotLimit: 0, backupLimit: 0, siteLimit: 0, trafficLimit: 0n, price: 1000, billingCycle: 1 } })
const baseExpiry = new Date(Date.now() + 5 * 86400000)
const instance = await prisma.instance.create({ data: { userId: buyer.id, hostId: host.id, packageId: pkg.id, packagePlanId: plan.id,
  name: prefix, incusId: prefix, image: 'fixture/debian', cpu: 100, memory: 512, disk: 2048, status: 'stopped',
  billingPrice: 10, billingCycle: 1, expiresAt: baseExpiry } })
const session = { id: owner.id, role: owner.role, username: owner.username, sid: prefix, iat: Math.floor(Date.now() / 1000) + 1 }
const logs: string[] = []
const stream = new Writable({ write(chunk, _encoding, done) { logs.push(String(chunk)); done() } })
const app = Fastify({ logger: { level: 'warn', stream } })
let authenticated: (() => void) | undefined
app.decorate('authenticate', async (request: any) => {
  request.user = request.headers['x-test-other'] ? { ...session, id: other.id } : { ...session }
  authenticated?.()
})
app.decorate('authenticateUser', app.authenticate); app.decorate('authenticateAdmin', app.authenticate); app.decorate('requireAdmin', async () => {})
const extend = (days: unknown = 7, hostId = host.id) => app.inject({ method: 'POST', url: `/hosts/${hostId}/extend-all`, payload: { days } })
const read = () => prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
const extra = await prisma.instance.create({ data: { userId: other.id, hostId: host.id, packageId: pkg.id, packagePlanId: plan.id,
  name: prefix + '-second', incusId: prefix + '-second', image: 'fixture/debian', cpu: 100, memory: 512, disk: 2048,
  status: 'stopped', expiresAt: baseExpiry } })
const instanceIds = [instance.id, extra.id]
const reset = async () => {
  await prisma.tokenInvalidation.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.update({ where: { id: owner.id }, data: { status: 'active', role: 'admin' } })
  await prisma.host.update({ where: { id: host.id }, data: { userId: owner.id } })
  await prisma.instanceTask.deleteMany({ where: { instanceId: instance.id } })
  await prisma.instanceTransfer.deleteMany({ where: { instanceId: instance.id } })
  await prisma.autoSnapshotOperation.deleteMany({ where: { instanceId: instance.id } })
  await prisma.proxySiteOperation.deleteMany({ where: { instanceId: instance.id } })
  await prisma.instance.update({ where: { id: instance.id }, data: { userId: buyer.id, hostId: host.id, incusId: prefix, packagePlanId: plan.id,
    expiresAt: baseExpiry, status: 'stopped', suspendReason: null, suspendedAt: null, suspendedBy: null,
    provisioningCleanupPending: false, deletionBillingPending: false, version: 0 } })
  await prisma.log.deleteMany({ where: { instanceId: instance.id } })
  await prisma.instance.update({ where: { id: extra.id }, data: { expiresAt: baseExpiry, version: 0 } })
  await prisma.log.deleteMany({ where: { userId: owner.id, action: 'host.batch_extend' } })
  await prisma.inboxMessage.deleteMany({ where: { userId: { in: ids }, eventType: 'instances_batch_extended' } })
}

async function race(mutate: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  let release!: () => void, entered!: (pid: number) => void, rejectReady!: (error: unknown) => void
  const hold = new Promise<void>(resolve => { release = resolve })
  const ready = new Promise<number>((resolve, reject) => { entered = resolve; rejectReady = reject })
  const blocker = prisma.$transaction(async tx => {
    await mutate(tx)
    const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
    entered(row.pid); await hold
  }, { timeout: 15000 })
  void blocker.catch(rejectReady)
  const pid = await ready
  let settled = false, blocked = false
  const operation = extend().then(response => { settled = true; return response })
  try {
    const end = Date.now() + 3500
    while (!settled && Date.now() < end) {
      const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`
      if (Number(row.count)) { blocked = true; break }
      await delay(20)
    }
  } finally { release(); await blocker }
  return { response: await operation, blocked }
}

async function assertUnextended() {
  for (const row of await prisma.instance.findMany({ where: { id: { in: instanceIds } } })) {
    assert.equal(row.expiresAt?.getTime(), baseExpiry.getTime())
    assert.equal(row.version, 0)
  }
  assert.equal(await prisma.log.count({ where: { userId: owner.id, action: 'host.batch_extend' } }), 0)
  assert.equal(await prisma.inboxMessage.count({ where: { userId: { in: ids }, eventType: 'instances_batch_extended' } }), 0)
}

async function withFault(table: 'instances' | 'logs' | 'inbox_messages', condition: string, action: () => Promise<void>) {
  const trigger = `extend_all_${randomUUID().replaceAll('-', '')}`
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'fixture-extension-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE ${table === 'instances' ? 'UPDATE' : 'INSERT'} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  try { await action() } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON ${table}`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
  }
}

let failure: unknown
try {
  await app.register(routes, { prefix: '/hosts' })
  for (const [table, condition] of [
    ['instances', `NEW.id = ${extra.id} AND NEW.expires_at IS DISTINCT FROM OLD.expires_at`],
    ['logs', `NEW.user_id = ${owner.id} AND NEW.action = 'host.batch_extend'`],
    ['inbox_messages', `NEW.user_id = ${other.id} AND NEW.event_type = 'instances_batch_extended'`]
  ] as const) {
    await reset()
    await withFault(table, condition, async () => {
      const response = await extend()
      assert.equal(response.statusCode, 500, response.body)
      assert.match(response.json().error, /核对实例到期时间和操作日志/)
      await assertUnextended()
    })
    const retry = await extend()
    assert.equal(retry.statusCode, 200, retry.body)
    assert.equal(retry.json().extendedCount, 2)
    for (const row of await prisma.instance.findMany({ where: { id: { in: instanceIds } } })) {
      assert.equal(row.expiresAt!.getTime(), baseExpiry.getTime() + 7 * 86400000)
      assert.equal(row.version, 1)
    }
  }
  console.log('PASS second expiry write, batch audit and second inbox faults roll back the complete batch; retry extends once')

  await reset()
  const renewedExpiry = new Date(baseExpiry.getTime() + 30 * 86400000)
  const renewed = await race(tx => tx.instance.update({ where: { id: instance.id }, data: { expiresAt: renewedExpiry, version: { increment: 1 } } }))
  assert.equal(renewed.blocked, true)
  assert.equal(renewed.response.statusCode, 200, renewed.response.body)
  assert.equal((await read()).expiresAt!.getTime(), renewedExpiry.getTime() + 7 * 86400000)
  assert.equal((await read()).version, 2)
  console.log('PASS current expiry is re-read after the real PostgreSQL row lock wait')

  for (const mode of ['instance-owner', 'host', 'incus', 'plan', 'deleted', 'banned', 'role', 'session', 'all-sessions']) {
    await reset()
    const result = await race(async tx => {
      if (['banned', 'role', 'session', 'all-sessions'].includes(mode)) {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${owner.id} FOR UPDATE`
        if (mode === 'banned') await tx.user.update({ where: { id: owner.id }, data: { status: 'banned' } })
        else if (mode === 'role') await tx.user.update({ where: { id: owner.id }, data: { role: 'user' } })
        else await tx.tokenInvalidation.create({ data: { userId: owner.id, sessionId: mode === 'session' ? prefix : '__USER_LEVEL__', invalidatedAt: session.iat } })
      } else await tx.instance.update({ where: { id: instance.id }, data: mode === 'instance-owner' ? { userId: other.id }
        : mode === 'host' ? { hostId: replacement.id } : mode === 'incus' ? { incusId: prefix + '-changed' }
          : mode === 'plan' ? { packagePlanId: null } : { status: 'deleted' } })
    })
    assert.equal(result.blocked, true, mode)
    assert.equal(result.response.statusCode, ['banned', 'role', 'session', 'all-sessions'].includes(mode) ? 403 : 409, result.response.body)
    await assertUnextended()
  }
  await reset()
  const movedHost = await race(tx => tx.host.update({ where: { id: host.id }, data: { userId: other.id } }))
  assert.equal(movedHost.blocked, true)
  assert.equal(movedHost.response.statusCode, 200, 'current admin may extend a host owned by another user')
  console.log('PASS current instance identity and administrator status/role/session revocation; admin remains able to extend another owner host')

  for (const mode of ['creating', 'cleanup', 'billing-pending', 'task', 'transfer', 'snapshot', 'proxy']) {
    await reset()
    if (mode === 'task') await prisma.instanceTask.create({ data: { instanceId: instance.id, userId: buyer.id, hostId: host.id, taskType: 'rebuild' } })
    else if (mode === 'transfer') await prisma.instanceTransfer.create({ data: { instanceId: instance.id, fromUserId: buyer.id, toUserId: other.id, snapshot: {} } })
    else if (mode === 'snapshot') await prisma.autoSnapshotOperation.create({ data: { id: randomUUID(), instanceId: instance.id,
      ownerId: buyer.id, hostId: host.id, incusId: prefix, identityHash: 'fixture', snapshotName: randomUUID() } })
    else if (mode === 'proxy') await prisma.proxySiteOperation.create({ data: { id: randomUUID(), siteId: 0, siteKey: randomUUID(),
      instanceId: instance.id, hostId: host.id, ownerId: buyer.id, actorId: buyer.id, actorSid: prefix, actorIat: 1,
      authority: 'user', identityHash: 'fixture', incusId: prefix, revision: 1, action: 'upsert', desiredConfig: {}, requestHash: 'fixture' } })
    else await prisma.instance.update({ where: { id: instance.id }, data: mode === 'creating' ? { status: 'creating' }
      : mode === 'cleanup' ? { provisioningCleanupPending: true } : { deletionBillingPending: true } })
    assert.equal((await extend()).statusCode, 409, mode)
    await assertUnextended()
  }
  for (const mode of ['creating', 'cleanup', 'billing-pending', 'task', 'transfer', 'snapshot', 'proxy']) {
    await reset()
    const result = await race(async tx => {
      await tx.$queryRaw`SELECT id FROM instances WHERE id = ${instance.id} FOR UPDATE`
      if (mode === 'task') await tx.instanceTask.create({ data: { instanceId: instance.id, userId: buyer.id, hostId: host.id, taskType: 'rebuild' } })
      else if (mode === 'transfer') await tx.instanceTransfer.create({ data: { instanceId: instance.id, fromUserId: buyer.id, toUserId: other.id, snapshot: {} } })
      else if (mode === 'snapshot') await tx.autoSnapshotOperation.create({ data: { id: randomUUID(), instanceId: instance.id,
        ownerId: buyer.id, hostId: host.id, incusId: prefix, identityHash: 'fixture', snapshotName: randomUUID() } })
      else if (mode === 'proxy') await tx.proxySiteOperation.create({ data: { id: randomUUID(), siteId: 0, siteKey: randomUUID(),
        instanceId: instance.id, hostId: host.id, ownerId: buyer.id, actorId: buyer.id, actorSid: prefix, actorIat: 1,
        authority: 'user', identityHash: 'fixture', incusId: prefix, revision: 1, action: 'upsert', desiredConfig: {}, requestHash: 'fixture' } })
      else await tx.instance.update({ where: { id: instance.id }, data: mode === 'creating' ? { status: 'creating' }
        : mode === 'cleanup' ? { provisioningCleanupPending: true } : { deletionBillingPending: true } })
    })
    assert.equal(result.blocked, true, mode)
    assert.equal(result.response.statusCode, 409, mode)
    await assertUnextended()
  }
  await reset()
  assert.equal((await race(tx => advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, extra.id))).response.statusCode, 409)
  await assertUnextended()
  console.log('PASS busy/cleanup/task/transfer/snapshot/proxy operations reject the whole batch with zero writes')

  for (const reason of ['manual', 'expired']) {
    await reset()
    const suspendedAt = new Date()
    const expiresAt = new Date(Date.now() - 30 * 86400000)
    const result = await race(tx => tx.instance.update({ where: { id: instance.id }, data: { status: 'suspended',
      suspendReason: reason, suspendedAt, suspendedBy: owner.id, expiresAt } }))
    assert.equal(result.response.statusCode, 200)
    const current = await read()
    assert.equal(current.expiresAt!.getTime(), expiresAt.getTime() + 7 * 86400000, 'admin extension uses original expiry, even if still expired')
    assert.equal(current.status, 'suspended')
    assert.equal(current.suspendReason, reason)
    assert.equal(current.suspendedBy, owner.id)
    assert.equal(current.suspendedAt!.getTime(), suspendedAt.getTime())
  }
  await reset()
  const concurrent = await Promise.all(Array.from({ length: 6 }, () => extend()))
  assert.ok(concurrent.every(response => response.statusCode === 200 && response.json().extendedCount === 2))
  for (const row of await prisma.instance.findMany({ where: { id: { in: instanceIds } } })) {
    assert.equal(row.expiresAt!.getTime(), baseExpiry.getTime() + 6 * 7 * 86400000)
    assert.equal(row.version, 6)
  }
  assert.equal(await prisma.log.count({ where: { userId: owner.id, action: 'host.batch_extend' } }), 6)
  assert.equal(await prisma.inboxMessage.count({ where: { userId: { in: ids }, eventType: 'instances_batch_extended' } }), 12)
  assert.equal(await prisma.balanceLog.count({ where: { userId: { in: ids } } }), 0)
  assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: { in: instanceIds } } }), 0)
  console.log('PASS original expiry and suspension preserved; six concurrent batches add six increments and zero financial entries')

  await reset()
  let releaseLane!: () => void, enterLane!: () => void
  const laneHold = new Promise<void>(resolve => { releaseLane = resolve }), laneReady = new Promise<void>(resolve => { enterLane = resolve })
  const lane = withInstanceBillingMutation(instance.id, async () => { enterLane(); await laneHold })
  await laneReady
  const buyerSession = { id: buyer.id, sid: prefix + '-buyer-session', iat: session.iat }
  const paidRenewal = performRenewal(buyer.id, await read(), 1, undefined, buyerSession)
  let settled = false
  const authReady = new Promise<void>(resolve => { authenticated = resolve })
  const queued = extend().then(response => { settled = true; return response })
  try {
    await authReady; await delay(150)
    assert.equal(settled, false)
    assert.equal((await read()).expiresAt!.getTime(), baseExpiry.getTime())
  } finally { authenticated = undefined; releaseLane(); await lane }
  const paid = await paidRenewal
  assert.equal((await queued).statusCode, 200)
  assert.equal((await read()).expiresAt!.getTime(), paid.newExpiresAt.getTime() + 7 * 86400000)
  assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: instance.id } }), 1)
  assert.equal(await prisma.balanceLog.count({ where: { userId: buyer.id } }), 1)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), 90)
  await assert.rejects(performRenewal(buyer.id, instance, 1, undefined, buyerSession), /实例状态已变更/)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), 90)
  console.log('PASS actual paid renewal and expiry lane; extension preserves paid time and stale renewal cannot debit twice')

  await reset()
  // Email channels fail immediately without outbound network calls.
  const channel = await prisma.notificationChannel.create({ data: { userId: buyer.id, type: 'email', name: prefix, config: {} } })
  try {
    const result = await extend()
    assert.equal(result.statusCode, 200, result.body)
    assert.equal(result.json().success, true)
    assert.equal(result.json().extendedCount, 2)
    assert.equal((await read()).version, 1)
    assert.equal(await prisma.notificationLog.count({ where: { channelId: channel.id, status: 'failed' } }), 1)
    assert.ok(logs.some(line => line.includes('external notifications failed') && JSON.parse(line).failed === 1))
    assert.equal(await prisma.inboxMessage.count({ where: { userId: buyer.id, eventType: 'instances_batch_extended' } }), 1, 'committed inbox is never duplicated by notification delivery')
  } finally { await prisma.notificationChannel.delete({ where: { id: channel.id } }) }
  console.log('PASS failed external delivery records its failure without failing a committed extension or duplicating its inbox')

  await reset()
  for (const days of [0, -1, 366, 1.5, null, {}, [], 'invalid']) {
    assert.equal((await extend(days)).statusCode, 400, String(days))
    await assertUnextended()
  }
  assert.equal((await extend(365)).json().extendedCount, 2)
  await reset()
  const empty = await extend(7, replacement.id)
  assert.equal(empty.statusCode, 200)
  assert.equal(empty.json().extendedCount, 0)
  await assertUnextended()
  for (const mode of ['free', 'deleted', 'no-expiry']) {
    await reset()
    await prisma.instance.update({ where: { id: instance.id }, data: mode === 'free' ? { packagePlanId: null }
      : mode === 'deleted' ? { status: 'deleted' } : { expiresAt: null } })
    assert.equal((await extend()).json().extendedCount, 1)
    assert.equal((await read()).version, 0)
  }
  await reset()
  await prisma.user.update({ where: { id: owner.id }, data: { role: 'user' } })
  assert.equal((await extend()).statusCode, 403)
  await assertUnextended()
  console.log('PASS day bounds, 365 maximum, zero targets, free/deleted/no-expiry exclusions and non-admin rejection')
} catch (error) { failure = error } finally {
  await app.close()
  await prisma.autoSnapshotOperation.deleteMany({ where: { instanceId: { in: instanceIds } } })
  await prisma.proxySiteOperation.deleteMany({ where: { instanceId: { in: instanceIds } } })
  await prisma.balanceLog.deleteMany({ where: { userId: { in: ids } } })
  await prisma.instance.deleteMany({ where: { id: { in: instanceIds } } })
  await prisma.package.delete({ where: { id: pkg.id } })
  await prisma.host.deleteMany({ where: { id: { in: [host.id, replacement.id] } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } }); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
