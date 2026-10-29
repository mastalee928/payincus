import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { setTimeout as delay } from 'node:timers/promises'
import type { Prisma } from '@prisma/client'
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && /^\/[a-zA-Z0-9_]+_pool_test$/.test(database.pathname) && !database.search && !database.hash)
process.env.JWT_SECRET ||= 'balance-audit-fixture-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/balance.js')
const prefix = `balance-audit-${randomUUID().slice(0,8)}`
const owner = await prisma.user.create({ data: { username: prefix, passwordHash: 'unusable-fixture', balance: 10 } })
const admin = await prisma.user.create({ data: { username: prefix + '-admin', passwordHash: 'unusable-fixture', role: 'admin' } })
let actor = { id: admin.id, username: admin.username, role: 'admin', sid: prefix, iat: Math.floor(Date.now()/1000) }
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = { ...actor } })
app.decorate('requireAdmin', async () => {})
const trigger = 'balance_audit_' + randomUUID().replaceAll('-', '')
const reset = async () => {
  actor = { id: admin.id, username: admin.username, role: 'admin', sid: prefix, iat: Math.floor(Date.now()/1000) }
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin', status: 'active' } })
  await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } })
  await prisma.user.update({ where: { id: owner.id }, data: { balance: 10 } })
  await prisma.balanceLog.deleteMany({ where: { userId: owner.id } })
  await prisma.log.deleteMany({ where: { userId: admin.id } })
}
const snapshot = async () => ({ balance: Number((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).balance), ledger: await prisma.balanceLog.count({ where: { userId: owner.id } }), audit: await prisma.log.count({ where: { userId: admin.id } }) })
const submit = (amount: number) => app.inject({ method: 'POST', url: `/balance/admin/${owner.id}/adjust`, payload: { amount, remark: 'fixture adjustment' } })
let failure: unknown
try {
  await app.register(routes, { prefix: '/balance' }); await app.ready()
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = ${admin.id} AND NEW.action = 'balance.adjust' THEN RAISE EXCEPTION 'fixture balance audit unavailable'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  for (const amount of [10, -10, 0.01, -0.01]) {
    await reset(); const before = await snapshot(), response = await submit(amount)
    assert.equal(response.statusCode, 400, 'audit failure must reject direct balance adjustment')
    assert.deepEqual(await snapshot(), before, 'audit, balance and ledger must roll back together')
  }
  await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON logs`)
  for (const amount of [10, -10, 0.01, -0.01, 0.29, 99999989.99]) {
    await reset(); const response = await submit(amount); assert.equal(response.statusCode, 200, response.body)
    const result = response.json(); assert.equal(result.newBalance, Number((10+amount).toFixed(2)))
    assert.equal(result.balanceLog.amount, amount); assert.equal(result.balanceLog.balanceBefore, 10); assert.equal(result.balanceLog.balanceAfter, result.newBalance)
    assert.deepEqual(await snapshot(), { balance: result.newBalance, ledger: 1, audit: 1 })
    const log = await prisma.log.findFirstOrThrow({ where: { userId: admin.id, action: 'balance.adjust' } }); assert.equal(log.result, 'success')
  }
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON balance_logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  // The function above filters the administrator audit. Use a distinct ledger failure function.
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = ${owner.id} THEN RAISE EXCEPTION 'fixture balance ledger unavailable'; END IF; RETURN NEW; END $$`)
  for (const amount of [10, -10]) {
    await reset(); const before = await snapshot(), response = await submit(amount)
    assert.equal(response.statusCode, 400); assert.deepEqual(await snapshot(), before, 'ledger insert failure also rolls back balance and audit')
  }
  await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON balance_logs`)
  for (const amount of [0, -11, 100000000, 0.001]) {
    await reset(); const before = await snapshot(), response = await submit(amount)
    assert.equal(response.statusCode, 400); assert.deepEqual(await snapshot(), before, 'invalid or insufficient balance cannot create an audit success')
  }
  for (const state of ['banned', 'demoted', 'session', 'all-sessions']) {
    await reset(); const before = await snapshot()
    if (state === 'banned') await prisma.user.update({ where: { id: admin.id }, data: { status: 'banned' } })
    if (state === 'demoted') await prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
    if (state.endsWith('sessions') || state === 'session') await prisma.tokenInvalidation.create({ data: { userId: admin.id, sessionId: state === 'session' ? actor.sid : '__USER_LEVEL__', invalidatedAt: actor.iat } })
    const response = await submit(10); assert.equal(response.statusCode, 403); assert.deepEqual(await snapshot(), before)
  }
  // Hold the administrator row, revoke it, and prove the already authenticated write waits.
  for (const state of ['banned', 'demoted', 'session', 'all-sessions']) {
    await reset(); const before = await snapshot()
    let release!: () => void, entered!: (pid: number) => void, rejectReady!: (error: unknown) => void
    const hold = new Promise<void>(resolve => { release = resolve })
    const ready = new Promise<number>((resolve, reject) => { entered = resolve; rejectReady = reject })
    const blocker = prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${admin.id} FOR UPDATE`
      if (state === 'banned') await tx.user.update({ where: { id: admin.id }, data: { status: 'banned' } })
      if (state === 'demoted') await tx.user.update({ where: { id: admin.id }, data: { role: 'user' } })
      if (state === 'session' || state === 'all-sessions') await tx.tokenInvalidation.create({ data: { userId: admin.id, sessionId: state === 'session' ? actor.sid : '__USER_LEVEL__', invalidatedAt: actor.iat } })
      const [row] = await tx.$queryRaw<Array<{pid:number}>>`SELECT pg_backend_pid() AS pid`; entered(row.pid); await hold
    }, { timeout: 15000 })
    void blocker.catch(rejectReady); const pid = await ready
    let settled = false, blocked = false
    const operation = submit(10).then(response => { settled = true; return response })
    try {
      const end = Date.now() + 3500
      while (!settled && Date.now() < end) {
        const [row] = await prisma.$queryRaw<Array<{count:bigint}>>`SELECT count(*) FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`
        if (Number(row.count)) { blocked = true; break }; await delay(20)
      }
    } finally { release(); await blocker }
    assert.ok(blocked, `${state} revocation serializes with current write`); assert.equal((await operation).statusCode, 403); assert.deepEqual(await snapshot(), before)
  }
  console.log('PASS real PG/Fastify audit and ledger failure atomic rollback, pennies/max/zero ledger receipts, invalid/insufficient balance, current admin/session and four actual revocation lock races')
} catch (error) { failure = error } finally {
  await app.close(); await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON balance_logs`); await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } }); await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON logs`); await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`)
  await prisma.log.deleteMany({ where: { userId: admin.id } }); await prisma.balanceLog.deleteMany({ where: { userId: owner.id } }); await prisma.user.deleteMany({ where: { id: { in: [owner.id, admin.id] } } }); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
