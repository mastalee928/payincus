import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { randomUUID } from 'node:crypto'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { increaseOwnQuota } = await import('../src/db/users.js')
const { default: routes } = await import('../src/routes/users.js')
const tag = randomUUID()
const user = await prisma.user.create({ data: { username: `quota-${tag}`, passwordHash: 'unusable-fixture',
  hostingBalance: 10, quota: { create: { hostLimit: 10, hostUsed: 5, friendLimit: 20, friendUsed: 10 } } } })
const admin = await prisma.user.create({ data: { username: `quota-admin-${tag}`, passwordHash: 'unusable-fixture', role: 'admin' } })
const actor = { id: user.id, username: user.username, role: 'user', sid: 'fixture-quota-session', iat: Math.floor(Date.now() / 1000) + 1 }
const adminActor = { ...actor, id: admin.id, username: admin.username, role: 'admin', sid: 'fixture-quota-admin-session' }
let currentActor = actor
const app = Fastify()
for (const hook of ['authenticateUser', 'authenticateAdmin', 'authenticate']) app.decorate(hook, async (request: any) => { request.user = { ...currentActor } })
const adjust = (type: 'available' | 'frozen', amount: number) => app.inject({ method: 'POST', url: `/users/${user.id}/hosting-balance/adjust`, payload: { type, amount, reason: 'Fixture adjustment' } })
try {
  await app.register(routes, { prefix: '/users' })
  const concurrent = await Promise.all(Array.from({ length: 7 }, () => app.inject({ method: 'POST', url: '/users/me/quota/increase', payload: { hostLimit: 15 } })))
  assert.equal(concurrent.filter(r => r.statusCode === 200).length, 1, 'only one same-old-limit request can increase by the allowed step')
  assert.ok(concurrent.every(r => [200, 400].includes(r.statusCode)))
  assert.equal((await prisma.userQuota.findUniqueOrThrow({ where: { userId: user.id } })).hostLimit, 15)
  await assert.rejects(increaseOwnQuota(user.id, 'host', 20, actor), /QUOTA_USAGE_TOO_LOW/)
  await prisma.user.update({ where: { id: user.id }, data: { status: 'banned' } })
  await assert.rejects(increaseOwnQuota(user.id, 'friend', 30, actor), /QUOTA_ACTOR_FORBIDDEN/)
  await prisma.user.update({ where: { id: user.id }, data: { status: 'active' } })
  await prisma.tokenInvalidation.create({ data: { userId: user.id, sessionId: actor.sid, invalidatedAt: actor.iat } })
  await assert.rejects(increaseOwnQuota(user.id, 'friend', 30, actor), /QUOTA_ACTOR_FORBIDDEN/)
  await prisma.tokenInvalidation.deleteMany({ where: { userId: user.id } })
  await prisma.userQuota.update({ where: { userId: user.id }, data: { hostLimit: 30 } })
  await assert.rejects(increaseOwnQuota(user.id, 'host', 20, actor), /QUOTA_INCREASE_STEP_INVALID/)
  assert.equal((await prisma.userQuota.findUniqueOrThrow({ where: { userId: user.id } })).hostLimit, 30, 'old request cannot lower a newly changed limit')
  currentActor = adminActor
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
  for (const [type, amount] of [['available', 1], ['available', -1], ['frozen', 1], ['frozen', -1]] as const) {
    assert.equal((await adjust(type, amount)).statusCode, 403, 'all hosting adjustment branches recheck admin at write')
  }
  assert.equal((await app.inject({ method: 'POST', url: `/users/${user.id}/quota/recalculate` })).statusCode, 403)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).hostingBalance), 10)
  assert.equal(await prisma.hostingBalanceLog.count({ where: { userId: user.id } }), 0)
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
  assert.equal((await adjust('available', 2)).statusCode, 200)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).hostingBalance), 12)
  assert.equal((await adjust('available', -3)).statusCode, 200)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).hostingBalance), 9)
  assert.equal((await adjust('frozen', 4)).statusCode, 200)
  assert.equal((await adjust('frozen', -1)).statusCode, 200)
  const frozen = await prisma.hostingBalanceLog.aggregate({ where: { userId: user.id, frozen: true }, _sum: { amount: true } })
  assert.equal(Number(frozen._sum.amount), 3)
  assert.equal((await adjust('available', -100)).statusCode, 400)
  const recalculated = await app.inject({ method: 'POST', url: `/users/${user.id}/quota/recalculate` })
  assert.equal(recalculated.statusCode, 200, recalculated.body)
  assert.deepEqual(recalculated.json().quota, { hostUsed: 0, friendUsed: 0, packageUsed: 0 })
  await prisma.tokenInvalidation.create({ data: { userId: admin.id, sessionId: adminActor.sid, invalidatedAt: adminActor.iat } })
  assert.equal((await adjust('available', 1)).statusCode, 403)
  console.log('PASS real PostgreSQL/Fastify quota and hosting adjustments: current-step concurrency, use/status/session guards, stale admin all four adjustment branches, quota recalc and normal balance/frozen semantics')
} finally {
  await app.close()
  await prisma.hostingBalanceLog.deleteMany({ where: { userId: user.id } })
  await prisma.user.deleteMany({ where: { id: { in: [user.id, admin.id] } } })
  await closePrismaDatabase()
}
process.exit(0)
