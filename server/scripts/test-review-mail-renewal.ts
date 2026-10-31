import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { Client } from 'pg'
import { setTimeout as delay } from 'node:timers/promises'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const scheduleInterval = globalThis.setInterval
globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
  const timer = scheduleInterval(...args); timer.unref(); return timer
}) as typeof setInterval
try { await import('../src/lib/security.js') } finally { globalThis.setInterval = scheduleInterval }
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/mail.js')
const { processMailAutoRenew } = await import('../src/services/mail-autorenew-scheduler.js')
const tag = 'money-mail-' + randomUUID(), app = Fastify(), originalFetch = globalThis.fetch
const originalTransaction = prisma.$transaction, transaction = originalTransaction.bind(prisma)
const holder = new Client({ connectionString: database.href }), monitor = new Client({ connectionString: database.href })
const trigger = 'money_mail_' + randomUUID().replaceAll('-', '')
let pending: Promise<unknown> | undefined, triggerCreated = false
let beforeTransaction: (() => Promise<unknown>) | undefined, actor: Record<string, unknown>, failure: unknown
prisma.$transaction = (async (...args: Parameters<typeof prisma.$transaction>) => {
  const pending = beforeTransaction; beforeTransaction = undefined; await pending?.()
  return (transaction as (...params: unknown[]) => Promise<unknown>)(...args)
}) as typeof prisma.$transaction
globalThis.fetch = async () => { throw Error('Unexpected external mail request') }
app.decorate('authenticate', async (request: any) => { request.user = { ...actor } })
app.decorate('requireAdmin', async (_request: any, reply: any) => reply.code(403).send())
let sourceId = 0, userId = 0
try {
  await holder.connect(); await monitor.connect()
  const user = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture', balance: 100 } }); userId = user.id
  actor = { id: user.id, username: user.username, role: 'user', sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
  const source = await prisma.mailSource.create({ data: { name: tag, code: tag, apiUrl: 'https://127.0.0.1:1', apiKey: 'unusable-fixture', smarterMailUrl: 'https://127.0.0.1:1' } }); sourceId = source.id
  const plan = await prisma.mailPlan.create({ data: { sourceId: source.id, name: tag, domainLimit: 1, diskLimitGb: 1, billingCycle: 'monthly', price: 10 } })
  const subscription = await prisma.mailSubscription.create({ data: { userId, sourceId, planId: plan.id, domainLimit: 1, diskLimitGb: 1,
    expiresAt: new Date(Date.now() + 86400000), autoRenew: true } })
  await app.register(routes, { prefix: '/mail' })
  const capture = async () => ({
    user: await prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    subscription: await prisma.mailSubscription.findUniqueOrThrow({ where: { id: subscription.id } }),
    ledger: await prisma.balanceLog.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    inbox: await prisma.inboxMessage.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    logs: await prisma.log.findMany({ where: { userId }, orderBy: { id: 'asc' } })
  })
  if (!process.argv.includes('--auto-only')) {
    for (const change of ['ban', 'logout', 'all-sessions', 'price', 'expiry'] as const) {
      const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7)
      if (only && only !== change) continue
      let expected: Awaited<ReturnType<typeof capture>> | undefined
      beforeTransaction = async () => {
        if (change === 'ban') await prisma.user.update({ where: { id: userId }, data: { status: 'banned' } })
        else if (change === 'price') await prisma.mailPlan.update({ where: { id: plan.id }, data: { price: 20 } })
        else if (change === 'expiry') await prisma.mailSubscription.update({ where: { id: subscription.id }, data: { expiresAt: new Date(subscription.expiresAt.getTime() + 86400000) } })
        else await prisma.tokenInvalidation.create({ data: { userId, sessionId: change === 'logout' ? tag : '__USER_LEVEL__', invalidatedAt: actor.iat as number } })
        expected = await capture()
      }
      const response = await app.inject({ method: 'POST', url: '/mail/subscription/renew', payload: { months: 1 } })
      console.log('Manual renewal after', change, 'status', response.statusCode, 'balance', Number((await capture()).user.balance))
      assert.equal(response.statusCode, change === 'price' || change === 'expiry' ? 409 : 403)
      assert.deepEqual(await capture(), expected, 'stale or revoked renewal must leave all accounting unchanged')
      await prisma.user.update({ where: { id: userId }, data: { status: 'active' } })
      await prisma.tokenInvalidation.deleteMany({ where: { userId } })
      await prisma.mailPlan.update({ where: { id: plan.id }, data: { price: 10 } })
      await prisma.mailSubscription.update({ where: { id: subscription.id }, data: { expiresAt: subscription.expiresAt } })
    }
    for (const change of ['ban', 'logout'] as const) {
      let expected: Awaited<ReturnType<typeof capture>> | undefined
      beforeTransaction = async () => {
        if (change === 'ban') await prisma.user.update({ where: { id: userId }, data: { status: 'banned' } })
        else await prisma.tokenInvalidation.create({ data: { userId, sessionId: tag, invalidatedAt: actor.iat as number } })
        expected = await capture()
      }
      const response = await app.inject({ method: 'PATCH', url: '/mail/subscription/auto-renew', payload: { autoRenew: false } })
      assert.equal(response.statusCode, 403, response.body)
      assert.deepEqual(await capture(), expected, 'revoked session cannot change future automatic charges')
      await prisma.user.update({ where: { id: userId }, data: { status: 'active' } })
      await prisma.tokenInvalidation.deleteMany({ where: { userId } })
    }
  }
  await prisma.user.update({ where: { id: userId }, data: { status: 'banned' } })
  const beforeBanned = await capture()
  const rejected = await processMailAutoRenew(subscription, new Date(), new Date(Date.now() + 3 * 86400000))
  console.log('Automatic renewal for banned account:', rejected.status, 'balance', Number((await capture()).user.balance))
  assert.equal(rejected.status, 'ineligible')
  assert.deepEqual(await capture(), beforeBanned)
  await prisma.user.update({ where: { id: userId }, data: { status: 'active' } })
  for (const mode of ['manual', 'automatic'] as const) {
    await holder.query('BEGIN')
    await holder.query('SELECT id FROM mail_subscriptions WHERE id=$1 FOR UPDATE', [subscription.id])
    const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    const operation = mode === 'manual'
      ? app.inject({ method: 'POST', url: '/mail/subscription/renew', payload: { months: 1 } }).then(response => response.statusCode)
      : processMailAutoRenew(subscription, new Date(), new Date(Date.now() + 3 * 86400000)).then(result => result.status)
    pending = operation
    let expected: Awaited<ReturnType<typeof capture>> | undefined
    try {
      const deadline = Date.now() + 3000
      while (!(await monitor.query('SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))', [pid])).rows.length) {
        assert.ok(Date.now() < deadline, 'renewal must wait on the actual PostgreSQL subscription lock'); await delay(10)
      }
      await prisma.user.update({ where: { id: userId }, data: { status: 'banned' } })
      expected = await capture()
    } finally { await holder.query('COMMIT') }
    assert.equal(await operation, mode === 'manual' ? 403 : 'ineligible'); pending = undefined
    assert.deepEqual(await capture(), expected, 'ban during real row-lock wait must prevent all accounting changes')
    await prisma.user.update({ where: { id: userId }, data: { status: 'active' } })
  }
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = ${userId} THEN RAISE EXCEPTION 'isolated mail ledger failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON balance_logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  triggerCreated = true
  const beforeFailure = await capture()
  const failed = await app.inject({ method: 'POST', url: '/mail/subscription/renew', payload: { months: 1 } })
  assert.equal(failed.statusCode, 500)
  assert.deepEqual(await capture(), beforeFailure, 'ledger INSERT failure must roll back debit and expiry')
  await assert.rejects(processMailAutoRenew(subscription, new Date(), new Date(Date.now() + 3 * 86400000)), /isolated mail ledger failure/)
  assert.deepEqual(await capture(), beforeFailure)
  await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON balance_logs`)
  await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`); triggerCreated = false
  const manual = await app.inject({ method: 'POST', url: '/mail/subscription/renew', payload: { months: 1 } })
  assert.equal(manual.statusCode, 200, manual.body)
  assert.equal(manual.json().finalPrice, 10)
  assert.equal(Number((await capture()).user.balance), 90)
  const stale = await processMailAutoRenew(subscription, new Date(), new Date(Date.now() + 3 * 86400000))
  assert.equal(stale.status, 'ineligible', 'old automatic candidate must not charge after manual renewal')
  const fresh = await prisma.mailSubscription.update({ where: { id: subscription.id }, data: { expiresAt: subscription.expiresAt } })
  assert.equal((await processMailAutoRenew(fresh, new Date(), new Date(Date.now() + 3 * 86400000))).status, 'renewed')
  assert.equal(Number((await capture()).user.balance), 80)
  assert.equal((await capture()).ledger.length, 2)
  assert.equal((await processMailAutoRenew(fresh, new Date(), new Date(Date.now() + 3 * 86400000))).status, 'ineligible')
  assert.equal(Number((await capture()).user.balance), 80)
  console.log('PASS mail renewal: current authorization and quote, banned automatic account, normal manual/automatic and stale-candidate one-time charge')
} catch (error) { failure = error }
finally {
  beforeTransaction = undefined; prisma.$transaction = originalTransaction; globalThis.fetch = originalFetch
  await holder.query('ROLLBACK').catch(() => undefined); await pending
  await app.close()
  if (triggerCreated) {
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON balance_logs`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
  }
  if (userId) {
    await prisma.log.deleteMany({ where: { userId } })
    await prisma.user.delete({ where: { id: userId } })
  }
  if (sourceId) await prisma.mailSource.delete({ where: { id: sourceId } })
  await holder.end(); await monitor.end(); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exitCode = 1 }
