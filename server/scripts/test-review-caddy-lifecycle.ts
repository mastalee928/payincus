import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import Fastify from 'fastify'
import { createCaddyClient, closeCaddyClients } from '../src/lib/caddy-client.js'
import { logSerializers, sanitizeObject, sanitizeTokensInString } from '../src/lib/log-sanitizer.js'

// Isolated TLS fixture: no PostgreSQL, cloud hosts or customer credentials.
const root = await mkdtemp(join(tmpdir(), 'payincus-caddy-lifecycle-'))
const caPath = join(root, 'cert.pem'), keyPath = join(root, 'key.pem')
let releaseGet: (() => void) | undefined
let enteredGet: (() => void) | undefined
let pauseGet: Promise<void> | undefined
const calls: string[] = []
let configuration: any = { apps: { http: { servers: {} } } }
let revision = 0
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=caddy-admin', '-addext', 'subjectAltName=DNS:caddy-admin', '-keyout', keyPath, '-out', caPath],
{ stdio: 'pipe', windowsHide: true })
const server = createServer({ key: await readFile(keyPath), cert: await readFile(caPath) }, async (request, response) => {
  const respond = (status: number, body: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json', etag: `"/config/ ${revision}"` })
    response.end(JSON.stringify(body))
  }
  try {
    assert.equal(request.headers.authorization, `Basic ${Buffer.from('fixture:fixture-password').toString('base64')}`)
    calls.push(`${request.method} ${request.url}`)
    if (request.method === 'GET' && request.url === '/config/') {
      const wait = pauseGet
      pauseGet = undefined
      enteredGet?.()
      if (wait) await wait
      respond(200, configuration)
      return
    }
    if (request.method === 'POST' && request.url === '/config/apps/http') {
      assert.equal(request.headers['if-match'], `"/config/ ${revision}"`)
      let body = ''
      for await (const chunk of request) body += chunk
      configuration.apps.http = JSON.parse(body)
      revision++
      respond(200, {})
      return
    }
    respond(404, {})
  } catch (error) {
    respond(500, { error: error instanceof Error ? error.message : String(error) })
  }
})
const logLines: string[] = []
const stream = new Writable({ write(chunk, _encoding, callback) { logLines.push(String(chunk)); callback() } })
const app = Fastify({ logger: { level: 'info', stream, serializers: logSerializers } })
app.get('/api/hosts/caddy-script/:token', async () => ({ ok: true }))

try {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const makeClient = (host = '127.0.0.1', targetPort = port) => createCaddyClient({
    host, port: targetPort, username: 'fixture', password: 'fixture-password', caPath
  })
  const client = makeClient()
  await client.getConfig()
  const originalAgent = (client as any).agent

  // Pause the first request of a multi-request write; evict while it is in flight.
  const reachedGet = new Promise<void>(resolve => { enteredGet = resolve })
  pauseGet = new Promise<void>(resolve => { releaseGet = resolve })
  const write = client.addSite('lru.fixture.test', '127.0.0.1', 8080, false)
  await reachedGet
  for (let index = 1; index <= 101; index++) makeClient(`127.0.0.${index}`, port + 1)
  assert.equal(originalAgent.closed, true, 'eviction drains the original Agent')
  releaseGet!()
  await write
  assert.ok(calls.includes('POST /config/apps/http'), 'write continues after its GET Agent was evicted')
  assert.equal(configuration.apps.http.servers.sites.routes[0].match[0].host[0], 'lru.fixture.test')
  assert.notEqual((client as any).agent, originalAgent)
  assert.equal((client as any).agent.closed, false)

  // An existing client must reuse a replacement pool created by another caller.
  const evictedAgent = (client as any).agent
  for (let index = 1; index <= 101; index++) makeClient(`127.0.1.${index}`, port + 1)
  assert.equal(evictedAgent.closed, true)
  const replacement = makeClient()
  await client.getConfig()
  assert.equal((client as any).agent, (replacement as any).agent)
  const replacementAgent = (client as any).agent
  // Actual requests refresh LRU order, even when no new client object is created.
  for (let index = 1; index <= 120; index++) {
    makeClient(`127.0.2.${index}`, port + 1)
    await client.getConfig()
  }
  assert.equal((client as any).agent, replacementAgent)
  assert.equal(replacementAgent.closed, false)

  const token = 'WzIsMSwyLDMsInVzZXIiXQ.fixtureSignature01234567890123456789012345678'
  const querySecret = 'fixture-query-secret'
  const url = `/api/hosts/caddy-script/${token}?token=${querySecret}&page=2`
  const sanitized = sanitizeTokensInString(url)
  assert.equal(sanitized, '/api/hosts/caddy-script/[REDACTED]?token=[REDACTED]&page=2')
  const encodedToken = token.replaceAll('.', '%2E')
  assert.equal(sanitizeTokensInString(`/hosts/caddy-script/${encodedToken}`), '/hosts/caddy-script/[REDACTED]')
  assert.equal(sanitizeTokensInString('/api/hosts/123/caddy/sites?page=2'), '/api/hosts/123/caddy/sites?page=2')
  for (const value of [sanitizeObject({ url }), logSerializers.err(new Error(`Fetch failed: ${url}`))]) {
    assert.ok(!JSON.stringify(value).includes(token))
    assert.ok(!JSON.stringify(value).includes(querySecret))
  }
  const response = await app.inject({ method: 'GET', url,
    headers: { authorization: 'Bearer fixture-header-secret', cookie: 'fixture-session=secret' } })
  assert.equal(response.statusCode, 200)
  await app.close()
  const output = logLines.join('')
  const incoming = logLines.flatMap(line => line.trim().split('\n')).map(line => JSON.parse(line)).find(row => row.req)
  assert.equal(incoming.req.url, sanitized, 'Fastify incoming request logs use the redacted path')
  for (const secret of [token, querySecret, 'fixture-header-secret', 'fixture-session=secret']) {
    assert.ok(!output.includes(secret), 'request logs must not retain bearer credentials')
  }
  await closeCaddyClients()
  assert.equal(replacementAgent.closed, true, 'backend shutdown closes the replacement Agent')
  console.log('PASS Caddy lifecycle: eviction during GET preserves the following POST, retained clients reacquire/reuse a live Agent, requests refresh LRU, shutdown closes pools; real Fastify request/error logs redact path/query/header credentials')
} finally {
  releaseGet?.()
  await app.close()
  await closeCaddyClients()
  await new Promise<void>(resolve => server.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
}
