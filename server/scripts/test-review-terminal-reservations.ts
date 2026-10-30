import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { WebSocket, WebSocketServer } from 'ws'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const db = await import('../src/db/index.js')
const { withTerminalOpeningAuthorization: authorize } = await import('../src/db/terminal-opening-authorization.js')
const { closeUserSessions, closeAllSessions, stopSessionCleanup, getActiveSessionStats } = await import('../src/lib/terminal-proxy.js')
const { generateTerminalAccessTicket } = await import('../src/lib/action-ticket.js')
const { default: routes } = await import('../src/routes/terminal.js')
const wait = async (condition: () => boolean | Promise<boolean>, label: string, timeout = 4000) => {
  const until = Date.now() + timeout
  while (!await condition()) {
    if (Date.now() > until) throw Error('timeout: ' + label)
    await delay(10)
  }
}
const root = await mkdtemp(join(tmpdir(), 'terminal-reservations-'))
const keyPath = join(root, 'fixture.key'), certPath = join(root, 'fixture.crt')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=terminal-fixture', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath], { stdio: 'pipe', windowsHide: true })
const key = await readFile(keyPath), cert = await readFile(certPath)
let posts = 0
const connections = new Set<WebSocket>(), backendWs = new WebSocketServer({ noServer: true })
backendWs.on('connection', socket => { connections.add(socket); socket.once('close', () => connections.delete(socket)) })
const backend = createServer({ key, cert, ca: cert, requestCert: true, rejectUnauthorized: true }, (request, response) => {
  assert.equal((request.socket as import('node:tls').TLSSocket).authorized, true)
  posts++; request.resume()
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ type: 'async', operation: '/1.0/operations/fixture', metadata: { metadata: { fds: { 0: 'data', control: 'control' } } } }))
})
backend.on('upgrade', (request, socket, head) => backendWs.handleUpgrade(request, socket, head, socket => backendWs.emit('connection', socket)))
backend.listen(0, '127.0.0.1'); await once(backend, 'listening')
const tag = `terminal-reservations-${randomUUID()}`
const owner = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: owner.id, name: tag,
  url: `https://127.0.0.1:${(backend.address() as { port: number }).port}`, certPath, keyPath } })
