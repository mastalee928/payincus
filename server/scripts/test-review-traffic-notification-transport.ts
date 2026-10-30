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
const { sendTrafficWarningNotification: warning, sendTrafficThrottledNotification: throttle } = await import('../src/services/traffic-notifier.js')
const { safeOutboundDispatcher } = await import('../src/lib/outbound-security.js')
const originalFetch = globalThis.fetch
const tag = 'traffic-wire-' + randomUUID()
const sockets = new Set<import('node:net').Socket>(), counts = new Map<string, number>(), durations = new Map<string, number[]>()
const activeResponses = new Set<import('node:http').ServerResponse>()
const requestsPerSocket = new Map<import('node:net').Socket, number>()
const fixtureDispatcher = new Agent()
const server = createServer(async (request, reply) => {
  activeResponses.add(reply)
  requestsPerSocket.set(request.socket, (requestsPerSocket.get(request.socket) || 0) + 1)
  reply.once('close', () => activeResponses.delete(reply))
  for await (const chunk of request) void chunk
  const path = request.url!, started = Date.now(), times = durations.get(path) || []
  durations.set(path, times); counts.set(path, (counts.get(path) || 0) + 1)
  reply.on('close', () => times.push(Date.now() - started))
  if (path.endsWith('/headers')) return
  if (path.endsWith('/body')) { reply.writeHead(path.startsWith('/discord/') ? 503 : 200, { 'content-type': 'application/json' }); reply.write('{"pending":'); return }
  if (path.endsWith('/redirect')) { reply.writeHead(302, { location: '/must-not-follow' }); reply.end('401 fixture redirect'); return }
  if (path.startsWith('/telegram/')) { reply.setHeader('content-type', 'application/json'); reply.end('{"ok":true}'); return }
  reply.writeHead(204); reply.end()
})
server.on('connection', socket => { sockets.add(socket); socket.once('close', () => { sockets.delete(socket); requestsPerSocket.delete(socket) }) })
await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
const rebindName = `${tag}.example`
let bridgedRequests = 0, rebindFetches = 0, preflightLookups = 0, connectionLookups = 0
let privateDnsAddress = '127.0.0.1'
const oldLookup = dns.lookup, oldPromiseLookup = dnsPromises.lookup
mock.method(dnsPromises, 'lookup', ((hostname: string, ...args: any[]) => {
  if (hostname === rebindName) { preflightLookups++; return Promise.resolve([{ address: '8.8.8.8', family: 4 }]) }
  return Reflect.apply(oldPromiseLookup, dnsPromises, [hostname, ...args])
}) as typeof dnsPromises.lookup)
mock.method(dns, 'lookup', ((hostname: string, options: unknown, callback: any) => {
  if (hostname === rebindName) { connectionLookups++; return queueMicrotask(() => callback(null,
    [{ address: privateDnsAddress, family: privateDnsAddress.includes(':') ? 6 : 4 }])) }
  return Reflect.apply(oldLookup, dns, [hostname, options, callback])
}) as typeof dns.lookup)
syncBuiltinESMExports()
globalThis.fetch = (async (input, init) => {
  const url = new URL(String(input)), settings = init as RequestInit & { dispatcher?: unknown }
  assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'manual'); assert.ok(init?.signal)
  if (url.hostname === rebindName) {
    assert.equal(settings.dispatcher, safeOutboundDispatcher); rebindFetches++
    return originalFetch(input, init)
  }
  assert.ok(['api.telegram.org', '8.8.8.8'].includes(url.hostname), 'No external notification target')
  if (url.hostname === '8.8.8.8') assert.equal(settings.dispatcher, safeOutboundDispatcher)
  const path = url.hostname === 'api.telegram.org' ? '/telegram/' + url.pathname.split('/')[1].replace('botfixture-', '').replaceAll('_', '/') : url.pathname
  const { dispatcher: ignored, ...rest } = settings; void ignored; bridgedRequests++
  return originalFetch(base + path, { ...rest, dispatcher: fixtureDispatcher,
    headers: { ...(rest.headers as Record<string, string>), connection: 'close' } } as RequestInit)
}) as typeof fetch
const users: number[] = [], hosts: number[] = [], instances: number[] = [], channels: number[] = []
async function fixture(type: 'telegram' | 'discord', event: 'warning' | 'throttled', mode: string) {
  const label = `${type}-${event}-${mode}`
  const user = await prisma.user.create({ data: { username: `${tag}-${label}`, passwordHash: 'unusable-fixture' } }); users.push(user.id)
  const host = await prisma.host.create({ data: { userId: user.id, name: label, url: 'https://127.0.0.1:1' } }); hosts.push(host.id)
  const instance = await prisma.instance.create({ data: { userId: user.id, hostId: host.id, name: label, incusId: label,
    image: 'fixture/debian', status: 'running', cpu: 100, memory: 512, disk: 1024 } }); instances.push(instance.id)
  const config = type === 'telegram' ? { botToken: `fixture-${event}_${mode}`, chatId: 'fixture-chat' } : { webhookUrl: mode === 'private'
    ? 'http://127.0.0.1/private' : mode.startsWith('rebind') ? `http://${rebindName}:${(server.address() as { port: number }).port}/private`
      : `https://8.8.8.8/discord/${event}/${mode}` }
  const channel = await prisma.notificationChannel.create({ data: { userId: user.id, type, name: label, config } }); channels.push(channel.id)
  return { channel, path: `/${type}/${event}/${mode}`, eventType: `traffic_${event}`, send: () => event === 'warning'
    ? warning(user.id, 80n, 100n, label) : throttle(user.id, label, label) }
}
async function empty() {
  for (const until = Date.now() + 3000; sockets.size && Date.now() < until;) await delay(10)
  assert.equal(sockets.size, 0)
}
async function assertLog(channelId: number, eventType: string, status: string) {
  const logs = await prisma.notificationLog.findMany({ where: { channelId } })
  assert.equal(logs.length, 1); assert.equal(logs[0].eventType, eventType); assert.equal(logs[0].status, status)
  return logs[0]
}
let failure: unknown
try {
  for (const event of ['warning', 'throttled'] as const) for (const type of ['telegram', 'discord'] as const) {
    const item = await fixture(type, event, 'ok'), result = await item.send()
    if (event === 'warning') assert.equal(result, true)
    await assertLog(item.channel.id, item.eventType, 'sent'); assert.equal(counts.get(item.path), 1)
  }
  await empty(); console.log('PASS actual traffic warning and throttle paths persist sent logs for Telegram JSON and Discord 204')
  for (const mode of ['redirect', 'private', 'rebind', 'rebind-mapped']) {
    if (mode === 'rebind-mapped') privateDnsAddress = '::ffff:7f00:1'
    preflightLookups = 0; connectionLookups = 0; rebindFetches = 0
    const item = await fixture('discord', 'warning', mode), before = bridgedRequests
    const sent = await item.send()
    if (mode === 'rebind-mapped') console.log('Mapped private DNS result:', { sent, privateRequests: counts.get('/private') || 0 })
    assert.equal(sent, false, mode + ' must reject private target')
    const log = await assertLog(item.channel.id, item.eventType, 'failed'); assert.ok(log.error)
    if (mode === 'redirect') { assert.equal(counts.get(item.path), 1); assert.equal(counts.get('/must-not-follow'), undefined) }
    else assert.equal(bridgedRequests, before)
    if (mode.startsWith('rebind')) {
      assert.equal(preflightLookups, 6); assert.equal(connectionLookups, 3); assert.equal(rebindFetches, 3)
      assert.equal(counts.get('/private'), undefined, 'actual connection dispatcher rejects private DNS result before socket connection')
    }
  }
  await empty(); console.log('PASS traffic Discord manual redirects/private URL refusal and actual safe dispatcher DNS rebind rejection with zero private requests')
  const stalled = await Promise.all((['warning', 'throttled'] as const).flatMap(event => (['telegram', 'discord'] as const)
    .flatMap(type => ['headers', 'body'].map(mode => fixture(type, event, mode)))))
  await Promise.all(stalled.map(async item => {
    const started = Date.now(), result = await item.send(), elapsed = Date.now() - started
    if (item.eventType === 'traffic_warning') assert.equal(result, false)
    const log = await assertLog(item.channel.id, item.eventType, 'failed')
    assert.match(log.error || '', /3 attempts/); assert.equal(counts.get(item.path), 3)
    assert.ok(elapsed >= 49000 && elapsed < 59000, item.path + ' total retry budget: ' + elapsed)
    console.log('PASS', item.path, elapsed + 'ms', 'three bounded attempts, durable failed log')
  }))
  for (const until = Date.now() + 3000; activeResponses.size && Date.now() < until;) await delay(10)
  assert.equal(activeResponses.size, 0, 'no unfinished HTTP response survives cancellation')
  for (const item of stalled) {
    const times = durations.get(item.path)!
    assert.equal(times.length, 3); assert.ok(times.every(ms => ms >= 14000 && ms < 17500), item.path + ' per-attempt deadline')
  }
  assert.equal(await prisma.notificationLog.count({ where: { channelId: { in: channels }, status: 'pending' } }), 0)
  // Undici may open an idle replacement connection after cancellation. It is
  // not a stalled request; verify this before closing our fixture dispatcher.
  for (const socket of sockets) assert.equal(requestsPerSocket.get(socket) || 0, 0, 'remaining sockets have never carried an HTTP request')
  console.log('PASS all eight traffic stalls cancel every response; idle replacement sockets:', sockets.size)
  await fixtureDispatcher.close(); await empty()
  console.log('PASS fixture dispatcher shutdown closes all idle sockets; no pending notification log')
} catch (error) { failure = error }
finally {
  globalThis.fetch = originalFetch; mock.restoreAll(); syncBuiltinESMExports()
  await safeOutboundDispatcher.close(); await fixtureDispatcher.destroy(); for (const socket of sockets) socket.destroy()
  server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()))
  await prisma.notificationLog.deleteMany({ where: { channelId: { in: channels } } })
  await prisma.notificationChannel.deleteMany({ where: { id: { in: channels } } })
  await prisma.instance.deleteMany({ where: { id: { in: instances } } }); await prisma.host.deleteMany({ where: { id: { in: hosts } } })
  await prisma.user.deleteMany({ where: { id: { in: users } } }); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }; process.exit(0)
