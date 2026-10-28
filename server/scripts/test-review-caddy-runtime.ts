import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { request as httpRequest } from 'node:http'
import { createServer as createHttpServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const binary = process.env.REVIEW_CADDY_BINARY
assert.ok(binary, 'Set REVIEW_CADDY_BINARY to a verified isolated Caddy executable')
const freePort = () => new Promise<number>(resolve => {
  const socket = createServer()
  socket.listen(0, '127.0.0.1', () => {
    const port = (socket.address() as { port: number }).port
    socket.close(() => resolve(port))
  })
})
const root = await mkdtemp(join(tmpdir(), 'payincus-real-caddy-'))
const isolatedEnv = { ...process.env, XDG_DATA_HOME: join(root, 'data'), XDG_CONFIG_HOME: join(root, 'config'), APPDATA: root, LOCALAPPDATA: root }
const ca = join(root, 'cert.pem'), key = join(root, 'key.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=caddy-admin', '-addext', 'subjectAltName=DNS:caddy-admin', '-keyout', key, '-out', ca], { stdio: 'pipe', windowsHide: true })
const hash = execFileSync(binary!, ['hash-password', '--plaintext', 'fixture-password'], { encoding: 'utf8', windowsHide: true, env: isolatedEnv }).trim()
const apiPort = await freePort(), adminPort = await freePort()
const configPath = join(root, 'config.json')
const config = { admin: { listen: `127.0.0.1:${adminPort}` },
  apps: {
    pki: { certificate_authorities: { local: { install_trust: false } } },
    tls: { certificates: { load_files: [{ certificate: ca, key, tags: ['fixture'] }] },
      automation: { policies: [{ issuers: [{ module: 'internal' }] }] } },
    http: { servers: {
      control: { listen: [`127.0.0.1:${apiPort}`], automatic_https: { disable_redirects: true }, tls_connection_policies: [{ certificate_selection: { any_tag: ['fixture'] } }],
        routes: [{ handle: [
          { handler: 'authentication', providers: { http_basic: { accounts: [{ username: 'fixture', password: hash }] } } },
          { handler: 'reverse_proxy', upstreams: [{ dial: `127.0.0.1:${adminPort}` }],
            headers: { request: { set: { Host: [`127.0.0.1:${adminPort}`] } } } }
        ] }] },
      sites: { listen: ['127.0.0.1:80', '127.0.0.1:443'], routes: [], automatic_https: { disable_redirects: true } }
    } }
  } }
