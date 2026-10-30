import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Duplex } from 'node:stream'
import type { Host } from '../src/types/database.js'
import { createTerminalSession, closeUserSessions, closeSessionTerminalSessions, closeInstanceSessions,
  closeAllSessions, getActiveSessionStats, stopSessionCleanup } from '../src/lib/terminal-proxy.js'

const root = await mkdtemp(join(tmpdir(), 'terminal-reconnect-'))
const keyPath = join(root, 'client.key'), certPath = join(root, 'client.crt')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=terminal-fixture', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath],
{ stdio: 'pipe', windowsHide: true })
const key = await readFile(keyPath), cert = await readFile(certPath)
let mode: 'post' | 'upgrade' | 'ready' | 'error' | 'vm-fallback' | 'one-error' = 'post', posts = 0, consoles = 0, upgrades = 0
const held: Array<() => void> = [], connections = new Set<WebSocket>()
const sockets = new Set<Duplex>()
const ws = new WebSocketServer({ noServer: true })
ws.on('connection', socket => { connections.add(socket); socket.once('close', () => connections.delete(socket)) })
const server = createServer({ key, cert, ca: cert, requestCert: true, rejectUnauthorized: true }, (req, res) => {
  assert.equal((req.socket as import('node:tls').TLSSocket).authorized, true)
  if (!req.url?.endsWith('/exec') && !req.url?.endsWith('/console')) { res.writeHead(404); res.end(); return }
  posts++; if (req.url.endsWith('/console')) consoles++
  req.resume()
  const reply = () => {
    const failed = mode === 'error' || mode === 'vm-fallback' && req.url!.endsWith('/exec')
    res.writeHead(failed ? 500 : 200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(failed ? { type: 'error', error: 'controlled terminal failure' } :
      { type: 'async', operation: '/1.0/operations/controlled', metadata: { metadata: { fds: { 0: 'data', control: 'control' } } } }))
  }
  if (mode === 'post') held.push(reply); else reply()
})
server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
server.on('upgrade', (req, socket, head) => {
  upgrades++
  if (mode === 'one-error') { if (req.url?.endsWith('secret=control')) socket.end('HTTP/1.1 503 Unavailable\r\nConnection: close\r\n\r\n'); return }
  const accept = () => { if (!socket.destroyed) ws.handleUpgrade(req, socket, head, socket => ws.emit('connection', socket)) }
  if (mode === 'upgrade') held.push(accept); else accept()
})
server.listen(0, '127.0.0.1'); await once(server, 'listening')
const host = { id: 1, url: `https://127.0.0.1:${(server.address() as { port: number }).port}`, cert_path: certPath, key_path: keyPath } as Host
class Client extends EventEmitter {
  OPEN = 1; readyState = 1; messages: string[] = []; closed = 0
  send(message: string) { this.messages.push(message) }
  ping() {}
  close() { if (this.readyState !== this.OPEN) return; this.closed++; this.readyState = 3; this.emit('close') }
}
const wait = async (condition: () => boolean, label: string) => {
  const deadline = Date.now() + 4000
  while (!condition()) { if (Date.now() > deadline) throw Error('timeout: ' + label); await new Promise(resolve => setTimeout(resolve, 10)) }
}
const start = (client: Client, user = 11, session = 'opening-session', instance = 101, type: 'container' | 'vm' = 'container') =>
  createTerminalSession(client as unknown as WebSocket, host, instance, 'fixture-instance', user, type, session)
const closeScopes = {
  user: () => closeUserSessions(11), session: () => closeSessionTerminalSessions('opening-session'),
  instance: () => closeInstanceSessions(101), all: () => closeAllSessions()
}

