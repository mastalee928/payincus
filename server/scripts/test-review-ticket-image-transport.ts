import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import dns from 'node:dns'
import dnsPromises from 'node:dns/promises'
import { syncBuiltinESMExports } from 'node:module'
import { mock } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import Fastify from 'fastify'
import { Agent } from 'undici'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/tickets.js')
const { MAX_TICKET_IMAGE_SIZE: limit } = await import('../src/lib/ticket-attachments.js')
const { safeOutboundDispatcher } = await import('../src/lib/outbound-security.js')
const tag = 'ticket-wire-' + randomUUID(), rebind = tag + '.example'
const originalFetch = globalThis.fetch, dispatcher = new Agent()
const active = new Set<ServerResponse>(), sockets = new Set<Socket>(), counts = new Map<string, number>()
const perSocket = new Map<Socket, number>()
let streamedBytes = 0
const server = createServer((request, response) => {
  active.add(response); response.once('close', () => active.delete(response))
  perSocket.set(request.socket, (perSocket.get(request.socket) || 0) + 1)
  const path = request.url!; counts.set(path, (counts.get(path) || 0) + 1)
  if (path === '/headers') return
  response.setHeader('content-type', 'image/png')
  if (path === '/redirect') { response.writeHead(302, { location: '/private' }); response.end(); return }
  if (path === '/oversize-header') { response.setHeader('content-length', limit + 1); response.flushHeaders(); return }
  if (path === '/body') { response.write(Buffer.from([1])); return }
  if (path === '/exact-limit' || path === '/overflow') {
    const chunk = Buffer.alloc(256 * 1024, 7), total = path === '/overflow' ? limit * 4 : limit
    let written = 0
    const pump = () => {
      while (!response.destroyed && written < total) {
        written += chunk.length
        if (path === '/overflow') streamedBytes += chunk.length
        if (!response.write(chunk)) { response.once('drain', pump); return }
      }
      if (!response.destroyed) response.end()
    }
    pump(); return
  }
  response.end(Buffer.from([1, 2, 3]))
})
server.on('connection', socket => {
  sockets.add(socket); socket.once('close', () => { sockets.delete(socket); perSocket.delete(socket) })
})
await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
const port = (server.address() as { port: number }).port, base = `http://127.0.0.1:${port}`
let lookupResults = [{ address: '127.0.0.1', family: 4 }], preflight = 0, connections = 0, bridged = 0
const oldLookup = dns.lookup, oldPromiseLookup = dnsPromises.lookup
mock.method(dnsPromises, 'lookup', ((hostname: string, ...args: any[]) => {
  if (hostname === rebind) { preflight++; return Promise.resolve([{ address: '8.8.8.8', family: 4 }]) }
  return Reflect.apply(oldPromiseLookup, dnsPromises, [hostname, ...args])
}) as typeof dnsPromises.lookup)
mock.method(dns, 'lookup', ((hostname: string, options: unknown, callback: any) => {
  if (hostname === rebind) { connections++; return queueMicrotask(() => callback(null, lookupResults)) }
  return Reflect.apply(oldLookup, dns, [hostname, options, callback])
}) as typeof dns.lookup)
syncBuiltinESMExports()
globalThis.fetch = (async (input, options) => {
  const url = new URL(String(input)), settings = options as RequestInit & { dispatcher?: unknown }
  assert.equal(settings.redirect, 'manual'); assert.ok(settings.signal)
  assert.equal(settings.dispatcher, safeOutboundDispatcher)
  if (url.hostname === rebind) return originalFetch(input, options)
  assert.equal(url.hostname, '8.8.8.8', 'Only the isolated transport bridge is allowed')
  bridged++
  return originalFetch(base + url.pathname, { ...settings, dispatcher, headers: { connection: 'close' } } as RequestInit)
}) as typeof fetch
const app = Fastify()
let actorId = 0, failure: unknown
app.decorate('authenticate', async (request: any) => { request.user = { id: actorId, role: 'user' } })
app.decorate('requireAdmin', async (_request: any, reply: any) => reply.code(403).send({ error: 'FORBIDDEN' }))
async function drained() {
  for (const until = Date.now() + 3000; active.size && Date.now() < until;) await delay(10)
  assert.equal(active.size, 0, 'the response must close before test cleanup')
}
try {
  const user = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
  const other = await prisma.user.create({ data: { username: tag + '-other', passwordHash: 'unusable-fixture' } })
  const ticket = await prisma.ticket.create({ data: { userId: user.id, subject: tag } })
  const message = await prisma.ticketMessage.create({ data: { ticketId: ticket.id, senderId: user.id, content: tag } })
  const attachment = await prisma.ticketMessageAttachment.create({ data: {
    ticketId: ticket.id, messageId: message.id, uploaderId: user.id, provider: 'fixture', providerVersion: 'v1',
    providerFileId: 'fixture-file', filename: 'fixture.png', originalName: 'fixture.png', mimeType: 'image/png',
    sizeBytes: 3, url: 'https://8.8.8.8/ok'
  } })
  await app.register(routes, { prefix: '/tickets' })
  const get = () => app.inject({ method: 'GET', url: `/tickets/attachments/${attachment.id}/content` })
  const target = async (url: string) => prisma.ticketMessageAttachment.update({ where: { id: attachment.id }, data: { url } })
  const failed = async (detail = 'Failed to load remote image') => {
    const response = await get()
    assert.equal(response.statusCode, 502)
    assert.equal(response.json().code, 'UPSTREAM_ERROR'); assert.equal(response.json().details, detail)
    await drained()
  }
  actorId = other.id
  assert.equal((await get()).statusCode, 404); assert.equal(bridged, 0)
  actorId = user.id
  const privateUrls = ['http://127.0.0.1/private', 'http://127.1/private', 'http://2130706433/private',
    'http://0x7f000001/private', 'http://[::1]/private', 'http://[::ffff:127.0.0.1]/private',
    'http://[0:0:0:0:0:ffff:7f00:1]/private', 'http://169.254.169.254/private', 'http://10.1.2.3/private',
    'http://localhost/private', 'http://fixture.internal/private', 'ftp://8.8.8.8/private']
  for (const url of privateUrls) { await target(url); await failed(); assert.equal(bridged, 0) }
  for (const results of [
    [{ address: '127.0.0.1', family: 4 }], [{ address: '::ffff:7f00:1', family: 6 }],
    [{ address: '0:0:0:0:0:ffff:127.0.0.1', family: 6 }],
    [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]
  ]) {
    lookupResults = results; preflight = 0; connections = 0
    await target(`http://${rebind}:${port}/private`); await failed()
    assert.equal(preflight, 2); assert.equal(connections, 1); assert.equal(bridged, 0)
    assert.equal(counts.get('/private'), undefined)
  }
  await target('https://8.8.8.8/redirect'); await failed()
  assert.equal(counts.get('/redirect'), 1); assert.equal(counts.get('/private'), undefined)
  console.log('PASS real image route rejects foreign owners, twelve private/invalid URLs, four connection-time DNS rebinding results and redirects with zero private requests')

  await target('https://8.8.8.8/oversize-header'); await failed('Remote image is too large')
  await target('https://8.8.8.8/overflow'); await failed('Remote image is too large')
  assert.ok(streamedBytes < limit * 4, 'oversize streaming must stop the producer before all 200 MiB are sent')
  const stoppedBytes = streamedBytes; await delay(100); assert.equal(streamedBytes, stoppedBytes)
  await target('https://8.8.8.8/exact-limit')
  const exact = await get(); assert.equal(exact.statusCode, 200); assert.equal(exact.rawPayload.length, limit)
  assert.ok(exact.rawPayload.every(byte => byte === 7)); await drained()
  assert.equal(exact.headers['cache-control'], 'private, max-age=300'); assert.equal(exact.headers['x-content-type-options'], 'nosniff')
  console.log('PASS declared and streamed oversize responses cancel the real producer; exact 50 MiB remains valid despite smaller stored attachment size')
  for (const path of ['/headers', '/body']) {
    await target('https://8.8.8.8' + path)
    const started = Date.now(); await failed('Remote image request timed out'); const elapsed = Date.now() - started
    assert.ok(elapsed >= 14000 && elapsed < 23000, `${path}: ${elapsed}ms`)
    console.log('PASS actual image transport deadline', path, elapsed + 'ms', 'active=0')
  }
  await target(attachment.url)
  const normal = await get(); assert.equal(normal.statusCode, 200); assert.deepEqual(normal.rawPayload, Buffer.from([1, 2, 3]))
  await drained()
  assert.deepEqual(await prisma.ticketMessageAttachment.findUniqueOrThrow({ where: { id: attachment.id } }), attachment)
  assert.deepEqual(await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } }), ticket)
  assert.deepEqual(await prisma.ticketMessage.findUniqueOrThrow({ where: { id: message.id } }), message)
  for (const socket of sockets) assert.equal(perSocket.get(socket) || 0, 0)
  await dispatcher.close()
  for (const until = Date.now() + 3000; sockets.size && Date.now() < until;) await delay(10)
  assert.equal(sockets.size, 0)
  console.log('PASS subsequent normal image read, all original PG records preserved and all local sockets released')
} catch (error) { failure = error }
finally {
  globalThis.fetch = originalFetch; mock.restoreAll(); syncBuiltinESMExports()
  await app.close(); await dispatcher.destroy(); await safeOutboundDispatcher.close(); server.closeAllConnections()
  await new Promise<void>(done => server.close(() => done()))
  const users = await prisma.user.findMany({ where: { username: { in: [tag, tag + '-other'] } }, select: { id: true } })
  await prisma.ticket.deleteMany({ where: { userId: { in: users.map(user => user.id) } } })
  await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } }); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
