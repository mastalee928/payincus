import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { Prisma, type PaymentProvider } from '@prisma/client'
import { randomUUID } from 'node:crypto'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const invite = await import('../src/lib/invite-pricing.js')
const payment = await import('../src/db/payment-providers.js')
const { getNotificationLogsByUserId } = await import('../src/db/notifications.js')
const { default: routes } = await import('../src/routes/notifications.js')
const tag = randomUUID()
const user = await prisma.user.create({ data: { username: `pagination-${tag}`, passwordHash: 'unusable-fixture', balance: 10 } })
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = { id: user.id, role: 'user' } })
await app.register(routes, { prefix: '/notifications' })
try {
  for (const resource of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    assert.equal(invite.isSupportedInviteCostResource(resource), false)
    assert.doesNotThrow(() => invite.serializeInviteCostOptions([{ resource, enabled: true, amount: 1 }]))
    await assert.rejects(prisma.$transaction(tx => invite.chargeInviteGenerationCost(tx, user.id, 'fixture-code', resource, [
      { resource, enabled: true, amount: 1 }
    ])), /INVITE_COST_RESOURCE_UNSUPPORTED/)
  }
  assert.equal(invite.isSupportedInviteCostResource('balance'), true)
  assert.equal(invite.isSupportedInviteCostResource('points'), true)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance), 10)
  assert.equal(await prisma.balanceLog.count({ where: { userId: user.id } }), 0)

  const provider: PaymentProvider = {
    id: 1, name: 'Fixture', type: 'yipay', status: 'active', config: {}, methods: [],
    feeRate: new Prisma.Decimal('0.03'), feeFixed: new Prisma.Decimal('0.2'),
    minAmount: new Prisma.Decimal('1'), maxAmount: null, sortOrder: 0, createdAt: new Date(), updatedAt: new Date()
  }
  for (const method of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    assert.deepEqual(payment.getPaymentFeeConfig(provider, method), { feeRate: 0.03, feeFixed: 0.2 })
    assert.equal(payment.calculatePaymentFee(provider, 10, method), 0.5, 'prototype names cannot produce NaN or suppress the configured fee')
  }
  const explicit = { ...provider, config: JSON.parse('{"methodFees":{"alipay":{"feeRate":0.04,"feeFixed":0.1},"__proto__":{"feeRate":0.05}}}') }
  const fees = payment.getPaymentMethodFeeMap(explicit)
  assert.equal(Object.getPrototypeOf(fees), null)
  assert.equal(payment.calculatePaymentFee(explicit, 10, 'alipay'), 0.5)
  assert.deepEqual(payment.getPaymentFeeConfig(explicit, 'toString'), { feeRate: 0.03, feeFixed: 0.2 })
  assert.deepEqual(payment.getPaymentFeeConfig(explicit, '__proto__'), { feeRate: 0.05, feeFixed: 0 }, 'an own JSON property remains data and never changes the prototype')

  const channel = await prisma.notificationChannel.create({ data: { userId: user.id, type: 'email', name: 'Fixture', config: {} } })
  await prisma.notificationLog.createMany({ data: Array.from({ length: 25 }, (_, i) => ({
    channelId: channel.id, eventType: 'fixture', message: `fixture-${i}`, status: i % 2 ? 'failed' : 'sent'
  })) })
  for (const value of ['2suffix', '2.5', '0', '-2', 'NaN', 'Infinity', '9007199254740992', '2147483648', '2147483647']) {
    const response = await app.inject({ method: 'GET', url: `/notifications/logs?page=${value}&pageSize=${value}&status=constructor` })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().page, 1, 'invalid or overflowed offset falls back to page 1')
    assert.equal(response.json().total, 25)
    assert.ok([20, 100].includes(response.json().pageSize))
  }
  const valid = await app.inject({ method: 'GET', url: '/notifications/logs?page=2&pageSize=10&status=sent' })
  assert.equal(valid.statusCode, 200)
  assert.equal(valid.json().page, 2)
  assert.equal(valid.json().pageSize, 10)
  assert.equal(valid.json().total, 13)
  assert.equal(valid.json().logs.length, 3)
  for (const page of [Number.MAX_SAFE_INTEGER, Infinity, 2.5, -1, 2147483647]) {
    const result = await getNotificationLogsByUserId(user.id, { page, pageSize: 100 })
    assert.equal(result.page, 1, 'helper rejects unsafe offset independently of the route')
    assert.equal(result.logs.length, 25)
  }
  console.log('PASS real PostgreSQL/Fastify notifications pagination and own-property invite/payment configuration: invalid suffix/decimal/safe-integer/offset boundaries, valid filtered page, prototype names and unchanged ledger')
} finally {
  await app.close()
  await prisma.user.delete({ where: { id: user.id } })
  await closePrismaDatabase()
}
process.exit(0)
