import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { readFileSync } from 'node:fs'
import type { InstanceTaskType } from '@prisma/client'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { prepareInstanceTaskSiteCleanup: cleanup } = await import('../src/services/instance-task-site-cleanup.js')
const { applyProxySiteOperation } = await import('../src/db/proxy-site-operations.js')
const { createCaddyClient, closeCaddyClients } = await import('../src/lib/caddy-client.js')
const { assertNoPendingProxySiteOperations } = await import('../src/db/proxy-site-operation-guards.js')
const { default: siteRoutes } = await import('../src/routes/proxy-sites.js')
const root = await mkdtemp(join(tmpdir(), 'instance-task-sites-'))
const ca = join(root, 'cert.pem'), key = join(root, 'key.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=caddy-admin', '-addext', 'subjectAltName=DNS:caddy-admin', '-keyout', key, '-out', ca], { stdio: 'pipe', windowsHide: true })
const originalCa = process.env.CADDY_CA_PATH
process.env.CADDY_CA_PATH = ca
let config: any = { apps: { http: { servers: { unmanaged: { listen: [':8081'], routes: [{ '@id': 'unmanaged', match: [{ host: ['untouched.example'] }] }] } } } } }
let revision = 0, failPost = false, posts = 0
const remote = createServer({ cert: await readFile(ca), key: await readFile(key) }, async (request, response) => {
  const reply = (status: number, body: unknown) => { response.writeHead(status, { 'content-type': 'application/json', etag: `"/config/ ${revision}"` }); response.end(JSON.stringify(body)) }
  try {
    assert.equal(request.headers.authorization, `Basic ${Buffer.from('fixture:fixture-password').toString('base64')}`)
    if (request.method === 'GET' && request.url === '/config/') return reply(200, config)
    if (request.method === 'POST' && request.url === '/config/apps/http') {
      posts++
      if (failPost) return reply(500, { error: 'controlled Caddy write failure' })
      if (request.headers['if-match'] !== `"/config/ ${revision}"`) return reply(412, {})
      let body = ''; for await (const chunk of request) body += chunk
      config.apps.http = JSON.parse(body); revision++; return reply(200, {})
    }
    reply(404, {})
  } catch (error) { reply(500, { error: String(error) }) }
})
await new Promise<void>(resolve => remote.listen(0, '127.0.0.1', resolve))
const tag = `task-sites-${randomUUID()}`
const owner = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
const other = await prisma.user.create({ data: { username: tag + '-other', passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: owner.id, name: tag, url: 'https://127.0.0.1:1', ipAddress: '127.0.0.1',
  caddyEnabled: true, caddyUsername: 'fixture', caddyPassword: 'fixture-password', caddyPort: (remote.address() as { port: number }).port } })
const instance = await prisma.instance.create({ data: { userId: owner.id, hostId: host.id, name: tag, incusId: tag,
  image: 'fixture/debian', cpu: 100, memory: 512, disk: 2048, status: 'running', ipv4: '10.7.0.2', dedicatedIpv4: true, dedicatedNetworkReady: true } })
const expected = { id: instance.id, user_id: owner.id, host_id: host.id, incus_id: tag }
const actor = { id: owner.id, username: owner.username, role: 'user', sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = { ...actor } })
app.decorate('authenticateUser', app.authenticate)
const client = createCaddyClient({ host: '127.0.0.1', port: host.caddyPort, username: 'fixture', password: 'fixture-password', caPath: ca })
let siteNumber = 0
const makeSite = async () => {
  const domain = `task-${++siteNumber}.fixture.example`
  await client.addSite(domain, instance.ipv4!, 8080, false)
  return prisma.proxySite.create({ data: { hostId: host.id, instanceId: instance.id, domain, targetPort: 8080, status: 'active', enabled: true, httpsEnabled: false } })
}
const task = (taskType: InstanceTaskType) => prisma.instanceTask.create({ data: { instanceId: instance.id, hostId: host.id, userId: owner.id,
  taskType, status: 'PROCESSING', startedAt: new Date() } })
