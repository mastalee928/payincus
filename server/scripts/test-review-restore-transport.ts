import assert from 'node:assert/strict'
import { randomUUID, X509Certificate } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { IncusClient } from '../src/lib/incus/incus-client.js'
import { restoreFromStream, instanceExists, stopInstanceForRestore } from '../src/lib/incus/incus-restore.js'

const root = await mkdtemp(join(tmpdir(), 'restore-transport-'))
async function certificate(name: string) {
  const keyPath = join(root, name + '.key'), certPath = join(root, name + '.pem')
  execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=incus-fixture', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath],
  { stdio: 'pipe', windowsHide: true })
  return { keyPath, certPath, key: await readFile(keyPath), cert: await readFile(certPath, 'utf8') }
}
const original = await certificate('original'), replacement = await certificate('replacement')
const operation = '/1.0/operations/' + randomUUID()
let mode = 'sync', uploads = 0, polls = 0, bytes = 0
let stopReads = 0, stops = 0
const server = createServer({ key: original.key, cert: original.cert, ca: original.cert, requestCert: true, rejectUnauthorized: true }, (request, response) => {
  assert.ok((request.socket as any).authorized)
  const json = (status: number, data: unknown) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(data)) }
  if (request.url === '/1.0') { json(200, { type: 'sync', metadata: { api_version: '1.0' } }); return }
  if (request.url === '/1.0/instances/vm%3Fpart/state') {
    if (request.method === 'PUT') {
      stops++
      if (mode === 'stop-hang') return
      json(mode === 'stop-error' ? 500 : 200, mode === 'stop-error'
        ? { type: 'error', error: 'fixture stop failed' } : { type: 'sync', metadata: {} })
    } else {
      stopReads++
      if (mode === 'state-hang') return
      if (mode === 'state-error') { json(403, { type: 'error', error: 'fixture state forbidden' }); return }
      const status = mode === 'stopped' || mode === 'stop-success' && stopReads > 1 ? 'Stopped'
        : mode === 'stop-unknown' ? undefined : 'Running'
      json(200, { type: 'sync', metadata: { status } })
    }
    return
  }
  if (request.url?.startsWith(operation + '/wait?')) {
    polls++
    if (mode === 'wait-hang') return
    json(200, { type: 'sync', metadata: mode === 'failure' ? { status: 'Failure', err: 'disk full' }
      : mode === 'cancelled' ? { status: 'Cancelled' } : { status: 'Success', metadata: {} } })
    return
  }
  if (request.method === 'GET' && request.url === '/1.0/instances/vm%3Fpart') {
    if (mode === 'exists') json(200, { type: 'sync', metadata: { name: 'vm?part' } })
    else json(mode === 'missing' ? 404 : 403, { type: 'error', error: 'fixture existence check' })
    return
  }
  if (request.method === 'POST' && request.url === '/1.0/instances') {
    uploads++
    assert.equal(request.headers['x-incus-name'], 'restored')
    assert.equal(request.headers['x-incus-pool'], 'pool')
    if (mode === 'upload-hang') return
    request.on('data', chunk => { bytes += chunk.length })
    request.on('end', () => {
      if (mode === 'large') { response.writeHead(500); response.end('a'.repeat(128 * 1024)); return }
      if (mode === 'error') { json(403, { type: 'error', error: 'fixture forbidden' }); return }
      if (mode === 'bad-path') { json(200, { type: 'async', operation: '/1.0/instances/wrong' }); return }
      if (mode === 'bad-type') { json(200, { arbitrary: true }); return }
      json(200, mode === 'sync' ? { type: 'sync', metadata: {} } : { type: 'async', operation })
    })
    return
  }
  json(404, { type: 'error', error: 'unexpected path' })
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const client = new IncusClient({ url: `https://127.0.0.1:${(server.address() as { port: number }).port}`,
  certPath: original.certPath, keyPath: original.keyPath, serverCertificate: original.cert,
  serverFingerprint: new X509Certificate(original.cert).fingerprint256 })
