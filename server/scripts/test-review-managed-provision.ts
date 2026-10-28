import assert from 'node:assert/strict'
import { randomUUID, X509Certificate } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use isolated local *_pool_test PostgreSQL')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { provisionManagedInstanceAsync } = await import('../src/lib/managed-instance-provision.js')
const { getHostById } = await import('../src/db/hosts.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const tag = `managed-${randomUUID()}`
const root = await mkdtemp(join(tmpdir(), tag))
const keyPath = join(root, 'key.pem'), certPath = join(root, 'cert.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=incus-fixture',
  '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath], { stdio: 'pipe', windowsHide: true })
const certificate = await readFile(certPath, 'utf8')
let mode = '', target = '', instanceId = 0
let remote: { name: string; config: Record<string, string>; status: string } | null = null
const actions: string[] = []
let afterCreate: (() => Promise<void>) | undefined
let afterStop: (() => Promise<void>) | undefined
const server = createServer({ key: await readFile(keyPath), cert: certificate, ca: certificate, requestCert: true, rejectUnauthorized: true }, async (request, response) => {
  response.setHeader('content-type', 'application/json')
  const ok = (metadata: unknown = {}) => response.end(JSON.stringify({ type: 'sync', metadata }))
  const fail = (status: number, error: string) => { response.statusCode = status; response.end(JSON.stringify({ type: 'error', error })) }
  try {
    assert.ok((request.socket as any).authorized)
    const path = request.url || ''
    if (path === '/1.0') return ok({ api_version: '1.0' })
    actions.push(`${request.method} ${path}`)
    if (path === '/1.0/instances' && request.method === 'POST') {
      let body = ''; for await (const chunk of request) body += chunk
      const config = JSON.parse(body)
      assert.equal(config.name, target)
      if (mode === 'existing') return fail(409, 'instance already exists')
      if (['absent', 'pending_create'].includes(mode)) return fail(500, 'image download failed')
      remote = { name: target, config: { ...config.config, 'volatile.uuid': randomUUID() }, status: 'Running' }
      await afterCreate?.()
      return ok()
    }
    if (path.includes('/files?')) return ['success', 'success_lost_claim'].includes(mode) ? ok() : fail(500, 'fixture cloud-init preparation failed')
    if (path === '/1.0/operations?recursion=1') return ok(mode === 'pending_create' ? { running: [{ id: 'pending-create', status: 'Running', resources: { instances: [`/1.0/instances/${target}`] } }] } : {})
    if (path.startsWith('/1.0/networks')) {
      if (mode === 'forward_refused') return fail(500, 'fixture network API unavailable')
      if (path === '/1.0/networks') return ok(['/1.0/networks/incusbr0'])
      if (mode === 'forward_unconfirmed' && request.method === 'GET') return ok([{ description: `payincus-dedicated:${target}`, listen_address: '192.0.2.20' }])
      return ok([])
    }
    assert.ok(path === `/1.0/instances/${target}` || path === `/1.0/instances/${target}/state`, 'never touch another remote instance')
    if (request.method === 'GET') {
      if (mode === 'not_found_text') return fail(500, 'backend not found')
      if (!remote) return fail(404, 'not found')
      return ok(path.endsWith('/state') ? { status: remote.status } : remote)
    }
    if (path.endsWith('/state') && request.method === 'PUT') {
      let body = ''; for await (const chunk of request) body += chunk
      const action = JSON.parse(body).action
      if (action === 'start') {
        assert.ok(['success', 'success_lost_claim'].includes(mode))
        if (remote) remote.status = 'Running'
        if (mode === 'success_lost_claim') await prisma.instance.update({ where: { id: instanceId }, data: { status: 'stopped' } })
        return ok()
      }
      assert.equal(action, 'stop')
      if (mode === 'stop_refused') return fail(500, 'stop refused')
      if (remote && mode !== 'still_running') remote.status = 'Stopped'
      if (remote && mode === 'uuid_changed') remote.config['volatile.uuid'] = randomUUID()
      await afterStop?.()
      return ok()
    }
    assert.equal(request.method, 'DELETE')
    if (mode === 'delete_refused') return fail(500, 'delete refused')
    if (mode === 'delete_false_404') return fail(404, 'operation not found')
    if (mode !== 'delete_unconfirmed') remote = null
    return ok()
  } catch (error) { fail(500, error instanceof Error ? error.message : String(error)) }
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const owner = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture', balance: 100 } })
const host = await prisma.host.create({ data: { userId: owner.id, name: tag, url: `https://127.0.0.1:${(server.address() as { port: number }).port}`,
  certPath, keyPath, serverCertificate: certificate, serverFingerprint: new X509Certificate(certificate).fingerprint256 } })
const constraint = `review_managed_${randomUUID().replaceAll('-', '')}`
let constraintAdded = false
try {
  for (const scenario of ['delete_refused', 'stop_refused', 'still_running', 'uuid_changed', 'delete_unconfirmed', 'delete_false_404', 'not_found_text', 'forward_refused', 'forward_unconfirmed', 'existing', 'pending_create', 'absent', 'confirmed', 'lost_claim', 'host_changed', 'allocation_changed', 'locked_cleanup', 'db_failure', 'success', 'success_lost_claim']) {
    mode = scenario; target = `${tag}-${mode}`; actions.length = 0; afterCreate = undefined; afterStop = undefined
    remote = mode === 'existing' ? { name: target, config: { 'user.unrelated': 'preserve' }, status: 'Running' } : null
    const instance = await prisma.instance.create({ data: { userId: owner.id, hostId: host.id, name: target, incusId: target,
      cpu: 50, memory: 256, disk: 1024, portLimit: 0, image: 'fixture/debian', networkMode: 'public_ipv4', status: 'creating' } })
    instanceId = instance.id
    await prisma.host.update({ where: { id: host.id }, data: { cpuUsed: 125, memoryUsed: 768, diskUsed: 4096 } })
    if (mode === 'db_failure') {
      await prisma.$executeRawUnsafe(`ALTER TABLE hosts ADD CONSTRAINT ${constraint} CHECK (id <> ${host.id} OR cpu_used >= 125) NOT VALID`)
      constraintAdded = true
    }
    await prisma.publicIpv4Address.create({ data: { hostId: host.id, address: '192.0.2.20', status: 'assigned', instanceId,
      prefixLength: 24, gateway: '192.0.2.1' } })
    await prisma.instanceBillingRecord.create({ data: { userId: owner.id, instanceId, type: 'newPurchase', amount: 5, months: 1,
      periodStart: new Date(), periodEnd: new Date(Date.now() + 86400000) } })
    if (mode === 'lost_claim') afterCreate = () => prisma.instance.update({ where: { id: instanceId }, data: { status: 'running' } }).then(() => {})
    if (mode === 'host_changed') afterCreate = () => prisma.host.update({ where: { id: host.id }, data: { url: 'https://127.0.0.1:1' } }).then(() => {})
    if (mode === 'allocation_changed') afterCreate = () => prisma.instance.update({ where: { id: instanceId }, data: { cpu: 60 } }).then(() => {})
    let mutation: Promise<unknown> | undefined, mutationFinished = false
    if (mode === 'locked_cleanup') afterStop = async () => {
      mutation = prisma.instance.update({ where: { id: instanceId }, data: { name: target + '-edited' } }).then(() => { mutationFinished = true })
      await new Promise(resolve => setTimeout(resolve, 150))
      assert.equal(mutationFinished, false, 'instance mutation must wait while cleanup holds the row lock')
    }
    const balance = Number((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).balance)
    const provisioning = provisionManagedInstanceAsync(instanceId, (await getHostById(host.id))!, {
      name: target, image: 'fixture/debian', cpu: 50, memory: 256, disk: 1024, networkMode: 'public_ipv4',
      cloudInitConfig: { 'user.user-data': '#cloud-config\n{}' }, ipv4Address: '192.0.2.20', autoRemotePort: false
    })
    if (mode === 'success') await provisioning; else await assert.rejects(provisioning)
    await mutation
    const current = await prisma.instance.findUniqueOrThrow({ where: { id: instanceId } })
    const resources = await prisma.host.findUniqueOrThrow({ where: { id: host.id } })
    const address = await prisma.publicIpv4Address.findFirstOrThrow({ where: { hostId: host.id } })
    const cleaned = ['absent', 'confirmed', 'host_changed', 'locked_cleanup'].includes(mode)
    assert.equal(resources.cpuUsed, cleaned ? 75 : 125, `${mode}: retain resources until remote absence and forward cleanup are confirmed`)
    assert.equal(resources.memoryUsed, cleaned ? 512 : 768)
    assert.equal(resources.diskUsed, cleaned ? 3072 : 4096)
    assert.equal(address.status, cleaned ? 'free' : 'assigned')
    const otherOwner = ['lost_claim', 'success', 'success_lost_claim'].includes(mode)
    assert.equal(current.status, mode === 'success_lost_claim' ? 'stopped' : ['lost_claim', 'success'].includes(mode) ? 'running' : 'error')
    assert.equal(current.provisioningCleanupPending, !cleaned && !otherOwner)
    if (!otherOwner) {
      const identity = (current.snapshottedSpecs as any).managedCleanup
      assert.match(identity.attempt, /^[a-f0-9-]{36}$/i)
      assert.match(identity.endpointHash, /^[a-f0-9]{64}$/)
      assert.equal('url' in identity, false, 'persist only an endpoint hash, not a management address')
    }
    assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).balance), balance + (otherOwner ? 0 : 5), 'failure refund remains independent of unresolved remote cleanup')
    if (['existing', 'lost_claim', 'not_found_text', 'allocation_changed'].includes(mode)) assert.equal(actions.filter(action => action.startsWith('PUT ') || action === `DELETE /1.0/instances/${target}`).length, 0, 'unknown or no longer claimed instance must not be stopped/deleted')
    if (mode === 'confirmed') {
      assert.equal(remote, null)
      assert.ok(actions.indexOf(`PUT /1.0/instances/${target}/state`) < actions.indexOf(`DELETE /1.0/instances/${target}`))
    }
    const actionCount = actions.length
    await assert.rejects(provisionManagedInstanceAsync(instanceId, (await getHostById(host.id))!, {
      name: target, image: 'fixture/debian', cpu: 50, memory: 256, disk: 1024, networkMode: 'public_ipv4'
    }), /no longer owns/)
    assert.equal(actions.length, actionCount, 'late duplicate callback must not retry destructive I/O')
    assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).cpuUsed, resources.cpuUsed)
    assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId, type: 'refund' } }), otherOwner ? 0 : 1)
    if (['success', 'success_lost_claim'].includes(mode)) {
      assert.equal(remote?.status, 'Running')
      assert.equal(actions.filter(action => action === `DELETE /1.0/instances/${target}`).length, 0)
    }
    if (constraintAdded) {
      await prisma.$executeRawUnsafe(`ALTER TABLE hosts DROP CONSTRAINT ${constraint}`)
      constraintAdded = false
    }
    await prisma.publicIpv4Address.deleteMany({ where: { hostId: host.id } })
    await prisma.instance.delete({ where: { id: instanceId } })
    if (mode === 'host_changed') await prisma.host.update({ where: { id: host.id }, data: { url: host.url } })
    console.log(`PASS managed provision ${mode}`)
  }
  console.log('PASS actual managed provision with local PostgreSQL and authenticated mTLS fixture; no live Incus or production operation.')
} finally {
  if (constraintAdded) await prisma.$executeRawUnsafe(`ALTER TABLE hosts DROP CONSTRAINT ${constraint}`)
  await closeAllClients()
  await new Promise<void>(resolve => server.close(() => resolve()))
  await prisma.publicIpv4Address.deleteMany({ where: { hostId: host.id } })
  await prisma.instance.deleteMany({ where: { hostId: host.id } })
  await prisma.host.delete({ where: { id: host.id } }); await prisma.user.delete({ where: { id: owner.id } }); await closePrismaDatabase()
  const resolved = root.replaceAll('\\', '/'), parent = tmpdir().replaceAll('\\', '/').replace(/\/$/, '')
  assert.ok(resolved.startsWith(parent + '/' + tag) && !resolved.slice(parent.length + 1).includes('/'))
  await rm(root, { recursive: true, force: true })
}
process.exit(0)