const remoteHas = (domain: string) => Object.values(config.apps.http.servers).some((server: any) => (server.routes || []).some((route: any) =>
  route.match?.some((match: any) => match.host?.includes(domain) && !match.not?.some((exclude: any) => exclude.host?.includes(domain)))))
const current = () => prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
let failure: unknown
try {
  await app.register(siteRoutes)
  for (const type of ['recreate', 'change_host'] as InstanceTaskType[]) {
    const site = await makeSite(), claim = await task(type)
    const before = await current(), postCount = posts
    await prisma.host.update({ where: { id: host.id }, data: { caddyEnabled: false } })
    await assert.rejects(cleanup(claim.id, expected), /Caddy/)
    assert.equal(posts, postCount); assert.ok(remoteHas(site.domain)); assert.ok(await prisma.proxySite.findUnique({ where: { id: site.id } }))
    assert.deepEqual(await current(), before, 'missing Caddy configuration cannot change original instance or dedicated delivery')
    assert.equal(await prisma.proxySiteOperation.count({ where: { instanceId: instance.id } }), 0)
    await prisma.host.update({ where: { id: host.id }, data: { caddyEnabled: true } })
    failPost = true; await assert.rejects(cleanup(claim.id, expected), /尚未清理/)
    assert.ok(remoteHas(site.domain)); assert.deepEqual(await current(), before)
    const operation = await prisma.proxySiteOperation.findFirstOrThrow({ where: { instanceId: instance.id, siteId: site.id } })
    assert.equal(operation.state, 'retry'); assert.equal(operation.authority, 'lifecycle')
    assert.deepEqual(operation.lifecycleClaim, { kind: 'instance_task', id: claim.id })
    await assert.rejects(prisma.$transaction(tx => assertNoPendingProxySiteOperations(tx, instance.id)), /未完成/)
    await prisma.instanceTask.update({ where: { id: claim.id }, data: { status: 'FAILED', finishedAt: new Date() } })
    failPost = false
    await prisma.proxySiteOperation.update({ where: { id: operation.id }, data: { nextRetryAt: new Date(0) } })
    if (type === 'change_host') {
      await prisma.proxySiteOperation.update({ where: { id: operation.id }, data: { state: 'blocked' } })
      actor.id = other.id
      const forbidden = await app.inject({ method: 'POST', url: `/instances/${instance.id}/sites/${site.id}/retry`,
        payload: { requestId: operation.id, expectedRevision: operation.revision } })
      assert.equal(forbidden.statusCode, 403)
      actor.id = owner.id
      const resumed = await app.inject({ method: 'POST', url: `/instances/${instance.id}/sites/${site.id}/retry`,
        payload: { requestId: operation.id, expectedRevision: operation.revision } })
      assert.equal(resumed.statusCode, 200, resumed.body)
    }
    const completed = await applyProxySiteOperation(operation.id)
    assert.equal(completed.state, 'succeeded', completed.error || '')
    assert.equal(completed.authority, 'lifecycle', 'manual retry must preserve the original lifecycle claim')
    assert.equal(remoteHas(site.domain), false); assert.equal(await prisma.proxySite.findUnique({ where: { id: site.id } }), null)
    assert.deepEqual(await current(), before, 'finishing old deletion intent does not change instance identity or resources')
    const repeat = posts; await applyProxySiteOperation(operation.id); assert.equal(posts, repeat, 'success receipt prevents repeated remote delete')
    assert.ok(config.apps.http.servers.unmanaged.routes.length === 1)
    await prisma.instanceTask.delete({ where: { id: claim.id } })
    await prisma.proxySiteOperation.deleteMany({ where: { instanceId: instance.id } })
    const valid = await task(type); await cleanup(valid.id, expected)
    assert.equal((await prisma.instanceTask.findUniqueOrThrow({ where: { id: valid.id } })).progress, 'proxy_sites_cleared')
    const newSite = await makeSite(), previousPosts = posts
    await assert.rejects(cleanup(valid.id, expected), /NEW_SITES/)
    assert.equal(posts, previousPosts); assert.ok(remoteHas(newSite.domain), 'cleared task must never expand its original deletion list')
    await prisma.proxySite.delete({ where: { id: newSite.id } })
    await prisma.instanceTask.delete({ where: { id: valid.id } })
    const normalSite = await makeSite(), normalClaim = await task(type), normalInstance = await current()
    await cleanup(normalClaim.id, expected)
    assert.equal(remoteHas(normalSite.domain), false)
    assert.equal(await prisma.proxySite.findUnique({ where: { id: normalSite.id } }), null)
    assert.deepEqual(await current(), normalInstance)
    assert.equal((await prisma.instanceTask.findUniqueOrThrow({ where: { id: normalClaim.id } })).progress, 'proxy_sites_cleared')
    const normalPosts = posts; await cleanup(normalClaim.id, expected); assert.equal(posts, normalPosts)
    await prisma.instanceTask.delete({ where: { id: normalClaim.id } })
    await prisma.proxySiteOperation.deleteMany({ where: { instanceId: instance.id } })
    console.log('PASS ' + type + ' missing Caddy/remote failure retains source, failed-task durable retry confirms deletion and normal empty retry remains')
  }
  for (const mode of ['owner', 'incus', 'host-credentials', 'task', 'new-site']) {
    const site = await makeSite(), claim = await task('recreate')
    failPost = true; await assert.rejects(cleanup(claim.id, expected)); failPost = false
    const operation = await prisma.proxySiteOperation.findFirstOrThrow({ where: { siteId: site.id } })
    await prisma.instanceTask.update({ where: { id: claim.id }, data: { status: 'FAILED' } })
    if (mode === 'owner') await prisma.instance.update({ where: { id: instance.id }, data: { userId: other.id } })
    if (mode === 'incus') await prisma.instance.update({ where: { id: instance.id }, data: { incusId: tag + '-changed' } })
    if (mode === 'host-credentials') await prisma.host.update({ where: { id: host.id }, data: { caddyPassword: 'changed-fixture' } })
    if (mode === 'task') await prisma.instanceTask.update({ where: { id: claim.id }, data: { progress: 'deleting_old' } })
    if (mode === 'new-site') await prisma.proxySite.update({ where: { id: site.id }, data: { revision: { increment: 1 } } })
    await prisma.proxySiteOperation.update({ where: { id: operation.id }, data: { nextRetryAt: new Date(0) } })
    const before = posts, refused = await applyProxySiteOperation(operation.id)
    assert.equal(refused.state, 'blocked'); assert.equal(posts, before); assert.ok(remoteHas(site.domain))
    await prisma.instance.update({ where: { id: instance.id }, data: { userId: owner.id, incusId: tag } })
    await prisma.host.update({ where: { id: host.id }, data: { caddyPassword: 'fixture-password' } })
    await prisma.proxySiteOperation.deleteMany({ where: { siteId: site.id } }); await prisma.proxySite.delete({ where: { id: site.id } })
    await prisma.instanceTask.delete({ where: { id: claim.id } })
  }
  console.log('PASS failed-task deletion intent rejects changed owner/Incus identity/host credentials/task phase/site revision with zero remote POST')
  const worker = readFileSync(new URL('../src/workers/instanceTaskWorker.ts', import.meta.url), 'utf8')
  const recreate = worker.slice(worker.indexOf('async function executeRecreateTask('), worker.indexOf('async function executeChangeHostTask('))
  assert.ok(recreate.indexOf('await prepareInstanceTaskSiteCleanup(task.id, instance)') < recreate.indexOf('await stopInstance('))
  console.log('PASS actual recreate worker calls source cleanup before original stop/delete and preserves dedicated delivery on preflight failure')
} catch (error) { failure = error }
finally {
  await app.close()
  await closeCaddyClients(); await new Promise<void>(resolve => remote.close(() => resolve()))
  await prisma.proxySiteOperation.deleteMany({ where: { instanceId: instance.id } }); await prisma.log.deleteMany({ where: { userId: { in: [owner.id, other.id] } } })
  await prisma.instance.delete({ where: { id: instance.id } }); await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } }); await closePrismaDatabase()
  if (originalCa === undefined) delete process.env.CADDY_CA_PATH; else process.env.CADDY_CA_PATH = originalCa
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); await rm(root, { recursive: true, force: true })
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
