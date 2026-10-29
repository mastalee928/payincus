import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { setTimeout as delay } from 'node:timers/promises'
import type { Prisma } from '@prisma/client'
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && /^\/[a-zA-Z0-9_]+_pool_test$/.test(database.pathname) && !database.search && !database.hash)
process.env.JWT_SECRET ||= 'hosting-write-fixture-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/users.js')
const prefix = `hosting-write-${randomUUID().slice(0, 8)}`
const owner = await prisma.user.create({ data: { username: prefix, passwordHash: 'unusable-fixture', hostingBalance: 10 } })
const admin = await prisma.user.create({ data: { username: prefix + '-admin', passwordHash: 'unusable-fixture', role: 'admin' } })
let actor = { id: admin.id, username: admin.username, role: 'admin', sid: prefix, iat: Math.floor(Date.now() / 1000) }
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = { ...actor } })
app.decorate('authenticateAdmin', async (request: any) => { request.user = { ...actor } })
app.decorate('authenticateUser', async (request: any) => { request.user = { ...actor } })
app.decorate('requireAdmin', async () => {})
const trigger = 'hosting_write_' + randomUUID().replaceAll('-', '')
const reset = async () => {
  actor = { id: admin.id, username: admin.username, role: 'admin', sid: prefix, iat: Math.floor(Date.now() / 1000) }
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin', status: 'active' } })
  await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } })
  await prisma.user.update({ where: { id: owner.id }, data: { hostingBalance: 10 } })
  await prisma.hostingBalanceLog.deleteMany({ where: { userId: owner.id } })
  for (const amount of [3, 7]) await prisma.hostingBalanceLog.create({ data: { userId: owner.id, type: 'income', amount, frozen: true, unfreezeAt: new Date('2099-01-01'), remark: 'fixture frozen' } })
  await prisma.log.deleteMany({ where: { userId: admin.id } })
}
const snapshot = async () => ({
  available: Number((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).hostingBalance),
  ledger: (await prisma.hostingBalanceLog.findMany({ where: { userId: owner.id }, orderBy: { id: 'asc' } })).map(log => ({ id: log.id, amount: Number(log.amount), frozen: log.frozen, remark: log.remark, unfreezeAt: log.unfreezeAt?.toISOString() })),
  audit: await prisma.log.count({ where: { userId: admin.id } })
})
const submit = (type: string, amount: number) => app.inject({ method: 'POST', url: `/users/${owner.id}/hosting-balance/adjust`, payload: { type, amount, reason: 'fixture hosting' } })
let failure: unknown
try {
  await app.register(routes, { prefix: '/users' }); await app.ready()
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = ${admin.id} AND NEW.action = 'admin.adjust_hosting_balance' THEN RAISE EXCEPTION 'fixture hosting audit unavailable'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  for (const type of ['available', 'frozen']) for (const amount of [1, -1, -10, 0.01]) {
    await reset(); const before = await snapshot(), response = await submit(type, amount)
    assert.equal(response.statusCode, 500, `${type}/${amount} audit failure rejects hosting adjustment`)
    assert.deepEqual(await snapshot(), before, 'audit failure restores available balance and every frozen source row')
  }
  await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON logs`)
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = ${owner.id} AND NEW.action_type = 'admin_adjust' THEN RAISE EXCEPTION 'fixture hosting ledger unavailable'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON hosting_balance_logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  for (const type of ['available', 'frozen']) for (const amount of [1, -4]) {
    await reset(); const before = await snapshot(), response = await submit(type, amount)
    assert.equal(response.statusCode, 500); assert.deepEqual(await snapshot(), before)
  }
  await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON hosting_balance_logs`)
  // Inject failure only after the real audit and ledger have been written inside the real PG transaction.
  const transaction = prisma.$transaction.bind(prisma)
  for (const receipt of ['available', 'frozen']) for (const type of ['available', 'frozen']) {
    await reset(); const before = await snapshot()
    ;(prisma as any).$transaction = (callback: any, options: any) => transaction(async tx => {
      let audited = false
      const wrapped = new Proxy(tx, { get(target, key) {
        if (key === 'log') return new Proxy(target.log, { get(delegate, operation) {
          if (operation === 'create') return async (args: any) => { const saved = await delegate.create(args); audited = true; return saved }
          return Reflect.get(delegate, operation)
        } })
        if (key === 'user' || key === 'hostingBalanceLog') return new Proxy(target[key], { get(delegate, operation) {
          if ((receipt === 'available' && key === 'user' && operation === 'findUniqueOrThrow') || (receipt === 'frozen' && key === 'hostingBalanceLog' && operation === 'aggregate')) {
            return (...args: any[]) => { if (audited) throw new Error('fixture committed receipt read unavailable'); return (Reflect.get(delegate, operation) as Function).apply(delegate, args) }
          }
          return Reflect.get(delegate, operation)
        } })
        return Reflect.get(target, key)
      } })
      return callback(wrapped)
    }, options)
    try { const response = await submit(type, 1); assert.equal(response.statusCode, 500); assert.deepEqual(await snapshot(), before, `${type}/${receipt} receipt failure rolls back all writes`) }
    finally { (prisma as any).$transaction = transaction }
  }
  for (const type of ['available', 'frozen']) for (const amount of [1, -1, -10, 0.01, -0.01, 0.29, -4]) {
    await reset(); const response = await submit(type, amount); assert.equal(response.statusCode, 200, response.body)
    const result = response.json(), expected = Number((10 + amount).toFixed(2))
    assert.deepEqual(result, { success: true, available: type === 'available' ? expected : 10, frozen: type === 'frozen' ? expected : 10 })
    const saved = await snapshot(); assert.equal(saved.available, result.available); assert.equal(saved.audit, 1)
    assert.equal(Number(saved.ledger.filter(log => log.frozen).reduce((sum, log) => sum + log.amount, 0).toFixed(2)), result.frozen)
    const log = await prisma.hostingBalanceLog.findFirstOrThrow({ where: { userId: owner.id, actionType: 'admin_adjust' } })
    assert.equal(Number(log.amount), type === 'frozen' && amount < 0 ? 0 : Math.abs(amount))
    if (type === 'available' && amount > 0) assert.ok(log.remark?.startsWith('[Admin]'))
    if (type === 'frozen' && amount > 0) assert.ok(log.unfreezeAt && log.unfreezeAt.getTime() > Date.now() + 29 * 86400000)
  }
  await reset(); await prisma.user.update({ where: { id: owner.id }, data: { hostingBalance: -3 } })
  assert.deepEqual((await submit('frozen', 1)).json(), { success: true, available: -3, frozen: 11 })
  assert.deepEqual((await submit('available', 1)).json(), { success: true, available: -2, frozen: 11 })
  for (const parts of [[0.1, 0.7], [0.1, 0.2], [0.29, 0.71], [0.01, 0.01, 0.01]]) {
    await reset(); await prisma.hostingBalanceLog.deleteMany({ where: { userId: owner.id } })
    for (const amount of parts) await prisma.hostingBalanceLog.create({ data: { userId: owner.id, type: 'income', amount, frozen: true, remark: 'fixture decimal source' } })
    const total = Number(parts.reduce((sum, part) => sum + part, 0).toFixed(2)), response = await submit('frozen', -total)
    assert.equal(response.statusCode, 200, 'all cents of multiple frozen entries can be deducted without floating-point insufficiency')
    assert.equal(response.json().frozen, 0); assert.equal(await prisma.hostingBalanceLog.count({ where: { userId: owner.id, frozen: true } }), 0)
  }
  for (const type of ['available', 'frozen']) for (const amount of [0.001, -0.001, 0.009, 1.234, -1.234]) {
    await reset(); const before = await snapshot(), response = await submit(type, amount)
    assert.equal(response.statusCode, 400, 'hosting adjustments reject sub-cent and extra decimal inputs instead of silently rounding them')
    assert.deepEqual(await snapshot(), before)
  }
  for (const [type, amount] of [['available', 0], ['available', -11], ['frozen', -11], ['available', 100000000], ['invalid', 1]] as const) {
    await reset(); const before = await snapshot(), response = await submit(type, amount); assert.equal(response.statusCode, 400); assert.deepEqual(await snapshot(), before)
  }
  for (const type of ['available', 'frozen']) for (const state of ['banned', 'demoted', 'session', 'all-sessions']) {
    await reset(); const before = await snapshot()
    let release!: () => void, entered!: (pid: number) => void, rejectReady!: (error: unknown) => void
    const hold = new Promise<void>(resolve => { release = resolve })
    const ready = new Promise<number>((resolve, reject) => { entered = resolve; rejectReady = reject })
    const blocker = prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${admin.id} FOR UPDATE`
      if (state === 'banned') await tx.user.update({ where: { id: admin.id }, data: { status: 'banned' } })
      if (state === 'demoted') await tx.user.update({ where: { id: admin.id }, data: { role: 'user' } })
      if (state === 'session' || state === 'all-sessions') await tx.tokenInvalidation.create({ data: { userId: admin.id, sessionId: state === 'session' ? actor.sid : '__USER_LEVEL__', invalidatedAt: actor.iat } })
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`; entered(row.pid); await hold
    }, { timeout: 15000 })
    void blocker.catch(rejectReady); const pid = await ready
    let settled = false, blocked = false
    const operation = submit(type, 1).then(response => { settled = true; return response })
    try {
      const end = Date.now() + 3500
      while (!settled && Date.now() < end) {
        const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`
        if (Number(row.count)) { blocked = true; break }; await delay(20)
      }
    } finally { release(); await blocker }
    assert.ok(blocked, `${type}/${state} uses existing current administrator lock`); assert.equal((await operation).statusCode, 403); assert.deepEqual(await snapshot(), before)
  }
  console.log('PASS real PG/Fastify hosting audit, ledger and receipt-read rollback, signed debt/exact receipts, frozen depletion, grant exclusion and eight current administrator revocation races')
} catch (error) { failure = error } finally {
  await app.close(); await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON logs`); await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON hosting_balance_logs`); await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`)
  await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } }); await prisma.log.deleteMany({ where: { userId: admin.id } }); await prisma.hostingBalanceLog.deleteMany({ where: { userId: owner.id } }); await prisma.user.deleteMany({ where: { id: { in: [owner.id, admin.id] } } }); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
