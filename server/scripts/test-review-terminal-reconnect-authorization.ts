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
  for (const name of ['banned', 'session', 'transferred', 'replaced', 'host-url', 'demoted', 'stopped', 'host-owner', 'all-sessions']) {
    await reset()
    const currentActor = name === 'demoted' ? { ...actor, id: admin.id, role: 'admin' } : actor
    const ticket = generateTerminalAccessTicket(currentActor.id, instance.id, currentActor.iat, currentActor.sid)
    const client = new WebSocket(`ws://127.0.0.1:${(app.server.address() as { port: number }).port}/instances/${instance.id}/terminal?ticket=${ticket}`)
    const messages: any[] = []; client.on('message', data => messages.push(JSON.parse(String(data))))
    try {
      await wait(() => messages.some(message => message.type === 'connected'), 'actual route initial connection')
      assert.equal(connections.size, 2)
      await prisma.$transaction(mutations[name])
      const before = posts
      for (const socket of connections) socket.terminate()
      await wait(() => client.readyState === WebSocket.CLOSED || posts > before, 'current authorization rejection or obsolete dispatch')
      assert.equal(posts, before, name + ': reconnect must not dispatch after current authority changed')
      assert.equal(client.readyState,WebSocket.CLOSED)
      assert.equal(messages.filter(message => message.type === 'connected').length,1)
      await wait(()=>connections.size===0&&getActiveSessionStats().total===0,'revoked session cleanup')
      console.log('PASS original WebSocket route reconnect rejects',name,'before POST')
    } finally { client.terminate();closeAllSessions();await wait(()=>connections.size===0,'matrix cleanup') }
  }
  for(const name of ['session','banned','transferred','host-url','demoted']) {
    await reset()
    const currentActor=name==='demoted'?{...actor,id:admin.id,role:'admin'}:actor
    const ticket=generateTerminalAccessTicket(currentActor.id,instance.id,currentActor.iat,currentActor.sid)
    const client=new WebSocket(`ws://127.0.0.1:${(app.server.address() as {port:number}).port}/instances/${instance.id}/terminal?ticket=${ticket}`)
    const messages:any[]=[];client.on('message',data=>messages.push(JSON.parse(String(data))))
    let release:()=>void=()=>{},entered!:(pid:number)=>void
    const held=new Promise<void>(resolve=>{release=resolve}),ready=new Promise<number>(resolve=>{entered=resolve})
    let blocker:Promise<unknown>|undefined
    try {
      await wait(()=>messages.some(message=>message.type==='connected'),'race initial connection')
      blocker=prisma.$transaction(async tx=>{
        if(name==='session')await tx.$queryRaw`SELECT id FROM users WHERE id = ${owner.id} FOR UPDATE`
        await mutations[name]!(tx)
        const [row]=await tx.$queryRaw<Array<{pid:number}>>`SELECT pg_backend_pid() AS pid`
        entered(row!.pid);await held
      },{timeout:10000})
      const pid=await ready,before=posts
      for(const socket of connections)socket.terminate()
      let blocked=false
      const until=Date.now()+4000
      while(Date.now()<until){
        const [row]=await prisma.$queryRaw<Array<{count:bigint}>>`SELECT count(*) FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`
        if(Number(row!.count)){blocked=true;break}await delay(10)
      }
      assert.equal(blocked,true,name+' reconnect waits on actual current-authority row lock')
      assert.equal(posts,before)
      release();await blocker
      await wait(()=>client.readyState===WebSocket.CLOSED,'race rejection')
      assert.equal(posts,before);assert.equal(messages.filter(message=>message.type==='connected').length,1)
      console.log('PASS actual reconnect waits on PG',name,'lock then rejects without dispatch')
    }finally{release();await blocker;client.terminate();closeAllSessions();await wait(()=>connections.size===0,'race cleanup')}
  }
  for(const currentActor of [actor,{...actor,id:hostOwner.id},{...actor,id:admin.id,role:'admin'}]) {
    await reset()
    const ticket=generateTerminalAccessTicket(currentActor.id,instance.id,currentActor.iat,currentActor.sid)
    const client=new WebSocket(`ws://127.0.0.1:${(app.server.address() as {port:number}).port}/instances/${instance.id}/terminal?ticket=${ticket}`)
    const messages:any[]=[];client.on('message',data=>messages.push(JSON.parse(String(data))))
    try {
      await wait(()=>messages.some(message=>message.type==='connected'),'normal role initial connection')
      const before=posts;for(const socket of connections)socket.terminate()
      await wait(()=>messages.filter(message=>message.type==='connected').length===2,'normal authorized reconnect')
      assert.equal(posts,before+1);assert.equal(connections.size,2)
    }finally{client.terminate();closeAllSessions();await wait(()=>connections.size===0,'normal role cleanup')}
  }
  console.log('PASS actual owner, host owner and administrator reconnect remain valid')
  for (const scenario of ['cancel-wait', 'lock-timeout', 'lock-then-post-deadline'] as const) {
    await reset()
    const captured = await snapshot(), client = new Client()
    const session = await createTerminalSession(client as unknown as WebSocket, captured.originalHost, instance.id,
      instance.incusId, owner.id, 'container', actor.sid,
      open => authorize(captured.expected, captured.originalHost, actor, 'container', open))
    let release!: () => void, entered!: (pid: number) => void
    const held = new Promise<void>(resolve => { release = resolve }), ready = new Promise<number>(resolve => { entered = resolve })
    const blocker = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${owner.id} FOR UPDATE`
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
      entered(row!.pid); await held
    }, { timeout: 15000 })
    try {
      const pid = await ready, before = posts, started = Date.now()
      holdPost = true; session.incusWebSocket!.terminate()
      let blocked = false
      const until = Date.now() + 4000
      while (Date.now() < until) {
        const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`
        if (Number(row!.count)) { blocked = true; break }; await delay(10)
      }
      assert.equal(blocked, true, scenario + ' must reach a real PostgreSQL lock wait')
      assert.equal(posts, before)
      if (scenario === 'cancel-wait') {
        assert.equal(closeUserSessions(owner.id), 1)
        assert.equal(client.readyState, 3)
        release(); await blocker
        await delay(150)
        assert.equal(posts, before, 'released lock must not allow a canceled reconnect POST')
      } else if (scenario === 'lock-timeout') {
        await wait(() => client.readyState === 3, 'database lock timeout closes reconnect', 6500)
        assert.equal(posts, before)
        release(); await blocker
      } else {
        const cancellation = session.reconnectCancellation
        assert.ok(cancellation)
        await delay(3200)
        release(); await blocker
        await wait(() => posts === before + 1, 'slow lock then stalled POST')
        await wait(() => cancellation.signal.aborted,
          'total reconnect deadline after lock wait', 20000)
        const elapsed = Date.now() - started
        assert.ok(elapsed >= 19000 && elapsed < 23000, 'database wait and POST must share the original 20s deadline')
        closeAllSessions()
        console.log('PASS reconnect lock and stalled POST share total deadline:', elapsed, 'ms')
      }
      await wait(() => connections.size === 0 && getActiveSessionStats().total === 0, 'lock boundary socket cleanup')
      await prisma.instance.update({ where: { id: instance.id }, data: { status: 'stopped' } })
      console.log('PASS reconnect PostgreSQL boundary', scenario, 'releases target locks')
    } finally { release(); await blocker; closeAllSessions() }
  }
  await reset()
  const commitTarget = await snapshot(), commitFailureClient = new Client()
  const commitFailureSession = await createTerminalSession(commitFailureClient as unknown as WebSocket,
    commitTarget.originalHost, instance.id, instance.incusId, owner.id, 'container', actor.sid,
    open => authorize(commitTarget.expected, commitTarget.originalHost, actor, 'container', open))
  const originalTransaction = prisma.$transaction
  let transportFinished = false, transactionCallbackFinished = false
  let commitFailure: unknown
  prisma.$transaction = (async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) =>
    originalTransaction.call(prisma, async tx => {
      const result = await callback(tx)
      transportFinished = true
      await tx.$executeRawUnsafe('CREATE TEMP TABLE terminal_commit_parent (id INTEGER PRIMARY KEY) ON COMMIT DROP')
      await tx.$executeRawUnsafe('CREATE TEMP TABLE terminal_commit_failure (user_id INTEGER REFERENCES terminal_commit_parent(id) DEFERRABLE INITIALLY DEFERRED) ON COMMIT DROP')
      await tx.$executeRawUnsafe('INSERT INTO terminal_commit_failure(user_id) VALUES (-1)')
      transactionCallbackFinished = true
      return result
    }, options).catch(error => { commitFailure = error; throw error })) as typeof prisma.$transaction
  try {
    commitFailureSession.incusWebSocket!.terminate()
    await wait(() => commitFailureClient.readyState === 3, 'actual deferred constraint commit failure')
    await wait(() => connections.size === 0, 'actual commit failure socket cleanup')
    assert.equal(transportFinished, true)
    assert.equal(transactionCallbackFinished, true, 'the transaction callback must return successfully before COMMIT fails')
    assert.match(String(commitFailure), /foreign key|constraint/i, 'the actual deferred foreign key must fail during COMMIT')
    assert.equal(commitFailureClient.messages.filter(message => JSON.parse(message).type === 'connected').length, 1)
    assert.equal(getActiveSessionStats().total, 0)
    console.log('PASS real PostgreSQL deferred-constraint COMMIT failure closes successful reconnect sockets')
  } finally { prisma.$transaction = originalTransaction; closeAllSessions() }
  await reset();const captured=await snapshot(),testClient=new Client();let authorizations=0
  const commitSession=await createTerminalSession(testClient as unknown as WebSocket,captured.originalHost,instance.id,instance.incusId,
    owner.id,'container',actor.sid,open=>authorize(captured.expected,captured.originalHost,actor,'container',async()=>{
      authorizations++;const result=await open();if(authorizations===2)throw Error('controlled reconnect commit failure');return result
    }))
  await wait(()=>connections.size===2,'commit failure initial pair');commitSession.incusWebSocket!.terminate()
  await wait(()=>testClient.readyState===3,'commit failure closes user session')
  await wait(()=>connections.size===0,'commit failure closes newly connected pair')
  assert.equal(authorizations,2);assert.equal(testClient.messages.filter(message=>JSON.parse(message).type==='connected').length,1)
  assert.equal(getActiveSessionStats().total,0)
  console.log('PASS successful reconnect transport followed by failed transaction closes both sockets without connected event')
  await reset()
  const cancelTarget=await snapshot(),cancelClient=new Client()
  let authorized=0,ready!:()=>void,release!:()=>void
  const commitReady=new Promise<void>(resolve=>{ready=resolve}),commitHeld=new Promise<void>(resolve=>{release=resolve})
  const cancelSession=await createTerminalSession(cancelClient as unknown as WebSocket,cancelTarget.originalHost,
    instance.id,instance.incusId,owner.id,'container',actor.sid,
    open=>authorize(cancelTarget.expected,cancelTarget.originalHost,actor,'container',async()=>{
      const result=await open();authorized++;if(authorized===2){ready();await commitHeld}return result
    }))
  try {
    cancelSession.incusWebSocket!.terminate()
    await Promise.race([commitReady,delay(4000).then(()=>{throw Error('reconnect transport did not reach pending transaction')})])
    assert.equal(connections.size,2)
    assert.equal(closeUserSessions(owner.id),1)
    await wait(()=>connections.size===0,'revocation must close new sockets before transaction finishes',800)
    assert.equal(cancelClient.messages.filter(message=>JSON.parse(message).type==='connected').length,1)
    console.log('PASS revocation closes newly connected transport while authorization transaction is still pending')
  }finally{release();await delay(100);closeAllSessions()}
  await reset()
  const initialTarget=await snapshot(),initialClient=new Client()
  let initialReady!:()=>void,initialRelease!:()=>void
  const initialReached=new Promise<void>(resolve=>{initialReady=resolve}),initialHeld=new Promise<void>(resolve=>{initialRelease=resolve})
  const initialOpening=createTerminalSession(initialClient as unknown as WebSocket,initialTarget.originalHost,
    instance.id,instance.incusId,owner.id,'container',actor.sid,
    open=>authorize(initialTarget.expected,initialTarget.originalHost,actor,'container',async()=>{
      const result=await open();initialReady();await initialHeld;return result
    })).then(()=> 'accepted',()=> 'rejected')
  try {
    await Promise.race([initialReached,delay(4000).then(()=>{throw Error('initial transport did not reach pending transaction')})])
    assert.equal(connections.size,2)
    assert.equal(closeUserSessions(owner.id),1)
    await wait(()=>connections.size===0,'initial revocation must close new sockets before transaction finishes',800)
    console.log('PASS initial revocation closes transport while authorization transaction is still pending')
  }finally{initialRelease();assert.equal(await initialOpening,'rejected');closeAllSessions()}
} catch(error) { failure=error }
finally {
  closeAllSessions();stopSessionCleanup();await app.close()
  for(const socket of connections)socket.terminate()
  backendWs.close();backend.closeAllConnections();await new Promise<void>(resolve=>backend.close(()=>resolve()))
  await prisma.log.deleteMany({where:{userId:{in:userIds}}})
  await prisma.instance.delete({where:{id:instance.id}});await prisma.package.delete({where:{id:pkg.id}})
  await prisma.host.delete({where:{id:host.id}});await prisma.user.deleteMany({where:{id:{in:userIds}}})
  await closePrismaDatabase()
  assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));await rm(root,{recursive:true,force:true})
}
if(failure){console.error(failure);process.exit(1)}
process.exit(0)