function restore(stream = Readable.from([Buffer.from('backup bytes')]), timeoutMs = 1500, signal?: AbortSignal) {
  return restoreFromStream({ client, backupStream: stream, targetName: 'restored', poolName: 'pool', timeoutMs, signal })
}
try {
  await client.connect()
  for (const state of ['stopped', 'stop-success', 'state-error', 'stop-error', 'stop-unconfirmed', 'stop-unknown', 'stop-hang', 'state-hang']) {
    mode = state; stops = 0; stopReads = 0
    const stop = stopInstanceForRestore(client, 'vm?part', state.endsWith('hang') ? 100 : 1500)
    if (['stopped', 'stop-success'].includes(state)) { await stop; assert.equal(stopReads, 2) }
    else await assert.rejects(stop)
    assert.equal(stops, ['stopped', 'state-error', 'state-hang', 'stop-unknown'].includes(state) ? 0 : 1)
  }
  assert.equal(uploads, 0, 'stopping alone never imports or deletes instances')
  for (const state of ['sync', 'async']) {
    mode = state
    const stream = Readable.from([Buffer.from('backup bytes')])
    await restore(stream)
    assert.ok(stream.destroyed)
  }
  assert.equal(bytes, 24)
  for (const [state, pattern] of [['failure', /disk full/], ['cancelled', /cancelled/], ['error', /forbidden/],
    ['bad-path', /operation path/], ['bad-type', /response type/], ['large', /64 KiB/]] as const) {
    mode = state
    const before = polls, stream = Readable.from([Buffer.from('bytes')])
    await assert.rejects(restore(stream), pattern)
    assert.ok(stream.destroyed)
    assert.equal(polls - before, ['failure', 'cancelled'].includes(state) ? 1 : 0, 'terminal error must not be retried')
  }
  for (const state of ['upload-hang', 'wait-hang']) {
    mode = state
    const stream = state === 'upload-hang' ? new Readable({ read() { this.push(Buffer.alloc(65536)) } }) : Readable.from(['bytes'])
    const started = Date.now()
    await assert.rejects(restore(stream, 120))
    assert.ok(Date.now() - started < 2000)
    assert.ok(stream.destroyed)
  }
  mode = 'wait-hang'
  const controller = new AbortController()
  const stream = Readable.from(['bytes'])
  const pending = assert.rejects(restore(stream, 1500, controller.signal), /fixture abort/)
  setTimeout(() => controller.abort(new Error('fixture abort')), 60)
  await pending
  assert.ok(stream.destroyed)
  const beforeAborted = uploads
  const preAborted = Readable.from(['bytes'])
  await assert.rejects(restore(preAborted, 1500, controller.signal), /fixture abort/)
  assert.equal(uploads, beforeAborted)
  assert.ok(preAborted.destroyed)

  mode = 'sync'
  server.setSecureContext({ key: replacement.key, cert: replacement.cert, ca: original.cert })
  const beforeWrongPeer = uploads
  await assert.rejects(restore())
  assert.equal(uploads, beforeWrongPeer)
  server.setSecureContext({ key: original.key, cert: original.cert, ca: original.cert })
  await restore()
  await client.getServerInfo()
  mode = 'exists'
  assert.equal(await instanceExists(client, 'vm?part'), true)
  mode = 'missing'
  assert.equal(await instanceExists(client, 'vm?part'), false)
  mode = 'forbidden'
  await assert.rejects(instanceExists(client, 'vm?part'), /existence check/)
  console.log('PASS actual mTLS restore: stopped confirmation, stop/state failures and total deadline; sync/async bytes, immediate disk-full/cancel/error, invalid operation path/type, bounded response, upload/poll total deadline, external/pre-abort, source cleanup, changed server pin rejected with zero HTTP, original client reusable, exact 404 existence versus 403')
} finally {
  await client.agent?.destroy()
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
}
