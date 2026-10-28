import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { Prisma } from '@prisma/client'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.JWT_SECRET ||= 'gift-days-fixture-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/hosts.js')
const { performRenewal } = await import('../src/db/billing-operations.js')
const { withInstanceBillingMutation } = await import('../src/lib/instance-billing-mutation.js')
const { advisoryTransactionLock, INSTANCE_OPERATION_LOCK_NAMESPACE } = await import('../src/db/advisory-locks.js')
const prefix = `gift-days-${randomUUID().slice(0, 8)}`
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
const app = Fastify()
let authenticated: (() => void) | undefined
app.decorate('authenticate', async (request: any) => {
  request.user = request.headers['x-test-other'] ? { ...session, id: other.id } : { ...session }
  authenticated?.()
})
app.decorate('authenticateUser', app.authenticate); app.decorate('authenticateAdmin', app.authenticate); app.decorate('requireAdmin', async () => {})
const gift = (days = 7, instanceIds = [instance.id]) => app.inject({ method: 'POST', url: `/hosts/${host.id}/instances/gift-days`, payload: { days, instanceIds } })
const read = () => prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
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
}
async function race(mutate: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  let release!: () => void, entered!: (pid: number) => void, rejectReady!: (error: unknown) => void
  const hold = new Promise<void>(resolve => { release = resolve }), ready = new Promise<number>((resolve, reject) => { entered = resolve; rejectReady = reject })
  const blocker = prisma.$transaction(async tx => {
    await mutate(tx)
    const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
    entered(row.pid); await hold
  }, { timeout: 15000 })
  void blocker.catch(rejectReady)
  const pid = await ready
  let settled = false, blocked = false
  const operation = gift().then(response => { settled = true; return response })
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
const assertFailed = (response: Awaited<ReturnType<typeof gift>>) => {
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(response.json().successCount, 0, response.body)
  assert.equal(response.json().failedCount, 1, response.body)
}
let failure: unknown
try {
  await app.register(routes, { prefix: '/hosts' })
  const renewedExpiry = new Date(baseExpiry.getTime() + 30 * 86400000)
  const renewed = await race(tx => tx.instance.update({ where: { id: instance.id }, data: { expiresAt: renewedExpiry, version: { increment: 1 } } }))
  assert.equal(renewed.response.json().successCount, 1, renewed.response.body)
  assert.equal((await read()).expiresAt!.getTime(), renewedExpiry.getTime() + 7 * 86400000, 'gift extends latest paid expiry, never the stale selected expiry')
  assert.equal(renewed.blocked, true)
  console.log('PASS gift concurrent expiry extension')
  for (const mode of ['instance-owner', 'host', 'incus', 'plan', 'deleted', 'host-owner', 'banned', 'session', 'all-sessions']) {
    await reset()
    const result = await race(async tx => {
      if (mode === 'host-owner') await tx.host.update({ where: { id: host.id }, data: { userId: other.id } })
      else if (mode === 'banned' || mode === 'session' || mode === 'all-sessions') {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${owner.id} FOR UPDATE`
        if (mode === 'banned') await tx.user.update({ where: { id: owner.id }, data: { status: 'banned' } })
        else await tx.tokenInvalidation.create({ data: { userId: owner.id, sessionId: mode === 'session' ? prefix : '__USER_LEVEL__', invalidatedAt: session.iat } })
      } else await tx.instance.update({ where: { id: instance.id }, data: mode === 'instance-owner' ? { userId: other.id }
        : mode === 'host' ? { hostId: replacement.id } : mode === 'incus' ? { incusId: prefix + '-changed' }
          : mode === 'plan' ? { packagePlanId: null } : { status: 'deleted' } })
    })
    assert.equal(result.blocked, true, mode)
    assertFailed(result.response)
    assert.equal((await read()).expiresAt!.getTime(), baseExpiry.getTime(), mode)
    assert.equal(await prisma.log.count({ where: { instanceId: instance.id, action: 'instance.gift_days', result: 'success' } }), 0)
  }
  console.log('PASS gift in-flight owner/host/incus/plan/deletion and account/session revocation')
  for (const reason of ['manual', 'expired']) {
    await reset()
    const suspendedAt = new Date()
    const result = await race(tx => tx.instance.update({ where: { id: instance.id }, data: { status: 'suspended',
      suspendReason: reason, suspendedAt, suspendedBy: reason === 'manual' ? owner.id : null } }))
    assert.equal(result.response.json().successCount, 1)
    const current = await read()
    assert.equal(current.status, reason === 'manual' ? 'suspended' : 'stopped')
    assert.equal(current.suspendReason, reason === 'manual' ? 'manual' : null)
    assert.equal(current.suspendedBy, reason === 'manual' ? owner.id : null)
    assert.equal(current.suspendedAt?.getTime() ?? null, reason === 'manual' ? suspendedAt.getTime() : null)
  }
  for (const mode of ['expired', 'no-expiry']) {
    await reset(); await prisma.instance.update({ where: { id: instance.id }, data: { expiresAt: mode === 'expired' ? new Date(Date.now() - 86400000) : null } })
    const start = Date.now()
    assert.equal((await gift()).json().successCount, 1)
    const value = (await read()).expiresAt!.getTime() - 7 * 86400000
    assert.ok(value >= start && value <= Date.now(), mode)
  }
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
    assertFailed(await gift())
    assert.equal((await read()).expiresAt!.getTime(), baseExpiry.getTime(), mode)
  }
  await reset()
  assertFailed((await race(tx => advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instance.id))).response)
  await reset()
  const gifts = await Promise.all(Array.from({ length: 6 }, () => gift()))
  assert.ok(gifts.every(response => response.json().successCount === 1), gifts.map(response => response.body).join(';'))
  assert.equal((await read()).expiresAt!.getTime(), baseExpiry.getTime() + 6 * 7 * 86400000)
  assert.equal((await read()).version, 6)
  assert.equal(await prisma.log.count({ where: { instanceId: instance.id, action: 'instance.gift_days' } }), 6)
  assert.equal(await prisma.balanceLog.count({ where: { userId: { in: ids } } }), 0, 'gifts do not charge or refund')
  assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: instance.id } }), 0)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), 100)
  console.log('PASS current suspension, expired/unset base, pending workflows, additive concurrent gifts and zero financial writes')

  await reset()
  // Queue the real renewal and gift behind the same billing lane, as expiry enforcement does.
  let releaseLane!: () => void, enterLane!: () => void
  const laneHold = new Promise<void>(resolve => { releaseLane = resolve }), laneReady = new Promise<void>(resolve => { enterLane = resolve })
  const lane = withInstanceBillingMutation(instance.id, async () => { enterLane(); await laneHold })
  await laneReady
  const buyerSession = { id: buyer.id, sid: prefix + '-buyer-session', iat: session.iat }
  const paidRenewal = performRenewal(buyer.id, await read(), 1, undefined, buyerSession)
  let giftSettled = false
  const authReady = new Promise<void>(resolve => { authenticated = resolve })
  const queuedGift = gift().then(response => { giftSettled = true; return response })
  try {
    await authReady; await delay(150)
    assert.equal(giftSettled, false, 'gift waits for in-flight billing/expiry action')
    assert.equal((await read()).expiresAt!.getTime(), baseExpiry.getTime())
  } finally { authenticated = undefined; releaseLane(); await lane }
  const paid = await paidRenewal
  assert.equal((await queuedGift).json().successCount, 1)
  assert.equal((await read()).expiresAt!.getTime(), paid.newExpiresAt.getTime() + 7 * 86400000)
  assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: instance.id } }), 1)
  assert.equal(await prisma.balanceLog.count({ where: { userId: buyer.id } }), 1)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), 90)
  await assert.rejects(performRenewal(buyer.id, instance, 1, undefined, buyerSession), /实例状态已变更/)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), 90, 'stale renewal cannot debit after gift consumes version')
  console.log('PASS actual paid renewal plus gift preserve paid end, billing lane and single debit')

  await reset()
  const trigger = `gift_days_${randomUUID().replaceAll('-', '')}`
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.instance_id = ${instance.id} AND NEW.action = 'instance.gift_days' THEN RAISE EXCEPTION 'fixture-gift-log-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  try {
    assertFailed(await gift())
    assert.equal((await read()).expiresAt!.getTime(), baseExpiry.getTime(), 'audit failure rolls back gifted expiry')
    assert.equal((await read()).version, 0)
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON logs`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
  }
  for (const days of [0, -1, 366, 1.5]) assert.equal((await gift(days)).statusCode, 400)
  assert.equal((await gift(365)).json().successCount, 1)
  assert.equal((await app.inject({ method: 'POST', url: `/hosts/${host.id}/instances/gift-days`, headers: { 'x-test-other': '1' },
    payload: { days: 7, instanceIds: [instance.id] } })).statusCode, 403)
  assert.equal(await prisma.balanceLog.count({ where: { userId: buyer.id } }), 1, 'only the prior real renewal created a financial entry')
  await reset()
  await prisma.user.update({ where: { id: owner.id }, data: { role: 'user' } })
  assert.equal((await gift(1)).json().successCount, 1, 'regular host owner can still gift days')
  const extra = await prisma.instance.create({ data: { userId: buyer.id, hostId: host.id, packageId: pkg.id, packagePlanId: plan.id,
    name: prefix + '-busy', incusId: prefix + '-busy', image: 'fixture', cpu: 100, memory: 512, disk: 2048,
    status: 'stopped', expiresAt: baseExpiry, provisioningCleanupPending: true } })
  const free = await prisma.instance.create({ data: { userId: buyer.id, hostId: host.id, name: prefix + '-free', incusId: prefix + '-free',
    image: 'fixture', cpu: 100, memory: 512, disk: 2048, status: 'stopped' } })
  try {
    const batch = await gift(1, [instance.id, extra.id, free.id])
    assert.equal(batch.statusCode, 200)
    assert.equal(batch.json().successCount, 1)
    assert.equal(batch.json().failedCount, 1)
    assert.equal(batch.json().skippedCount, 1)
    assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: extra.id } })).expiresAt!.getTime(), baseExpiry.getTime())
    assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: free.id } })).expiresAt, null)
  } finally { await prisma.instance.deleteMany({ where: { id: { in: [extra.id, free.id] } } }) }
  console.log('PASS transactional audit rollback, day bounds, maximum and non-owner rejection')
} catch (error) { failure = error } finally {
  await app.close()
  await prisma.autoSnapshotOperation.deleteMany({ where: { instanceId: instance.id } })
  await prisma.proxySiteOperation.deleteMany({ where: { instanceId: instance.id } })
  await prisma.balanceLog.deleteMany({ where: { userId: { in: ids } } })
  await prisma.instance.delete({ where: { id: instance.id } })
  await prisma.package.delete({ where: { id: pkg.id } })
  await prisma.host.deleteMany({ where: { id: { in: [host.id, replacement.id] } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } }); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
