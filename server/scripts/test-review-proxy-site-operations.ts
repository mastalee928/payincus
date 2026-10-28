import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:https'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/proxy-sites.js')
const { applyProxySiteOperation, prepareProxySiteOperation, supersedeProxySiteIpv4Operation } = await import('../src/db/proxy-site-operations.js')
const { advisoryTransactionLock, INSTANCE_OPERATION_LOCK_NAMESPACE } = await import('../src/db/advisory-locks.js')
const { closeCaddyClients } = await import('../src/lib/caddy-client.js')
const { assertNoPendingProxySiteOperations } = await import('../src/db/proxy-site-operation-guards.js')
const { syncInstanceNetworkAndProxySites, readProxyNetworkSyncHostIdentity } = await import('../src/lib/instance-proxy-network-sync.js')
const tag = `proxy-op-${randomUUID()}`
const root = await mkdtemp(join(tmpdir(), tag))
const ca = join(root, 'cert.pem'), key = join(root, 'key.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=caddy-admin', '-addext', 'subjectAltName=DNS:caddy-admin', '-keyout', key, '-out', ca], { stdio: 'pipe', windowsHide: true })
let config: any = { apps: { http: { servers: { unmanaged: { listen: [':8081'], routes: [{ '@id': 'unmanaged', match: [{ host: ['untouched.example'] }] }] } } } } }
let revision = 0
let failPost = false
let beforePost: (() => Promise<void>) | undefined
let afterPost: (() => Promise<void>) | undefined
const remoteCalls: string[] = []
const remote = createServer({ cert: await readFile(ca), key: await readFile(key) }, async (request, response) => {
  const respond = (status: number, body: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json', etag: `"/config/ ${revision}"` })
    response.end(JSON.stringify(body))
  }
  try {
    assert.equal(request.headers.authorization, `Basic ${Buffer.from('fixture:fixture-password').toString('base64')}`)
    remoteCalls.push(`${request.method} ${request.url}`)
    if (request.method === 'GET' && request.url === '/config/') return respond(200, config)
    if (request.method === 'POST' && request.url === '/config/apps/http') {
      await beforePost?.()
      if (failPost) return respond(500, { error: 'fixture-remote-write-failed' })
      if (request.headers['if-match'] !== `"/config/ ${revision}"`) return respond(412, {})
      let body = ''; for await (const chunk of request) body += chunk
      config.apps.http = JSON.parse(body)
      revision++
      await afterPost?.()
      return respond(200, {})
    }
    respond(404, {})
  } catch (error) { respond(500, { error: error instanceof Error ? error.message : String(error) }) }
})
await new Promise<void>(resolve => remote.listen(0, '127.0.0.1', resolve))
const port = (remote.address() as { port: number }).port
const originalCa = process.env.CADDY_CA_PATH
process.env.CADDY_CA_PATH = ca
const owner = await prisma.user.create({ data: { username: `${tag}-owner`, passwordHash: 'fixture' } })
const other = await prisma.user.create({ data: { username: `${tag}-other`, passwordHash: 'fixture' } })
const host = await prisma.host.create({ data: { name: tag, userId: owner.id, url: 'https://127.0.0.1:1', ipAddress: '127.0.0.1',
  caddyEnabled: true, caddyUsername: 'fixture', caddyPassword: 'fixture-password', caddyPort: port } })
const instance = await prisma.instance.create({ data: { name: tag, incusId: tag, userId: owner.id, hostId: host.id,
  image: 'fixture/debian', status: 'running', ipv4: '10.7.0.2', cpu: 100, memory: 512, disk: 2048, siteLimit: 4 } })
const site = await prisma.proxySite.create({ data: { instanceId: instance.id, hostId: host.id, domain: 'state.fixture.example', targetPort: 8080,
  httpsEnabled: false, status: 'active', enabled: true } })
