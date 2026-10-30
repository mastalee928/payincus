import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import dns from 'node:dns'
import dnsPromises from 'node:dns/promises'
import { syncBuiltinESMExports } from 'node:module'
import { mock } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { Agent } from 'undici'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { sendLotteryWinNotification: send } = await import('../src/lib/lottery-notifier.js')
const { safeOutboundDispatcher } = await import('../src/lib/outbound-security.js')
const originalFetch = globalThis.fetch, dispatcher = new Agent(), tag = 'lottery-wire-' + randomUUID()
const active = new Set<import('node:http').ServerResponse>()
const sockets = new Set<import('node:net').Socket>(), perSocket = new Map<import('node:net').Socket, number>()
const counts = new Map<string, number>()
const server = createServer(async (request, response) => {
  active.add(response); response.once('close', () => active.delete(response))
  perSocket.set(request.socket, (perSocket.get(request.socket) || 0) + 1)
  for await (const chunk of request) void chunk
  const path = request.url!; counts.set(path, (counts.get(path) || 0) + 1)
  if (path.endsWith('/headers')) return
  if (path.endsWith('/body')) {
    response.writeHead(path.startsWith('/discord/') ? 503 : 200, { 'content-type': 'application/json' })
    response.write('{"pending":'); return
  }
  if (path.endsWith('/success-body') || path.endsWith('/reject-body')) {
    response.writeHead(path.endsWith('/success-body') ? 200 : 503, { 'content-type': 'text/plain' })
    response.write('unneeded body'); return
  }
  if (path.endsWith('/redirect')) { response.writeHead(302, { location: '/private' }); response.end('redirect'); return }
  if (path.startsWith('/telegram/')) { response.setHeader('content-type', 'application/json'); response.end('{"ok":true}'); return }
  response.writeHead(204); response.end()
})
server.on('connection', socket => { sockets.add(socket); socket.once('close', () => { sockets.delete(socket); perSocket.delete(socket) }) })
await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`, rebind = tag + '.example'
let privateAddress = '127.0.0.1', connectionLookups = 0, preflightLookups = 0, bridged = 0
const oldLookup = dns.lookup, oldPromiseLookup = dnsPromises.lookup
mock.method(dnsPromises, 'lookup', ((hostname: string, ...args: any[]) => {
  if (hostname === rebind) { preflightLookups++; return Promise.resolve([{ address: '8.8.8.8', family: 4 }]) }
  return Reflect.apply(oldPromiseLookup, dnsPromises, [hostname, ...args])
}) as typeof dnsPromises.lookup)
mock.method(dns, 'lookup', ((hostname: string, options: unknown, callback: any) => {
  if (hostname === rebind) { connectionLookups++; return queueMicrotask(() => callback(null,
    [{ address: privateAddress, family: privateAddress.includes(':') ? 6 : 4 }])) }
  return Reflect.apply(oldLookup, dns, [hostname, options, callback])
}) as typeof dns.lookup)
syncBuiltinESMExports()
globalThis.fetch = (async (input, options) => {
  const url = new URL(String(input)), settings = options as RequestInit & { dispatcher?: unknown }
  assert.equal(settings.method, 'POST'); assert.equal(settings.redirect, 'manual'); assert.ok(settings.signal)
  if (url.hostname === rebind) { assert.equal(settings.dispatcher, safeOutboundDispatcher); return originalFetch(input, options) }
  assert.ok(['api.telegram.org', '8.8.8.8'].includes(url.hostname), 'No external notification')
  if (url.hostname === '8.8.8.8') assert.equal(settings.dispatcher, safeOutboundDispatcher)
  const path = url.hostname === 'api.telegram.org' ? '/telegram/' + url.pathname.split('/')[1].replace('botfixture-', '') : url.pathname
  bridged++
  return originalFetch(base + path, { ...settings, dispatcher,
    headers: { ...(settings.headers as Record<string, string>), connection: 'close' } } as RequestInit)
}) as typeof fetch
const user = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
const lotteries: number[] = []
async function fixture(type: 'telegram' | 'discord' | 'webhook', mode: string) {
  const lottery = await prisma.lottery.create({ data: { name: tag, costPoints: 1, createdBy: user.id } }); lotteries.push(lottery.id)
  const prize = await prisma.lotteryPrize.create({ data: { lotteryId: lottery.id, name: 'fixture', type: 'balance', value: 1, probability: 100 } })
  const record = await prisma.lotteryRecord.create({ data: { lotteryId: lottery.id, prizeId: prize.id, userId: user.id,
    prizeType: 'balance', prizeValue: 1, prizeName: prize.name, pointsSpent: 1 } })
  const url = mode === 'private' ? 'http://127.0.0.1/private' : mode.startsWith('rebind')
    ? `http://${rebind}:${(server.address() as { port: number }).port}/private` : `https://8.8.8.8/${type}/${mode}`
  await prisma.lotteryNotificationConfig.create({ data: { lotteryId: lottery.id, type, config: type === 'telegram'
    ? { botToken: 'fixture-' + mode, chatId: 'fixture-chat' } : type === 'discord' ? { webhookUrl: url } : { url } } })
  return { type, mode, record, run: () => send({ lotteryId: lottery.id, recordId: record.id, prizeType: 'balance',
    username: tag, lotteryName: lottery.name, prizeName: prize.name, amount: 1 }) }
}
async function assertRecord(item: Awaited<ReturnType<typeof fixture>>, sent: boolean) {
  assert.deepEqual(await prisma.lotteryRecord.findUniqueOrThrow({ where: { id: item.record.id } }), { ...item.record, notificationSent: sent })
}
let failure: unknown
try {
  for (const type of ['telegram', 'discord', 'webhook'] as const) {
    const item = await fixture(type, 'ok'); await item.run(); await assertRecord(item, true)
  }
  for (const type of ['discord', 'webhook'] as const) for (const mode of ['redirect', 'private', 'rebind', 'rebind-mapped']) {
    privateAddress = mode === 'rebind-mapped' ? '::ffff:7f00:1' : '127.0.0.1'; connectionLookups = 0; preflightLookups = 0
    const item = await fixture(type, mode), before = bridged
    await item.run(); await assertRecord(item, false)
    assert.equal(bridged - before, mode === 'redirect' ? 1 : 0)
    if (mode.startsWith('rebind')) { assert.equal(connectionLookups, 1); assert.equal(preflightLookups, 2) }
    assert.equal(counts.get('/private'), undefined)
  }
  console.log('PASS actual lottery notifier persists sent only for accepted sends; private URLs, manual redirects and normal/mapped DNS rebinding retain unsent records with zero private requests')
  const stalled = await Promise.all([fixture('telegram', 'headers'), fixture('telegram', 'body'), fixture('discord', 'headers'), fixture('discord', 'body'), fixture('webhook', 'headers')])
  await Promise.all(stalled.map(async item => {
    const started = Date.now(); await item.run(); const elapsed = Date.now() - started
    assert.ok(elapsed >= 14000 && elapsed < 18500, item.type + '/' + item.mode + ': ' + elapsed)
    await assertRecord(item, false); console.log('PASS lottery', item.type, item.mode, elapsed + 'ms', 'unsent')
  }))
  for (const until = Date.now() + 3000; active.size && Date.now() < until;) await delay(10)
  assert.equal(active.size, 0)
  const unused = await Promise.all([fixture('discord', 'success-body'), fixture('webhook', 'success-body'), fixture('webhook', 'reject-body')])
  for (const item of unused) {
    const started = Date.now(); await item.run(); assert.ok(Date.now() - started < 2500)
    await assertRecord(item, item.mode === 'success-body')
  }
  for (const until = Date.now() + 2500; active.size && Date.now() < until;) await delay(10)
  assert.equal(active.size, 0, 'Completed lottery sends must cancel response bodies they do not consume')
  for (const socket of sockets) assert.equal(perSocket.get(socket) || 0, 0)
  await dispatcher.close()
  for (const until = Date.now() + 3000; sockets.size && Date.now() < until;) await delay(10)
  assert.equal(sockets.size, 0)
  console.log('PASS lottery deadlines release responses and completed status-only sends cancel unread bodies immediately; all sockets released')
} catch (error) { failure = error }
finally {
  globalThis.fetch = originalFetch; mock.restoreAll(); syncBuiltinESMExports()
  await dispatcher.destroy(); await safeOutboundDispatcher.close(); server.closeAllConnections()
  await new Promise<void>(done => server.close(() => done()))
  await prisma.lottery.deleteMany({ where: { id: { in: lotteries } } })
  await prisma.user.delete({ where: { id: user.id } }); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
