import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Host } from '../src/types/database.js'
import { createTerminalSession, closeUserSessions, closeSessionTerminalSessions, closeInstanceSessions,
  closeAllSessions, getActiveSessionStats, stopSessionCleanup } from '../src/lib/terminal-proxy.js'

const root = await mkdtemp(join(tmpdir(), 'terminal-opening-'))
const keyPath = join(root, 'client.key'), certPath = join(root, 'client.crt')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=terminal-fixture', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath],
{ stdio: 'pipe', windowsHide: true })
const key = await readFile(keyPath), cert = await readFile(certPath)
let mode: 'post' | 'upgrade' | 'ready' | 'error' | 'vm-fallback' | 'one-error' = 'post', posts = 0, consoles = 0, upgrades = 0
const held: Array<() => void> = [], connections = new Set<WebSocket>()
const ws = new WebSocketServer({ noServer: true })
ws.on('connection', socket => { connections.add(socket); socket.once('close', () => connections.delete(socket)) })
const server = createServer({ key, cert, ca: cert, requestCert: true, rejectUnauthorized: true }, (req, res) => {
  assert.equal((req.socket as any).authorized, true)
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
const rejectionWithin = async (opening: Promise<string>) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    assert.equal(await Promise.race([opening, new Promise(resolve => { timer = setTimeout(() => resolve('still-pending'), 1500) })]), 'rejected',
      'revocation interrupts an unresponsive backend without waiting for its receipt')
  } finally { clearTimeout(timer) }
}
try {
  const client = new Client(), before = posts
  const opening = start(client).then(() => 'accepted', () => 'rejected')
  await wait(() => posts > before, 'opening POST')
  assert.equal(closeUserSessions(11), 1, 'revocation must include a terminal opening its backend')
  await rejectionWithin(opening)
  held.splice(0).forEach(reply => reply())
  assert.equal(await opening, 'rejected')
  assert.equal(client.messages.some(message => JSON.parse(message).type === 'connected'), false)
  assert.equal(getActiveSessionStats().total, 0)
  console.log('PASS opening user revocation cannot establish a backend terminal')
  for (const phase of ['post', 'upgrade'] as const) for (const [scope, close] of Object.entries(closeScopes)) {
    mode = phase; held.length = 0; const client = new Client(), beforePosts = posts, beforeUpgrades = upgrades
    const opening = start(client).then(() => 'accepted', () => 'rejected')
    await wait(() => phase === 'post' ? posts > beforePosts : upgrades >= beforeUpgrades + 2, `${phase} opening`)
    assert.equal(close(), 1, scope); assert.equal(client.closed, 1)
    await rejectionWithin(opening)
    held.splice(0).forEach(reply => reply())
    assert.equal(await opening, 'rejected'); assert.equal(getActiveSessionStats().total, 0)
    assert.equal(client.listenerCount('close'), 0); assert.equal(client.listenerCount('error'), 0)
    assert.equal(client.messages.some(message => JSON.parse(message).type === 'connected'), false)
  }
  console.log('PASS eight revocations during POST and WebSocket handshakes clean opening slots, sockets and handlers')
  mode = 'post'; const old = new Client(), other = new Client(), previousPosts = posts
  const oldOpening = start(old).then(() => 'accepted', () => 'rejected')
  const otherOpening = start(other, 22, 'other-session', 202)
  await wait(() => posts === previousPosts + 2, 'two independent opening requests')
  assert.equal(closeUserSessions(11), 1); await rejectionWithin(oldOpening)
  held.splice(0).forEach(reply => reply()); const otherSession = await otherOpening
  assert.equal(otherSession.userId, 22); assert.equal(getActiveSessionStats().total, 1); assert.equal(other.closed, 0)
  assert.equal(closeAllSessions(), 1); await wait(() => connections.size === 0, 'independent opening cleanup')
  console.log('PASS concurrent opening revocation remains scoped and stale completion cannot affect the other user')
  for (const event of ['close', 'error']) {
    mode = 'post'; const client = new Client(), before = posts
    const opening = start(client).then(() => 'accepted', () => 'rejected'); await wait(() => posts > before, 'client disconnect')
    if (event === 'close') client.close(); else client.emit('error', Error('controlled client error'))
    held.splice(0).forEach(reply => reply()); assert.equal(await opening, 'rejected'); assert.equal(getActiveSessionStats().total, 0)
  }
  mode = 'post'; const vm = new Client(), beforeVm = posts, beforeConsole = consoles
  const openingVm = start(vm, 11, 'opening-session', 101, 'vm').then(() => 'accepted', () => 'rejected')
  await wait(() => posts > beforeVm, 'VM opening'); closeUserSessions(11); held.splice(0).forEach(reply => reply())
  assert.equal(await openingVm, 'rejected'); assert.equal(consoles, beforeConsole, 'revocation must not trigger VM fallback')
  console.log('PASS disconnect/error and VM revocation cannot reopen via fallback')
  mode = 'one-error'; const brokenPair = new Client()
  await assert.rejects(start(brokenPair), /503|closed|cancelled/)
  assert.equal(closeUserSessions(11), 0); assert.equal(brokenPair.listenerCount('close'), 0)
  mode = 'error'; const failed = new Client()
  await assert.rejects(start(failed), /controlled terminal failure/)
  assert.equal(closeUserSessions(11), 0); assert.equal(failed.listenerCount('close'), 0); assert.equal(failed.listenerCount('error'), 0)
  mode = 'ready'; const retry = await start(failed); assert.equal(retry.connectionMode, 'exec'); closeAllSessions()
  await wait(() => connections.size === 0, 'failure retry cleanup')
  const closed = new Client(); closed.close(); const noRequest = posts
  await assert.rejects(start(closed), /before terminal/); assert.equal(posts, noRequest)
  mode = 'vm-fallback'; const fallback = await start(new Client(), 33, 'vm-session', 303, 'vm')
  assert.equal(fallback.connectionMode, 'console'); closeAllSessions(); await wait(() => connections.size === 0, 'VM cleanup')
  console.log('PASS backend failure releases opening slots, retry works, closed clients make zero requests and valid VM fallback remains')
  mode = 'ready'; const normal = new Client(), session = await start(normal, 22, 'normal-session', 202)
  assert.equal(getActiveSessionStats().total, 1); assert.equal(connections.size, 2)
  assert.equal(closeUserSessions(11), 0); assert.equal(closeSessionTerminalSessions('opening-session'), 0); assert.equal(closeInstanceSessions(101), 0)
  assert.equal(getActiveSessionStats().total, 1)
  assert.equal(normal.messages.filter(message => JSON.parse(message).type === 'connected').length, 1)
  assert.equal(closeAllSessions(), 1); assert.equal(session.heartbeatTimer, null)
  await wait(() => connections.size === 0, 'backend socket cleanup'); assert.equal(getActiveSessionStats().total, 0)
  console.log('PASS normal mTLS/data/control connection and unrelated revocation scope remain valid')
} finally {
  closeAllSessions(); stopSessionCleanup(); held.splice(0).forEach(reply => reply()); for (const socket of connections) socket.terminate()
  ws.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep) && resolve(root) !== resolve(tmpdir()))
  await rm(root, { recursive: true, force: true })
}
