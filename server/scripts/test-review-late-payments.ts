import assert from 'node:assert/strict'
import { createHash, createSign, generateKeyPairSync, randomUUID } from 'node:crypto'
import Fastify from 'fastify'
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(database.hostname === '127.0.0.1' && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'; process.env.ENCRYPTION_KEY = randomUUID(); process.env.PAYMENT_CALLBACK_IP_WHITELIST = '127.0.0.1'
const schedule = globalThis.setInterval
globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => { const timer = schedule(...args); timer.unref(); return timer }) as typeof setInterval
try { await import('../src/lib/security.js') } finally { globalThis.setInterval = schedule }
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const db = await import('../src/db/index.js')
const { default: recharge } = await import('../src/routes/recharge.js')
const { default: adminRoutes } = await import('../src/routes/admin-billing.js')
const app = Fastify(), tag = 'late-pay-' + randomUUID(), secret = randomUUID(), oldFetch = globalThis.fetch
let actor: any, failure: unknown, providerId = 0
const users: number[] = []
app.decorate('authenticate', async (req: any) => { req.user = { ...actor } })
app.decorate('authenticateAdmin', async (req: any) => { req.user = { ...actor } })
app.decorate('requireAdmin', async (_req: any, reply: any) => { if (actor.role !== 'admin') return reply.code(403).send() })
await app.register(recharge); await app.register(adminRoutes)
globalThis.fetch = async () => { throw Error('No external payment or notification allowed') }
try {
  const buyer = await prisma.user.create({ data: { username: tag, passwordHash: 'fixture' } }); users.push(buyer.id)
  const admin = await prisma.user.create({ data: { username: tag + '-admin', passwordHash: 'fixture', role: 'admin' } }); users.push(admin.id)
  actor = { id: admin.id, username: admin.username, role: 'admin', sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
  const provider = await db.createPaymentProvider({ name: tag, type: 'yipay', status: 'active', config: { version: 'v1', apiurl: 'https://8.8.8.8', pid: 'fixture', key: secret } }); providerId = provider.id
  const make = (status: 'pending' | 'cancelled' | 'failed' | 'refunded' = 'cancelled', cancelReason: string | null = 'timeout') => prisma.rechargeRecord.create({ data: {
    userId: buyer.id, providerId, orderNo: randomUUID(), amount: 10, actualAmount: 9, status, cancelReason, expiredAt: new Date(Date.now() - 8 * 3600000)
  } })
  const send = (orderNo: string, trade = orderNo, money = '10.00', badSign = false) => {
    const payload: Record<string, string> = { pid: 'fixture', out_trade_no: orderNo, trade_no: trade, money, trade_status: 'TRADE_SUCCESS', type: 'alipay' }
    payload.sign = badSign ? 'invalid' : createHash('md5').update(Object.keys(payload).sort().map(key => `${key}=${payload[key]}`).join('&') + secret).digest('hex')
    payload.sign_type = 'MD5'
    return app.inject({ method: 'POST', url: `/api/recharge/callback/${providerId}`, payload })
  }
  const balance = async () => Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance)
  const proof = (id: number) => prisma.rechargeLatePayment.findFirstOrThrow({ where: { rechargeId: id } })
  const resolve = (id: number, action = 'credit') => app.inject({ method: 'POST', url: `/api/admin/billing/late-payments/${id}/resolve`, payload: { action, note: '已核对平台到账及退款记录' } })
  const timeout = await make()
  assert.equal((await send(timeout.orderNo, timeout.orderNo, '10.00', true)).statusCode, 400)
  assert.equal((await send(timeout.orderNo, timeout.orderNo, '1.00')).statusCode, 400)
  assert.equal(await balance(), 0); assert.equal(await prisma.rechargeLatePayment.count({ where: { rechargeId: timeout.id } }), 0)
  const parallel = await Promise.all(Array.from({ length: 5 }, () => send(timeout.orderNo)))
  assert.ok(parallel.every(r => r.statusCode === 200), parallel.map(r => r.body).join('\n'))
  assert.equal(await balance(), 9); assert.equal((await proof(timeout.id)).status, 'credited')
  assert.equal(await prisma.balanceLog.count({ where: { orderId: timeout.orderNo } }), 1)
  assert.equal(await prisma.rechargeLatePayment.count({ where: { rechargeId: timeout.id } }), 1)
  const originalRead = prisma.paymentCallback.findUnique.bind(prisma.paymentCallback)
  for (const reason of ['timeout', 'user'] as const) {
    const race = await make('pending', null), before = await balance()
    let injected = false
    prisma.paymentCallback.findUnique = (async (args: any) => {
      if (!injected && args.where.providerId_orderNo_tradeNo?.orderNo === race.orderNo) {
        injected = true
        await db.cancelRecharge(race.orderNo, undefined, undefined, undefined, undefined, reason)
      }
      return originalRead(args)
    }) as typeof prisma.paymentCallback.findUnique
    try {
      const response = await send(race.orderNo)
      assert.equal(response.statusCode, 200, response.body); assert.equal(injected, true)
      assert.equal(await balance(), before + (reason === 'timeout' ? 9 : 0))
      assert.equal((await proof(race.id)).status, reason === 'timeout' ? 'credited' : 'pending')
    } finally { prisma.paymentCallback.findUnique = originalRead }
  }
  for (const [state, reason] of [['cancelled', 'user'], ['cancelled', null], ['failed', null], ['refunded', null]] as const) {
    const order = await make(state, reason), before = await balance()
    assert.equal((await send(order.orderNo)).statusCode, 200)
    const item = await proof(order.id)
    assert.equal(item.status, 'pending'); assert.equal(await balance(), before)
    assert.equal((await send(order.orderNo)).statusCode, 200); assert.equal(await prisma.rechargeLatePayment.count({ where: { rechargeId: order.id } }), 1)
    if (state === 'refunded') {
      assert.equal(item.eligible, false); assert.equal((await resolve(item.id)).statusCode, 409)
      assert.equal((await resolve(item.id, 'resolve')).statusCode, 200); assert.equal(await balance(), before)
    } else {
      await prisma.tokenInvalidation.create({ data: { userId: admin.id, sessionId: tag, invalidatedAt: actor.iat } })
      assert.equal((await resolve(item.id)).statusCode, 403)
      await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } })
      const resolutions = await Promise.all([resolve(item.id), resolve(item.id)])
      assert.ok(resolutions.every(r => [200, 409].includes(r.statusCode)), resolutions.map(r => r.body).join('\n'))
      assert.equal(await balance(), before + 9); assert.equal((await proof(order.id)).status, 'credited')
    }
  }
  const duplicate = await make()
  assert.equal((await send(duplicate.orderNo, timeout.orderNo)).statusCode, 200)
  assert.equal((await proof(duplicate.id)).reason, 'duplicate_trade'); assert.equal((await proof(duplicate.id)).eligible, false)
  assert.equal((await resolve((await proof(duplicate.id)).id)).statusCode, 409)
  const old = await make('pending', null)
  await db.updatePendingRechargePaymentSelection(old.orderNo, { fee: 0, actualAmount: 9, paymentDetails: { paymentAttempt: { current: { id: '123456789ABC', gatewayOrderNo: old.orderNo + '--PA-123456789ABC', createdAt: new Date().toISOString() } } } })
  const beforeOld = await balance()
  assert.equal((await send(old.orderNo)).statusCode, 200); assert.equal((await proof(old.id)).reason, 'superseded_attempt')
  assert.equal((await resolve((await proof(old.id)).id)).statusCode, 409); assert.equal(await balance(), beforeOld)
  const expires = await make('pending', null)
  assert.equal(await db.expireOrders([expires.orderNo]), 1)
  assert.equal((await prisma.rechargeRecord.findUniqueOrThrow({ where: { id: expires.id } })).cancelReason, 'timeout')
  assert.equal((await send(expires.orderNo)).statusCode, 200)
  const retry = await make(), beforeRollback = await balance(), trigger = 'late_fail_' + randomUUID().replaceAll('-', '')
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.order_id = '${retry.orderNo}' THEN RAISE EXCEPTION 'late receipt rollback'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON balance_logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  try {
    assert.equal((await send(retry.orderNo)).statusCode, 500); assert.equal(await balance(), beforeRollback)
    assert.equal((await prisma.rechargeRecord.findUniqueOrThrow({ where: { id: retry.id } })).status, 'cancelled')
    assert.equal(await prisma.rechargeLatePayment.count({ where: { rechargeId: retry.id } }), 0)
  } finally { await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON balance_logs`); await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`) }
  assert.equal((await send(retry.orderNo)).statusCode, 200); assert.equal(await balance(), beforeRollback + 9)
  const query = await make(), adminQuery = await make()
  globalThis.fetch = async input => {
    const url = new URL(String(input)); assert.equal(url.hostname, '8.8.8.8')
    const orderNo = url.searchParams.get('out_trade_no')
    return new Response(JSON.stringify({ code: 1, status: 1, out_trade_no: orderNo, trade_no: orderNo, money: '10.00' }), { headers: { 'content-type': 'application/json' } })
  }
  actor = { ...actor, id: buyer.id, role: 'user' }
  const beforeQuery = await balance(), verification = await app.inject({ method: 'POST', url: `/api/recharge/orders/${query.orderNo}/verify` })
  assert.equal(verification.statusCode, 200, verification.body); assert.equal(verification.json().verified, true)
  actor = { ...actor, id: admin.id, role: 'admin' }
  const sync = await app.inject({ method: 'POST', url: `/api/admin/billing/recharge-records/${adminQuery.id}/sync` })
  assert.equal(sync.statusCode, 200, sync.body); assert.equal(sync.json().synced, true); assert.equal(await balance(), beforeQuery + 18)
  const list = await app.inject({ method: 'GET', url: '/api/admin/billing/late-payments?status=pending' })
  assert.equal(list.statusCode, 200); assert.ok(list.json().records.some((r: any) => r.orderNo === duplicate.orderNo))
  assert.ok(!list.body.includes('proof') && !list.body.includes('expectedPaymentDetails'), 'operator list omits raw callbacks')
  globalThis.fetch = async () => { throw Error('No external request allowed') }
  for (const type of ['heleket', 'antom'] as const) {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
    const config = type === 'heleket' ? { apiurl: 'https://8.8.8.8', merchant_uuid: randomUUID(), api_key: secret, currency: 'CNY' }
      : { apiurl: 'https://open-sea-global.alipay.com', clientId: 'fixture-client', environment: 'sandbox', antom_public_key: keys.publicKey, merchant_private_key: keys.privateKey, currency: 'CNY', currencyRate: 1, currencyExponent: 2 }
    const channel = await db.createPaymentProvider({ name: tag, type, status: 'active', config })
    try {
      const paid = await make(), cancelled = await make()
      await prisma.rechargeRecord.updateMany({ where: { id: { in: [paid.id, cancelled.id] } }, data: { providerId: channel.id } })
      const callback = (orderNo: string, state: string, currency = 'CNY') => {
        const url = `/api/recharge/callback/${channel.id}`
        const payload: Record<string, unknown> = type === 'heleket' ? { order_id: orderNo, uuid: orderNo, amount: '10.00', currency, status: state }
          : { notifyType: 'PAYMENT_RESULT', paymentRequestId: orderNo, paymentId: orderNo, paymentAmount: { currency, value: '1000' }, result: { resultStatus: state, resultCode: state === 'S' ? 'SUCCESS' : 'PENDING' } }
        const headers: Record<string, string> = { 'content-type': 'application/json' }
        if (type === 'heleket') payload.sign = createHash('md5').update(Buffer.from(JSON.stringify(payload).replace(/\//g, '\\/')).toString('base64') + secret).digest('hex')
        else {
          const time = String(Date.now()), signer = createSign('RSA-SHA256')
          signer.update(`POST ${url}\nfixture-client.${time}.${JSON.stringify(payload)}`); signer.end()
          headers['client-id'] = 'fixture-client'; headers['request-time'] = time
          headers.signature = 'algorithm=RSA256, keyVersion=1, signature=' + encodeURIComponent(signer.sign(keys.privateKey).toString('base64'))
        }
        return app.inject({ method: 'POST', url, headers, payload: JSON.stringify(payload) })
      }
      const before = await balance(), state = type === 'heleket' ? 'paid' : 'S'
      assert.equal((await callback(paid.orderNo, state, 'USD')).statusCode, 400); assert.equal(await balance(), before)
      assert.equal((await callback(paid.orderNo, state)).statusCode, 200); assert.equal(await balance(), before + 9)
      assert.equal((await callback(paid.orderNo, state)).statusCode, 200); assert.equal(await balance(), before + 9)
      assert.equal((await callback(cancelled.orderNo, type === 'heleket' ? 'check' : 'U')).statusCode, 200)
      assert.equal((await prisma.rechargeRecord.findUniqueOrThrow({ where: { id: cancelled.id } })).cancelReason, 'timeout')
      assert.equal((await callback(cancelled.orderNo, type === 'heleket' ? 'cancel' : 'F')).statusCode, 200)
      assert.equal((await prisma.rechargeRecord.findUniqueOrThrow({ where: { id: cancelled.id } })).cancelReason, 'provider')
      assert.equal((await callback(cancelled.orderNo, state)).statusCode, 200)
      assert.equal((await proof(cancelled.id)).status, 'pending'); assert.equal(await balance(), before + 9)
    } finally {
      await prisma.paymentCallback.deleteMany({ where: { providerId: channel.id } })
      await prisma.rechargeRecord.deleteMany({ where: { providerId: channel.id } }); await prisma.paymentProvider.delete({ where: { id: channel.id } })
    }
  }
  console.log('PASS late payments: signed amount checks, concurrent timeout credit once, terminal review/admin authorization, duplicate trades, old attempts, rollback, expire marker, verify and admin sync')
} catch (error) { failure = error }
finally {
  globalThis.fetch = oldFetch; await app.close()
  await prisma.paymentCallback.deleteMany({ where: { providerId } }); await prisma.log.deleteMany({ where: { userId: { in: users } } })
  await prisma.user.deleteMany({ where: { id: { in: users } } }); if (providerId) await prisma.paymentProvider.delete({ where: { id: providerId } })
  await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exitCode = 1 }
