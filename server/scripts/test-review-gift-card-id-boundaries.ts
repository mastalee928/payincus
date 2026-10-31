import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify, { type InjectOptions } from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const cards = await import('../src/db/gift-cards.js')
const { default: routes } = await import('../src/routes/gift-cards.js')
const tag = 'gift-ids-' + randomUUID(), app = Fastify(), users: number[] = []
const originalAllowlist = process.env.PAYINCUS_GIFT_CARD_ADMIN_IDS
let failure: unknown
try {
  const admin = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture', role: 'admin' } }); users.push(admin.id)
  const issuer = await prisma.user.create({ data: { username: tag + '-issuer', passwordHash: 'unusable-fixture', balance: 20 } }); users.push(issuer.id)
  process.env.PAYINCUS_GIFT_CARD_ADMIN_IDS = String(admin.id)
  const session = { sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
  let actor = { ...session, id: admin.id, username: admin.username, role: 'admin' }
  app.decorate('authenticate', async (request: any) => { request.user = { ...actor } })
  app.decorate('requireAdmin', async (_request: any, reply: any) => { if (actor.role !== 'admin') return reply.code(403).send() })
  await app.register(routes, { prefix: '/api/gift-cards' })
  const funded = await cards.generateGiftCardFromBalance({ userId: issuer.id, faceValue: 2, session })
  const state = async () => ({
    users: await prisma.user.findMany({ where: { id: { in: users } }, orderBy: { id: 'asc' } }),
    cards: await prisma.giftCard.findMany({ where: { createdById: { in: users } }, orderBy: { id: 'asc' } }),
    ledger: await prisma.balanceLog.findMany({ where: { userId: { in: users } }, orderBy: { id: 'asc' } }),
    audits: await prisma.log.findMany({ where: { userId: { in: users } }, orderBy: { id: 'asc' } })
  })
  const before = await state()
  const mixed = await app.inject({ method: 'POST', url: '/api/gift-cards/admin/batch-disable', payload: { ids: [funded.giftCard.id, 2147483648] } })
  if (mixed.statusCode !== 400) console.log('Unexpected mixed batch response', mixed.statusCode,
    'card', (await prisma.giftCard.findUniqueOrThrow({ where: { id: funded.giftCard.id } })).status,
    'issuerBalance', Number((await prisma.user.findUniqueOrThrow({ where: { id: issuer.id } })).balance))
  assert.equal(mixed.statusCode, 400); assert.deepEqual(await state(), before)
  let rejected = 1
  for (const invalid of ['0', '-1', '1.5', '1e2', '01', '2suffix', '2147483648', '4294967296', String(Number.MAX_SAFE_INTEGER), '9007199254740992']) {
    const requests: InjectOptions[] = [
      { method: 'PATCH', url: `/api/gift-cards/admin/${invalid}/enable` },
      { method: 'PATCH', url: `/api/gift-cards/admin/${invalid}/disable` },
      { method: 'DELETE', url: `/api/gift-cards/admin/${invalid}` },
      { method: 'POST', url: `/api/gift-cards/user/${invalid}/revoke` }
    ]
    for (const request of requests) {
      assert.equal((await app.inject(request)).statusCode, 400, String(request.url))
      assert.deepEqual(await state(), before); rejected++
    }
  }
  for (const invalid of [0, -1, 1.5, 2147483648, 4294967296, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, '2147483648']) {
    for (const action of ['batch-disable', 'batch-delete']) {
      assert.equal((await app.inject({ method: 'POST', url: '/api/gift-cards/admin/' + action,
        payload: { ids: [funded.giftCard.id, invalid] } })).statusCode, 400)
      assert.deepEqual(await state(), before); rejected++
    }
  }
  assert.equal(await prisma.giftCard.count({ where: { id: 2147483647 } }), 0, 'upper-bound fixture id must not exist')
  for (const request of [
    { method: 'PATCH', url: '/api/gift-cards/admin/2147483647/enable' },
    { method: 'PATCH', url: '/api/gift-cards/admin/2147483647/disable' },
    { method: 'DELETE', url: '/api/gift-cards/admin/2147483647' },
    { method: 'POST', url: '/api/gift-cards/user/2147483647/revoke' }
  ] as InjectOptions[]) {
    assert.equal((await app.inject(request)).statusCode, 404); assert.deepEqual(await state(), before)
  }
  const valid = await app.inject({ method: 'POST', url: '/api/gift-cards/admin/batch-disable', payload: { ids: [funded.giftCard.id] } })
  assert.equal(valid.statusCode, 200); assert.equal(valid.json().count, 1)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: issuer.id } })).balance), 20)
  actor = { ...session, id: issuer.id, username: issuer.username, role: 'user' }
  const next = await cards.generateGiftCardFromBalance({ userId: issuer.id, faceValue: 2, session })
  assert.equal((await app.inject({ method: 'POST', url: `/api/gift-cards/user/${next.giftCard.id}/revoke` })).statusCode, 200)
  assert.equal((await app.inject({ method: 'POST', url: `/api/gift-cards/user/${next.giftCard.id}/revoke` })).statusCode, 200)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: issuer.id } })).balance), 20)
  assert.equal(await prisma.balanceLog.count({ where: { userId: issuer.id, type: 'refund' } }), 2)
  console.log('PASS', rejected, 'invalid ID requests preserve cards, balance, ledger and audit; four legal absent IDs 404; valid admin/user refund once')
} catch (error) { failure = error }
finally {
  await app.close()
  await prisma.giftCard.deleteMany({ where: { createdById: { in: users } } })
  await prisma.log.deleteMany({ where: { userId: { in: users } } }); await prisma.user.deleteMany({ where: { id: { in: users } } })
  if (originalAllowlist === undefined) delete process.env.PAYINCUS_GIFT_CARD_ADMIN_IDS
  else process.env.PAYINCUS_GIFT_CARD_ADMIN_IDS = originalAllowlist
  await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
