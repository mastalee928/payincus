import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Client } from 'pg'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const { prisma, closePrismaDatabase, getDbPoolStats } = await import('../src/db/prisma.js')
const billing = await import('../src/db/billing-operations.js')
const holder = new Client({ connectionString: database.href }), monitor = new Client({ connectionString: database.href })
const tag = 'renew-selection-' + randomUUID(), userIds: number[] = []
let hostId: number | undefined, packageId: number | undefined, failure: unknown
const capture = <T>(promise: Promise<T>) => promise.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }))
const pending = new Set<Promise<unknown>>()
const track = <T>(promise: Promise<T>) => { pending.add(promise); void promise.finally(() => pending.delete(promise)); return promise }
const wait = async (condition: () => Promise<boolean> | boolean, label: string) => {
  const deadline = Date.now() + 3000
  while (!await condition()) { if (Date.now() > deadline) throw Error('Timed out: ' + label); await delay(10) }
}
try {
  await holder.connect(); await monitor.connect()
  const buyer = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture', balance: 100 } }); userIds.push(buyer.id)
  const owner = await prisma.user.create({ data: { username: tag + '-owner', passwordHash: 'unusable-fixture', role: 'admin' } }); userIds.push(owner.id)
  const host = await prisma.host.create({ data: { userId: owner.id, name: tag, url: 'https://127.0.0.1:1' } }); hostId = host.id
  const pkg = await prisma.package.create({ data: { userId: owner.id, name: tag, cpuMax: 100, memoryMax: 1024, diskMax: 2048 } }); packageId = pkg.id
  const plan = await prisma.packagePlan.create({ data: { packageId: pkg.id, name: tag, cpu: 100, memory: 1024, disk: 2048,
    portLimit: 1, snapshotLimit: 0, backupLimit: 0, siteLimit: 0, trafficLimit: 0, price: 1000, billingCycle: 1 } })
  const session = { sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }, automatic = { expiryThreshold: new Date(Date.now() + 7 * 86400000) }
  const make = (status: 'running' | 'stopped' | 'suspended' = 'stopped') => prisma.instance.create({ data: {
    userId: buyer.id, hostId: host.id, packageId: pkg.id, packagePlanId: plan.id, name: tag + randomUUID(), incusId: tag + randomUUID(),
    image: 'fixture', cpu: 100, memory: 1024, disk: 2048, billingPrice: 10, billingCycle: 1, autoRenew: true, status,
    expiresAt: new Date(Date.now() + (status === 'suspended' ? -1 : 1) * 86400000),
    ...(status === 'suspended' ? { suspendReason: 'expired', suspendedAt: new Date() } : {})
  } })
  const state = async () => ({
    users: await prisma.user.findMany({ where: { id: { in: userIds } }, orderBy: { id: 'asc' } }),
    instances: await prisma.instance.findMany({ where: { hostId: host.id }, orderBy: { id: 'asc' } }),
    ledger: await prisma.balanceLog.findMany({ where: { userId: { in: userIds } }, orderBy: { id: 'asc' } }),
    bills: await prisma.instanceBillingRecord.findMany({ where: { userId: { in: userIds } }, orderBy: { id: 'asc' } }),
    inbox: await prisma.inboxMessage.findMany({ where: { userId: { in: userIds } }, orderBy: { id: 'asc' } })
  })
  for (const status of ['running', 'stopped', 'suspended'] as const) {
    const old = await make(status)
    await billing.updateAutoRenew(old.id, false, buyer.id, session)
    const before = await state()
    for (let repeat = 0; repeat < 3; repeat++) {
      await assert.rejects(billing.performRenewal(buyer.id, old, 1, automatic), /实例状态已变更/)
      assert.deepEqual(await state(), before)
    }
    await billing.updateAutoRenew(old.id, true, buyer.id, session)
    const fresh = await prisma.instance.findUniqueOrThrow({ where: { id: old.id } })
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => billing.performRenewal(buyer.id, fresh, 1, automatic)))
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: old.id } }), 1)
    assert.equal(await prisma.balanceLog.count({ where: { instanceId: old.id } }), 1)
    console.log('PASS disabled old selection rejected three times with exact rollback; re-enabled eight concurrent requests debit once', status)
  }
  const inFlight = await make()
  await holder.query('BEGIN'); await holder.query('SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE', [buyer.id])
  const { rows: [holding] } = await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
  const renewal = track(capture(billing.performRenewal(buyer.id, inFlight, 1, automatic)))
  try {
    await wait(async () => (await monitor.query('SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [holding.pid])).rows.length > 0,
      'renewal holds the instance lock and waits for the user balance')
    await assert.rejects(billing.updateAutoRenew(inFlight.id, false, buyer.id, session), /实例正在处理/)
    assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: inFlight.id } })).autoRenew, true)
  } finally { await holder.query('COMMIT') }
  assert.ok((await renewal).ok)
  await billing.updateAutoRenew(inFlight.id, false, buyer.id, session)
  const afterDisable = await state()
  const current = await prisma.instance.findUniqueOrThrow({ where: { id: inFlight.id } })
  await assert.rejects(billing.performRenewal(buyer.id, current, 1, { expiryThreshold: new Date(Date.now() + 60 * 86400000) }), /实例状态已变更/)
  assert.deepEqual(await state(), afterDisable)
  console.log('PASS in-flight renewal conflicts with disable instead of reporting false success; disable after settlement blocks further charges')

  for (const change of [{ autoRenewAttempts: 3 }, { lastAutoRenewAttemptAt: new Date() }, { deletionBillingPending: true },
    { provisioningCleanupPending: true }, { status: 'suspended' as const, suspendReason: 'manual', suspendedBy: owner.id }]) {
    const old = await make()
    await prisma.instance.update({ where: { id: old.id }, data: change })
    const before = await state()
    await assert.rejects(billing.performRenewal(buyer.id, old, 1, automatic), /实例状态已变更/)
    assert.deepEqual(await state(), before)
  }
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), 60)
  assert.equal(await prisma.instanceBillingRecord.count({ where: { userId: buyer.id } }), 4)
  assert.equal(await prisma.balanceLog.count({ where: { userId: buyer.id } }), 4)
  await wait(() => { const stats = getDbPoolStats(); return stats.idleCount === stats.totalCount && stats.waitingCount === 0 }, 'pool fully reclaimed')
  assert.equal(Number((await monitor.query(`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state LIKE 'idle in transaction%'`)).rows[0].count), 0)
  console.log('PASS retry ceiling, retry spacing, cleanup and manual suspension preserve all records; 4 exact renewals, balance 60, no idle transaction')
} catch (error) { failure = error }
finally {
  await holder.query('ROLLBACK').catch(() => undefined); await Promise.allSettled([...pending])
  await prisma.log.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.balanceLog.deleteMany({ where: { userId: { in: userIds } } })
  if (hostId) await prisma.instance.deleteMany({ where: { hostId } })
  if (packageId) await prisma.package.delete({ where: { id: packageId } })
  if (hostId) await prisma.host.delete({ where: { id: hostId } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await holder.end(); await monitor.end(); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
