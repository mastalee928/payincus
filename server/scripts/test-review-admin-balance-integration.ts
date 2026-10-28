import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { randomUUID } from 'node:crypto'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use isolated local *_pool_test PostgreSQL')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/balance.js')
const { giftBalance } = await import('../src/db/balance.js')
const tag = `balance-${randomUUID().replaceAll('-', '')}`
const admin = await prisma.user.create({ data: { username: `${tag}-admin`, passwordHash: 'unusable', role: 'admin' } })
const buyer = await prisma.user.create({ data: { username: `${tag}-buyer`, passwordHash: 'unusable', balance: 100 } })
const actor = { id: admin.id, username: admin.username, role: 'admin', sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
let afterAuthentication: (() => Promise<unknown>) | undefined
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = { ...actor }; await afterAuthentication?.() })
app.decorate('requireAdmin', async () => {})
const adjustUrl = `/balance/admin/${buyer.id}`
const call = (url: string, payload: object) => app.inject({ method: 'POST', url, payload })
const create = (amount = 5, requestType = 'adjust', sourceType?: string) => call(`${adjustUrl}/adjustment-requests`, { amount, requestType, reason: tag, sourceType })
const state = async () => ({ balance: Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance),
  logs: await prisma.balanceLog.count({ where: { userId: buyer.id } }), requests: await prisma.balanceAdjustmentRequest.count({ where: { userId: buyer.id } }) })
const trigger = tag.replaceAll('-', '_')
let triggerExists = false
try {
  await app.register(routes, { prefix: '/balance' })
  const invalidBefore = await state()
  assert.equal((await create(100000000)).statusCode, 400)
  assert.equal((await create(-100000000)).statusCode, 400)
  assert.deepEqual(await state(), invalidBefore, 'out-of-range amounts are validation errors with no writes')
  const initial = await create()
  assert.equal(initial.statusCode, 201, initial.body)
  const requestId = initial.json().request.id
  for (const mutation of [
    { url: `${adjustUrl}/adjust`, payload: { amount: 2, remark: tag } },
    { url: `${adjustUrl}/gift`, payload: { amount: 2, remark: tag } },
    { url: `${adjustUrl}/adjustment-requests`, payload: { amount: 2, reason: tag } },
    { url: `/balance/admin/adjustment-requests/${requestId}/approve`, payload: {} },
    { url: `/balance/admin/adjustment-requests/${requestId}/reject`, payload: { remark: tag } }
  ]) {
    const before = await state()
    afterAuthentication = () => prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
    const denied = await call(mutation.url, mutation.payload)
    assert.equal(denied.statusCode, 403, denied.body)
    assert.deepEqual(await state(), before, 'in-flight demotion cannot mutate balance, ledger or requests')
    assert.equal((await prisma.balanceAdjustmentRequest.findUniqueOrThrow({ where: { id: requestId } })).status, 'pending')
    afterAuthentication = undefined
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
  }
  for (const reason of ['banned', 'logout']) {
    afterAuthentication = () => reason === 'banned'
      ? prisma.user.update({ where: { id: admin.id }, data: { status: 'banned' } })
      : prisma.tokenInvalidation.create({ data: { userId: admin.id, sessionId: actor.sid, invalidatedAt: actor.iat } })
    const before = await state()
    assert.equal((await call(`${adjustUrl}/adjust`, { amount: 1, remark: tag })).statusCode, 403)
    assert.deepEqual(await state(), before)
    afterAuthentication = undefined
    await prisma.user.update({ where: { id: admin.id }, data: { status: 'active' } })
    await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } })
  }
  const approvals = await Promise.all(Array.from({ length: 5 }, () => call(`/balance/admin/adjustment-requests/${requestId}/approve`, {})))
  assert.equal(approvals.filter(result => result.statusCode === 200).length, 1)
  assert.equal((await state()).balance, 105)
  assert.equal((await state()).logs, 1)
  const rejected = await create()
  const rejectedId = rejected.json().request.id
  const rejections = await Promise.all(Array.from({ length: 3 }, () => call(`/balance/admin/adjustment-requests/${rejectedId}/reject`, { remark: tag })))
  assert.equal(rejections.filter(result => result.statusCode === 200).length, 1)
  assert.equal((await state()).logs, 1)

  const reclaim = await create(5, 'refund', 'recharge')
  assert.equal(reclaim.statusCode, 201, reclaim.body)
  assert.equal((await call(`/balance/admin/adjustment-requests/${reclaim.json().request.id}/approve`, {})).statusCode, 200)
  assert.equal((await state()).balance, 100, 'recharge refund approval still reclaims credited balance')
  assert.equal((await prisma.balanceLog.findFirstOrThrow({ where: { userId: buyer.id }, orderBy: { id: 'desc' } })).type, 'admin_adjust')

  const failureRequest = await create()
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = ${buyer.id} THEN RAISE EXCEPTION 'fixture-admin-balance-ledger-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON balance_logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  triggerExists = true
  const beforeFailure = await state()
  for (const mutation of [
    { url: `${adjustUrl}/adjust`, payload: { amount: 3, remark: tag } },
    { url: `${adjustUrl}/gift`, payload: { amount: 3, remark: tag } },
    { url: `/balance/admin/adjustment-requests/${failureRequest.json().request.id}/approve`, payload: {} }
  ]) {
    assert.equal((await call(mutation.url, mutation.payload)).statusCode, 400)
    assert.deepEqual(await state(), beforeFailure, 'ledger failure rolls back the balance and approval claim')
  }
  assert.equal((await prisma.balanceAdjustmentRequest.findUniqueOrThrow({ where: { id: failureRequest.json().request.id } })).status, 'pending')
  await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON balance_logs`)
  await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
  triggerExists = false
  await prisma.user.update({ where: { id: buyer.id }, data: { status: 'banned' } })
  assert.equal((await giftBalance(buyer.id, 1, 'internal-fixture')).success, true, 'internal gift callers retain their existing non-Web semantics')
  console.log('PASS real PostgreSQL/Fastify admin balance: in-flight demotion/ban/logout refusal, atomic request/approval/rejection, five concurrent approvals settle once, recharge reclaim remains negative, ledger faults roll back all state; no SMTP dispatch')
} finally {
  if (triggerExists) {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON balance_logs`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`)
  }
  await app.close()
  await prisma.balanceAdjustmentRequest.deleteMany({ where: { userId: buyer.id } })
  await prisma.balanceLog.deleteMany({ where: { userId: buyer.id } })
  await prisma.log.deleteMany({ where: { userId: { in: [admin.id, buyer.id] } } })
  await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } })
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, buyer.id] } } })
  await closePrismaDatabase()
}
process.exit(0)
