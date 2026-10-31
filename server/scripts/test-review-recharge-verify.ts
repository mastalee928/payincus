import assert from 'node:assert/strict'
import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto'
import dnsPromises from 'node:dns/promises'
import { syncBuiltinESMExports } from 'node:module'
import { mock } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'; process.env.ENCRYPTION_KEY = randomUUID()
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const db = await import('../src/db/index.js')
const { default: routes } = await import('../src/routes/recharge.js')
const { safeOutboundDispatcher } = await import('../src/lib/outbound-security.js')
const tag = 'verify-' + randomUUID(), originalFetch = globalThis.fetch
const antomHost = 'open-sea-global.alipay.com', oldLookup = dnsPromises.lookup
mock.method(dnsPromises, 'lookup', ((host: string, ...args: any[]) => host === antomHost
  ? Promise.resolve([{ address: '8.8.8.8', family: 4 }]) : Reflect.apply(oldLookup, dnsPromises, [host, ...args])) as typeof dnsPromises.lookup)
syncBuiltinESMExports()
const keys = generateKeyPairSync('rsa', { modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
const app = Fastify(), providerIds: number[] = []
let actorId = 0, failure: unknown, query: (url: URL, settings: RequestInit) => Promise<Response>
app.decorate('authenticate', async (request: any) => { request.user = { id: actorId, role: 'user', sid: tag, iat: Math.floor(Date.now() / 1000) + 1 } })
app.decorate('requireAdmin', async (_request: any, reply: any) => reply.code(403).send({ error: 'FORBIDDEN' }))
globalThis.fetch = (async (input, options) => {
  const url = new URL(String(input)), settings = options as RequestInit & { dispatcher?: unknown }
  assert.ok(['8.8.8.8', antomHost].includes(url.hostname), 'No external notification or provider request')
  assert.equal(settings.redirect, 'manual'); assert.equal(settings.dispatcher, safeOutboundDispatcher)
  return query(url, settings)
}) as typeof fetch
try {
  assert.equal(await prisma.notificationChannel.count({ where: { alertCategory: 'payment', enabled: true } }), 0,
    'fixture database must have no enabled payment alert channels')
  const user = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } }); actorId = user.id
  await app.register(routes)
  let expectedBalance = 0, completed = 0
  for (const type of ['yipay', 'heleket', 'antom'] as const) {
    const config = type === 'yipay' ? { version: 'v1', apiurl: 'https://8.8.8.8', pid: 'fixture', key: randomUUID() }
      : type === 'heleket' ? { apiurl: 'https://8.8.8.8', merchant_uuid: randomUUID(), api_key: randomUUID(), currency: 'CNY' }
        : { apiurl: `https://${antomHost}`, environment: 'sandbox', clientId: 'fixture-client',
          antom_public_key: keys.publicKey, merchant_private_key: keys.privateKey, currency: 'CNY', currencyRate: 1, currencyExponent: 2 }
    const provider = await db.createPaymentProvider({ name: tag, type, status: 'active', config }); providerIds.push(provider.id)
    const states = type === 'yipay' ? ['paid'] : type === 'heleket' ? ['paid', 'check', 'cancel', 'fail'] : ['SUCCESS', 'PROCESSING', 'CANCELLED', 'FAIL']
    for (const initial of ['null', 'attempt'] as const) for (const state of states) {
      const orderNo = 'verify-' + randomUUID()
      let gatewayOrderNo = initial === 'attempt' ? orderNo + '--PA-123456789ABC' : orderNo
      const order = await prisma.rechargeRecord.create({ data: { orderNo, userId: user.id, providerId: provider.id, amount: 10, actualAmount: 9,
        ...(initial === 'attempt' ? { paymentDetails: { paymentAttempt: { current: {
          id: '123456789ABC', gatewayOrderNo, createdAt: new Date().toISOString()
        }, superseded: [] } } } : {}) } })
      let drift = true, resultState = state, changed: unknown, returnedCurrency: unknown = 'CNY'
      let returnedAmount = '10.00'
      query = async (url, settings) => {
        const input = type === 'yipay' ? url.searchParams.get('out_trade_no') : JSON.parse(String(settings.body))[type === 'heleket' ? 'order_id' : 'paymentRequestId']
        assert.equal(input, gatewayOrderNo)
        if (drift) changed = await db.updatePendingRechargePaymentSelection(orderNo, { paymentMethod: 'new-payment', fee: 0, actualAmount: 9,
          paymentDetails: { paymentAttempt: { current: { id: 'ABCDEF123456', gatewayOrderNo: orderNo + '--PA-ABCDEF123456', createdAt: new Date().toISOString() }, superseded: [] } } })
        const result = type === 'yipay' ? { code: 1, status: 1, out_trade_no: input, trade_no: orderNo, money: returnedAmount }
          : type === 'heleket' ? { state: 0, result: { order_id: input, uuid: orderNo, status: resultState, amount: returnedAmount, currency: returnedCurrency } }
            : { result: { resultStatus: 'S', resultCode: 'SUCCESS' }, paymentStatus: resultState, paymentRequestId: input,
              paymentId: orderNo, paymentAmount: { currency: 'CNY', value: '1000' } }
        const body = JSON.stringify(result), headers: Record<string, string> = { 'content-type': 'application/json' }
        if (type === 'antom') {
          const time = String(Date.now()), clientId = 'fixture-client'
          const signer = createSign('RSA-SHA256'); signer.update(`POST ${url.pathname}\n${clientId}.${time}.${body}`); signer.end()
          headers['client-id'] = clientId; headers['response-time'] = time
          headers.signature = 'algorithm=RSA256, keyVersion=1, signature=' + encodeURIComponent(signer.sign(keys.privateKey).toString('base64'))
        }
        return new Response(body, { headers })
      }
      const verify = () => app.inject({ method: 'POST', url: `/api/recharge/orders/${orderNo}/verify` })
      if (type === 'heleket' && state === 'paid') {
        drift = false
        const capture = async () => ({
          user: await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
          record: await prisma.rechargeRecord.findUniqueOrThrow({ where: { id: order.id } }),
          ledger: await prisma.balanceLog.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } }),
          inbox: await prisma.inboxMessage.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } }),
          callbacks: await prisma.paymentCallback.findMany({ where: { orderNo }, orderBy: { id: 'asc' } })
        })
        const before = await capture()
        for (const currency of ['USD', '', null, undefined]) {
          returnedCurrency = currency
          const invalid = await verify()
          assert.equal(invalid.statusCode, 200, invalid.body)
          assert.equal(invalid.json().verified, false, 'missing or foreign currency must not verify payment')
          assert.deepEqual(await capture(), before, 'invalid currency must preserve order and all accounting')
        }
        returnedCurrency = 'CNY'; drift = true
        console.log('PASS user verify currency binding', initial, 'four invalid currencies leave accounting unchanged')
      }
      const stale = await verify(), after = await prisma.rechargeRecord.findUniqueOrThrow({ where: { id: order.id } })
      if (stale.statusCode !== 409) console.log('Unexpected stale user verify', type, state, initial, stale.statusCode, after.status,
        'balance', Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance))
      assert.equal(stale.statusCode, 409, 'stale provider query must not mutate the replacement payment attempt')
      assert.deepEqual(after, changed)
      assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance), expectedBalance)
      assert.equal(await prisma.paymentCallback.count({ where: { orderNo } }), 0)
      assert.equal(await prisma.balanceLog.count({ where: { userId: user.id } }), completed)
      assert.equal(await prisma.inboxMessage.count({ where: { userId: user.id } }), completed)
      drift = false; gatewayOrderNo = orderNo + '--PA-ABCDEF123456'; resultState = type === 'antom' ? 'SUCCESS' : 'paid'
      if (type !== 'antom') {
        // Exact cent boundary with the credited amount remaining below the payable amount.
        const current = await prisma.rechargeRecord.update({ where: { id: order.id }, data: { amount: 10.05 } })
        returnedAmount = '10.039999'
        const rejected = await verify()
        assert.equal(rejected.json().verified, false)
        assert.deepEqual(await prisma.rechargeRecord.findUniqueOrThrow({ where: { id: order.id } }), current)
        assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance), expectedBalance)
        returnedAmount = '10.04'
      }
      const normal = await verify(); assert.equal(normal.statusCode, 200, normal.body); assert.equal(normal.json().verified, true)
      completed++; expectedBalance += 9
      assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance), expectedBalance)
      assert.equal(await prisma.balanceLog.count({ where: { userId: user.id } }), completed)
      assert.equal(await prisma.inboxMessage.count({ where: { userId: user.id } }), completed)
      assert.equal(await prisma.paymentCallback.count({ where: { orderNo } }), 1)
      console.log('PASS user verify', type, state, initial, 'stale 409 preserves replacement and accounting; fresh query settles once')
    }
  }
} catch (error) { failure = error }
finally {
  globalThis.fetch = originalFetch; mock.restoreAll(); syncBuiltinESMExports(); await app.close(); await safeOutboundDispatcher.close()
  await delay(100)
  await prisma.paymentCallback.deleteMany({ where: { providerId: { in: providerIds } } })
  await prisma.log.deleteMany({ where: { user: { username: tag } } })
  await prisma.user.deleteMany({ where: { username: tag } })
  await prisma.paymentProvider.deleteMany({ where: { id: { in: providerIds } } }); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
