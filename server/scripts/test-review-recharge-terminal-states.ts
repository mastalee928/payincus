import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Client } from 'pg'
import type { RechargeRecord } from '@prisma/client'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const { prisma, closePrismaDatabase, getDbPoolStats } = await import('../src/db/prisma.js')
const db = await import('../src/db/recharge-records.js')
const observer = new Client({ connectionString: database.href })
// Keep pg_stat_activity observations out of the lock holder's transaction/statistics snapshot.
const monitor = new Client({ connectionString: database.href })
const tag = 'recharge-terminal-' + randomUUID()
const originalFetch = globalThis.fetch
let outbound = 0
globalThis.fetch = async () => { outbound++; throw Error('Unexpected external request in isolated state test') }
type Operation = 'fail' | 'cancel' | 'metadata' | 'expire'
type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown }
const capture = <T>(promise: Promise<T>): Promise<Outcome<T>> => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error }))
const pending = new Set<Promise<unknown>>()
const track = <T>(promise: Promise<T>) => { pending.add(promise); void promise.finally(() => pending.delete(promise)); return promise }
const wait = async (condition: () => Promise<boolean> | boolean, label: string) => {
  const deadline = Date.now() + 3000
  while (!await condition()) { if (Date.now() > deadline) throw Error('Timed out: ' + label); await delay(10) }
}
const mutate = async (operation: Operation, record: RechargeRecord, expected: boolean): Promise<RechargeRecord | number> => {
  const expectedPaymentDetails = expected ? record.paymentDetails as Record<string, unknown> | null : undefined
  const callbackData = { source: 'stale-' + operation }, paymentDetails = { stale: operation }
  if (operation === 'fail') return db.failRecharge(record.orderNo, 'isolated failure', callbackData, paymentDetails, undefined, expectedPaymentDetails)
  if (operation === 'cancel') return db.cancelRecharge(record.orderNo, callbackData, paymentDetails, expectedPaymentDetails)
  if (operation === 'metadata') return db.updateRechargeOrderMetadata(record.orderNo, { tradeNo: 'stale', callbackData, paymentDetails, expectedPaymentDetails })
  return db.expireOrders([record.orderNo])
}
let failure: unknown, providerId: number | undefined, userId: number | undefined
try {
  await observer.connect(); await monitor.connect()
  const user = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } }); userId = user.id
  const provider = await prisma.paymentProvider.create({ data: { name: tag, type: 'yipay', status: 'disabled', config: {} } }); providerId = provider.id
  const create = (status: RechargeRecord['status'], withDetails = false) => prisma.rechargeRecord.create({ data: {
    userId: user.id, providerId: provider.id, orderNo: tag + '-' + randomUUID(), amount: 10, actualAmount: 9, status,
    expiredAt: new Date(Date.now() - 60000), ...(withDetails ? { paymentDetails: { source: 'original' } } : {})
  } })
  const unchanged = async (record: RechargeRecord) => assert.deepEqual(await prisma.rechargeRecord.findUniqueOrThrow({ where: { id: record.id } }), record)
  const ledgerCount = (record: RechargeRecord) => prisma.balanceLog.count({ where: { userId: user.id, orderId: record.orderNo } })
  const failureNotices = (record: RechargeRecord) => prisma.inboxMessage.count({ where: {
    userId: user.id, eventType: 'recharge_failed', data: { path: ['orderNo'], equals: record.orderNo }
  } })
  let credited = 0
  for (const status of ['pending', 'paid'] as const) {
    for (const operation of ['fail', 'cancel', 'metadata', 'expire'] as const) {
      if (status === 'paid' && operation === 'expire') continue
      for (const expected of operation === 'expire' ? [false] : [false, true]) {
        const record = await create(status, expected)
        await observer.query('BEGIN')
        await observer.query('SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE', [user.id])
        const { rows: [holder] } = await observer.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
        const completed = track(capture(db.completeRecharge(record.orderNo, { tradeNo: record.orderNo, actualAmount: 9,
          callbackData: { source: 'settlement' }, ...(expected ? { expectedPaymentDetails: record.paymentDetails as Record<string, unknown> } : {}) })))
        let competing: ReturnType<typeof capture> | undefined
        try {
          let settlementPid = 0
          await wait(async () => {
            const { rows } = await monitor.query<{ pid: number }>('SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [holder.pid])
            settlementPid = rows[0]?.pid || 0; return settlementPid !== 0
          }, 'real settlement blocked at the balance row')
          competing = track(capture(mutate(operation, record, expected)))
          await wait(async () => {
            const { rows } = await monitor.query('SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [settlementPid])
            return rows.length > 0
          }, operation + ' blocked behind the settlement order update')
        } finally { await observer.query('COMMIT') }
        const result = await completed, stale = await competing!
        assert.ok(result.ok, 'settlement must succeed'); assert.equal(result.value.completedNow, true)
        credited += 9
        const { completedNow: _completedNow, ...settled } = result.value
        await unchanged(settled)
        if (expected) { assert.ok(!stale.ok); assert.ok(stale.error instanceof db.RechargePaymentSelectionChangedError) }
        else { assert.ok(stale.ok); if (operation === 'expire') assert.equal(stale.value, 0); else assert.deepEqual(stale.value, settled) }
        assert.equal(await ledgerCount(record), 1); assert.equal(await failureNotices(record), 0)
        assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance), credited)
        assert.equal((await db.completeRecharge(record.orderNo, { actualAmount: 99 })).completedNow, false)
        await unchanged(settled); assert.equal(await ledgerCount(record), 1)
        console.log('PASS settlement wins real row-lock race', status, operation, 'expected', expected)
      }
    }
  }

  for (const status of ['pending', 'paid'] as const) for (const operation of ['fail', 'cancel'] as const) for (const expected of [false, true]) {
    const record = await create(status, expected)
    await observer.query('BEGIN')
    await observer.query('SELECT id FROM recharge_records WHERE id = $1 FOR UPDATE', [record.id])
    const { rows: [holder] } = await observer.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    const first = track(capture(mutate(operation, record, expected)))
    let completing: ReturnType<typeof capture> | undefined
    try {
      await wait(async () => (await monitor.query('SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [holder.pid])).rows.length === 1,
        'first terminal update waits at held row')
      completing = track(capture(db.completeRecharge(record.orderNo, { actualAmount: 9 })))
      await wait(async () => {
        const { rows } = await monitor.query<{ count: string }>(`WITH RECURSIVE blocked(pid) AS (
          SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))
          UNION SELECT activity.pid FROM pg_stat_activity activity JOIN blocked ON blocked.pid = ANY(pg_blocking_pids(activity.pid))
        ) SELECT count(*) FROM blocked`, [holder.pid])
        return Number(rows[0].count) === 2
      }, 'settlement waits behind the first terminal update')
    } finally { await observer.query('COMMIT') }
    const result = await first, settlement = await completing!
    assert.ok(result.ok); assert.ok(!settlement.ok, 'failed/cancelled state must refuse stale settlement')
    const after = await prisma.rechargeRecord.findUniqueOrThrow({ where: { id: record.id } })
    assert.equal(after.status, operation === 'fail' ? 'failed' : 'cancelled'); assert.deepEqual(after, result.value)
    assert.equal(await ledgerCount(record), 0)
    assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance), credited)
    if (operation === 'fail') await wait(async () => await failureNotices(record) === 1, 'failure notification persisted')
    await mutate(operation, record, false); await unchanged(after)
    console.log('PASS terminal update wins real row-lock race', status, operation, 'expected', expected)
  }

  for (const status of ['completed', 'failed', 'cancelled', 'refunded'] as const) {
    const record = await create(status, true)
    for (const operation of ['fail', 'cancel', 'metadata', 'expire'] as const) for (const expected of operation === 'expire' ? [false] : [false, true]) {
      const result = await capture(mutate(operation, record, expected))
      if (expected) { assert.ok(!result.ok); assert.ok(result.error instanceof db.RechargePaymentSelectionChangedError) }
      else assert.ok(result.ok)
      await unchanged(record); assert.equal(await ledgerCount(record), 0); assert.equal(await failureNotices(record), 0)
    }
    console.log('PASS pre-existing terminal row completely preserved', status)
  }
  await wait(() => { const stats = getDbPoolStats(); return stats.waitingCount === 0 && stats.idleCount === stats.totalCount }, 'all application connections returned')
  const { rows: [active] } = await observer.query<{ count: string }>(`SELECT count(*) FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'`)
  assert.equal(Number(active.count), 0); assert.equal(outbound, 0)
  assert.equal(await prisma.inboxMessage.count({ where: { userId: user.id } }), 4)
  assert.equal(await prisma.balanceLog.count({ where: { userId: user.id } }), 13)
  console.log('PASS 21 real lock competitions and 28 terminal no-op checks; exact balance, ledger and notices; no idle transaction or outbound call')
} catch (error) { failure = error }
finally {
  await observer.query('ROLLBACK').catch(() => undefined)
  await Promise.allSettled([...pending])
  if (userId) {
    await wait(() => { const stats = getDbPoolStats(); return stats.waitingCount === 0 && stats.idleCount === stats.totalCount }, 'cleanup waits for notifications').catch(error => { failure ||= error })
    await prisma.log.deleteMany({ where: { userId } }); await prisma.user.delete({ where: { id: userId } })
  }
  if (providerId) await prisma.paymentProvider.delete({ where: { id: providerId } })
  await monitor.end(); await observer.end(); await closePrismaDatabase(); globalThis.fetch = originalFetch
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
