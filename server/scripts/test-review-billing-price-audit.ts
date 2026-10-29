import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { Prisma } from '@prisma/client'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) &&
  /^\/[a-zA-Z0-9_]+_pool_test$/.test(database.pathname) && !database.search && !database.hash)
process.env.JWT_SECRET ||= 'billing-price-audit-fixture-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/admin-billing.js')
const prefix = `price-audit-${randomUUID().slice(0, 8)}`
const owner = await prisma.user.create({ data: { username: prefix, passwordHash: 'unusable-fixture', balance: 1000 } })
const admin = await prisma.user.create({ data: { username: prefix + '-admin', passwordHash: 'unusable-fixture', role: 'admin' } })
const host = await prisma.host.create({ data: { userId: admin.id, name: prefix, url: 'https://127.0.0.1:1' } })
const pack = await prisma.package.create({ data: { userId: admin.id, name: prefix, cpuMax: 400, memoryMax: 4096, diskMax: 40960 } })
const plan = await prisma.packagePlan.create({ data: { packageId: pack.id, name: prefix, cpu: 100, memory: 512, disk: 1024,
  portLimit: 20, snapshotLimit: 1, backupLimit: 1, siteLimit: 1, trafficLimit: 1000n, price: 1000 } })
const now = Date.now(), expires = new Date(now + 15 * 86400000)
const instances = await Promise.all([1, 2].map(number => prisma.instance.create({ data: {
  userId: owner.id, hostId: host.id, packageId: pack.id, packagePlanId: plan.id,
  incusId: `${prefix}-${number}`, name: `${prefix}-${number}`, image: 'fixture', status: 'running',
  cpu: 100, memory: 512, disk: 1024, billingPrice: 10, billingCycle: 1, expiresAt: expires,
  dedicatedIpv4: true, dedicatedNetworkReady: true,
} })))
const ids = instances.map(item => item.id), actors = [owner.id, admin.id]
let actor = { id: admin.id, role: 'admin', username: admin.username, sid: prefix, iat: Math.floor(now / 1000) }
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = { ...actor } })
app.decorate('requireAdmin', async () => {})
app.decorate('authenticateAdmin', app.authenticate)
const trigger = 'price_audit_' + randomUUID().replaceAll('-', '')
const reset = async () => {
  actor = { id: admin.id, role: 'admin', username: admin.username, sid: prefix, iat: Math.floor(now / 1000) }
  await prisma.user.update({ where: { id: admin.id }, data: { status: 'active', role: 'admin' } })
  await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } })
  await prisma.instance.updateMany({ where: { id: { in: ids } }, data: { billingPrice: 10, version: 0, expiresAt: expires, status: 'running', packagePlanId: plan.id } })
  await prisma.user.update({ where: { id: owner.id }, data: { balance: 1000 } })
  await prisma.balanceLog.deleteMany({ where: { userId: owner.id } })
  await prisma.instanceBillingRecord.deleteMany({ where: { instanceId: { in: ids } } })
  await prisma.log.deleteMany({ where: { userId: { in: actors } } })
  await prisma.instanceBillingRecord.createMany({ data: ids.map(instanceId => ({ instanceId, userId: owner.id, type: 'newPurchase' as const,
    amount: 10, months: 1, periodStart: new Date(now - 16 * 86400000), periodEnd: expires })) })
}
const snapshot = async () => ({
  instances: await prisma.instance.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' }, select: { id: true, version: true, billingPrice: true, expiresAt: true, dedicatedIpv4: true } }),
  balance: (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).balance,
  balanceLogs: await prisma.balanceLog.count({ where: { userId: owner.id } }),
  billingRecords: await prisma.instanceBillingRecord.count({ where: { instanceId: { in: ids } } }),
})
async function race(kind: string, mutate: (tx: Prisma.TransactionClient) => Promise<unknown>, target = 'admin') {
  let release!: () => void, entered!: (pid: number) => void, rejectReady!: (error: unknown) => void
  const hold = new Promise<void>(resolve => { release = resolve })
  const ready = new Promise<number>((resolve, reject) => { entered = resolve; rejectReady = reject })
  const blocker = prisma.$transaction(async tx => {
    if (target === 'admin') await tx.$queryRaw`SELECT id FROM users WHERE id = ${admin.id} FOR UPDATE`
    else await tx.$queryRaw`SELECT id FROM instances WHERE id = ${ids[0]} FOR UPDATE`
    await mutate(tx)
    const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
    entered(row.pid); await hold
  }, { timeout: 15000 })
  void blocker.catch(rejectReady)
  const pid = await ready
  let settled = false, blocked = false
  const operation = submit(kind, true).then(response => { settled = true; return response })
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
const submit = (kind: string, settleBalance: boolean, newPrice = 20) => app.inject({ method: 'POST',
  url: kind === 'single' ? `/api/admin/instances/${ids[0]}/update-price` : '/api/admin/instances/batch-update-price',
  payload: kind === 'single' ? { newPrice, settleBalance, expectedVersion: 0 } : {
    instanceIds: ids, newPrice, settleBalance, expectations: ids.map(instanceId => ({ instanceId, version: 0 })),
  },
})
let failure: unknown
try {
  await app.register(routes); await app.ready()
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = ${admin.id} AND NEW.action IN ('instance.admin_update_price', 'instance.admin_batch_update_price') THEN RAISE EXCEPTION 'fixture price audit unavailable'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  for (const kind of ['single', 'batch']) for (const settle of [false, true]) for (const price of [0, 20]) {
    await reset(); const before = await snapshot()
    const result = await submit(kind, settle, price)
    assert.equal(result.statusCode, 500, `${kind}/${settle}/${price} audit failure must reject the write`)
    assert.deepEqual(await snapshot(), before, 'audit failure rolls back price, version, balance and billing records together')
    assert.equal(await prisma.log.count({ where: { userId: admin.id } }), 0)
  }
  await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON logs`)
  for (const kind of ['single', 'batch']) for (const settle of [false, true]) for (const price of [0, 20]) {
    await reset(); const result = await submit(kind, settle, price)
    assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().success, true)
    const saved = await snapshot(), changed = kind === 'single' ? 1 : 2
    for (const item of saved.instances) {
      assert.equal(Number(item.billingPrice), kind === 'single' && item.id !== ids[0] ? 10 : price)
      assert.equal(item.version, kind === 'single' && item.id !== ids[0] ? 0 : 1)
      assert.equal(item.dedicatedIpv4, true); assert.equal(item.expiresAt!.getTime(), expires.getTime())
    }
    const action = kind === 'single' ? 'instance.admin_update_price' : 'instance.admin_batch_update_price'
    const logs = await prisma.log.findMany({ where: { userId: admin.id, action } })
    assert.equal(logs.length, 1); assert.equal(logs[0].result, 'success')
    if (kind === 'single') assert.equal(logs[0].instanceId, ids[0])
    assert.equal(saved.balanceLogs, settle ? changed : 0)
    assert.equal(saved.billingRecords, 2 + (settle ? changed : 0))
    const balanceLogs = await prisma.balanceLog.findMany({ where: { userId: owner.id }, orderBy: { id: 'asc' } })
    let expected = 1000
    for (const log of balanceLogs) {
      assert.equal(Number(log.amount) < 0, price > 10, 'settlement direction agrees with the adjusted price')
      assert.equal(log.type, price > 10 ? 'consume' : 'refund')
      assert.equal(Number(log.balanceBefore), expected)
      expected = Number((expected + Number(log.amount)).toFixed(2)); assert.equal(Number(log.balanceAfter), expected)
    }
    assert.equal(Number(saved.balance), expected)
    const repeat = await submit(kind, settle, price)
    assert.equal(repeat.statusCode, 409, 'old version cannot repeat settlement')
    assert.deepEqual(await snapshot(), saved)
  }
  for (const kind of ['single', 'batch']) {
    for (const state of ['deleted', 'free']) {
      await reset(); const before = await snapshot()
      const result = await race(kind, tx => tx.instance.update({ where: { id: ids[0] }, data: state === 'deleted' ? { status: 'deleted' } : { packagePlanId: null } }), 'instance')
      assert.equal(result.response.statusCode, 400, `${kind}/${state} changed instance cannot be billed`)
      assert.ok(result.blocked, `${kind}/${state} instance lock serializes validation`)
      assert.deepEqual(await snapshot(), before)
      assert.equal(await prisma.log.count({ where: { userId: admin.id } }), 0)
    }
    await reset(); const before = await snapshot(), result = await submit(kind, true, 10)
    assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().success, true)
    assert.deepEqual(await snapshot(), before, 'unchanged price cannot touch price version, balance or billing records')
    assert.equal(await prisma.log.count({ where: { userId: admin.id } }), kind === 'single' ? 0 : 1)
  }
  console.log('PASS real PG/Fastify single/batch price audit atomic rollback, zero/increase, no-settle/settle, ledger continuity and stale version matrix')
  for (const kind of ['single', 'batch']) {
    for (const state of ['banned', 'demoted', 'session', 'all-sessions']) {
      await reset(); const before = await snapshot()
      const result = await race(kind, async tx => {
        if (state === 'banned') await tx.user.update({ where: { id: admin.id }, data: { status: 'banned' } })
        else if (state === 'demoted') await tx.user.update({ where: { id: admin.id }, data: { role: 'user' } })
        else await tx.tokenInvalidation.create({ data: { userId: admin.id, sessionId: state === 'session' ? prefix : '__USER_LEVEL__', invalidatedAt: actor.iat } })
      })
      assert.equal(result.response.statusCode, 403, `${kind}/${state}: stale authenticated admin must not write`)
      assert.ok(result.blocked, `${kind}/${state}: actual revocation lock must serialize the write`)
      assert.deepEqual(await snapshot(), before)
      assert.equal(await prisma.log.count({ where: { userId: admin.id } }), 0)
    }
    for (const state of ['missing-sid', 'missing-iat', 'demoted', 'banned']) {
      for (const price of [10, 20]) {
        await reset(); const before = await snapshot()
        if (state === 'missing-sid') actor.sid = ''
        if (state === 'missing-iat') actor.iat = 0
        if (state === 'demoted') await prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
        if (state === 'banned') await prisma.user.update({ where: { id: admin.id }, data: { status: 'banned' } })
        assert.equal((await submit(kind, false, price)).statusCode, 403, `${kind}/${state}/${price} current identity is required even for an unchanged price`)
        assert.deepEqual(await snapshot(), before)
        assert.equal(await prisma.log.count({ where: { userId: admin.id } }), 0)
      }
    }
    await reset()
    await prisma.tokenInvalidation.create({ data: { userId: admin.id, sessionId: prefix, invalidatedAt: actor.iat - 1 } })
    assert.equal((await submit(kind, false)).statusCode, 200, 'a token issued after the recorded revocation remains valid')
  }
  console.log('PASS current admin status/role/session and real lock races reject stale writes, including unchanged-price requests')
} catch (error) { failure = error } finally {
  await app.close()
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON logs`)
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`)
  await prisma.log.deleteMany({ where: { userId: { in: actors } } })
  await prisma.balanceLog.deleteMany({ where: { userId: owner.id } })
  await prisma.instance.deleteMany({ where: { id: { in: ids } } })
  await prisma.package.delete({ where: { id: pack.id } }); await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.deleteMany({ where: { id: { in: actors } } }); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
