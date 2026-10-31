import assert from 'node:assert/strict'
import { createHash, createSign, generateKeyPairSync, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'; process.env.ENCRYPTION_KEY = randomUUID()
process.env.PAYMENT_CALLBACK_IP_WHITELIST = '127.0.0.1'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const db = await import('../src/db/index.js')
const { default: routes } = await import('../src/routes/recharge.js')
const tag = 'cb-race-' + randomUUID(), app = Fastify(), providerIds: number[] = []
const keys = generateKeyPairSync('rsa', { modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
const originalFetch = globalThis.fetch
globalThis.fetch = async () => { throw Error('Unexpected outbound request during isolated callback test') }
app.decorate('authenticate', async (_request: any, reply: any) => reply.code(403).send())
app.decorate('requireAdmin', async (_request: any, reply: any) => reply.code(403).send())
let failure: unknown, gate: ((orderNo: string) => Promise<void>) | undefined
const originalCallbackRead = prisma.paymentCallback.findUnique.bind(prisma.paymentCallback)
prisma.paymentCallback.findUnique = (async (args: any) => {
  const result = await originalCallbackRead(args)
  await gate?.(args.where.providerId_orderNo_tradeNo?.orderNo)
  return result
}) as typeof prisma.paymentCallback.findUnique
try {
  assert.equal(await prisma.notificationChannel.count({ where: { alertCategory: 'payment', enabled: true } }), 0)
  const user = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
  await app.register(routes)
  let credited = 0, completed = 0
  for (const type of ['yipay', 'heleket', 'antom'] as const) {
    const secret = randomUUID()
    const config = type === 'yipay' ? { version: 'v1', apiurl: 'https://8.8.8.8', pid: 'fixture', key: secret }
      : type === 'heleket' ? { apiurl: 'https://8.8.8.8', merchant_uuid: randomUUID(), api_key: secret, currency: 'CNY' }
        : { apiurl: 'https://open-sea-global.alipay.com', clientId: 'fixture-client', environment: 'sandbox',
          antom_public_key: keys.publicKey, merchant_private_key: keys.privateKey, currency: 'CNY', currencyRate: 1, currencyExponent: 2 }
    const provider = await db.createPaymentProvider({ name: tag, type, status: 'active', config }); providerIds.push(provider.id)
    const states = type === 'yipay' ? ['paid'] : type === 'heleket' ? ['paid', 'check', 'cancel', 'fail'] : ['S', 'U', 'F']
    for (const method of type === 'yipay' ? ['GET', 'POST'] as const : ['POST'] as const) {
      for (const initial of ['null', 'attempt']) for (const state of states) {
        const orderNo = 'cb-' + randomUUID(), oldGateway = initial === 'attempt' ? orderNo + '--PA-123456789ABC' : orderNo
        const freshGateway = orderNo + '--PA-ABCDEF123456'
        const order = await prisma.rechargeRecord.create({ data: { orderNo, userId: user.id, providerId: provider.id, amount: 10, actualAmount: 9,
          ...(initial === 'attempt' ? { paymentDetails: { paymentAttempt: { current: {
            id: '123456789ABC', gatewayOrderNo: oldGateway, createdAt: new Date().toISOString()
          }, superseded: [] } } } : {}) } })
        let changes = 0, changed: unknown
        gate = async queried => {
          if (queried !== orderNo || changes) return
          changes++
          changed = await db.updatePendingRechargePaymentSelection(orderNo, { paymentMethod: 'replacement', fee: 0, actualAmount: 9,
            paymentDetails: { paymentAttempt: { current: { id: 'ABCDEF123456', gatewayOrderNo: freshGateway, createdAt: new Date().toISOString() }, superseded: [] } } })
          assert.ok(changed)
        }
        const callback = async (gateway: string, status: string, badSignature = false) => {
          const url = `/api/recharge/callback/${provider.id}`
          const payload: Record<string, unknown> = type === 'yipay'
            ? { pid: 'fixture', out_trade_no: gateway, trade_no: gateway, money: '10.00', trade_status: 'TRADE_SUCCESS', type: 'alipay' }
            : type === 'heleket' ? { order_id: gateway, uuid: gateway, amount: '10.00', currency: 'CNY', status }
              : { notifyType: 'PAYMENT_RESULT', paymentRequestId: gateway, paymentId: gateway,
                paymentAmount: { currency: 'CNY', value: '1000' }, result: { resultStatus: status, resultCode: status === 'S' ? 'SUCCESS' : 'PENDING' } }
          const headers: Record<string, string> = { 'content-type': 'application/json' }
          if (type === 'yipay') {
            const signed = Object.keys(payload).sort().map(key => `${key}=${payload[key]}`).join('&') + secret
            payload.sign = badSignature ? 'invalid' : createHash('md5').update(signed).digest('hex'); payload.sign_type = 'MD5'
          } else if (type === 'heleket') {
            const body = JSON.stringify(payload).replace(/\//g, '\\/')
            payload.sign = badSignature ? 'invalid' : createHash('md5').update(Buffer.from(body).toString('base64') + secret).digest('hex')
          } else {
            const body = JSON.stringify(payload), time = String(Date.now())
            const signer = createSign('RSA-SHA256'); signer.update(`POST ${url}\nfixture-client.${time}.${body}`); signer.end()
            headers['client-id'] = 'fixture-client'; headers['request-time'] = time
            headers.signature = 'algorithm=RSA256, keyVersion=1, signature=' + (badSignature ? 'invalid' : encodeURIComponent(signer.sign(keys.privateKey).toString('base64')))
          }
          return method === 'GET' ? app.inject({ method, url: url + '?' + new URLSearchParams(payload as Record<string, string>).toString() })
            : app.inject({ method, url, headers, payload: JSON.stringify(payload) })
        }
        const bad = await callback(oldGateway, state, true)
        assert.equal(bad.statusCode, 400); assert.equal(changes, 0, 'invalid signatures must not reach the race boundary')
        assert.deepEqual(await prisma.rechargeRecord.findUniqueOrThrow({ where: { id: order.id } }), order)
        const stale = await callback(oldGateway, state)
        const after = await prisma.rechargeRecord.findUniqueOrThrow({ where: { id: order.id } })
        if (stale.statusCode !== 409) console.log('Unexpected stale callback', type, state, method, initial, stale.statusCode, after.status,
          'balance', Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance))
        assert.equal(stale.statusCode, 409); assert.equal(changes, 1); assert.deepEqual(after, changed)
        assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance), credited)
        assert.equal(await prisma.paymentCallback.count({ where: { orderNo } }), 0)
        assert.equal(await prisma.balanceLog.count({ where: { userId: user.id } }), completed)
        assert.equal(await prisma.inboxMessage.count({ where: { userId: user.id } }), completed)
        gate = undefined
        const replay = await callback(oldGateway, state)
        assert.equal(replay.statusCode, 200, 'superseded callbacks retain the original acknowledged-ignore behavior on retry')
        assert.deepEqual(await prisma.rechargeRecord.findUniqueOrThrow({ where: { id: order.id } }), changed)
        assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance), credited)
        const success = await callback(freshGateway, type === 'antom' ? 'S' : 'paid')
        assert.equal(success.statusCode, 200, success.body)
        credited += 9; completed++
        assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance), credited)
        assert.equal(await prisma.balanceLog.count({ where: { userId: user.id } }), completed)
        assert.equal(await prisma.inboxMessage.count({ where: { userId: user.id } }), completed)
        assert.equal((await callback(freshGateway, type === 'antom' ? 'S' : 'paid')).statusCode, 200)
        assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance), credited)
        console.log('PASS signed callback', type, state, method, initial, 'stale conflict, ignored old retry and one valid new credit')
      }
    }
  }
} catch (error) { failure = error }
finally {
  gate = undefined; prisma.paymentCallback.findUnique = originalCallbackRead; globalThis.fetch = originalFetch
  await app.close(); await delay(100)
  await prisma.paymentCallback.deleteMany({ where: { providerId: { in: providerIds } } })
  await prisma.log.deleteMany({ where: { user: { username: tag } } })
  await prisma.user.deleteMany({ where: { username: tag } })
  await prisma.paymentProvider.deleteMany({ where: { id: { in: providerIds } } }); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
