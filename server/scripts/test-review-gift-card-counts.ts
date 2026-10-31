import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const cards = await import('../src/db/gift-cards.js')
const { default: routes } = await import('../src/routes/gift-cards.js')
const tag = 'gift-count-' + randomUUID(), app = Fastify()
const originalAllowlist = process.env.PAYINCUS_GIFT_CARD_ADMIN_IDS
let failure: unknown, adminId: number | undefined
try {
  const admin = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture', role: 'admin', balance: 20 } }); adminId = admin.id
  process.env.PAYINCUS_GIFT_CARD_ADMIN_IDS = String(admin.id)
  const actor = { id: admin.id, username: admin.username, role: 'admin', sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
  app.decorate('authenticate', async (request: any) => { request.user = { ...actor } })
  app.decorate('requireAdmin', async () => {})
  await app.register(routes, { prefix: '/api/gift-cards' })
  const state = async () => ({
    admin: await prisma.user.findUniqueOrThrow({ where: { id: admin.id } }),
    cards: await prisma.giftCard.findMany({ where: { createdById: admin.id }, orderBy: { id: 'asc' } }),
    ledger: await prisma.balanceLog.findMany({ where: { userId: admin.id }, orderBy: { id: 'asc' } }),
    audits: await prisma.log.findMany({ where: { userId: admin.id }, orderBy: { id: 'asc' } })
  })
  const empty = await state()
  const invalid = [-1, 0, 0.1, 1.5, 499.5, 500.1, 501, 2147483648, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1,
    '1.5', '500.1', '2suffix', '', 'NaN', null, false, {}, [], [1.5]]
  for (const count of invalid) {
    const result = await app.inject({ method: 'POST', url: '/api/gift-cards/admin/batch', payload: { faceValue: 1, count } })
    assert.equal(result.statusCode, 400, 'invalid count must reject: ' + JSON.stringify(count))
    assert.deepEqual(await state(), empty, 'rejected input must not create partial codes or financial/audit mutations')
  }
  const missing = await app.inject({ method: 'POST', url: '/api/gift-cards/admin/batch', payload: { faceValue: 1 } })
  assert.equal(missing.statusCode, 400); assert.deepEqual(await state(), empty)
  for (const count of [-1, 0, 0.1, 1.5, 500.1, 501, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Infinity, -Infinity]) {
    await assert.rejects(cards.createGiftCardBatch(count, { faceValue: 1, balanceValue: 1, createdById: admin.id }, actor), /GIFT_CARD_BATCH_TOO_LARGE/)
    assert.deepEqual(await state(), empty)
  }
  for (const payload of [{ faceValue: 201, count: 500 }, { faceValue: 10000, count: 11 }, { faceValue: 1, balanceValue: 2, count: 2 }]) {
    assert.equal((await app.inject({ method: 'POST', url: '/api/gift-cards/admin/batch', payload })).statusCode, 400)
    assert.deepEqual(await state(), empty)
  }
  let total = 0
  for (const count of [1, 2, 499, 500]) {
    const result = await app.inject({ method: 'POST', url: '/api/gift-cards/admin/batch', payload: { faceValue: 200, count } })
    assert.equal(result.statusCode, 201, 'valid count failed: ' + count)
    const payload = result.json(); total += count
    assert.equal(payload.count, count); assert.equal(payload.codes.length, count)
    const stored = await prisma.giftCard.findMany({ where: { createdById: admin.id, batchId: payload.batchId }, orderBy: { id: 'asc' } })
    assert.equal(stored.length, count)
    assert.deepEqual(payload.codes.map((row: { id: number }) => row.id).sort((a: number, b: number) => a - b), stored.map(row => row.id))
    assert.equal(new Set(payload.codes.map((row: { code: string }) => row.code)).size, count)
    for (const row of stored) {
      assert.equal(row.status, 'active'); assert.equal(Number(row.faceValue), 200); assert.equal(Number(row.balanceValue), 200)
      assert.equal(row.ownerId, null); assert.ok(/^gc-[A-Za-z0-9_-]{24}$/.test(row.code))
    }
    console.log('PASS exact batch quantity', count, 'with returned and persisted unique codes; value boundary', count * 200)
  }
  assert.equal(await prisma.giftCard.count({ where: { createdById: admin.id } }), total)
  assert.equal(await prisma.log.count({ where: { userId: admin.id, action: 'admin_batch_generate' } }), 4)
  assert.equal(await prisma.balanceLog.count({ where: { userId: admin.id } }), 0)
  assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: admin.id } }), empty.admin)
  console.log('PASS quantity rejection preserves all state; exact min/max batches and face-value cap; no balance changes')
} catch (error) { failure = error }
finally {
  await app.close()
  if (adminId) {
    await prisma.giftCard.deleteMany({ where: { createdById: adminId } })
    await prisma.log.deleteMany({ where: { userId: adminId } })
    await prisma.user.delete({ where: { id: adminId } })
  }
  if (originalAllowlist === undefined) delete process.env.PAYINCUS_GIFT_CARD_ADMIN_IDS
  else process.env.PAYINCUS_GIFT_CARD_ADMIN_IDS = originalAllowlist
  await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