const instanceData = { userId: owner.id, hostId: host.id, image: 'fixture/debian', cpu: 50, memory: 256, disk: 1024, status: 'running' as const }
const instance = await prisma.instance.create({ data: { ...instanceData, name: tag, incusId: tag } })
const second = await prisma.instance.create({ data: { ...instanceData, name: tag + '-second', incusId: tag + '-second' } })
const third = await prisma.instance.create({ data: { ...instanceData, name: tag + '-third', incusId: tag + '-third' } })
const actor = { id: owner.id, role: 'user', sid: tag, iat: Math.floor(Date.now() / 1000) }
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = { ...actor, username: owner.username } })
app.decorate('authenticateAdmin', app.authenticate)
const originalTransaction = prisma.$transaction
const originalLogCreate = prisma.log.create
let logsInFlight = 0, audits = 0
const auditErrors: unknown[] = []
prisma.log.create = (async (...args: Parameters<typeof originalLogCreate>) => {
  logsInFlight++
  try { const result = await originalLogCreate.apply(prisma.log, args); audits++; return result }
  catch (error) { auditErrors.push(error); throw error }
  finally { logsInFlight-- }
}) as unknown as typeof originalLogCreate
let failure: unknown
try {
  // Reproduce the log FK lock order without resetting fixture rows between operations.
  const expected = (await db.getInstanceById(instance.id))!, originalHost = (await db.getHostById(host.id))!
  let ready!: (pid: number) => void, release!: () => void
  const reached = new Promise<number>(resolve => { ready = resolve }), held = new Promise<void>(resolve => { release = resolve })
  const audit = prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`
    // The first FK in an audit insert already holds this key-share lock.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${owner.id} FOR KEY SHARE`
    const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
    ready(row.pid); await held
    await tx.log.create({ data: { userId: owner.id, instanceId: instance.id, module: 'terminal',
      action: 'terminal.connect', content: 'isolated concurrent audit', result: 'failed' } })
  }, { timeout: 12000 }).then(() => ({ ok: true as const }), error => ({ ok: false as const, error }))
  const auditPid = await reached
  let dispatched = 0
  const opening = authorize(expected, originalHost, actor, 'container', async () => { dispatched++; return true })
    .then(() => ({ ok: true as const }), error => ({ ok: false as const, error }))
  try {
    await wait(async () => {
      const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE ${auditPid} = ANY(pg_blocking_pids(pid))`
      return Number(row.count) > 0
    }, 'terminal authorization waits for the audit user FK')
  } finally { release() }
  const results = await Promise.all([audit, opening])
  assert.ok(results.every(result => result.ok), JSON.stringify(results))
  assert.equal(dispatched, 1)
  assert.equal(await prisma.log.count({ where: { userId: owner.id } }), 1)
  console.log('PASS actual PostgreSQL audit FK and terminal authorization both complete without deadlock')

  for (const mutation of ['update', 'delete'] as const) {
    let entered!: () => void, releaseOpen!: () => void, competitorReady!: (pid: number) => void
    const openReady = new Promise<void>(resolve => { entered = resolve })
    const openHeld = new Promise<void>(resolve => { releaseOpen = resolve })
    const pidReady = new Promise<number>(resolve => { competitorReady = resolve })
    const active = authorize(expected, originalHost, actor, 'container', async () => { entered(); await openHeld; return true })
    await openReady
    let mutated = false
    const rollback = new Error('fixture rollback')
    const competitor = prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
      competitorReady(row.pid)
      if (mutation === 'update') await tx.instance.update({ where: { id: instance.id }, data: { status: 'stopped' } })
      else await tx.instance.delete({ where: { id: instance.id } })
      mutated = true; throw rollback
    }, { timeout: 10000 }).then(() => undefined, error => error)
    try {
      const pid = await pidReady
      await wait(async () => {
        const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE pid = ${pid} AND cardinality(pg_blocking_pids(pid)) > 0`
        return Number(row.count) === 1
      }, mutation + ' waits for terminal authorization')
      assert.equal(mutated, false)
    } finally { releaseOpen(); await active }
    assert.equal(await competitor, rollback)
    assert.equal(mutated, true)
    assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).status, 'running')
  }
  console.log('PASS instance update and deletion still wait for authorization; rolled-back fixtures retain the instance')

  await app.register(websocket); await app.register(routes, { prefix: '/instances' })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const connect = (target: number) => {
    const ticket = generateTerminalAccessTicket(owner.id, target, actor.iat, actor.sid)
    const socket = new WebSocket(`ws://127.0.0.1:${(app.server.address() as { port: number }).port}/instances/${target}/terminal?ticket=${ticket}`)
    const messages: Array<{ type: string; code?: string }> = []
    socket.on('message', data => messages.push(JSON.parse(String(data))))
    return { socket, messages }
  }
  for (const scope of ['instance', 'user'] as const) {
    const requested = scope === 'instance' ? 5 : 6, expectedCount = scope === 'instance' ? 3 : 5
    let pending = 0, inFlight = 0, release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const beforeAudits = audits
    prisma.$transaction = (async (...args: Parameters<typeof originalTransaction>) => {
      pending++; inFlight++
      try { await held; return await originalTransaction.apply(prisma, args) }
      finally { inFlight-- }
    }) as typeof originalTransaction
    const originalRead = prisma.instance.findUnique
    let preflightReads = 0, releasePreflight!: () => void
    const preflight = new Promise<void>(resolve => { releasePreflight = resolve })
    prisma.instance.findUnique = (async (...args: Parameters<typeof originalRead>) => {
      const result = await originalRead.apply(prisma.instance, args)
      preflightReads++; await preflight; return result
    }) as unknown as typeof originalRead
    const targets = scope === 'instance' ? Array<number>(requested).fill(instance.id) :
      [instance.id, second.id, instance.id, second.id, instance.id, third.id]
    const clients = targets.map(connect)
    try {
      // All contenders pass the early general WS check before any reserves a slot.
      await wait(() => preflightReads === requested, 'all concurrent preflight reads')
      prisma.instance.findUnique = originalRead; releasePreflight()
      await wait(() => pending === expectedCount && clients.filter(item => item.messages.some(message => message.type === 'error')).length === requested - expectedCount, 'pending reservation limit')
      const errors = clients.flatMap(item => item.messages.filter(message => message.type === 'error'))
      assert.ok(errors.every(message => message.code === (scope === 'instance' ? 'INSTANCE_LIMIT_EXCEEDED' : 'USER_LIMIT_EXCEEDED')), JSON.stringify(errors))
      assert.equal(posts, 0)
      assert.equal(closeUserSessions(owner.id), expectedCount)
      release(); prisma.$transaction = originalTransaction
      await wait(() => inFlight === 0, 'cancelled authorization transactions settle', 12000)
      await wait(() => clients.every(item => item.socket.readyState === WebSocket.CLOSED), 'pending clients closed')
      await wait(() => logsInFlight === 0 && audits - beforeAudits === expectedCount, 'every cancelled route persists its audit', 12000)
      assert.equal(posts, 0); assert.equal(getActiveSessionStats().total, 0)
      assert.deepEqual(auditErrors, [])
      console.log('PASS actual route', scope, 'pending limit', expectedCount, 'with cancellation, zero backend POST and all audits persisted')
    } finally {
      prisma.instance.findUnique = originalRead; releasePreflight()
      release(); prisma.$transaction = originalTransaction
      for (const item of clients) item.socket.terminate()
      closeAllSessions(); await wait(() => inFlight === 0, 'reservation transaction cleanup', 12000)
    }
  }
  // Reuse released slots with actual WebSocket transports and actual audit writes.
  const client = connect(instance.id), beforeAudits = audits
  try {
    await wait(() => client.messages.some(message => message.type === 'connected'), 'released slots reusable')
    await wait(() => logsInFlight === 0 && audits === beforeAudits + 1, 'connection audit persisted')
    assert.equal(posts, 1); assert.equal(connections.size, 2)
    assert.equal(getActiveSessionStats().total, 1)
    client.socket.close()
    await wait(() => connections.size === 0 && getActiveSessionStats().total === 0, 'transport cleanup')
    await wait(() => logsInFlight === 0 && audits === beforeAudits + 2, 'disconnection audit persisted')
    assert.deepEqual(auditErrors, [])
    console.log('PASS released reservation connects normally, with connect/disconnect audits and complete socket cleanup')
  } finally { client.socket.terminate(); closeAllSessions() }
} catch (error) { failure = error }
finally {
  prisma.$transaction = originalTransaction
  closeAllSessions(); stopSessionCleanup(); await app.close()
  for (const socket of connections) socket.terminate()
  backendWs.close(); backend.closeAllConnections(); await new Promise<void>(resolve => backend.close(() => resolve()))
  await wait(() => logsInFlight === 0, 'audit cleanup', 12000)
  prisma.log.create = originalLogCreate
  await prisma.log.deleteMany({ where: { userId: owner.id } })
  await prisma.instance.deleteMany({ where: { id: { in: [instance.id, second.id, third.id] } } })
  await prisma.host.delete({ where: { id: host.id } }); await prisma.user.delete({ where: { id: owner.id } })
  await closePrismaDatabase()
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); await rm(root, { recursive: true, force: true })
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
