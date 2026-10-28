import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { randomUUID, X509Certificate } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:https'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'),
  'Use an isolated local *_pool_test database')
process.env.JWT_SECRET ||= 'proxy-ipv4-sync-isolated-fixture-secret'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: instanceRoutes } = await import('../src/routes/instances.js')
const { default: hostRoutes } = await import('../src/routes/hosts.js')
const { default: proxyRoutes } = await import('../src/routes/proxy-sites.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const { closeCaddyClients } = await import('../src/lib/caddy-client.js')
const tag = `proxy-sync-${randomUUID().slice(0, 12)}`
const trigger = `proxy_sync_${randomUUID().replaceAll('-', '')}`
const root = await mkdtemp(join(tmpdir(), 'payincus-proxy-ipv4-sync-'))
const caPath = join(root, 'cert.pem'), keyPath = join(root, 'key.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=caddy-admin', '-addext', 'subjectAltName=DNS:caddy-admin', '-keyout', keyPath, '-out', caPath],
{ stdio: 'pipe', windowsHide: true })
const certificate = await readFile(caPath, 'utf8')
const previousCa = process.env.CADDY_CA_PATH
process.env.CADDY_CA_PATH = caPath
let observedIpv4 = '10.42.0.2'
let observedStatus = 'Running'
let credentials = { username: 'fixture', password: 'fixture-password' }
let beforeState: (() => Promise<void>) | undefined
let beforeWrite: (() => Promise<void>) | undefined
let rejectWrite = false
let revision = 0
const calls: string[] = []
const domain = `${tag}.fixture.test`
const routeId = `site-v2-${Buffer.from(domain).toString('base64url')}`
let config: any = { apps: { http: { servers: { sites: { listen: [':80'], routes: [
  { '@id': routeId, match: [{ host: [domain], protocol: 'http' }],
    handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '10.42.0.1:8080' }] }] }
] } } } } }
const server = createServer({ key: await readFile(keyPath), cert: certificate, ca: certificate,
  requestCert: true, rejectUnauthorized: false }, async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk
  const url = request.url || ''
  const send = (value: unknown, code = 200) => { response.writeHead(code, { 'content-type': 'application/json', etag: `"/config/ ${revision}"` }); response.end(JSON.stringify(value)) }
  const incus = (metadata: unknown) => send({ type: 'sync', metadata })
  calls.push(`${request.method} ${url}`)
  if (url.startsWith('/1.0')) {
    assert.ok((request.socket as any).authorized, 'Incus fixture requires the pinned client certificate')
    if (url === '/1.0') return incus({ api_version: '1.0' })
    if (url === `/1.0/instances/${tag}/state`) {
      const state = { status: observedStatus, network: { eth0: { addresses: [{ family: 'inet', scope: 'global', address: observedIpv4 }] } } }
      const hook = beforeState; beforeState = undefined
      if (hook) await hook()
      return incus(state)
    }
    if (url === `/1.0/instances/${tag}`) return incus({ name: tag, status: observedStatus, devices: {}, config: {} })
    return send({ type: 'error', error: 'fixture instance absent' }, 404)
  }
  assert.equal(request.headers.authorization, `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
    'Caddy writes use current host credentials')
  if (request.method === 'GET' && url === '/config/') return send(config)
  if (request.method === 'POST' && url === '/config/apps/http') {
    const hook = beforeWrite; beforeWrite = undefined
    if (hook) await hook()
    if (rejectWrite) return send({ error: `fixture upstream not found ${credentials.password}` }, 500)
    if (request.headers['if-match'] !== `"/config/ ${revision}"`) return send({}, 412)
    config.apps.http = JSON.parse(body); revision++; return send({})
  }
  if (url.startsWith('/id/')) {
    const id = url.slice(4)
    const routes = config.apps.http.servers.sites.routes
    const row = routes.find((route: any) => route['@id'] === id)
    if (!row) return send({}, 404)
    if (request.method === 'GET') return send(row)
    if (request.method === 'DELETE') { config.apps.http.servers.sites.routes = routes.filter((route: any) => route['@id'] !== id); revision++; return send({}) }
  }
  return send({}, 404)
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as { port: number }).port
const owner = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
const other = await prisma.user.create({ data: { username: `${tag}-other`, passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: owner.id, name: tag, url: `https://127.0.0.1:${port}`,
  certPath: caPath, keyPath, serverCertificate: certificate, serverFingerprint: new X509Certificate(certificate).fingerprint256,
  caddyEnabled: true, caddyUsername: credentials.username, caddyPassword: credentials.password, caddyPort: port,
  natPublicIp: '127.0.0.1', status: 'online', cpuUsed: 100, memoryUsed: 512, diskUsed: 1024 } })
