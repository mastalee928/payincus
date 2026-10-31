import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'; process.env.ENCRYPTION_KEY = randomUUID()
process.env.PAYMENT_CALLBACK_IP_WHITELIST = '127.0.0.1'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { createPaymentProvider } = await import('../src/db/payment-providers.js')
const { default: routes } = await import('../src/routes/recharge.js')
const { signHeleketPayload } = await import('../src/lib/heleket.js')
const { buildRechargeProviderConfigSnapshot } = await import('../src/lib/recharge-provider-snapshot.js')
const tag = 'payment-integrity-' + randomUUID(), providerIds: number[] = [], userIds: number[] = []
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')
const app = Fastify(), originalFetch = globalThis.fetch
globalThis.fetch = async () => { throw Error('Unexpected outbound request during payment integrity test') }
app.decorate('authenticate', async (_request: any, reply: any) => reply.code(403).send())
app.decorate('requireAdmin', async (_request: any, reply: any) => reply.code(403).send())
let failure: unknown
try {
  assert.equal(await prisma.notificationChannel.count({ where: { alertCategory: 'payment', enabled: true } }), 0)
  const user = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } }); userIds.push(user.id)
  await app.register(routes)
  for (const type of ['yipay-v2', 'yipay-v1', 'heleket'] as const) {
    if (process.argv.includes('--heleket-only') && type !== 'heleket') continue
    const secret = randomUUID(), version = type === 'yipay-v2' ? 'v2' : 'v1'
    const config = type === 'heleket'
      ? { apiurl: 'https://8.8.8.8', merchant_uuid: randomUUID(), api_key: secret, currency: 'CNY' }
      : version === 'v1' ? { apiurl: 'https://8.8.8.8', version, pid: '12345', key: secret }
        : { apiurl: 'https://8.8.8.8', version, pid: '12345', platform_public_key: publicKey, merchant_private_key: privateKey }
    const provider = await createPaymentProvider({ name: tag, type: type === 'heleket' ? type : 'yipay', status: 'active', config }); providerIds.push(provider.id)
    let order = await prisma.rechargeRecord.create({ data: { orderNo: tag + type, userId: user.id, providerId: provider.id, amount: 10, actualAmount: 9,
      providerConfigSnapshot: buildRechargeProviderConfigSnapshot(type === 'heleket' ? type : 'yipay', config) } })
    const callback = (changes: Record<string, unknown> = {}) => {
      const payload: Record<string, unknown> = type === 'heleket'
        ? { order_id: order.orderNo, uuid: order.orderNo, amount: '10.00', currency: 'CNY', status: 'paid', ...changes }
        : { pid: '12345', out_trade_no: order.orderNo, trade_no: order.orderNo, money: '10.00', trade_status: 'TRADE_SUCCESS', type: 'alipay', ...changes }
      if (type === 'heleket') payload.sign = signHeleketPayload(payload, secret)
      else {
        const text = Object.keys(payload).filter(key => payload[key] !== undefined && payload[key] !== null && payload[key] !== '').sort().map(key => `${key}=${payload[key]}`).join('&')
        payload.sign = version === 'v1' ? createHash('md5').update(text + secret).digest('hex') : sign('sha256', Buffer.from(text), keys.privateKey).toString('base64')
        payload.sign_type = version === 'v1' ? 'MD5' : 'RSA'
      }
      return app.inject({ method: 'POST', url: `/api/recharge/callback/${provider.id}`, payload })
    }
    const balanceBefore = Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance)
    const invalids = type === 'heleket' ? [{ amount: '10garbage' }, { amount: '1e1' }, { amount: 'Infinity' }, { currency: 'USD' }, { currency: '' }, { currency: null }, { currency: undefined }]
      : [{ pid: 'other-merchant' }, { pid: null }, { pid: '' }, { pid: ['12345'] }]
    for (const changes of invalids) {
      const response = await callback(changes)
      const after = await prisma.rechargeRecord.findUniqueOrThrow({ where: { id: order.id } })
      console.log('Invalid signed callback:', type, Object.keys(changes).join(','), 'status:', response.statusCode, 'order:', after.status)
      assert.equal(response.statusCode, 400, 'signed callback must still match merchant and valid invoice amount')
      assert.deepEqual(after, order)
      assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance), balanceBefore)
      assert.equal(await prisma.balanceLog.count({ where: { orderId: order.orderNo } }), 0)
      assert.equal(await prisma.paymentCallback.count({ where: { orderNo: order.orderNo } }), 0)
    }
    await prisma.paymentProvider.update({ where: { id: provider.id }, data: { config: { ...config, ...(type === 'heleket' ? { currency: 'USD' } : { pid: '67890' }) } } })
    assert.equal((await callback(type === 'heleket' ? {} : { pid: 12345 })).statusCode, 200, 'the order merchant and currency snapshot remains authoritative after config changes')
    assert.equal((await callback()).statusCode, 200)
    assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance), Number((balanceBefore + 9).toFixed(2)))
    assert.equal(await prisma.balanceLog.count({ where: { orderId: order.orderNo } }), 1)
    console.log('PASS', type, 'invalid signed data rejected, current payment credited exactly once')
    for (const [expected, paid, accepted] of [[1, 1.01, true], [1.01, 1, true], [1.01, 0.999999, false], [1, 1.010001, type === 'heleket']] as const) {
      order = await prisma.rechargeRecord.create({ data: { orderNo: tag + randomUUID(), userId: user.id, providerId: provider.id,
        amount: expected, actualAmount: expected, providerConfigSnapshot: buildRechargeProviderConfigSnapshot(type === 'heleket' ? type : 'yipay', config) } })
      const before = Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance)
      const response = await callback(type === 'heleket' ? { amount: String(paid) } : { money: String(paid) })
      console.log('Callback tolerance:', type, expected, paid, response.statusCode)
      assert.equal(response.statusCode, accepted ? 200 : 400)
      assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance), Number((before + (accepted ? expected : 0)).toFixed(2)))
      assert.equal(await prisma.balanceLog.count({ where: { orderId: order.orderNo } }), accepted ? 1 : 0)
      if (!accepted) assert.deepEqual(await prisma.rechargeRecord.findUniqueOrThrow({ where: { id: order.id } }), order)
    }
  }
} catch (error) { failure = error }
finally {
  globalThis.fetch = originalFetch
  await app.close()
  await prisma.paymentCallback.deleteMany({ where: { providerId: { in: providerIds } } })
  await prisma.log.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.paymentProvider.deleteMany({ where: { id: { in: providerIds } } })
  await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
