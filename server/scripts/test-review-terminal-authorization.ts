import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { WebSocket, WebSocketServer } from 'ws'
import type { Prisma } from '@prisma/client'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const db = await import('../src/db/index.js')
const { withTerminalOpeningAuthorization: authorize } = await import('../src/db/terminal-opening-authorization.js')
const { createTerminalSession, closeUserSessions, closeAllSessions, stopSessionCleanup, getActiveSessionStats } = await import('../src/lib/terminal-proxy.js')
const { generateTerminalAccessTicket } = await import('../src/lib/action-ticket.js')
const { default: routes } = await import('../src/routes/terminal.js')
const root = await mkdtemp(join(tmpdir(), 'terminal-authorization-'))
const keyPath = join(root, 'fixture.key'), certPath = join(root, 'fixture.crt')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=terminal-fixture', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath], { stdio: 'pipe', windowsHide: true })
const key = await readFile(keyPath), cert = await readFile(certPath)
let posts = 0, holdPost = false
const connections = new Set<WebSocket>(), backendWs = new WebSocketServer({ noServer: true })
backendWs.on('connection', socket => { connections.add(socket); socket.once('close', () => connections.delete(socket)) })
const backend = createServer({ key, cert, ca: cert, requestCert: true, rejectUnauthorized: true }, (request, response) => {
  assert.equal((request.socket as import('node:tls').TLSSocket).authorized, true)
  posts++; request.resume()
  if (holdPost) return
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ type: 'async', operation: '/1.0/operations/fixture', metadata: { metadata: { fds: { 0: 'data', control: 'control' } } } }))
})
backend.on('upgrade', (request, socket, head) => backendWs.handleUpgrade(request, socket, head, socket => backendWs.emit('connection', socket)))
backend.listen(0, '127.0.0.1'); await once(backend, 'listening')
const tag = `terminal-auth-${randomUUID()}`
const owner = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
const hostOwner = await prisma.user.create({ data: { username: tag + '-host', passwordHash: 'unusable-fixture' } })
const admin = await prisma.user.create({ data: { username: tag + '-admin', passwordHash: 'unusable-fixture', role: 'admin' } })
const host = await prisma.host.create({ data: { userId: hostOwner.id, name: tag,
  url: `https://127.0.0.1:${(backend.address() as { port: number }).port}`, certPath, keyPath } })
const pkg = await prisma.package.create({ data: { userId: hostOwner.id, name: tag, cpuMax: 100, memoryMax: 512, diskMax: 1024 } })
const instance = await prisma.instance.create({ data: { userId: owner.id, hostId: host.id, packageId: pkg.id,
  name: tag, incusId: tag, image: 'fixture/debian', cpu: 50, memory: 256, disk: 1024, status: 'running' } })