const actor = { id: owner.id, role: 'user', username: owner.username, sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
const app = Fastify()
app.decorate('authenticateUser', async (request: any) => { request.user = { ...actor } })
app.decorate('authenticate', async (request: any) => { request.user = { ...actor } })
const base = `/instances/${instance.id}/sites/${site.id}`
const routesForDomain = () => Object.values(config.apps.http.servers).flatMap((server: any) => server.routes || [])
const remoteSite = () => routesForDomain().filter((row: any) => row['@id']?.startsWith(`site-v3-${site.siteKey}-`)) as any[]
const ref = async () => prisma.proxySite.findUniqueOrThrow({ where: { id: site.id } })
const pendingCount = () => prisma.proxySiteOperation.count({ where: { instanceId: instance.id, state: { in: ['pending', 'retry', 'blocked', 'applying'] } } })
let trigger: string | undefined
try {
  await app.register(routes)
  const initial = await app.inject({ method: 'GET', url: `/instances/${instance.id}/sites` })
  assert.equal(initial.statusCode, 200)
  assert.equal(initial.json().sites[0].revision, 0)
  assert.equal((await app.inject({ method: 'POST', url: `${base}/refresh` })).statusCode, 409, 'missing revision cannot write')
  assert.equal((await app.inject({ method: 'POST', url: `${base}/toggle`, payload: { requestId: randomUUID(), expectedRevision: 0 } })).statusCode, 409, 'target must be explicit')
  const requestId = randomUUID()
  failPost = true
  const refused = await app.inject({ method: 'PATCH', url: base, payload: { requestId, expectedRevision: 0, targetPort: 9090 } })
  assert.equal(refused.statusCode, 502, refused.body)
  assert.equal((await ref()).targetPort, 8080)
  assert.equal((await ref()).revision, 1)
  assert.equal(await pendingCount(), 1)
  assert.equal((await app.inject({ method: 'PATCH', url: base, payload: { requestId: randomUUID(), expectedRevision: 1, targetPort: 9091 } })).statusCode, 409)
  const duplicate = await app.inject({ method: 'PATCH', url: base, payload: { requestId, expectedRevision: 0, targetPort: 9090 } })
  assert.equal(duplicate.statusCode, 502, duplicate.body)
  assert.equal(await prisma.proxySiteOperation.count({ where: { siteId: site.id } }), 1)
  failPost = false
  const retry = await app.inject({ method: 'POST', url: `${base}/retry`, payload: { requestId, expectedRevision: 1 } })
  assert.equal(retry.statusCode, 200, retry.body)
  assert.equal((await ref()).targetPort, 9090)
  assert.equal((await ref()).appliedRevision, 1)
  assert.equal(remoteSite().length, 1)
  assert.equal(remoteSite()[0]['@id'], `site-v3-${site.siteKey}-1-active`)
  assert.ok(routesForDomain().some((row: any) => row['@id'] === 'unmanaged'))

  // Remote success followed by a ledger failure must retain the accepted intent.
  trigger = `fixture_proxy_${randomUUID().replaceAll('-', '')}`
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'site.operation.applied' AND NEW.instance_id = ${instance.id} THEN RAISE EXCEPTION 'fixture-proxy-log-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  const secondId = randomUUID()
  const uncertain = await app.inject({ method: 'PATCH', url: base, payload: { requestId: secondId, expectedRevision: 1, targetPort: 9092 } })
  assert.equal(uncertain.statusCode, 502, uncertain.body)
  assert.equal((await ref()).targetPort, 9090)
  assert.equal((await ref()).revision, 2)
  assert.equal(remoteSite()[0]['@id'], `site-v3-${site.siteKey}-2-active`)
  assert.equal(await pendingCount(), 1)
  await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON logs`)
  await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
  trigger = undefined
  const resumed = await app.inject({ method: 'POST', url: `${base}/retry`, payload: { requestId: secondId, expectedRevision: 2 } })
  assert.equal(resumed.statusCode, 200, resumed.body)
  assert.equal((await ref()).targetPort, 9092)
  assert.equal(remoteSite().length, 1)

  failPost = true
  const oldAddressRequest = randomUUID()
  const oldAddressResult = await app.inject({ method: 'PATCH', url: base,
    payload: { requestId: oldAddressRequest, expectedRevision: 2, targetPort: 9093, remark: 'keep intended change' } })
  assert.equal(oldAddressResult.statusCode, 502, oldAddressResult.body)
  const syncAddress = async () => {
    const current = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
    const currentHost = await prisma.host.findUniqueOrThrow({ where: { id: host.id } })
    return syncInstanceNetworkAndProxySites({ id: current.id, hostId: host.id, incusId: current.incusId, userId: current.userId,
      hostOwnerId: currentHost.userId, hostUrl: currentHost.url, hostConnectionIdentity: await readProxyNetworkSyncHostIdentity(host.id),
      updatedAt: current.updatedAt.toISOString(), networkMode: current.networkMode, ipv4: current.ipv4, ipv6: current.ipv6 },
    { ipv4: '10.7.0.3', ipv6: null, ipv4Device: 'eth0', ipv6Device: 'eth1', configuredIpv6: null, observedIpv6: null }, 'running', actor)
  }
  trigger = `fixture_proxy_${randomUUID().replaceAll('-', '')}`
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'site.operation.accepted' AND NEW.instance_id = ${instance.id} THEN RAISE EXCEPTION 'fixture-replacement-intent-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  const failedReplacement = await syncAddress()
  assert.equal(failedReplacement.proxySitesPending, 1)
  assert.equal((await ref()).revision, 3, 'replacement transaction failure preserves the old generation')
  assert.equal((await prisma.proxySiteOperation.findUniqueOrThrow({ where: { id: oldAddressRequest } })).state, 'retry')
  await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON logs`)
  await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
  trigger = undefined
  failPost = false
  const replacement = await syncAddress()
  assert.equal(replacement.proxySitesPending, 0)
  assert.equal(replacement.proxySitesUpdated, 1)
  assert.equal((await ref()).revision, 4)
  assert.equal((await ref()).targetPort, 9093, 'new address keeps the unconfirmed authorized port target')
  assert.equal((await ref()).remark, 'keep intended change')
  assert.equal(remoteSite()[0].handle[0].upstreams[0].dial, '10.7.0.3:9093')
  assert.equal((await prisma.proxySiteOperation.findUniqueOrThrow({ where: { id: oldAddressRequest } })).state, 'superseded')
  const beforeLate = remoteCalls.length
  assert.equal((await applyProxySiteOperation(oldAddressRequest)).state, 'superseded')
  assert.equal(remoteCalls.length, beforeLate, 'superseded attempt cannot send a late remote write')
  console.log('PASS IPv4 supersede: same identity, intended fields retained, replacement fault rolls back, old receipt retained and late execution stopped')
  const deleteId = randomUUID()
  failPost = true
  const refusedDelete = await app.inject({ method: 'DELETE', url: base, payload: { requestId: deleteId, expectedRevision: 4 } })
  assert.equal(refusedDelete.statusCode, 502, refusedDelete.body)
  assert.equal((await ref()).revision, 5)
  assert.equal(await pendingCount(), 1)
  await prisma.$transaction(tx => assert.rejects(assertNoPendingProxySiteOperations(tx, instance.id), /未完成/))
  failPost = false
  const deleted = await app.inject({ method: 'POST', url: `${base}/retry`, payload: { requestId: deleteId, expectedRevision: 5 } })
  assert.equal(deleted.statusCode, 200, deleted.body)
  assert.equal(await prisma.proxySite.findUnique({ where: { id: site.id } }), null)
  assert.equal(remoteSite().length, 1)
  assert.equal(remoteSite()[0]['@id'], `site-v3-${site.siteKey}-5-deleted`)
  const late = await app.inject({ method: 'POST', url: `${base}/retry`, payload: { requestId: secondId, expectedRevision: 2 } })
  assert.equal(late.statusCode, 404, late.body)
  assert.equal(await pendingCount(), 0)
  for (const scenario of ['etag_retry', 'fresh_applying', 'stale_applying', 'changed_host', 'revoked_actor', 'supersede_applying', 'process_killed'] as const) {
    const candidate = await prisma.proxySite.create({ data: { instanceId: instance.id, hostId: host.id,
      domain: `${scenario.replaceAll('_', '-')}.fixture.example`, targetPort: 8080, httpsEnabled: false, enabled: true } })
    const operation = await prepareProxySiteOperation(instance.id, candidate.id, actor,
      { requestId: randomUUID(), expectedRevision: 0, action: 'upsert', changes: { targetPort: 8888, remark: scenario } })
    if (scenario === 'etag_retry') {
      let conflicts = 0
      beforePost = async () => { if (conflicts++ < 2) revision++ }
      assert.equal((await applyProxySiteOperation(operation.id)).state, 'succeeded')
      assert.equal(conflicts, 3)
      beforePost = undefined
    } else if (scenario === 'fresh_applying' || scenario === 'stale_applying') {
      const priorAttempt = randomUUID()
      await prisma.proxySiteOperation.update({ where: { id: operation.id }, data: { state: 'applying', attemptId: priorAttempt,
        startedAt: new Date(Date.now() - (scenario === 'stale_applying' ? 300000 : 0)) } })
      const count = remoteCalls.length
      const result = await applyProxySiteOperation(operation.id)
      if (scenario === 'fresh_applying') {
        assert.equal(result.state, 'applying'); assert.equal(remoteCalls.length, count)
        await prisma.proxySiteOperation.update({ where: { id: operation.id }, data: { startedAt: new Date(0) } })
        assert.equal((await applyProxySiteOperation(operation.id)).state, 'succeeded')
      } else { assert.equal(result.state, 'succeeded'); assert.notEqual(result.attemptId, priorAttempt) }
    } else if (['changed_host', 'revoked_actor', 'supersede_applying'].includes(scenario)) {
      if (scenario === 'changed_host') await prisma.host.update({ where: { id: host.id }, data: { serverFingerprint: 'fixture-changed-pin' } })
      if (scenario === 'revoked_actor') await prisma.tokenInvalidation.create({ data: { userId: actor.id, sessionId: actor.sid, invalidatedAt: actor.iat } })
      if (scenario === 'supersede_applying') await prisma.proxySiteOperation.update({ where: { id: operation.id },
        data: { state: 'applying', attemptId: randomUUID(), startedAt: new Date(0) } })
      const replace = () => prisma.$transaction(async tx => {
        await advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instance.id)
        await tx.$queryRaw`SELECT id FROM instances WHERE id = ${instance.id} FOR UPDATE`
        await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${host.id} FOR SHARE`
        await tx.$queryRaw`SELECT id FROM proxy_sites WHERE id = ${candidate.id} FOR UPDATE`
        const source = await tx.instance.findUniqueOrThrow({ where: { id: instance.id } })
        return supersedeProxySiteIpv4Operation(tx, { instance: source, host: await tx.host.findUniqueOrThrow({ where: { id: host.id } }),
          site: await tx.proxySite.findUniqueOrThrow({ where: { id: candidate.id } }), actor },
        await tx.proxySiteOperation.findUniqueOrThrow({ where: { id: operation.id } }))
      })
      if (scenario === 'supersede_applying') {
        const replaced = await replace()
        assert.equal((await applyProxySiteOperation(replaced.id)).state, 'succeeded')
        const count = remoteCalls.length
        assert.equal((await applyProxySiteOperation(operation.id)).state, 'superseded')
        assert.equal(remoteCalls.length, count)
      } else {
        const count = remoteCalls.length
        await assert.rejects(replace)
        assert.equal(remoteCalls.length, count)
        assert.equal((await prisma.proxySiteOperation.findUniqueOrThrow({ where: { id: operation.id } })).state, 'pending')
        assert.equal((await prisma.proxySite.findUniqueOrThrow({ where: { id: candidate.id } })).revision, 1)
        if (scenario === 'changed_host') await prisma.host.update({ where: { id: host.id }, data: { serverFingerprint: null } })
        else await prisma.tokenInvalidation.deleteMany({ where: { userId: actor.id, sessionId: actor.sid } })
        assert.equal((await applyProxySiteOperation(operation.id)).state, 'succeeded')
      }
    } else {
      let reached!: () => void, release!: () => void
      const ready = new Promise<void>(resolve => { reached = resolve }), paused = new Promise<void>(resolve => { release = resolve })
      afterPost = async () => { reached(); await paused }
      const url = new URL('../src/db/proxy-site-operations.ts', import.meta.url).href
      const script = `const {applyProxySiteOperation}=await import(${JSON.stringify(url)});await applyProxySiteOperation(${JSON.stringify(operation.id)});process.exit(0)`
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''; child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
      const exited = new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('exit', () => resolve()) })
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([ready, exited.then(() => { throw new Error(`proxy child exited before fault: ${output}`) }),
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('proxy child timed out')), 20000) })])
        child.kill('SIGKILL'); await exited
      } finally { if (timer) clearTimeout(timer); child.kill('SIGKILL'); afterPost = undefined; release() }
      assert.equal((await prisma.proxySiteOperation.findUniqueOrThrow({ where: { id: operation.id } })).state, 'applying')
      await prisma.proxySiteOperation.update({ where: { id: operation.id }, data: { startedAt: new Date(0) } })
      const posts = remoteCalls.filter(call => call.startsWith('POST')).length
      assert.equal((await applyProxySiteOperation(operation.id)).state, 'succeeded')
      assert.equal(remoteCalls.filter(call => call.startsWith('POST')).length, posts, 'restart consumes the remote generation receipt without another write')
    }
    console.log(`PASS durable proxy ${scenario}`)
  }
  console.log('PASS real PG/Fastify/TLS Caddy fixture: explicit revisions, pending receipts, dedupe, retry, remote success/SQL rollback recovery, lifecycle gate, delete tombstone and no late reactivation')
} finally {
  if (trigger) {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON logs`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`)
  }
  await app.close()
  await prisma.proxySiteOperation.deleteMany({ where: { instanceId: instance.id } })
  await prisma.log.deleteMany({ where: { instanceId: instance.id } })
  await prisma.proxySite.deleteMany({ where: { instanceId: instance.id } })
  await prisma.instance.delete({ where: { id: instance.id } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } })
  await closeCaddyClients()
  await closePrismaDatabase()
  await new Promise<void>(resolve => remote.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
  if (originalCa === undefined) delete process.env.CADDY_CA_PATH
  else process.env.CADDY_CA_PATH = originalCa
}
process.exit(0)
