import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { updatePrize, performDraw } = await import('../src/db/lottery.js')
const { default: routes } = await import('../src/routes/admin-entertainment.js')
const owner = await prisma.user.create({ data: { username: `prize-stock-${randomUUID()}`, passwordHash: 'unusable-fixture', role: 'admin' } })
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = { id: owner.id, username: owner.username, role: 'admin' } })
app.decorate('requireAdmin', async () => {})
let lotteryId: number | undefined
try {
  await app.register(routes, { prefix: '/entertainment' })
  const lottery = await prisma.lottery.create({ data: { name: 'Isolated stock fixture', costPoints: 10, createdBy: owner.id,
    prizes: { create: [{ name: 'Limited', type: 'instance', probability: 100, totalQuantity: 100, remainQuantity: 100 }] } }, include: { prizes: true } })
  lotteryId = lottery.id
  const id = lottery.prizes[0].id
  const read = () => prisma.lotteryPrize.findUniqueOrThrow({ where: { id } })
  const put = (payload: object) => app.inject({ method: 'PUT', url: `/entertainment/prizes/${id}`, payload })
  const edit = async (payload: object) => {
    const response = await put({ expectedRevision: (await read()).revision, ...payload })
    assert.equal(response.statusCode, 200, response.body)
  }
  const adminList = await app.inject('/entertainment/lotteries')
  assert.equal(adminList.json().lotteries[0].prizes[0].revision, 0)
  // Actual draw deducts stock after the editor obtained revision 0.
  await prisma.userPoints.create({ data: { userId: owner.id, points: 10000 } })
  assert.equal((await performDraw(owner.id, lottery.id)).success, true)
  assert.equal((await read()).remainQuantity, 99)
  await edit({ name: 'Renamed' })
  assert.equal((await read()).remainQuantity, 99, 'ordinary edits cannot restore consumed stock')
  await edit({ totalQuantity: 150 })
  assert.equal((await read()).remainQuantity, 99, 'editing a finite quantity does not reset remaining stock')
  const revision = (await read()).revision
  const copies = await Promise.all(Array.from({ length: 8 }, () => put({ expectedRevision: revision, replenishAmount: 5 })))
  assert.equal(copies.filter(r => r.statusCode === 200).length, 1)
  assert.equal(copies.filter(r => r.statusCode === 409).length, 7)
  assert.equal((await read()).remainQuantity, 104, 'a retry or duplicate save adds only once')
  assert.equal((await put({ expectedRevision: revision, replenishAmount: 5 })).statusCode, 409)

  // Hold a real row lock, consume stock, then let the waiting admin replenish from committed stock.
  let release!: () => void, locked!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const ready = new Promise<void>(resolve => { locked = resolve })
  const draw = prisma.$transaction(async tx => {
    await tx.lotteryPrize.update({ where: { id }, data: { remainQuantity: { decrement: 3 } } })
    locked(); await held
  })
  await ready
  const replenishment = updatePrize(id, { expectedRevision: (await read()).revision, replenishAmount: 7 })
  release(); await Promise.all([draw, replenishment])
  assert.equal((await read()).remainQuantity, 108, 'waiting replenishment preserves concurrent consumption')
  // Full draw vs edit: serialization errors may be retried by the same route contract.
  const before = (await read()).remainQuantity!
  const drawRetry = async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try { return await performDraw(owner.id, lottery.id) }
      catch (error: any) {
        if (attempt === 4 || !(error.code === 'P2034' || /could not serialize|write conflict|deadlock/.test(error.message))) throw error
      }
    }
  }
  const concurrentRevision = (await read()).revision
  const [drawn] = await Promise.all([drawRetry(), updatePrize(id, { expectedRevision: concurrentRevision, replenishAmount: 4 })])
  assert.equal(drawn?.success, true)
  assert.equal((await read()).remainQuantity, before + 3)
  await edit({ totalQuantity: null }); assert.equal((await read()).remainQuantity, null)
  await edit({ totalQuantity: 12 }); assert.equal((await read()).remainQuantity, 12)
  await edit({ type: 'nothing', totalQuantity: null }); assert.equal((await read()).remainQuantity, null)
  assert.equal((await put({ expectedRevision: (await read()).revision, replenishAmount: 1 })).statusCode, 400)
  await edit({ type: 'instance', totalQuantity: 2_147_483_647 })
  assert.equal((await put({ expectedRevision: (await read()).revision, replenishAmount: 1 })).statusCode, 400)
  for (const payload of [{ totalQuantity: 0 }, { totalQuantity: -1 }, { totalQuantity: 2_147_483_648 }, { totalQuantity: '2' },
    { replenishAmount: null }, { replenishAmount: -1 }, { replenishAmount: 0.5 }, { replenishAmount: '1' }, { replenishAmount: 2_147_483_648 }]) {
    assert.equal((await put({ expectedRevision: (await read()).revision, ...payload })).statusCode, 400, JSON.stringify(payload))
  }
  for (const payload of [{ name: 'Old client' }, { expectedRevision: -1 }, { expectedRevision: 0.1 }, { expectedRevision: null },
    { expectedRevision: (await read()).revision, remainQuantity: 99 }, { expectedRevision: (await read()).revision, remainQuantity: null }]) {
    assert.equal((await put(payload)).statusCode, 409)
  }
  assert.equal((await read()).remainQuantity, 2_147_483_647)
  // List responses intentionally omit notification credentials; the editor must load detail.
  for (const type of ['telegram', 'discord', 'webhook']) {
    const data = { enabled: false, type, notifyBalance: false, notifyInstance: true, config:
      type === 'telegram' ? { botToken: 'inert-fixture-value', chatId: '-1000' } :
      type === 'discord' ? { webhookUrl: 'https://example.invalid/inert-discord' } : { url: 'https://example.invalid/inert-webhook', secret: 'inert-fixture-value' } }
    const saved = await app.inject({ method: 'PUT', url: `/entertainment/lotteries/${lottery.id}/notification`, payload: data })
    assert.equal(saved.statusCode, 200)
    const detail = await app.inject(`/entertainment/lotteries/${lottery.id}`)
    assert.deepEqual(detail.json().lottery.notificationConfig, data)
    const listing = await app.inject('/entertainment/lotteries')
    assert.equal('notificationConfig' in listing.json().lotteries.find((item: any) => item.id === lottery.id), false)
  }
  console.log('PASS actual notification save/detail contract for 3 types; list omits credentials. Inert configuration only, no messages sent.')
  console.log('PASS actual Fastify/PostgreSQL: consumed stock preserved, atomic replenishment, concurrent duplicate/replayed revision rejection, actual draw race, null/limited/type transitions and integer limits. Authentication identity is a fixture; no customer data.')
} finally {
  await app.close()
  if (lotteryId) await prisma.lottery.delete({ where: { id: lotteryId } })
  await prisma.user.delete({ where: { id: owner.id } })
  await closePrismaDatabase()
}
process.exit(0)
