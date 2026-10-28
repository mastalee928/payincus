import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IncusClient } from '../src/lib/incus/incus-client.js'
import { getBackupExportStream, getBackupExportUrl } from '../src/lib/incus/incus-backups.js'

const root = await mkdtemp(join(tmpdir(), 'backup-export-'))
async function certificate(name: string) {
  const keyPath = join(root, `${name}.key`), certPath = join(root, `${name}.pem`)
  execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=incus-fixture', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath],
  { stdio: 'pipe', windowsHide: true })
  return { keyPath, certPath, key: await readFile(keyPath), cert: await readFile(certPath, 'utf8') }
}
const original = await certificate('original'), replacement = await certificate('replacement')
const payload = Buffer.from('authenticated backup bytes')
let mode: 'normal' | 'stream' | 'hang' | 'error' = 'normal'
let exports = 0, bytesSent = 0, responseClosed = 0
const server = createServer({ key: original.key, cert: original.cert, ca: original.cert,
  requestCert: true, rejectUnauthorized: true }, (request, response) => {
  assert.ok((request.socket as any).authorized)
  if (request.url === '/1.0') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ type: 'sync', metadata: { api_version: '1.0' } }))
    return
  }
  exports++
  response.on('close', () => { responseClosed++ })
  if (mode === 'hang') { response.writeHead(200); response.flushHeaders(); return }
  if (mode === 'error') { response.writeHead(500); response.end(Buffer.alloc(128 * 1024, 97)); return }
  if (mode === 'normal') { response.setHeader('content-length', payload.length); response.end(payload); return }
  const chunk = Buffer.alloc(64 * 1024)
  const pump = () => {
    while (!response.destroyed && bytesSent < 256 * 1024 * 1024) {
      bytesSent += chunk.length
      if (!response.write(chunk)) { response.once('drain', pump); return }
    }
    if (!response.destroyed) response.end()
  }
  pump()
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as { port: number }).port
const client = new IncusClient({ url: `https://127.0.0.1:${port}`, certPath: original.certPath, keyPath: original.keyPath,
  serverCertificate: original.cert, serverFingerprint: new X509Certificate(original.cert).fingerprint256 })
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
try {
  await client.connect()
  assert.ok(getBackupExportUrl(client, 'vm?part', 'copy/#x').endsWith('/vm%3Fpart/backups/copy%2F%23x/export'))
  assert.throws(() => getBackupExportUrl(client, '..', 'copy'), /target/)
  const good = await getBackupExportStream(client, 'vm', 'copy')
  assert.equal(good.contentLength, payload.length)
  assert.deepEqual(Buffer.from(await new Response(good.stream).arrayBuffer()), payload)
  await assert.rejects(getBackupExportStream(client, 'vm', 'copy', { timeoutMs: 2147483648 }), /timeout/)

  // The ordinary API client is already connected. A new export connection
  // must reject a changed server certificate before sending an HTTP request.
  const beforeWrongPeer = exports
  server.setSecureContext({ key: replacement.key, cert: replacement.cert, ca: original.cert })
  await assert.rejects(getBackupExportStream(client, 'vm', 'copy'))
  assert.equal(exports, beforeWrongPeer)
  server.setSecureContext({ key: original.key, cert: original.cert, ca: original.cert })

  mode = 'stream'
  bytesSent = 0
  const beforeCancel = responseClosed
  const slow = await getBackupExportStream(client, 'vm', 'copy')
  await delay(150)
  assert.ok(bytesSent < 16 * 1024 * 1024, `unconsumed stream eagerly buffered ${bytesSent} bytes`)
  await slow.stream.cancel()
  for (let i = 0; i < 30 && responseClosed <= beforeCancel; i++) await delay(10)
  assert.ok(responseClosed > beforeCancel, 'cancel must terminate the remote response')

  mode = 'hang'
  const timeout = await getBackupExportStream(client, 'vm', 'copy', { timeoutMs: 80 })
  const started = Date.now()
  await assert.rejects(timeout.stream.getReader().read())
  assert.ok(Date.now() - started < 1500, 'total deadline must close a stalled body')
  const beforeUnread = responseClosed
  const unread = await getBackupExportStream(client, 'vm', 'copy', { timeoutMs: 80 })
  await delay(180)
  assert.ok(responseClosed > beforeUnread, 'deadline must close the connection even without a consumer')
  await assert.rejects(unread.stream.getReader().read())
  const aborter = new AbortController()
  const aborted = await getBackupExportStream(client, 'vm', 'copy', { signal: aborter.signal })
  aborter.abort(new Error('fixture-abort'))
  await assert.rejects(aborted.stream.getReader().read(), /fixture-abort/)
  const preAborted = exports
  await assert.rejects(getBackupExportStream(client, 'vm', 'copy', { signal: aborter.signal }))
  assert.equal(exports, preAborted)

  mode = 'error'
  await assert.rejects(getBackupExportStream(client, 'vm', 'copy'), error => error instanceof Error && error.message.length < 4200)
  mode = 'normal'
  const final = await getBackupExportStream(client, 'vm', 'copy')
  assert.deepEqual(Buffer.from(await new Response(final.stream).arrayBuffer()), payload)
  const legacy = new IncusClient({ url: client.baseUrl, certPath: original.certPath, keyPath: original.keyPath })
  try {
    await legacy.connect()
    const existingHost = await getBackupExportStream(legacy, 'vm', 'copy')
    assert.deepEqual(Buffer.from(await new Response(existingHost.stream).arrayBuffer()), payload)
  } finally { await legacy.close() }
  console.log('PASS real mTLS backup export: preserved server identity, changed-peer rejection, encoded resource path, bounded buffering/error body, cancellation/deadline and subsequent successful export')
} finally {
  await client.close()
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
}