await writeFile(configPath, JSON.stringify(config))
execFileSync(binary!, ['validate', '--config', configPath], { stdio: 'pipe', windowsHide: true, env: isolatedEnv })
const processHandle = spawn(binary!, ['run', '--config', configPath], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: isolatedEnv })
let output = ''
processHandle.stdout.on('data', bytes => { output += bytes.toString() })
processHandle.stderr.on('data', bytes => { output += bytes.toString() })
const { createCaddyClient, closeCaddyClients } = await import('../src/lib/caddy-client.js')
const client = createCaddyClient({ host: '127.0.0.1', port: apiPort, username: 'fixture', password: 'fixture-password', caPath: ca })
try {
  let ready = false
  let lastError: unknown
  for (let attempt = 0; attempt < 100; attempt++) {
    if (processHandle.exitCode !== null) throw new Error(`Caddy exited before ready: ${output}`)
    try { await client.getConfig(); ready = true; break } catch (error) { lastError = error; await new Promise(resolve => setTimeout(resolve, 100)) }
  }
  assert.ok(ready, `${lastError}\n${output}`)
  await client.addSite('http-only.fixture.test', '127.0.0.1', 43210, false)
  let current = await client.getConfig() as any
  assert.deepEqual(current.apps.http.servers.sites.listen, ['127.0.0.1:80', '127.0.0.1:443'])
  assert.deepEqual(current.apps.http.servers.sites.automatic_https.skip, ['http-only.fixture.test'])
  const httpStatus = await new Promise<number>(resolve => {
    const request = httpRequest('http://127.0.0.1', { headers: { Host: 'http-only.fixture.test' } }, response => { response.resume(); resolve(response.statusCode!) })
    request.end()
  })
  assert.equal(httpStatus, 502, `HTTP request reaches the configured unavailable fixture upstream: ${JSON.stringify(current.apps.http.servers.sites)}`)
  await client.addSite('https.fixture.test', '127.0.0.1', 43211, true)
  const before = await client.getConfig()
  let etag: string | undefined
  await (client as any).request('GET', '/config/', undefined, { onEtag: (value: string) => { etag = value } })
  const invalidHttp = structuredClone((before as any).apps.http)
  invalidHttp.servers.sites.routes[0].handle = [{ handler: 'fixture_nonexistent_handler' }]
  await assert.rejects((client as any).request('POST', '/config/apps/http', invalidHttp, { ifMatch: etag }), /Caddy API error/)
  assert.deepEqual(await client.getConfig(), before, 'real Caddy rejects invalid reload and keeps the exact prior configuration')
  await client.addSite('http-only.fixture.test', '2001:db8::1', 43213, false)
  current = await client.getConfig() as any
  assert.equal(current.apps.http.servers.sites.routes.find((row: any) => row.match[0].host[0] === 'http-only.fixture.test').handle[0].upstreams[0].dial, '[2001:db8::1]:43213')
  await client.deleteSite('http-only.fixture.test')
  await client.deleteSite('http-only.fixture.test')
  current = await client.getConfig() as any
  assert.ok(!current.apps.http.servers.sites.routes.some((row: any) => row.match[0].host[0] === 'http-only.fixture.test'))
  assert.ok(current.apps.http.servers.control, 'unmanaged control server preserved through all writes')
  // Exact legacy migration/deletion runs against the real ETag API.
  await (client as any).request('POST', '/config/apps/http/servers/sites/routes',
    { '@id': 'site-legacy-fixture-test', match: [{ host: ['legacy.fixture.test'] }], handle: [{ handler: 'static_response', body: 'fixture' }] })
  await client.deleteSite('legacy.fixture.test')
  assert.ok(!(await client.getSites()).includes('legacy.fixture.test'))
  let upstreamHits = 0
  const upstream = createHttpServer((_request, response) => { upstreamHits++; response.end('managed-fixture') })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const upstreamPort = (upstream.address() as { port: number }).port
  const siteKey = randomUUID(), domain = 'generation.fixture.test'
  const managed = { siteKey, domain, targetIp: '127.0.0.1', targetPort: upstreamPort, httpsEnabled: false }
  const visit = () => new Promise<void>((resolve, reject) => {
    const request = httpRequest('http://127.0.0.1', { headers: { Host: domain } }, response => {
      response.resume(); response.once('end', resolve)
    })
    request.on('error', reject); request.end()
  })
  try {
    await client.reconcileManagedSite({ ...managed, revision: 1, action: 'upsert' })
    await visit()
    assert.equal(upstreamHits, 1, 'active managed route reaches its exact upstream')
    assert.equal(await client.reconcileManagedSite({ ...managed, revision: 1, action: 'upsert' }), 'unchanged')
    await client.reconcileManagedSite({ ...managed, revision: 2, action: 'disable' })
    await visit()
    assert.equal(upstreamHits, 1, 'disabled tombstone must match zero traffic')
    await assert.rejects(client.reconcileManagedSite({ ...managed, revision: 1, action: 'upsert' }), /更新.*代次/)
    await client.reconcileManagedSite({ ...managed, revision: 3, action: 'upsert' })
    await visit()
    assert.equal(upstreamHits, 2)
    await client.reconcileManagedSite({ ...managed, revision: 4, action: 'delete' })
    await visit()
    assert.equal(upstreamHits, 2, 'deleted tombstone must match zero traffic')
    await assert.rejects(client.reconcileManagedSite({ ...managed, revision: 3, action: 'upsert' }), /更新.*代次/)
    const afterTombstone = await client.getConfig() as any
    assert.equal(afterTombstone.apps.http.servers.sites.routes.filter((route: any) =>
      route['@id']?.startsWith(`site-v3-${siteKey}-`)).length, 1)
    assert.ok(afterTombstone.apps.http.servers.control, 'v3 reconciliation preserves the control server')
    console.log('PASS real Caddy v3 generations: active traffic, identical replay, zero-traffic disabled/deleted tombstones and late-generation rejection')
  } finally { await new Promise<void>(resolve => upstream.close(() => resolve())) }
  console.log('PASS real Caddy runtime: verified TLS/Basic Auth, root ETag scoped atomic updates, HTTP-only routing/skip, invalid reload rollback, bracketed IPv6 upstream, exact legacy deletion and unmanaged config preservation; Windows native process, not Linux installation')
} finally {
  await closeCaddyClients()
  processHandle.kill()
  if (processHandle.exitCode === null) await new Promise(resolve => processHandle.once('exit', resolve))
  await writeFile(join(process.cwd(), '../logs/review-caddy-runtime/process.log'), output)
  await rm(root, { recursive: true, force: true })
}
