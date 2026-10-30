import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { Socket } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { Agent } from 'undici'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { sendToChannel } = await import('../src/lib/notifier.js')
const originalFetch = globalThis.fetch, dispatcher = new Agent()
const tag = 'custom-telegram-' + randomUUID()
const sockets = new Set<Socket>(), perSocket = new Map<Socket, number>()
const active = new Set<import('node:http').ServerResponse>()
const counts = new Map<string, number>(), cancelled = new Map<string, number>()
const payloads: Array<{ chat_id: string; text: string; parse_mode: string }> = []
let recover = false
const server = createServer(async (request, response) => {
  active.add(response); perSocket.set(request.socket, (perSocket.get(request.socket) || 0) + 1)
  const path = request.url!, started = Date.now()
  response.once('close', () => { active.delete(response); cancelled.set(path, Date.now() - started) })
  counts.set(path, (counts.get(path) || 0) + 1)
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  payloads.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  if (!recover && path === '/headers') return
  if (!recover && path === '/body') { response.writeHead(200, { 'content-type': 'application/json' }); response.write('{"ok":'); return }
  if (path === '/redirect') { response.writeHead(302, { location: '/must-not-follow' }); response.end('redirect'); return }
  if (path === '/malformed') { response.end('not-json'); return }
  response.setHeader('content-type', 'application/json')
  response.end(path === '/rejected' ? '{"ok":false,"description":"controlled rejection"}' : '{"ok":true}')
})
server.on('connection', socket => { sockets.add(socket); socket.once('close', () => { sockets.delete(socket); perSocket.delete(socket) }) })
await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
globalThis.fetch = (async (input, options) => {
  const url = new URL(String(input))
  assert.equal(url.hostname, 'api.telegram.org'); assert.equal(url.protocol, 'https:')
  assert.equal(options?.method, 'POST'); assert.equal(options?.redirect, 'manual'); assert.ok(options?.signal)
  const mode = url.pathname.split('/')[1].replace('botfixture-', '')
  assert.ok(['ok', 'rejected', 'malformed', 'redirect', 'headers', 'body'].includes(mode))
  return originalFetch(base + '/' + mode, { ...options, dispatcher,
    headers: { ...(options?.headers as Record<string, string>), connection: 'close' } } as RequestInit)
}) as typeof fetch
const user = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
const channels: number[] = []
async function fixture(mode: string) {
  const channel = await prisma.notificationChannel.create({ data: {
    userId: user.id, type: 'telegram', name: tag + '-' + mode, enabled: false,
    config: { botToken: mode === 'missing' ? '' : 'fixture-' + mode, chatId: 'fixture-chat' }
  } })
  channels.push(channel.id); return channel
}
const send = (id: number) => sendToChannel(id, 'Quota (released)', 'Ready_1', { label: 'Open [panel]', url: 'https://example.invalid/path?a=1&b=2' })
async function logs(id: number) { return prisma.notificationLog.findMany({ where: { channelId: id }, orderBy: { id: 'asc' } }) }
let failure: unknown
try {
  for (const mode of ['ok', 'rejected', 'malformed', 'redirect', 'missing']) {
    const channel = await fixture(mode), result = await send(channel.id), rows = await logs(channel.id)
    assert.equal(result.success, mode === 'ok'); assert.equal(rows.length, 1)
    assert.equal(rows[0].status, mode === 'ok' ? 'sent' : 'failed'); assert.equal(rows[0].eventType, 'package.quota_release')
    assert.equal(counts.get('/' + mode) || 0, mode === 'missing' ? 0 : 1)
  }
  assert.equal(counts.get('/must-not-follow'), undefined)
  assert.deepEqual(payloads[0], { chat_id: 'fixture-chat', parse_mode: 'MarkdownV2',
    text: '*Quota \\(released\\)*\n\nReady\\_1\n[Open \\[panel\\]](https://example.invalid/path?a=1&b=2)' })
  const stalled = await Promise.all(['headers', 'body'].map(fixture))
  await Promise.all(stalled.map(async channel => {
    const started = Date.now(), result = await send(channel.id), elapsed = Date.now() - started
    assert.equal(result.success, false); assert.ok(elapsed >= 14000 && elapsed < 18500, 'Real 15-second deadline: ' + elapsed)
    const rows = await logs(channel.id)
    assert.equal(rows.length, 1); assert.equal(rows[0].status, 'failed'); assert.ok(rows[0].error)
    console.log('PASS custom Telegram', channel.name.endsWith('headers') ? 'headers' : 'body', elapsed + 'ms', 'durable failed receipt')
  }))
  for (const until = Date.now() + 3000; active.size && Date.now() < until;) await delay(10)
  assert.equal(active.size, 0, 'Timeout cancels both live responses before fixture cleanup')
  for (const mode of ['headers', 'body']) {
    assert.equal(counts.get('/' + mode), 1)
    assert.ok(cancelled.get('/' + mode)! >= 14000 && cancelled.get('/' + mode)! < 18500)
  }
  for (const socket of sockets) assert.equal(perSocket.get(socket) || 0, 0, 'Any replacement socket must have sent no request')
  assert.equal(await prisma.notificationLog.count({ where: { channelId: { in: channels }, status: 'pending' } }), 0)
  await delay(1500)
  for (const channel of stalled) assert.deepEqual((await logs(channel.id)).map(row => row.status), ['failed'])
  recover = true
  for (const channel of stalled) {
    assert.equal((await send(channel.id)).success, true)
    assert.deepEqual((await logs(channel.id)).map(row => row.status), ['failed', 'sent'])
    assert.equal((await prisma.notificationChannel.findUniqueOrThrow({ where: { id: channel.id } })).enabled, false)
  }
  await dispatcher.close()
  for (const until = Date.now() + 3000; sockets.size && Date.now() < until;) await delay(10)
  assert.equal(sockets.size, 0)
  console.log('PASS actual sendToChannel: disabled custom channels, escaped payload/link, rejection/JSON/redirect errors, no pending logs or late success, recovery after timeout and zero sockets')
} catch (error) { failure = error }
finally {
  globalThis.fetch = originalFetch; await dispatcher.destroy(); server.closeAllConnections()
  await new Promise<void>(done => server.close(() => done()))
  await prisma.notificationLog.deleteMany({ where: { channelId: { in: channels } } })
  await prisma.notificationChannel.deleteMany({ where: { id: { in: channels } } })
  await prisma.user.delete({ where: { id: user.id } }); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