const instance = await prisma.instance.create({ data: { userId: owner.id, hostId: host.id, name: tag, incusId: tag,
  image: 'fixture/debian', status: 'running', cpu: 100, memory: 512, disk: 1024, networkMode: 'nat', ipv4: '10.42.0.1' } })
const site = await prisma.proxySite.create({ data: { instanceId: instance.id, hostId: host.id, domain,
  targetPort: 8080, httpsEnabled: false, status: 'active', enabled: true } })
const actor = { id: owner.id, username: tag, role: 'user', sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
const app = Fastify()
for (const hook of ['authenticate', 'authenticateUser', 'authenticateAdmin', 'requireAdmin']) app.decorate(hook, async (request: any) => { request.user = { ...actor } })
const single = () => app.inject({ method: 'POST', url: `/instances/${instance.id}/sync-status` })
const batch = () => app.inject({ method: 'POST', url: `/hosts/${host.id}/instances/sync-status`, payload: { instanceIds: [instance.id] } })
const toggle = () => app.inject({ method: 'POST', url: `/instances/${instance.id}/sites/${site.id}/toggle` })
const currentSite = () => prisma.proxySite.findUniqueOrThrow({ where: { id: site.id } })
const currentInstance = () => prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
const routeDial = () => config.apps.http.servers.sites.routes.find((route: any) => route['@id'] === routeId)?.handle[0].upstreams[0].dial
async function setTrigger(condition: string) {
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = ${site.id} AND (${condition}) THEN RAISE EXCEPTION 'fixture-proxy-sync-write-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON proxy_sites FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
}
async function dropTrigger() {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON proxy_sites`)
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`)
}
function pauseObservation() {
  let entered!: () => void, release!: () => void
  const ready = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  beforeState = async () => { entered(); await gate }
  return { ready, release }
}
try {
  await app.register(instanceRoutes, { prefix: '/instances' })
  await app.register(hostRoutes, { prefix: '/hosts' })
  await app.register(proxyRoutes)

  // Failure to persist intent rolls back both the instance address and primary IP.
  await setTrigger('NEW.ipv4_sync_pending AND NOT OLD.ipv4_sync_pending')
  const beforeMark = calls.length
  const failedMark = await single()
  assert.equal(failedMark.statusCode, 500, failedMark.body)
  assert.equal((await currentInstance()).ipv4, '10.42.0.1')
  assert.equal(await prisma.ipAddress.count({ where: { instanceId: instance.id } }), 0)
  assert.equal((await currentSite()).ipv4SyncPending, false)
  assert.ok(!calls.slice(beforeMark).some(call => call.endsWith('/config/apps/http')))
  await dropTrigger()

  rejectWrite = true
  const beforeFailure = calls.length
  const failed = await single()
  assert.equal(failed.statusCode, 502, failed.body)
  assert.equal((await currentInstance()).ipv4, observedIpv4)
  assert.equal((await currentSite()).ipv4SyncPending, true)
  assert.match((await currentSite()).error!, /not found/)
  assert.ok(!(await currentSite()).error!.includes(credentials.password))
  assert.equal(routeDial(), '10.42.0.1:8080', 'rejected Caddy update preserves the old working route')
  assert.ok(!calls.slice(beforeFailure).some(call => call.startsWith('DELETE ')))
  assert.equal((await prisma.ipAddress.findFirstOrThrow({ where: { instanceId: instance.id, type: 'inet4', isPrimary: true } })).address, observedIpv4)
  rejectWrite = false
  const retry = await single()
  assert.equal(retry.statusCode, 200, retry.body)
  assert.equal(retry.json().ipv4Changed, false)
  assert.equal(retry.json().proxySitesUpdated, 1)
  assert.equal((await currentSite()).ipv4SyncPending, false)
  assert.equal(routeDial(), `${observedIpv4}:8080`)

  // Remote success followed by a SQL failure cannot discard the committed intent.
  observedIpv4 = '10.42.0.3'
  await setTrigger('OLD.ipv4_sync_pending AND NOT NEW.ipv4_sync_pending')
  const failedFinalizer = await single()
  assert.equal(failedFinalizer.statusCode, 502, failedFinalizer.body)
  assert.equal(routeDial(), `${observedIpv4}:8080`)
  assert.equal((await currentSite()).ipv4SyncPending, true)
  await dropTrigger()
  const completedRetry = await single()
  assert.equal(completedRetry.statusCode, 200, completedRetry.body)
  assert.equal(completedRetry.json().ipv4Changed, false)
  assert.equal((await currentSite()).ipv4SyncPending, false)

  // A user disable that completes during Incus observation cannot be undone.
  observedIpv4 = '10.42.0.4'
  const paused = pauseObservation()
  const delayedSync = single()
  await paused.ready
  assert.equal((await toggle()).statusCode, 200)
  const afterDisable = calls.length
  paused.release()
  assert.equal((await delayedSync).statusCode, 200)
  assert.equal((await currentSite()).enabled, false)
  assert.equal(routeDial(), undefined)
  assert.ok(!calls.slice(afterDisable).some(call => call.endsWith('/config/apps/http')))
  assert.equal((await toggle()).statusCode, 200)

  // An in-flight Caddy write holds the same lock used by user mutations.
  observedIpv4 = '10.42.0.5'
  let enteredWrite!: () => void, releaseWrite!: () => void
  const entered = new Promise<void>(resolve => { enteredWrite = resolve })
  const gate = new Promise<void>(resolve => { releaseWrite = resolve })
  beforeWrite = async () => { enteredWrite(); await gate }
  const inFlight = single()
  await entered
  assert.equal((await currentSite()).ipv4SyncPending, true)
  assert.equal((await toggle()).statusCode, 409)
  releaseWrite()
  assert.equal((await inFlight).statusCode, 200)

  // Re-read current credentials after the observation instead of using the old host snapshot.
  observedIpv4 = '10.42.0.6'
  const credentialPause = pauseObservation()
  const credentialSync = single()
  await credentialPause.ready
  credentials = { username: 'fixture-new', password: 'fixture-new-password' }
  await prisma.host.update({ where: { id: host.id }, data: { caddyUsername: credentials.username, caddyPassword: credentials.password } })
  credentialPause.release()
  assert.equal((await credentialSync).statusCode, 200)

  observedIpv4 = '10.42.0.7'
  const ownershipPause = pauseObservation()
  const ownershipSync = single()
  await ownershipPause.ready
  await prisma.instance.update({ where: { id: instance.id }, data: { userId: other.id } })
  const beforeStaleWrite = calls.length
  ownershipPause.release()
  assert.equal((await ownershipSync).statusCode, 409)
  assert.equal((await currentInstance()).ipv4, '10.42.0.6')
  assert.ok(!calls.slice(beforeStaleWrite).some(call => call.endsWith('/config/apps/http')))
  await prisma.instance.update({ where: { id: instance.id }, data: { userId: owner.id } })

  const hostIdentityPause = pauseObservation()
  const hostIdentitySync = single()
  await hostIdentityPause.ready
  await prisma.host.update({ where: { id: host.id }, data: { serverFingerprint: 'fixture-changed-identity' } })
  hostIdentityPause.release()
  const changedIdentity = await hostIdentitySync
  assert.equal(changedIdentity.statusCode, 409, changedIdentity.body)
  assert.equal(changedIdentity.json().code, 'INSTANCE_SYNC_HOST_CHANGED')
  assert.equal((await currentInstance()).ipv4, '10.42.0.6')
  await prisma.host.update({ where: { id: host.id }, data: { serverFingerprint: new X509Certificate(certificate).fingerprint256 } })

  const bannedPause = pauseObservation()
  const bannedSync = single()
  await bannedPause.ready
  await prisma.user.update({ where: { id: owner.id }, data: { status: 'banned' } })
  bannedPause.release()
  assert.equal((await bannedSync).statusCode, 403)
  assert.equal((await currentInstance()).ipv4, '10.42.0.6')
  await prisma.user.update({ where: { id: owner.id }, data: { status: 'active' } })

  // Host batch returns the Caddy failure, even if its body contains 'not found'.
  rejectWrite = true
  const failedBatch = await batch()
  assert.equal(failedBatch.statusCode, 200, failedBatch.body)
  assert.equal(failedBatch.json().results[0].success, false)
  assert.match(failedBatch.json().results[0].error, /not found/)
  assert.equal((await currentInstance()).status, 'running')
  assert.equal((await currentSite()).ipv4SyncPending, true)
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).cpuUsed, 100)
  rejectWrite = false
  const batchRetry = await batch()
  assert.equal(batchRetry.json().results[0].success, true)
  assert.equal(batchRetry.json().results[0].proxySitesUpdated, 1)
  assert.equal(batchRetry.json().results[0].ipv4Changed, undefined)

  // Missing Caddy configuration also keeps the durable retry marker.
  observedIpv4 = '10.42.0.8'
  await prisma.host.update({ where: { id: host.id }, data: { caddyEnabled: false } })
  const beforeMissing = calls.length
  assert.equal((await single()).statusCode, 502)
  assert.equal((await currentSite()).ipv4SyncPending, true)
  assert.match((await currentSite()).error!, /Caddy 未启用/)
  assert.ok(!calls.slice(beforeMissing).some(call => call.endsWith('/config/apps/http')))
  await prisma.host.update({ where: { id: host.id }, data: { caddyEnabled: true } })
  const recoveredConfig = await single()
  assert.equal(recoveredConfig.statusCode, 200)
  assert.equal(recoveredConfig.json().ipv4Changed, false)

  // Same-IP observations still consume a strictly increasing DB generation.
  const futureGeneration = new Date(Date.now() + 60_000)
  await prisma.instance.update({ where: { id: instance.id }, data: { updatedAt: futureGeneration } })
  const unchangedSync = await single()
  assert.equal(unchangedSync.statusCode, 200, unchangedSync.body)
  assert.equal(unchangedSync.json().ipv4Changed, false)
  assert.equal(unchangedSync.json().statusChanged, false)
  assert.ok((await currentInstance()).updatedAt > futureGeneration, 'generation advances even when the previous timestamp is ahead of the clock')

  const lateRunningPause = pauseObservation()
  const lateRunning = single()
  await lateRunningPause.ready
  observedStatus = 'Stopped'
  const newerStopped = await batch()
  assert.equal(newerStopped.json().results[0].success, true, newerStopped.body)
  const afterStopped = await currentInstance()
  assert.equal(afterStopped.status, 'stopped')
  lateRunningPause.release()
  const rejectedRunning = await lateRunning
  assert.equal(rejectedRunning.statusCode, 409, rejectedRunning.body)
  assert.equal(rejectedRunning.json().code, 'INSTANCE_SYNC_SOURCE_CHANGED')
  assert.equal((await currentInstance()).status, 'stopped', 'late Running cannot overwrite newer Stopped at the same IP')
  assert.equal((await currentInstance()).updatedAt.getTime(), afterStopped.updatedAt.getTime())

  // ABA: a stopped snapshot becomes running then stopped again before it arrives.
  const abaPause = pauseObservation()
  const staleBatch = batch()
  await abaPause.ready
  observedStatus = 'Running'
  assert.equal((await single()).statusCode, 200)
  observedStatus = 'Stopped'
  assert.equal((await single()).statusCode, 200)
  const afterAba = await currentInstance()
  abaPause.release()
  const rejectedAba = await staleBatch
  assert.equal(rejectedAba.json().results[0].success, false, rejectedAba.body)
  assert.equal((await currentInstance()).status, 'stopped')
  assert.equal((await currentInstance()).updatedAt.getTime(), afterAba.updatedAt.getTime(), 'ABA cannot consume or overwrite the newer generation')
  observedStatus = 'Running'
  assert.equal((await single()).statusCode, 200)

  // Both entry points preserve suspended while retaining the retry intent.
  observedIpv4 = '10.42.0.9'
  await prisma.instance.update({ where: { id: instance.id }, data: { status: 'suspended', suspendReason: 'admin' } })
  const beforeSuspended = calls.length
  const suspended = await single()
  assert.equal(suspended.statusCode, 502, suspended.body)
  assert.equal(suspended.json().statusChanged, false)
  assert.equal(suspended.json().currentStatus, 'suspended')
  const suspendedBatch = await batch()
  assert.equal(suspendedBatch.json().changedCount, 0)
  assert.equal((await currentInstance()).status, 'suspended')
  assert.equal((await currentSite()).ipv4SyncPending, true)
  assert.ok(!calls.slice(beforeSuspended).some(call => call.endsWith('/config/apps/http')))
  console.log('PASS real PostgreSQL/Fastify/TLS IPv4 sync: atomic address+intent rollback, same-IP retry, remote-success/DB-failure retains intent, concurrent disable/shared lock, current identities and session, same-IP late-state/ABA generation rejection and monotonic progress, suspended preservation; retry runs on sync requests, not a timer worker')
} finally {
  await dropTrigger()
  await app.close()
  await closeAllClients()
  await closeCaddyClients()
  await new Promise<void>(resolve => server.close(() => resolve()))
  await prisma.log.deleteMany({ where: { OR: [{ instanceId: instance.id }, { userId: owner.id }] } })
  await prisma.proxySite.deleteMany({ where: { instanceId: instance.id } })
  await prisma.ipAddress.deleteMany({ where: { instanceId: instance.id } })
  await prisma.instance.delete({ where: { id: instance.id } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } })
  await closePrismaDatabase()
  if (previousCa === undefined) delete process.env.CADDY_CA_PATH; else process.env.CADDY_CA_PATH = previousCa
  await rm(root, { recursive: true, force: true })
}
process.exit(0)