try {
  for(const phase of ['delay','post','upgrade'] as const) for(const [scope,close] of Object.entries(closeScopes)) {
    mode='ready';held.length=0
    const client=new Client();const session=await start(client)
    await wait(()=>connections.size===2,'initial pair')
    const beforePosts=posts,beforeUpgrades=upgrades
    mode=phase==='upgrade'?'upgrade':'post'
    session.incusWebSocket!.terminate()
    if(phase==='delay')await wait(()=>client.messages.some(m=>JSON.parse(m).type==='reconnecting'),'backoff')
    else await wait(()=>phase==='post'?posts===beforePosts+1:upgrades===beforeUpgrades+2,'reconnect phase')
    const cancellation=session.reconnectCancellation
    assert.ok(cancellation && !cancellation.signal.aborted)
    assert.equal(close(),1);assert.equal(client.closed,1)
    assert.equal(cancellation.signal.aborted,true)
    await wait(()=>sockets.size===0,'revocation closes actual in-flight transport before its receipt')
    assert.equal(session.reconnectCancellation,null)
    assert.equal(session.heartbeatTimer,null)
    mode='ready';held.splice(0).forEach(reply=>reply());await new Promise(resolve=>setTimeout(resolve,150))
    assert.equal(getActiveSessionStats().total,0)
    assert.equal(client.messages.filter(m=>JSON.parse(m).type==='connected').length,1)
    if(phase==='delay')assert.equal(posts,beforePosts)
    if(phase!=='upgrade')assert.equal(upgrades,beforeUpgrades)
    await wait(()=>connections.size===0,'pair cleanup')
    console.log('PASS',phase,scope,'no late backend session')
  }
  for(const scope of ['user','session','instance'] as const) {
    mode='ready';held.length=0
    const oldClient=new Client(), otherClient=new Client()
    const old=await start(oldClient),other=await start(otherClient,22,'other-session',202)
    await wait(()=>connections.size===4,'two initial pairs')
    const before=posts,beforeUpgrade=upgrades
    mode='post';old.incusWebSocket!.terminate();other.incusWebSocket!.terminate()
    await wait(()=>posts===before+2,'two simultaneous reconnect requests')
    const cancellation=old.reconnectCancellation
    assert.equal(closeScopes[scope](),1);assert.equal(oldClient.closed,1)
    assert.equal(cancellation?.signal.aborted,true)
    await wait(()=>sockets.size===1,'only other account retains its pending request')
    assert.equal(otherClient.closed,0);assert.equal(other.reconnectCancellation?.signal.aborted,false)
    mode='ready';held.splice(0).forEach(reply=>reply())
    await wait(()=>otherClient.messages.filter(m=>JSON.parse(m).type==='connected').length===2,'other account reconnects')
    assert.equal(upgrades,beforeUpgrade+2)
    assert.equal(oldClient.messages.filter(m=>JSON.parse(m).type==='connected').length,1)
    assert.equal(getActiveSessionStats().total,1);assert.equal(other.incusReconnectAttempts,0)
    assert.equal(other.reconnectCancellation,null);closeAllSessions()
    await wait(()=>sockets.size===0,'independent transport cleanup')
    console.log('PASS concurrent',scope,'revocation preserves the other reconnect')
  }
  for(const event of ['close','error'] as const) {
    mode='ready';held.length=0
    const client=new Client(),session=await start(client)
    await wait(()=>connections.size===2,'disconnect initial pair')
    const before=posts,beforeUpgrade=upgrades
    mode='post';session.incusWebSocket!.terminate()
    await wait(()=>posts===before+1,'disconnect pending reconnect')
    if(event==='close')client.close();else client.emit('error',Error('controlled reconnect client failure'))
    await wait(()=>sockets.size===0,'client disconnect cancels request before receipt')
    mode='ready';held.splice(0).forEach(reply=>reply())
    await new Promise(resolve=>setTimeout(resolve,100))
    assert.equal(upgrades,beforeUpgrade);assert.equal(getActiveSessionStats().total,0)
    console.log('PASS reconnect client',event,'cancels in-flight request')
  }
  mode='ready';const vmClient=new Client(),vm=await start(vmClient,11,'opening-session',101,'vm')
  await wait(()=>connections.size===2,'VM initial pair')
  const beforeVmPosts=posts,beforeConsoles=consoles
  mode='post';vm.incusWebSocket!.terminate();await wait(()=>posts===beforeVmPosts+1,'VM reconnect POST')
  closeUserSessions(11);await wait(()=>sockets.size===0,'VM cancellation transport cleanup')
  mode='vm-fallback';held.splice(0).forEach(reply=>reply());await new Promise(resolve=>setTimeout(resolve,100))
  assert.equal(consoles,beforeConsoles,'VM cancellation must not trigger console fallback')
  mode='ready';const fallbackClient=new Client(),fallback=await start(fallbackClient,11,'opening-session',101,'vm')
  await wait(()=>connections.size===2,'VM fallback initial pair')
  mode='vm-fallback';fallback.incusWebSocket!.terminate()
  await wait(()=>fallbackClient.messages.filter(m=>JSON.parse(m).type==='connected').length===2,'valid VM reconnect fallback')
  assert.equal(fallback.connectionMode,'console');assert.equal(consoles,beforeConsoles+1)
  closeAllSessions();await wait(()=>sockets.size===0,'VM fallback cleanup')
  console.log('PASS VM reconnect cancellation prevents fallback while valid fallback remains')
  mode='ready'; const good=new Client(), session=await start(good)
  await wait(()=>connections.size===2,'ready pair');session.incusWebSocket!.terminate()
  await wait(()=>good.messages.filter(m=>JSON.parse(m).type==='connected').length===2,'normal reconnect')
  assert.equal(getActiveSessionStats().total,1);assert.equal(connections.size,2);closeAllSessions()
  await wait(()=>connections.size===0,'normal reconnect cleanup')
  mode='ready';const bounded=new Client(), hung=await start(bounded)
  await wait(()=>connections.size===2,'bounded pair')
  mode='post';const before=posts,started=Date.now();hung.incusWebSocket!.terminate()
  await wait(()=>posts===before+1,'hung POST')
  const firstCancellation=hung.reconnectCancellation
  await new Promise(resolve=>setTimeout(resolve,20500))
  assert.equal(hung.incusReconnectAttempts,2,'20s request must settle into bounded retry')
  assert.equal(firstCancellation?.signal.aborted,true)
  assert.notEqual(hung.reconnectCancellation,firstCancellation,'new attempt uses an independent controller')
  assert.equal(sockets.size,0,'expired attempt closes its transport before next retry')
  assert.ok(Date.now()-started<23000);closeAllSessions();mode='ready';held.splice(0).forEach(reply=>reply())
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(getActiveSessionStats().total,0)
  console.log('PASS normal reconnect and total 20s deadline, cleanup before retry')
} finally {
  closeAllSessions();stopSessionCleanup();held.splice(0).forEach(reply=>reply())
  for(const socket of connections)socket.terminate()
  ws.close();server.closeAllConnections();for(const socket of sockets)socket.destroy()
  await new Promise<void>(resolve=>server.close(()=>resolve()))
  assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&resolve(root)!==resolve(tmpdir()))
  await rm(root,{recursive:true,force:true})
}
