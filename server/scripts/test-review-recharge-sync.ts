import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import Fastify from 'fastify'
import { Prisma } from '@prisma/client'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
process.env.ENCRYPTION_KEY = randomUUID()
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const providers = await import('../src/db/payment-providers.js')
const { buildRechargeProviderConfigSnapshot } = await import('../src/lib/recharge-provider-snapshot.js')
const { default: routes } = await import('../src/routes/admin-billing.js')
const { safeOutboundDispatcher } = await import('../src/lib/outbound-security.js')
const { updatePendingRechargePaymentSelection } = await import('../src/db/recharge-records.js')
const tag = 'sync-review-' + randomUUID(), originalFetch = globalThis.fetch, app = Fastify()
let actor: any, query: (input: string, settings: RequestInit) => Promise<Response>
let requests = 0, failure: unknown
const providerIds: number[] = []
app.decorate('authenticate', async (request: any) => { request.user = actor })
app.decorate('requireAdmin', async (_request: any, reply: any) => {
  if (actor.role !== 'admin') return reply.code(403).send({ error: 'FORBIDDEN' })
})
app.decorate('authenticateAdmin', async (request: any) => { request.user = actor })
globalThis.fetch = (async (input, options) => {
  const settings = options as RequestInit & { dispatcher?: unknown }
  assert.equal(new URL(String(input)).hostname, '8.8.8.8', 'No external payment provider request')
  assert.equal(settings.redirect, 'manual'); assert.equal(settings.dispatcher, safeOutboundDispatcher)
  requests++; return query(String(input), settings)
}) as typeof fetch
try {
  const user = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
  const admin = await prisma.user.create({ data: { username: tag + '-admin', passwordHash: 'unusable-fixture', role: 'admin' } })
  actor = { id: admin.id, username: admin.username, role: 'admin', sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
  await app.register(routes)
  let expectedBalance = 0, completedOrders = 0
  for (const type of ['yipay', 'heleket'] as const) {
    for (const mode of ['encrypted', 'legacy-string', 'legacy-object', 'snapshot', 'concurrent', 'payment-attempt', 'json-null', 'changed-during-query', 'changed-from-null'] as const) {
      const secret = randomUUID(), merchant = randomUUID()
      const current: Record<string, unknown> = type === 'yipay'
        ? { version: 'v1', apiurl: 'https://8.8.8.8/current/', pid: merchant, key: secret }
        : { apiurl: 'https://8.8.8.8/current/', merchant_uuid: merchant, api_key: secret, currency: 'CNY' }
      const provider = await providers.createPaymentProvider({ name: tag, type, status: 'active', config: current })
      providerIds.push(provider.id)
      const stored = await prisma.paymentProvider.findUniqueOrThrow({ where: { id: provider.id } })
      assert.equal(typeof stored.config, 'string')
      assert.ok(!JSON.stringify(stored.config).includes(secret), 'database config must be encrypted')
      if (mode === 'legacy-string' || mode === 'legacy-object') {
        await prisma.paymentProvider.update({ where: { id: provider.id }, data: {
          config: mode === 'legacy-string' ? JSON.stringify(current) : current as any
        } })
      }
      const effective = mode === 'snapshot' ? { ...current, apiurl: 'https://8.8.8.8/snapshot/' } : current
      const snapshot = mode === 'snapshot' ? buildRechargeProviderConfigSnapshot(type, effective) : undefined
      if (mode === 'snapshot') {
        await providers.updatePaymentProvider(provider.id, { config: { ...current, key: randomUUID(), api_key: randomUUID() } })
        assert.ok(!snapshot!.includes(secret), 'order snapshot must also be encrypted')
      }
      const order = await prisma.rechargeRecord.create({ data: {
        userId: user.id, providerId: provider.id, amount: 10, actualAmount: 9, orderNo: 'sync-' + randomUUID(),
        providerConfigSnapshot: snapshot,
        ...(mode === 'json-null' ? { paymentDetails: Prisma.JsonNull } : {})
      } })
      let gatewayOrderNo = mode === 'payment-attempt' || mode === 'changed-during-query' ? `${order.orderNo}--PA-123456789ABC` : order.orderNo
      if (mode === 'payment-attempt' || mode === 'changed-during-query') await prisma.rechargeRecord.update({ where: { id: order.id }, data: { paymentDetails: {
        paymentAttempt: { current: { id: '123456789ABC', gatewayOrderNo, createdAt: new Date().toISOString() }, superseded: [] }
      } } })
      let arrived = 0, release: (() => void) | undefined
      let returnedOrder: unknown = gatewayOrderNo
      let returnedStatus = 'paid'
      let afterQuery: (() => Promise<void>) | undefined
      const barrier = mode === 'concurrent' ? new Promise<void>(resolve => { release = resolve }) : undefined
      query = async (input, settings) => {
        const url = new URL(input)
        assert.ok(url.pathname.startsWith(mode === 'snapshot' ? '/snapshot/' : '/current/'))
        if (type === 'yipay') {
          assert.equal(settings.method, 'GET')
          assert.ok(url.searchParams.get('key') === secret && url.searchParams.get('pid') === merchant,
            'provider query must use decrypted effective credentials')
          if (url.searchParams.get('out_trade_no') !== gatewayOrderNo) console.log('Wrong query target', type, mode, 'current payment attempt was ignored')
          assert.equal(url.searchParams.get('out_trade_no'), gatewayOrderNo)
        } else {
          assert.equal(settings.method, 'POST')
          const headers = new Headers(settings.headers), body = String(settings.body)
          assert.ok(headers.get('merchant') === merchant && headers.get('sign') ===
            createHash('md5').update(Buffer.from(body).toString('base64') + secret).digest('hex'),
          'provider query must sign with decrypted effective credentials')
          if (JSON.parse(body).order_id !== gatewayOrderNo) console.log('Wrong query target', type, mode, 'current payment attempt was ignored')
          assert.equal(JSON.parse(body).order_id, gatewayOrderNo)
        }
        arrived++; await barrier; await afterQuery?.()
        return new Response(JSON.stringify(type === 'yipay'
          ? { code: 1, status: 1, money: '10.00', trade_no: order.orderNo, out_trade_no: returnedOrder }
          : { state: 0, result: { order_id: returnedOrder, uuid: order.orderNo, status: returnedStatus, amount: '10.00', currency: 'CNY' } }),
        { headers: { 'content-type': 'application/json' } })
      }
      const sync = () => app.inject({ method: 'POST', url: `/api/admin/billing/recharge-records/${order.id}/sync` })
      if (mode === 'changed-during-query' || mode === 'changed-from-null') {
        const states = type === 'heleket' ? ['paid', 'check', 'cancel', 'fail'] : ['paid']
        for (const status of states) {
          if (mode === 'changed-from-null') {
            await prisma.rechargeRecord.update({ where: { id: order.id }, data: { paymentDetails: Prisma.DbNull } })
            gatewayOrderNo = order.orderNo; returnedOrder = gatewayOrderNo
          }
          returnedStatus = status
          let changedRecord: unknown
          afterQuery = async () => {
            const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()
            const current = { id: suffix, gatewayOrderNo: `${order.orderNo}--PA-${suffix}`, createdAt: new Date().toISOString() }
            changedRecord = await updatePendingRechargePaymentSelection(order.orderNo, { paymentDetails: { paymentAttempt: { current, superseded: [] } },
              paymentMethod: 'new-attempt', fee: 0, actualAmount: 9 })
            assert.ok(changedRecord)
          }
          const result = await sync()
          const after = await prisma.rechargeRecord.findUniqueOrThrow({ where: { id: order.id } })
          if (result.statusCode !== 409) console.log('Unexpected stale query', type, status, result.statusCode, after.status,
            'balance', Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance))
          assert.equal(result.statusCode, 409, 'a payment selection changed during query must reject the stale result')
          assert.deepEqual(after, changedRecord)
          assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance), expectedBalance)
          assert.equal(await prisma.balanceLog.count({ where: { userId: user.id } }), completedOrders)
          assert.equal(await prisma.inboxMessage.count({ where: { userId: user.id } }), completedOrders)
          assert.equal(await prisma.paymentCallback.count({ where: { providerId: provider.id } }), 0)
          gatewayOrderNo = (after.paymentDetails as any).paymentAttempt.current.gatewayOrderNo
          returnedOrder = gatewayOrderNo
        }
        afterQuery = undefined; returnedStatus = 'paid'
        console.log('PASS', type, 'payment selection changes during paid/metadata/terminal queries preserve the new attempt and all accounting')
      }
      if (mode === 'encrypted') {
        const capture = async () => ({
          user: await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
          record: await prisma.rechargeRecord.findUniqueOrThrow({ where: { id: order.id } }),
          balance: await prisma.balanceLog.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } }),
          inbox: await prisma.inboxMessage.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } }),
          callbacks: await prisma.paymentCallback.findMany({ where: { providerId: provider.id }, orderBy: { id: 'asc' } }),
          audit: await prisma.log.findMany({ where: { userId: admin.id }, orderBy: { id: 'asc' } })
        })
        const before = await capture()
        for (const foreign of ['different-order', undefined, null, '', ' ', 123]) {
          returnedOrder = foreign
          const response = await sync()
          if (response.statusCode !== 400) {
            const after = await capture()
            console.log('Unexpected mismatched order result', type, response.statusCode, after.record.status,
              'balance delta', Number(after.user.balance) - Number(before.user.balance),
              'new ledger', after.balance.length - before.balance.length, 'new inbox', after.inbox.length - before.inbox.length)
          }
          assert.equal(response.statusCode, 400, `${type}: mismatched provider order must reject`)
          assert.deepEqual(await capture(), before, 'wrong provider order must not change accounting, callbacks or notifications')
        }
        if (type === 'heleket') for (const status of ['check', 'cancel', 'fail']) {
          returnedOrder = 'different-order'; returnedStatus = status
          assert.equal((await sync()).statusCode, 400)
          assert.deepEqual(await capture(), before, 'foreign unpaid/terminal query must not change order metadata or state')
        }
        returnedOrder = order.orderNo; returnedStatus = 'paid'
        console.log('PASS', type, 'missing/foreign provider order rejected before every state or accounting mutation')
      }
      const expectedRequests = mode === 'concurrent' ? 8 : 1
      const pending = Promise.all(Array.from({ length: expectedRequests }, () => sync()))
      if (barrier) {
        try {
          for (const until = Date.now() + 8000; arrived < expectedRequests && Date.now() < until;) await delay(10)
          assert.equal(arrived, expectedRequests, 'all concurrent queries must observe the pending order')
        } finally { release!() }
      }
      const results = await pending
      for (const result of results) assert.equal(result.statusCode, 200, result.body)
      assert.equal(results.filter(result => result.json().synced === true).length, 1)
      expectedBalance += 9; completedOrders++
      const ledger = await prisma.balanceLog.findMany({ where: { userId: user.id, orderId: order.orderNo } })
      const messages = await prisma.inboxMessage.findMany({ where: { userId: user.id, eventType: 'recharge_success', data: { path: ['orderNo'], equals: order.orderNo } } })
      assert.equal(ledger.length, 1); assert.equal(Number(ledger[0].amount), 9)
      assert.equal(messages.length, 1); assert.equal((messages[0].data as any).amount, 9)
      assert.equal(await prisma.paymentCallback.count({ where: { providerId: provider.id, orderNo: order.orderNo } }), 1)
      assert.equal(await prisma.log.count({ where: { userId: admin.id, action: 'admin.recharge.sync', content: { contains: order.orderNo } } }), 1)
      assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance), expectedBalance)
      const settled = await prisma.rechargeRecord.findUniqueOrThrow({ where: { id: order.id } }), beforeRequests = requests
      assert.equal(settled.status, 'completed')
      for (let retry = 0; retry < 3; retry++) {
        const result = await sync(); assert.equal(result.statusCode, 200); assert.equal(result.json().synced, false)
      }
      assert.equal(requests, beforeRequests, 'completed retries must not query the provider again')
      assert.deepEqual(await prisma.rechargeRecord.findUniqueOrThrow({ where: { id: order.id } }), settled)
      assert.equal(await prisma.inboxMessage.count({ where: { userId: user.id } }), completedOrders)
      assert.equal(await prisma.balanceLog.count({ where: { userId: user.id } }), completedOrders)
      console.log('PASS admin recharge sync', type, mode, expectedRequests, 'queries, single credit/ledger/callback/audit/inbox; completed retries have no effects')
    }
  }
} catch (error) { failure = error }
finally {
  globalThis.fetch = originalFetch; await app.close(); await safeOutboundDispatcher.close()
  await prisma.paymentCallback.deleteMany({ where: { providerId: { in: providerIds } } })
  await prisma.log.deleteMany({ where: { user: { username: { in: [tag, tag + '-admin'] } } } })
  await prisma.user.deleteMany({ where: { username: { in: [tag, tag + '-admin'] } } })
  await prisma.paymentProvider.deleteMany({ where: { id: { in: providerIds } } }); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
