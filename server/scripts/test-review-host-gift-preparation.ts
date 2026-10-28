import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { randomUUID, X509Certificate } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use isolated local *_pool_test PostgreSQL')
process.env.JWT_SECRET ||= 'gift-preparation-fixture-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: hostRoutes } = await import('../src/routes/hosts.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const { listNatIpv4Pool } = await import('../src/lib/ip-calculator.js')
const prefix = `gift-${randomUUID().slice(0, 8)}`
const root = await mkdtemp(join(tmpdir(), prefix))
const keyPath = join(root, 'key.pem'), certPath = join(root, 'cert.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=gift-fixture',
  '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath], { stdio: 'pipe', windowsHide: true })
const certificate = await readFile(certPath, 'utf8')
const actions: string[] = []
const remotes = new Map<string, { config: Record<string, string>; status: string }>()
const remoteServer = createServer({ key: await readFile(keyPath), cert: certificate, ca: certificate, requestCert: true, rejectUnauthorized: true }, async (request, response) => {
  const send = (metadata: unknown, status = 200) => {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ type: status === 200 ? 'sync' : 'error', metadata, error: status === 200 ? '' : 'not found' }))
  }
  try {
    assert.ok((request.socket as any).authorized)
    const path = request.url || ''
    actions.push(`${request.method} ${path}`)
    if (path === '/1.0') return send({ api_version: '1.0' })
    if (path === '/1.0/instances' && request.method === 'POST') {
      let body = ''; for await (const chunk of request) body += chunk
      const input = JSON.parse(body)
      assert.ok(input.config['user.payincus.provisioning-attempt'])
      assert.equal(input.devices.root.pool, 'test')
      remotes.set(input.name, { config: input.config, status: 'Stopped' })
      return send({})
    }
    if (path.includes('/files?')) return send({})
    const match = /^\/1\.0\/instances\/([^/]+)(\/state)?$/.exec(path)
    if (match && remotes.has(match[1]!)) {
      const remote = remotes.get(match[1]!)!
      if (request.method === 'GET') return send(remote)
      let body = ''; for await (const chunk of request) body += chunk
      assert.equal(request.method, 'PUT'); assert.equal(JSON.parse(body).action, 'start')
      remote.status = 'Running'; return send({})
    }
    return send({}, 404)
  } catch { return send({}, 500) }
})
await new Promise<void>(resolve => remoteServer.listen(0, '127.0.0.1', resolve))
const admin = await prisma.user.create({ data: { username: `${prefix}-admin`, passwordHash: 'unusable-fixture', role: 'admin', balance: 100 } })
const owner = await prisma.user.create({ data: { username: `${prefix}-owner`, passwordHash: 'unusable-fixture', balance: 100 } })
const buyer = await prisma.user.create({ data: { username: `${prefix}-buyer`, passwordHash: 'unusable-fixture', balance: 100 } })
await prisma.sshKey.create({ data: { userId: buyer.id, name: prefix, publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureOnlyNotUsable', fingerprint: prefix } })
const systemImage = await prisma.systemImage.create({ data: { name: prefix, remoteAlias: `${prefix}/debian`, architecture: 'x86_64', instanceType: 'container', icon: 'debian' } })
const app = Fastify()
app.decorate('authenticate', async (request: any) => {
  const actor = request.headers['x-test-role'] === 'owner' ? owner : admin
  request.user = { id: actor.id, username: actor.username, role: actor.role }
})
app.decorate('requireAdmin', async (request: any, reply: any) => { if (request.user.role !== 'admin') return reply.code(403).send({ code: 'FORBIDDEN' }) })
app.decorate('authenticateAdmin', async (request: any, reply: any) => { await app.authenticate(request, reply); if (!reply.sent) await app.requireAdmin(request, reply) })
await app.register(hostRoutes, { prefix: '/hosts' })
const functionName = `review_gift_${randomUUID().replaceAll('-', '')}`
let triggerInstalled = false
let cleanupError: unknown
const waitFor = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 150; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  assert.fail('Timed out waiting for managed provisioning')
}
try {
  const all = ['storage_nat', 'storage_public', 'public_empty', 'nat_empty', 'nat_error', 'ipv6_error', 'storage_write_error', 'claim_lost', 'resource_changed', 'compensation_error', 'inbox_error', 'success_free', 'success_paid']
  for (const scenario of process.env.REVIEW_GIFT_SCENARIOS?.split(',') || all) {
    const nat = ['storage_nat', 'nat_empty', 'nat_error', 'ipv6_error'].includes(scenario)
    const networkMode = scenario === 'ipv6_error' ? 'nat_ipv6' : nat ? 'nat' : 'public_ipv4'
    const paid = scenario !== 'success_free'
    const host = await prisma.host.create({ data: { userId: owner.id, name: `${prefix}-${scenario}`, url: `https://127.0.0.1:${(remoteServer.address() as { port: number }).port}`,
      certPath, keyPath, serverCertificate: certificate, serverFingerprint: new X509Certificate(certificate).fingerprint256,
      status: 'online', isInstalled: true, cpuAllowanceMax: 1000, memoryMax: 4096, storageSize: 60,
      cpuUsed: 75, memoryUsed: 512, diskUsed: 3072, natPortsUsedCount: 7, natPortStart: 20000, natPortEnd: 30000,
      ipv6Subnet: scenario === 'ipv6_error' ? 'invalid-subnet' : null, ipv6ParentInterface: 'eth0' } })
    const pkg = await prisma.package.create({ data: { userId: owner.id, name: host.name, cpuMax: 100, memoryMax: 1024, diskMax: 2048, portLimit: 6, networkMode } })
    const plan = await prisma.packagePlan.create({ data: { packageId: pkg.id, name: host.name, cpu: 50, memory: 256, disk: 1024, trafficLimit: 1000000n, price: 1000, portLimit: 3, snapshotLimit: 0, backupLimit: 0, siteLimit: 0 } })
    await prisma.storagePool.create({ data: { hostId: host.id, name: 'test', driver: 'btrfs', purpose: 'instance_data' } })
    await prisma.publicIpv4Address.create({ data: { hostId: host.id, address: '192.0.2.20', prefixLength: 24, gateway: '192.0.2.1' } })
    if (scenario === 'nat_empty') await prisma.natIpv4Reservation.createMany({ data: listNatIpv4Pool().map(address => ({ hostId: host.id, address, expiresAt: new Date(Date.now() + 3600000) })) })
    // Database-side faults execute on the real route's transaction boundaries.
    const functionBody = scenario.startsWith('storage_') && scenario !== 'storage_write_error' || ['claim_lost', 'resource_changed', 'compensation_error'].includes(scenario)
      ? `IF TG_OP = 'INSERT' THEN DELETE FROM storage_pools WHERE host_id = ${host.id}; ${scenario === 'claim_lost' ? `UPDATE instances SET status = 'running' WHERE id = NEW.id;` : scenario === 'resource_changed' ? `UPDATE instances SET cpu = 60 WHERE id = NEW.id;` : ''} END IF;`
      : scenario === 'public_empty' ? `IF TG_OP = 'INSERT' THEN UPDATE public_ipv4_addresses SET status = 'disabled' WHERE host_id = ${host.id}; END IF;`
      : scenario === 'storage_write_error' ? `IF TG_OP = 'UPDATE' AND NEW.storage_pool_name IS NOT NULL THEN RAISE EXCEPTION 'fixture storage persistence failure'; END IF;`
      : scenario === 'nat_error' ? `IF TG_OP = 'UPDATE' AND NEW.ipv4 IS NOT NULL THEN RAISE EXCEPTION 'fixture NAT persistence failure'; END IF;` : ''
    await prisma.$executeRawUnsafe(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $fixture$ BEGIN IF NEW.host_id = ${host.id} THEN ${functionBody} END IF; RETURN NEW; END $fixture$`)
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${functionName} AFTER INSERT OR UPDATE ON instances FOR EACH ROW EXECUTE FUNCTION ${functionName}()`)
    triggerInstalled = true
    if (scenario === 'compensation_error') await prisma.$executeRawUnsafe(`ALTER TABLE hosts ADD CONSTRAINT ${functionName} CHECK (id <> ${host.id} OR cpu_used >= 125) NOT VALID`)
    if (scenario === 'inbox_error') await prisma.$executeRawUnsafe(`ALTER TABLE inbox_messages ADD CONSTRAINT ${functionName} CHECK (user_id <> ${buyer.id} OR event_type <> 'instance_paid_created') NOT VALID`)
    actions.length = 0
    const response = await app.inject({ method: 'POST', url: `/hosts/${host.id}/instances/create-for-user`, headers: { 'x-test-role': scenario === 'success_free' ? 'owner' : 'admin' },
      payload: { username: buyer.username, name: host.name, packageId: pkg.id, ...(paid ? { planId: plan.id, giftDays: 7 } : { cpu: 50, memory: 256, disk: 1024 }), image: systemImage.remoteAlias } })
    const accepted = ['inbox_error', 'success_free', 'success_paid'].includes(scenario)
    const instance = await prisma.instance.findFirstOrThrow({ where: { hostId: host.id } })
    if (accepted) {
      // Wait even if the response is wrong: the old code really starts delivery before returning 500.
      await waitFor(async () => (await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).status === 'running')
      await waitFor(async () => await prisma.ipAddress.count({ where: { instanceId: instance.id } }) === 1)
      assert.equal(response.statusCode, 202, `${scenario}: accepted delivery must not turn into a failure response`)
      assert.equal(response.json().instance.user.id, buyer.id)
      assert.equal(response.json().instance.charged, false)
      assert.equal(actions.filter(action => action === 'POST /1.0/instances').length, 1)
      assert.equal(remotes.get(instance.incusId)?.status, 'Running')
    } else {
      assert.ok([409, 503].includes(response.statusCode), `${scenario}: expected explicit preparation failure, got ${response.statusCode}`)
      assert.equal(actions.length, 0, 'failed preparation must perform no Incus requests')
    }
    const retained = accepted || ['claim_lost', 'resource_changed', 'compensation_error'].includes(scenario)
    const current = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
    assert.equal(current.status, accepted || scenario === 'claim_lost' ? 'running' : retained ? 'creating' : 'error')
    assert.equal(current.userId, buyer.id)
    assert.equal(current.provisioningCleanupPending, false, 'no remote cleanup is pending for preparation failure')
    const resources = await prisma.host.findUniqueOrThrow({ where: { id: host.id } })
    assert.deepEqual([resources.cpuUsed, resources.memoryUsed, resources.diskUsed, resources.natPortsUsedCount],
      [retained ? 125 : 75, retained ? 768 : 512, retained ? 4096 : 3072, 7 + (retained && nat ? 3 : 0)], `${scenario}: release only this reservation atomically`)
    const address = await prisma.publicIpv4Address.findFirstOrThrow({ where: { hostId: host.id } })
    assert.equal(address.status, scenario === 'public_empty' ? 'disabled' : !nat && accepted ? 'assigned' : 'free')
    if (nat && !retained) {
      assert.equal(current.ipv4, null)
      assert.equal(await prisma.natIpv4Reservation.count({ where: { hostId: host.id } }), scenario === 'nat_empty' ? listNatIpv4Pool().length : 0)
    }
    if (!accepted) {
      assert.equal(current.storagePoolName, null, 'failed preparation must not publish a storage choice')
      const failure = await prisma.log.findFirst({ where: { instanceId: instance.id, result: 'failed' } })
      assert.ok(failure, 'preparation failure must retain a per-instance audit record')
      assert.equal(response.json().instanceId, instance.id, 'unknown/failed preparation gives the operator the existing record to inspect')
    }
    if (scenario === 'inbox_error') {
      assert.equal(await prisma.inboxMessage.count({ where: { userId: buyer.id, eventType: 'instance_paid_created' } }), 0)
      assert.ok(await prisma.log.findFirst({ where: { instanceId: instance.id, result: 'failed' } }), 'notification failure is persisted independently')
    }
    assert.equal(await prisma.balanceLog.count({ where: { userId: { in: [admin.id, owner.id, buyer.id] } } }), 0)
    assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: instance.id, type: 'refund' } }), 0)
    const bills = await prisma.instanceBillingRecord.findMany({ where: { instanceId: instance.id } })
    assert.equal(bills.length, paid ? 1 : 0)
    if (paid) assert.equal(Number(bills[0]!.amount), 0)
    for (const actor of [admin, owner, buyer]) assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: actor.id } })).balance), 100)
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${functionName} ON instances`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${functionName}()`)
    triggerInstalled = false
    if (scenario === 'compensation_error') await prisma.$executeRawUnsafe(`ALTER TABLE hosts DROP CONSTRAINT ${functionName}`)
    if (scenario === 'inbox_error') await prisma.$executeRawUnsafe(`ALTER TABLE inbox_messages DROP CONSTRAINT ${functionName}`)
    console.log(`PASS host gift ${scenario}`)
  }
} catch (error) { cleanupError = error } finally {
  if (triggerInstalled) {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${functionName} ON instances`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${functionName}()`)
  }
  await prisma.$executeRawUnsafe(`ALTER TABLE hosts DROP CONSTRAINT IF EXISTS ${functionName}`)
  await prisma.$executeRawUnsafe(`ALTER TABLE inbox_messages DROP CONSTRAINT IF EXISTS ${functionName}`)
  await app.close(); await closeAllClients()
  await new Promise<void>(resolve => remoteServer.close(() => resolve()))
  await prisma.publicIpv4Address.deleteMany({ where: { host: { userId: owner.id } } })
  await prisma.instance.deleteMany({ where: { userId: buyer.id } })
  await prisma.host.deleteMany({ where: { userId: owner.id } })
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, owner.id, buyer.id] } } })
  await prisma.systemImage.delete({ where: { id: systemImage.id } })
  await closePrismaDatabase()
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + prefix))
  await rm(root, { recursive: true, force: true })
}
if (cleanupError) { console.error(cleanupError); process.exit(1) }
console.log('PASS real Fastify/PostgreSQL gift preparation and mTLS delivery fixture; no native Incus or production operations')
process.exit(0)
