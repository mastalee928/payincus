import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:https'
import dns from 'node:dns'
import { syncBuiltinESMExports } from 'node:module'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use isolated local *_pool_test database')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { prepareHostCaddyCredentials, confirmHostCaddyCredentials } = await import('../src/db/host-caddy-credentials.js')
const { default: hostRoutes } = await import('../src/routes/hosts.js')
const { createCaddyClient, closeCaddyClients } = await import('../src/lib/caddy-client.js')
const originalResolve4 = dns.resolve4, originalResolve6 = dns.resolve6
dns.resolve4 = ((_: string, callback: (error: Error | null, addresses: string[]) => void) => callback(null, ['127.0.0.1'])) as typeof dns.resolve4
dns.resolve6 = ((_: string, callback: (error: Error | null, addresses: string[]) => void) => callback(null, [])) as typeof dns.resolve6
syncBuiltinESMExports()
const { default: proxyRoutes } = await import('../src/routes/proxy-sites.js')
const { withProxySiteMutation } = await import('../src/db/proxy-site-mutations.js')
const { advisoryTransactionLock, INSTANCE_OPERATION_LOCK_NAMESPACE } = await import('../src/db/advisory-locks.js')
const { verifyCaddyScriptToken } = await import('../src/lib/caddy-script-token.js')
const tag = randomUUID()
const owner = await prisma.user.create({ data: { username: `caddy-${tag}`, passwordHash: 'unusable-fixture' } })
const other = await prisma.user.create({ data: { username: `caddy-other-${tag}`, passwordHash: 'unusable-fixture' } })
const admin = await prisma.user.create({ data: { username: `caddy-admin-${tag}`, passwordHash: 'unusable-fixture', role: 'admin' } })
const host = await prisma.host.create({ data: { userId: owner.id, name: tag, url: 'https://127.0.0.1:1' } })
const actor = { id: owner.id, username: owner.username, role: 'user', sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
let currentActor = actor
let afterAuthentication: (() => Promise<unknown>) | undefined
const app = Fastify({ routerOptions: { maxParamLength: 500 } })
for (const name of ['authenticate', 'authenticateAdmin', 'authenticateUser']) app.decorate(name, async (request: any) => { request.user = { ...currentActor }; await afterAuthentication?.() })
const tlsRoot = await mkdtemp(join(tmpdir(), 'payincus-review-caddy-'))
const caPath = join(tlsRoot, 'server.crt'), keyPath = join(tlsRoot, 'server.key')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=caddy-admin',
  '-addext', 'subjectAltName=DNS:caddy-admin', '-keyout', keyPath, '-out', caPath], { stdio: 'pipe', windowsHide: true })