const userIds = [owner.id, hostOwner.id, admin.id]
const actor = { id: owner.id, role: 'user', sid: tag, iat: Math.floor(Date.now() / 1000) }
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = { ...actor, username: owner.username } })
app.decorate('authenticateAdmin', app.authenticate)
const wait = async (condition: () => boolean, label: string, timeout = 4000) => {
  const until = Date.now() + timeout
  while (!condition()) { if (Date.now() > until) throw Error('timeout: ' + label); await delay(10) }
}
const reset = async () => {
  holdPost = false; closeAllSessions()
  await prisma.tokenInvalidation.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { status: 'active', role: 'user' } })
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
  await prisma.host.update({ where: { id: host.id }, data: { url: host.url, userId: hostOwner.id, certPath, keyPath } })
  await prisma.package.update({ where: { id: pkg.id }, data: { instanceType: 'container' } })
  await prisma.instance.update({ where: { id: instance.id }, data: { userId: owner.id, hostId: host.id, incusId: tag,
    status: 'running', packageId: pkg.id, provisioningCleanupPending: false, deletionBillingPending: false } })
}
const snapshot = async () => ({ expected: (await db.getInstanceById(instance.id))!, originalHost: (await db.getHostById(host.id))! })
const mutations: Record<string, (tx: Prisma.TransactionClient) => Promise<unknown>> = {
  banned: tx => tx.user.update({ where: { id: owner.id }, data: { status: 'banned' } }),
  demoted: tx => tx.user.update({ where: { id: admin.id }, data: { role: 'user' } }),
  session: tx => tx.tokenInvalidation.create({ data: { userId: owner.id, sessionId: actor.sid, invalidatedAt: actor.iat } }),
  'all-sessions': tx => tx.tokenInvalidation.create({ data: { userId: owner.id, sessionId: '__USER_LEVEL__', invalidatedAt: actor.iat } }),
  transferred: tx => tx.instance.update({ where: { id: instance.id }, data: { userId: hostOwner.id } }),
  stopped: tx => tx.instance.update({ where: { id: instance.id }, data: { status: 'stopped' } }),
  replaced: tx => tx.instance.update({ where: { id: instance.id }, data: { incusId: tag + '-replacement' } }),
  'host-owner': tx => tx.host.update({ where: { id: host.id }, data: { userId: owner.id } }),
  'host-url': tx => tx.host.update({ where: { id: host.id }, data: { url: 'https://127.0.0.1:1' } })
}
class Client extends EventEmitter {
  OPEN = 1; readyState = 1; messages: string[] = []
  send(message: string) { this.messages.push(message) }
  ping() {}
  close() { if (this.readyState === 1) { this.readyState = 3; this.emit('close') } }
}
let failure: unknown
try {
  await app.register(websocket); await app.register(routes, { prefix: '/instances' })
  await app.listen({ host: '127.0.0.1', port: 0 })
  // Actual routes pause after all initial authorization reads, before opening registration.
  for (const name of ['session', 'banned', 'transferred', 'replaced', 'host-url']) {
    await reset(); const before = posts
    const originalRead = prisma.package.findUnique
    let release!: () => void, entered!: () => void
    const held = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { entered = resolve })
    prisma.package.findUnique = (async (...args: Parameters<typeof originalRead>) => {
      const result = await originalRead.apply(prisma.package, args); entered(); await held; return result
    }) as unknown as typeof originalRead
    const ticket = generateTerminalAccessTicket(owner.id, instance.id, actor.iat, actor.sid)
    const client = new WebSocket(`ws://127.0.0.1:${(app.server.address() as { port: number }).port}/instances/${instance.id}/terminal?ticket=${ticket}`)
    const messages: any[] = []; client.on('message', data => messages.push(JSON.parse(String(data))))
    const closed = once(client, 'close')
    try {
      await Promise.race([ready, delay(4000).then(() => { throw Error('route did not reach package barrier') })])
      await prisma.$transaction(mutations[name]); prisma.package.findUnique = originalRead; release()
      await Promise.race([closed, delay(4000).then(() => { throw Error('obsolete route stayed open') })])
      assert.equal(posts, before, name + ' must make zero backend requests')
      assert.equal(messages.some(message => message.type === 'connected'), false)
      assert.equal(getActiveSessionStats().total, 0)
    } finally { prisma.package.findUnique = originalRead; release(); client.terminate() }
  }
  console.log('PASS five actual WebSocket routes reject stale session/account/instance/host after preflight reads')
  for (const [name, mutate] of Object.entries(mutations)) {
    await reset(); const target = await snapshot(), currentActor = name === 'demoted' ? { ...actor, id: admin.id, role: 'admin' } : actor
    let release!: () => void, entered!: (pid: number) => void
    const held = new Promise<void>(resolve => { release = resolve }), ready = new Promise<number>(resolve => { entered = resolve })
    const blocker = prisma.$transaction(async tx => {
      if (['session', 'all-sessions'].includes(name)) await tx.$queryRaw`SELECT id FROM users WHERE id = ${owner.id} FOR UPDATE`
      await mutate(tx); const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
      entered(row.pid); await held
    }, { timeout: 10000 })
    const pid = await ready; let dispatched = 0, settled = false
    const opening = authorize(target.expected, target.originalHost, currentActor, 'container', async () => { dispatched++; return true })
      .then(() => 'accepted', () => 'rejected').finally(() => { settled = true })
    try {
      let blocked = false
      const until = Date.now() + 3500
      while (!settled && Date.now() < until) {
        const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`
        if (Number(row.count)) { blocked = true; break }; await delay(10)
      }
      assert.equal(blocked, true, name + ' must serialize on a real PostgreSQL lock')
    } finally { release(); await blocker }
    assert.equal(await opening, 'rejected', name); assert.equal(dispatched, 0)
  }
  console.log('PASS nine real PostgreSQL target/account/revocation competitors serialize and make zero dispatches')
  await reset(); const target = await snapshot()
  for (const currentActor of [actor, { ...actor, id: hostOwner.id }, { ...actor, id: admin.id, role: 'admin' }]) {
    assert.equal(await authorize(target.expected, target.originalHost, currentActor, 'container', async () => true), true)
  }
  for (const currentActor of [{ ...actor, sid: undefined }, { ...actor, iat: undefined }]) {
    await assert.rejects(authorize(target.expected, target.originalHost, currentActor, 'container', async () => assert.fail('invalid session dispatched')))
  }
  await prisma.package.update({ where: { id: pkg.id }, data: { instanceType: 'vm' } })
  await assert.rejects(authorize(target.expected, target.originalHost, actor, 'container', async () => assert.fail('changed package dispatched')))
  console.log('PASS current owner/host owner/admin remain allowed, missing credentials and changed package type reject')
  for (const currentActor of [actor, { ...actor, id: hostOwner.id }, { ...actor, id: admin.id, role: 'admin' }]) {
    await reset()
    const ticket = generateTerminalAccessTicket(currentActor.id, instance.id, currentActor.iat, currentActor.sid)
    const client = new WebSocket(`ws://127.0.0.1:${(app.server.address() as { port: number }).port}/instances/${instance.id}/terminal?ticket=${ticket}`)
    const messages: any[] = []; client.on('message', data => messages.push(JSON.parse(String(data))))
    try {
      await wait(() => messages.some(message => message.type === 'connected'), 'current actual route connects')
      assert.equal(getActiveSessionStats().total, 1); assert.equal(connections.size, 2)
      const closed = once(client, 'close'); client.close(); await closed
      await wait(() => getActiveSessionStats().total === 0 && connections.size === 0, 'current route closes both mTLS channels')
    } finally { client.terminate() }
  }
  console.log('PASS actual owner/host-owner/admin WebSocket routes connect over both mTLS channels and close cleanly')
  await reset(); const current = await snapshot(), client = new Client(), before = posts
  holdPost = true
  const opening = createTerminalSession(client as unknown as WebSocket, current.originalHost, instance.id, instance.incusId,
    owner.id, 'container', actor.sid, open => authorize(current.expected, current.originalHost, actor, 'container', open))
    .then(() => 'accepted', () => 'rejected')
  await wait(() => posts > before, 'held terminal POST')
  let changed = false
  const change = prisma.instance.update({ where: { id: instance.id }, data: { status: 'stopped' } }).then(() => { changed = true })
  await delay(80); assert.equal(changed, false, 'target stays locked through initial backend opening')
  assert.equal(closeUserSessions(owner.id), 1)
  assert.equal(await opening, 'rejected'); await change; assert.equal(changed, true)
  assert.equal(client.messages.some(message => JSON.parse(message).type === 'connected'), false)
  console.log('PASS actual mTLS opening holds original target, revocation cancels POST and releases database locks')
  await reset(); const bounded = await snapshot(); holdPost = true
  const started = Date.now()
  await assert.rejects(createTerminalSession(new Client() as unknown as WebSocket, bounded.originalHost, instance.id, instance.incusId,
    owner.id, 'container', actor.sid, open => authorize(bounded.expected, bounded.originalHost, actor, 'container', open)))
  assert.ok(Date.now() - started >= 19000 && Date.now() - started < 24000, 'unresponsive POST must obey the total 20s opening deadline')
  await prisma.instance.update({ where: { id: instance.id }, data: { status: 'stopped' } })
  assert.equal(closeUserSessions(owner.id), 0)
  console.log('PASS unresponsive mTLS backend hits total opening deadline and releases target locks without a receipt')
  await reset(); const commitFailed = await snapshot(), commitClient = new Client()
  await assert.rejects(createTerminalSession(commitClient as unknown as WebSocket, commitFailed.originalHost, instance.id, instance.incusId,
    owner.id, 'container', actor.sid, open => authorize(commitFailed.expected, commitFailed.originalHost, actor, 'container', async () => {
      await open(); throw Error('controlled transaction commit failure')
    })), /commit failure/)
  await wait(() => connections.size === 0, 'failed transaction backend cleanup')
  assert.equal(commitClient.messages.some(message => JSON.parse(message).type === 'connected'), false)
  assert.equal(commitClient.listenerCount('close'), 0); assert.equal(commitClient.listenerCount('error'), 0)
  assert.equal(closeUserSessions(owner.id), 0)
  console.log('PASS transaction failure after successful mTLS opening closes both backend sockets and releases opening registration')
} catch (error) { failure = error }
finally {
  closeAllSessions(); stopSessionCleanup(); await app.close()
  for (const socket of connections) socket.terminate()
  backendWs.close(); backend.closeAllConnections(); await new Promise<void>(resolve => backend.close(() => resolve()))
  await prisma.log.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.instance.delete({ where: { id: instance.id } }); await prisma.package.delete({ where: { id: pkg.id } })
  await prisma.host.delete({ where: { id: host.id } }); await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await closePrismaDatabase()
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); await rm(root, { recursive: true, force: true })
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
