import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/vip-benefits.js')
const owner = await prisma.user.create({ data: { username: `vip-description-${randomUUID()}`, passwordHash: 'unusable-fixture', role: 'admin' } })
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = { id: owner.id, username: owner.username, role: 'admin' } })
app.decorate('requireAdmin', async () => {})
const rewardIds: number[] = []
try {
  await app.register(routes)
  for (const type of ['balance', 'points']) {
    const created = await app.inject({ method: 'POST', url: '/api/admin/vip-benefits/rewards', payload: {
      level: 1, type, title: `Description ${type}`, description: 'Original text', enabled: false, config: { amount: 12 }
    } })
    assert.equal(created.statusCode, 200, created.body)
    const id = created.json().reward.id; rewardIds.push(id)
    const put = (payload: object) => app.inject({ method: 'PUT', url: `/api/admin/vip-benefits/rewards/${id}`, payload })
    for (const empty of [null, '', '   ']) {
      assert.equal((await put({ description: 'Restore me' })).statusCode, 200)
      const response = await put({ description: empty })
      assert.equal(response.statusCode, 200, response.body)
      assert.equal(response.json().reward.description, null, 'explicit empty descriptions clear old text')
      const row = await prisma.vipBenefitReward.findUniqueOrThrow({ where: { id } })
      assert.equal(row.description, null); assert.deepEqual(row.config, { amount: 12 }); assert.equal(row.enabled, false)
      const listed = await app.inject('/api/admin/vip-benefits/rewards')
      assert.equal(listed.json().rewards.find((item: any) => item.id === id).description, null)
    }
    await put({ description: '  Keep this text  ' })
    const omitted = await put({ title: `Updated ${type}` })
    assert.equal(omitted.statusCode, 200)
    assert.equal(omitted.json().reward.description, 'Keep this text', 'omitted description preserves existing value')
    assert.equal(await prisma.vipBenefitClaim.count({ where: { rewardId: id } }), 0)
    if (type === 'balance') {
      for (const amount of [Number.MIN_VALUE, 0.0001, 0.004, 0, -1, 100000000]) {
        const updated = await put({ config: { amount } })
        assert.equal(updated.statusCode, 400, `reject balance amount ${amount}`)
        assert.deepEqual((await prisma.vipBenefitReward.findUniqueOrThrow({ where: { id } })).config, { amount: 12 })
      }
      for (const [amount, expected] of [[0.005, 0.01], [0.01, 0.01], [12.345, 12.35], [99999999.99, 99999999.99]]) {
        const updated = await put({ config: { amount } })
        assert.equal(updated.statusCode, 200)
        assert.equal(updated.json().reward.config.amount, expected)
      }
      const createdZero = await app.inject({ method: 'POST', url: '/api/admin/vip-benefits/rewards', payload: {
        level: 1, type, title: 'Zero normalization fixture', enabled: false, config: { amount: 0.004 }
      } })
      if (createdZero.statusCode === 200) rewardIds.push(createdZero.json().reward.id)
      assert.equal(createdZero.statusCode, 400)
    }
  }
  console.log('PASS actual Fastify/PostgreSQL VIP descriptions and amounts: explicit clearing/omission, zero after rounding rejected on create/update, invalid updates preserve configuration and valid rounding stays compatible. No claim/payment/instance operations; auth identity is a fixture.')
} finally {
  await app.close()
  await prisma.vipBenefitReward.deleteMany({ where: { id: { in: rewardIds } } })
  await prisma.user.delete({ where: { id: owner.id } })
  await closePrismaDatabase()
}
process.exit(0)