let config: any = { admin: { disabled: false }, apps: { http: { servers: { unmanaged: { listen: [':8081'], routes: [{ '@id': 'unmanaged', match: [{ host: ['preserved.example'] }] }] } } } } }
let revision = 0, conflicts = 0, rejectNext = false, deleteError = false
let beforeRead: (() => Promise<unknown>) | undefined
let beforeWrite: (() => Promise<unknown>) | undefined
const calls: Array<{ method: string; path: string; ifMatch?: string }> = []
const allRoutes = () => Object.values(config.apps?.http?.servers || {}).flatMap((server: any) => server.routes || []) as any[]
const server = createServer({ cert: await readFile(caPath), key: await readFile(keyPath) }, async (request, response) => {
  try {
    assert.equal(request.headers.authorization, 'Basic ' + Buffer.from('fixture:fixture-password').toString('base64'))
    const path = request.url!, method = request.method!
    calls.push({ method, path, ifMatch: request.headers['if-match'] as string | undefined })
    const send = (status: number, body: unknown) => { response.writeHead(status, { 'content-type': 'application/json', etag: `"/config/ ${revision}"` }); response.end(JSON.stringify(body)) }
    if (method === 'GET' && path === '/config/') { await beforeRead?.(); send(200, config); return }
    if (path.startsWith('/id/')) {
      const id = path.slice(4), route = allRoutes().find(row => row['@id'] === id)
      if (method === 'GET') { send(route ? 200 : 404, route || {}); return }
      if (deleteError) { send(500, { error: 'fixture downstream 404 token, actual server failure' }); return }
      if (!route) { send(404, {}); return }
      if (id.startsWith('site-') && !id.startsWith('site-v2-')) assert.ok(request.headers['if-match'])
      for (const value of Object.values(config.apps.http.servers) as any[]) value.routes = (value.routes || []).filter((row: any) => row !== route)
      revision++; send(200, {}); return
    }
    if (method === 'POST' && path === '/config/apps/http') {
      await beforeWrite?.()
      if (conflicts > 0) { conflicts--; revision++; send(412, {}); return }
      if (request.headers['if-match'] !== `"/config/ ${revision}"`) { send(412, {}); return }
      const chunks = []; for await (const chunk of request) chunks.push(chunk)
      const next = JSON.parse(Buffer.concat(chunks).toString())
      if (rejectNext) { rejectNext = false; send(400, { error: 'fixture invalid config' }); return }
      config.apps.http = next; revision++; send(200, {}); return
    }
    send(404, {})
  } catch (error) { response.writeHead(500); response.end(String(error)) }
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as { port: number }).port
const client = createCaddyClient({ host: '127.0.0.1', port, username: 'fixture', password: 'fixture-password', caPath })
const savedCa = process.env.CADDY_CA_PATH
const savedJwt = process.env.JWT_SECRET
process.env.CADDY_CA_PATH = caPath
process.env.JWT_SECRET = 'isolated-caddy-script-fixture-secret-long-enough'
try {
  await app.register(hostRoutes, { prefix: '/hosts' })
  await app.register(proxyRoutes)
  const first = await prepareHostCaddyCredentials(host.id, actor)
  const parallel = await Promise.all(Array.from({ length: 6 }, () => prepareHostCaddyCredentials(host.id, actor)))
  assert.ok(parallel.every(row => row.password === first.password && !row.isNewCredentials), 'concurrent generation reuses committed current credentials')
  const command = await app.inject({ method: 'POST', url: `/hosts/${host.id}/caddy/generate` })
  assert.equal(command.statusCode, 200, command.body)
  const commandToken = command.json().installCommand.match(/\/caddy-script\/([^"\s]+)/)![1]
  assert.ok(commandToken.length <= 500, 'command fits the real production router parameter limit')
  assert.ok(verifyCaddyScriptToken(commandToken))
  const download = () => app.inject({ method: 'GET', url: `/hosts/caddy-script/${commandToken}` })
  assert.equal((await download()).statusCode, 200)
  assert.equal((await app.inject({ method: 'GET', url: `/hosts/caddy-script/${commandToken}x` })).statusCode, 403)
  await prisma.tokenInvalidation.create({ data: { userId: owner.id, sessionId: actor.sid, invalidatedAt: actor.iat } })
  assert.equal((await download()).statusCode, 403, 'download rejects the revoked issuing session')
  await prisma.tokenInvalidation.deleteMany({ where: { userId: owner.id } })
  await prisma.host.update({ where: { id: host.id }, data: { userId: other.id } })
  assert.equal((await download()).statusCode, 403, 'old command cannot disclose transferred host credentials')
  await prisma.host.update({ where: { id: host.id }, data: { userId: owner.id } })
  await prepareHostCaddyCredentials(host.id, actor, true)
  assert.equal((await download()).statusCode, 403, 'old command cannot disclose rotated credentials')
  await prisma.host.update({ where: { id: host.id }, data: { caddyUsername: first.username, caddyPassword: first.password } })
  for (const action of ['generate', 'reset']) {
    afterAuthentication = () => prisma.user.update({ where: { id: owner.id }, data: { status: 'banned' } })
    const response = await app.inject({ method: 'POST', url: `/hosts/${host.id}/caddy/${action}` })
    assert.equal(response.statusCode, 403, response.body)
    assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).caddyPassword, first.password)
  }
  afterAuthentication = undefined
  await prisma.user.update({ where: { id: owner.id }, data: { status: 'active' } })
  await prisma.host.update({ where: { id: host.id }, data: { userId: other.id } })
  await assert.rejects(prepareHostCaddyCredentials(host.id, actor), /CADDY_ACTOR_FORBIDDEN/)
  await prisma.host.update({ where: { id: host.id }, data: { userId: owner.id } })
  currentActor = { ...actor, id: admin.id, username: admin.username, role: 'admin' }
  afterAuthentication = () => prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
  assert.equal((await app.inject({ method: 'POST', url: `/hosts/${host.id}/caddy/generate` })).statusCode, 403)
  afterAuthentication = undefined
  currentActor = actor
  const expected = { id: host.id, userId: owner.id, username: first.username, password: first.password, port: first.port, ipAddress: null, natPublicIp: null }
  await prepareHostCaddyCredentials(host.id, actor, true)
  await assert.rejects(confirmHostCaddyCredentials(expected, actor), /CADDY_CONFIG_CHANGED/)
  await prisma.host.update({ where: { id: host.id }, data: { caddyUsername: 'fixture', caddyPassword: 'fixture-password', caddyPort: port, ipAddress: '127.0.0.1', caddyEnabled: false } })
  beforeRead = () => prisma.host.update({ where: { id: host.id }, data: { caddyPassword: 'new-fixture-password' } })
  const staleConfirm = await app.inject({ method: 'POST', url: `/hosts/${host.id}/caddy/confirm` })
  assert.equal(staleConfirm.statusCode, 409, staleConfirm.body)
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).caddyEnabled, false)
  beforeRead = undefined
  await prisma.host.update({ where: { id: host.id }, data: { caddyPassword: 'fixture-password' } })
  assert.equal((await app.inject({ method: 'POST', url: `/hosts/${host.id}/caddy/confirm` })).statusCode, 200)

  // Different domain label boundaries must have different managed route IDs.
  const d1 = 'a.b-c.example', d2 = 'a-b.c.example'
  await client.addSite(d1, '10.0.0.1', 80, false)
  await client.addSite(d2, '2001:db8::1', 8080, true)
  let sites = allRoutes().filter(route => route['@id']?.startsWith('site-v2-'))
  assert.equal(sites.length, 2)
  assert.notEqual(sites[0]['@id'], sites[1]['@id'])
  assert.deepEqual(config.apps.http.servers.sites.automatic_https.skip, [d1])
  assert.equal(sites[1].handle[0].upstreams[0].dial, '[2001:db8::1]:8080')
  assert.ok(allRoutes().some(route => route['@id'] === 'unmanaged'))
  const before = structuredClone(config)
  rejectNext = true
  await assert.rejects(client.addSite(d1, '10.0.0.2', 90, true), /400/)
  assert.deepEqual(config, before, 'rejected new route leaves old site and other configuration in place')
  conflicts = 1
  await client.addSite(d1, '10.0.0.2', 90, true)
  assert.deepEqual(config.apps.http.servers.sites.automatic_https.skip, [])
  assert.equal(allRoutes().filter(route => route.match?.[0]?.host?.[0] === d1).length, 1)
  const legacyId = `site-${d1.replaceAll('.', '-')}`
  config.apps.http.servers.sites.routes.push({ '@id': legacyId, match: [{ host: [d2] }] }); revision++
  await client.deleteSite(d1)
  assert.ok(allRoutes().some(route => route['@id'] === legacyId), 'legacy collision belonging to other domain stays')
  deleteError = true
  await assert.rejects(client.deleteSite(d2), /500/, 'body text containing 404 cannot hide status 500')
  deleteError = false
  await client.deleteSite(d2)
  assert.ok(!allRoutes().some(route => route['@id'] === legacyId), 'matching legacy route removed with ETag')
  assert.ok(calls.filter(call => call.method === 'POST').every(call => call.ifMatch))

  // Actual user mutation routes: current authorization, quota and workflow boundaries.
  const instance = await prisma.instance.create({ data: { userId: owner.id, hostId: host.id,
    name: tag, incusId: tag, image: 'fixture/debian', cpu: 100, memory: 1024, disk: 2048,
    status: 'running', ipv4: '10.0.0.7', siteLimit: 2 } })
  const url = `/instances/${instance.id}/sites`
  const create = (domain: string) => app.inject({ method: 'POST', url, payload: { domain, targetPort: 8080, httpsEnabled: false } })
  const existing = await create('first.proxy.example')
  assert.equal(existing.statusCode, 200, existing.body)
  const siteId = existing.json().site.id
  const siteUrl = `${url}/${siteId}`
  for (const route of [
    { method: 'POST' as const, url, payload: { domain: 'denied.proxy.example', targetPort: 80 } },
    { method: 'DELETE' as const, url: siteUrl },
    { method: 'PATCH' as const, url: siteUrl, payload: { remark: 'denied' } },
    { method: 'POST' as const, url: `${siteUrl}/refresh` },
    { method: 'POST' as const, url: `${siteUrl}/toggle` },
    { method: 'POST' as const, url: `${siteUrl}/check-dns` }
  ]) {
    afterAuthentication = () => prisma.user.update({ where: { id: owner.id }, data: { status: 'banned' } })
    const count = calls.length
    const denied = await app.inject(route)
    assert.equal(denied.statusCode, 403, denied.body)
    assert.equal(calls.length, count, 'banned in-flight requests make no remote writes')
    afterAuthentication = undefined
    await prisma.user.update({ where: { id: owner.id }, data: { status: 'active' } })
  }
  afterAuthentication = () => prisma.tokenInvalidation.upsert({ where: { userId_sessionId: { userId: owner.id, sessionId: actor.sid } },
    create: { userId: owner.id, sessionId: actor.sid, invalidatedAt: actor.iat }, update: { invalidatedAt: actor.iat } })
  assert.equal((await create('logout.proxy.example')).statusCode, 403)
  afterAuthentication = undefined
  await prisma.tokenInvalidation.deleteMany({ where: { userId: owner.id } })
  afterAuthentication = () => prisma.user.update({ where: { id: owner.id }, data: { role: 'admin' } })
  assert.equal((await create('promoted.proxy.example')).statusCode, 403)
  afterAuthentication = undefined
  await prisma.user.update({ where: { id: owner.id }, data: { role: 'user' } })
  afterAuthentication = () => prisma.instance.update({ where: { id: instance.id }, data: { userId: other.id } })
  assert.equal((await app.inject({ method: 'PATCH', url: siteUrl, payload: { remark: 'old-owner' } })).statusCode, 403)
  afterAuthentication = undefined
  await prisma.instance.update({ where: { id: instance.id }, data: { userId: owner.id } })
  for (const data of [ { status: 'creating' as const }, { status: 'error' as const }, { status: 'deleted' as const },
    { status: 'suspended' as const }, { expiresAt: new Date(Date.now() - 1000) }, { provisioningCleanupPending: true }, { deletionBillingPending: true } ]) {
    await prisma.instance.update({ where: { id: instance.id }, data })
    assert.equal((await create('not-ready.proxy.example')).statusCode, 403)
    await prisma.instance.update({ where: { id: instance.id }, data: { status: 'running', expiresAt: null, provisioningCleanupPending: false, deletionBillingPending: false } })
  }
  const quotaResults = await Promise.all(Array.from({ length: 6 }, (_, i) => create(`quota-${i}.proxy.example`)))
  assert.equal(quotaResults.filter(r => r.statusCode === 200).length, 1)
  assert.equal(await prisma.proxySite.count({ where: { instanceId: instance.id } }), 2)
  const busyTask = await prisma.instanceTask.create({ data: { userId: owner.id, hostId: host.id, instanceId: instance.id, taskType: 'start', status: 'PENDING' } })
  assert.equal((await app.inject({ method: 'PATCH', url: siteUrl, payload: { remark: 'busy' } })).statusCode, 409)
  await prisma.instanceTask.delete({ where: { id: busyTask.id } })

  // Once remote apply starts, transfer cannot pass its shared lock until commit.
  let entered!: () => void, finish!: () => void
  const writeEntered = new Promise<void>(resolve => { entered = resolve })
  const releaseWrite = new Promise<void>(resolve => { finish = resolve })
  beforeWrite = async () => { entered(); await releaseWrite }
  const refresh = app.inject({ method: 'POST', url: `${siteUrl}/refresh` })
  await writeEntered
  let transferFinished = false
  const transfer = prisma.$transaction(async tx => {
    await advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instance.id)
    await tx.instance.update({ where: { id: instance.id }, data: { userId: other.id } })
    transferFinished = true
  })
  await new Promise(resolve => setTimeout(resolve, 80))
  assert.equal(transferFinished, false, 'transfer waits for the authorized remote mutation')
  assert.equal((await app.inject({ method: 'POST', url: `${siteUrl}/toggle` })).statusCode, 409)
  finish()
  assert.equal((await refresh).statusCode, 200)
  await transfer
  beforeWrite = undefined
  assert.equal((await app.inject({ method: 'POST', url: `${siteUrl}/refresh` })).statusCode, 403)
  await prisma.instance.update({ where: { id: instance.id }, data: { userId: owner.id } })

  const originalSite = await prisma.proxySite.findUniqueOrThrow({ where: { id: siteId } })
  const originalConfig = structuredClone(config)
  rejectNext = true
  const rejectedEdit = await app.inject({ method: 'PATCH', url: siteUrl, payload: { targetPort: 9000 } })
  assert.equal(rejectedEdit.statusCode, 502, rejectedEdit.body)
  const preserved = await prisma.proxySite.findUniqueOrThrow({ where: { id: siteId } })
  assert.equal(preserved.targetPort, originalSite.targetPort)
  assert.equal(preserved.status, 'active')
  assert.ok(preserved.error?.includes('400'))
  assert.deepEqual(config, originalConfig, 'rejected edit keeps the old working site')
  deleteError = true
  const refusedDelete = await app.inject({ method: 'DELETE', url: siteUrl })
  assert.equal(refusedDelete.statusCode, 502, refusedDelete.body)
  assert.ok((await prisma.proxySite.findUniqueOrThrow({ where: { id: siteId } })).error?.includes('记录已保留'))
  deleteError = false
  await prisma.host.update({ where: { id: host.id }, data: { caddyEnabled: false } })
  assert.equal((await app.inject({ method: 'DELETE', url: siteUrl })).statusCode, 502, 'missing Caddy config preserves cleanup record')
  await prisma.host.update({ where: { id: host.id }, data: { caddyEnabled: true } })
  assert.equal((await app.inject({ method: 'DELETE', url: siteUrl })).statusCode, 200)
  assert.equal(await prisma.proxySite.findUnique({ where: { id: siteId } }), null)
  const remarkSite = await prisma.proxySite.findFirstOrThrow({ where: { instanceId: instance.id } })
  await prisma.proxySite.update({ where: { id: remarkSite.id }, data: { enabled: false, status: 'pending' } })
  const beforeDns = calls.length
  const disabledDns = await app.inject({ method: 'POST', url: `${url}/${remarkSite.id}/check-dns` })
  assert.equal(disabledDns.statusCode, 200, disabledDns.body)
  assert.equal(disabledDns.json().ipMatches, true)
  assert.equal(disabledDns.json().activated, undefined)
  assert.equal(calls.length, beforeDns, 'DNS match does not enable a disabled pending site')
  assert.equal((await prisma.proxySite.findUniqueOrThrow({ where: { id: remarkSite.id } })).enabled, false)
  await prisma.proxySite.update({ where: { id: remarkSite.id }, data: { enabled: true } })
  const edits = await Promise.all([app.inject({ method: 'PATCH', url: `${url}/${remarkSite.id}`, payload: { remark: 'concurrent' } }),
    app.inject({ method: 'PATCH', url: `${url}/${remarkSite.id}`, payload: { targetPort: 9090 } })])
  assert.ok(edits.some(r => r.statusCode === 200))
  // The rejected concurrent request can retry; merge fields from the current row.
  if (edits[0].statusCode !== 200) assert.equal((await app.inject({ method: 'PATCH', url: `${url}/${remarkSite.id}`, payload: { remark: 'concurrent' } })).statusCode, 200)
  if (edits[1].statusCode !== 200) assert.equal((await app.inject({ method: 'PATCH', url: `${url}/${remarkSite.id}`, payload: { targetPort: 9090 } })).statusCode, 200)
  const merged = await prisma.proxySite.findUniqueOrThrow({ where: { id: remarkSite.id } })
  assert.equal(merged.targetPort, 9090); assert.equal(merged.remark, 'concurrent')
  await assert.rejects(withProxySiteMutation(instance.id, remarkSite.id, { ...actor, id: other.id }, async () => {}), /无权/)

  // Confirmed remote repair consumes the intent; local edits and failures do not.
  const repairUrl = `${url}/${remarkSite.id}`
  const readRepair = () => prisma.proxySite.findUniqueOrThrow({ where: { id: remarkSite.id } })
  const markPending = () => prisma.proxySite.update({ where: { id: remarkSite.id }, data: { ipv4SyncPending: true, error: 'fixture IPv4 sync pending' } })
  await prisma.instance.update({ where: { id: instance.id }, data: { ipv4: '10.42.0.88' } })
  await markPending()
  const beforeRemark = calls.length
  assert.equal((await app.inject({ method: 'PATCH', url: repairUrl, payload: { remark: 'local-only' } })).statusCode, 200)
  assert.equal((await readRepair()).ipv4SyncPending, true)
  assert.equal((await readRepair()).error, 'fixture IPv4 sync pending')
  assert.equal(calls.length, beforeRemark, 'remark-only edits have no remote write to confirm')
  assert.equal((await app.inject({ method: 'PATCH', url: repairUrl, payload: { remark: 'local-only' } })).statusCode, 200)
  assert.equal((await readRepair()).ipv4SyncPending, true, 'no-op edits also keep intent')
  assert.equal((await app.inject({ method: 'POST', url: `${repairUrl}/check-dns` })).statusCode, 200)
  assert.equal((await readRepair()).ipv4SyncPending, true, 'DNS success without activation cannot consume intent')
  rejectNext = true
  assert.equal((await app.inject({ method: 'POST', url: `${repairUrl}/refresh` })).statusCode, 502)
  assert.equal((await readRepair()).ipv4SyncPending, true)
  assert.equal((await app.inject({ method: 'POST', url: `${repairUrl}/refresh` })).statusCode, 200)
  assert.equal((await readRepair()).ipv4SyncPending, false)
  assert.equal((await readRepair()).error, null)
  const repairedRoute = () => allRoutes().find(route => route.match?.[0]?.host?.[0] === remarkSite.domain)
  assert.equal(repairedRoute().handle[0].upstreams[0].dial, '10.42.0.88:9090', 'repair uses current locked instance IPv4')

  await markPending()
  rejectNext = true
  assert.equal((await app.inject({ method: 'PATCH', url: repairUrl, payload: { targetPort: 9091 } })).statusCode, 502)
  assert.equal((await readRepair()).ipv4SyncPending, true)
  assert.equal((await readRepair()).targetPort, 9090)
  assert.equal((await app.inject({ method: 'PATCH', url: repairUrl, payload: { targetPort: 9091 } })).statusCode, 200)
  assert.equal((await readRepair()).ipv4SyncPending, false)
  assert.equal(repairedRoute().handle[0].upstreams[0].dial, '10.42.0.88:9091')

  await markPending()
  deleteError = true
  assert.equal((await app.inject({ method: 'POST', url: `${repairUrl}/toggle` })).statusCode, 502)
  assert.equal((await readRepair()).ipv4SyncPending, true)
  assert.equal((await readRepair()).enabled, true)
  deleteError = false
  assert.equal((await app.inject({ method: 'POST', url: `${repairUrl}/toggle` })).statusCode, 200)
  assert.equal((await readRepair()).ipv4SyncPending, false)
  assert.equal(repairedRoute(), undefined, 'disable removes the remote route before clearing intent')
  await markPending()
  rejectNext = true
  assert.equal((await app.inject({ method: 'POST', url: `${repairUrl}/toggle` })).statusCode, 502)
  assert.equal((await readRepair()).ipv4SyncPending, true)
  assert.equal((await readRepair()).enabled, false)
  assert.equal((await app.inject({ method: 'POST', url: `${repairUrl}/toggle` })).statusCode, 200)
  assert.equal((await readRepair()).ipv4SyncPending, false)
  assert.equal(repairedRoute().handle[0].upstreams[0].dial, '10.42.0.88:9091')

  await prisma.proxySite.update({ where: { id: remarkSite.id }, data: { status: 'pending', ipv4SyncPending: true } })
  rejectNext = true
  const rejectedActivation = await app.inject({ method: 'POST', url: `${repairUrl}/check-dns` })
  assert.equal(rejectedActivation.statusCode, 200, rejectedActivation.body)
  assert.equal(rejectedActivation.json().activated, false)
  assert.equal((await readRepair()).ipv4SyncPending, true)
  await prisma.proxySite.update({ where: { id: remarkSite.id }, data: { status: 'pending' } })
  const activated = await app.inject({ method: 'POST', url: `${repairUrl}/check-dns` })
  assert.equal(activated.statusCode, 200, activated.body)
  assert.equal(activated.json().activated, true)
  assert.equal((await readRepair()).ipv4SyncPending, false)
  assert.equal(repairedRoute().handle[0].upstreams[0].dial, '10.42.0.88:9091')
  console.log('PASS IPv4 intent: successful activate/refresh/config-change/enable/confirmed-disable clear pending; remark/no-op/non-activating DNS and every failed remote action preserve it')

  // The same CA path with different contents must create a new TLS trust pool.
  const cached = createCaddyClient({ host: '127.0.0.1', port, username: 'fixture', password: 'fixture-password', caPath })
  assert.equal((cached as any).agent, (client as any).agent)
  const secondCa = join(tlsRoot, 'second.crt')
  execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=other-ca',
    '-keyout', join(tlsRoot, 'second.key'), '-out', secondCa], { stdio: 'pipe', windowsHide: true })
  const originalCa = await readFile(caPath)
  await writeFile(caPath, await readFile(secondCa))
  const replaced = createCaddyClient({ host: '127.0.0.1', port, username: 'fixture', password: 'fixture-password', caPath })
  assert.notEqual((replaced as any).agent, (client as any).agent)
  await assert.rejects(replaced.getConfig(), /certificate|self.signed|verify/i)
  await writeFile(caPath, originalCa)
  for (let i = 0; i < 101; i++) createCaddyClient({ host: `127.0.0.${i + 1}`, port: port + 1, username: 'fixture', password: 'fixture-password', caPath })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.ok((client as any).agent.closed, 'least recently used Agent closes when the pool reaches its bound')
  await prisma.log.deleteMany({ where: { instanceId: instance.id } })
  await prisma.instance.delete({ where: { id: instance.id } })
  console.log('PASS actual proxy routes: current actor/session/ownership/readiness/workflow and quota guards, shared transfer lock, field merge, atomic rejected edit, remote refusal/missing config preserves retriable record; CA-content binding and LRU close verified')
  console.log('PASS real PostgreSQL/Fastify/TLS Caddy: actor/owner/current credentials, concurrent generation, changed-while-probe confirmation refusal, collision-free IDs, exact legacy deletion, true status errors, HTTP-only skip, atomic config failure and bounded ETag retry; Caddy runtime is an HTTPS fixture')
} finally {
  await app.close()
  await closeCaddyClients()
  await new Promise<void>(resolve => server.close(() => resolve()))
  if (savedCa === undefined) delete process.env.CADDY_CA_PATH; else process.env.CADDY_CA_PATH = savedCa
  if (savedJwt === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = savedJwt
  dns.resolve4 = originalResolve4; dns.resolve6 = originalResolve6; syncBuiltinESMExports()
  await prisma.log.deleteMany({ where: { userId: { in: [owner.id, other.id, admin.id] } } })
  await prisma.instanceTask.deleteMany({ where: { hostId: host.id } })
  await prisma.instance.deleteMany({ where: { hostId: host.id } })
  await prisma.tokenInvalidation.deleteMany({ where: { userId: { in: [owner.id, other.id, admin.id] } } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, other.id, admin.id] } } })
  await closePrismaDatabase()
  await rm(tlsRoot, { recursive: true, force: true })
}
process.exit(0)
