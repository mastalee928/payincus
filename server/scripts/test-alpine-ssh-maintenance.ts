import assert from 'node:assert/strict'
import { createHash, randomUUID, randomInt } from 'node:crypto'
import Fastify from 'fastify'
const database = new URL(process.env.DATABASE_URL || '')
assert.equal(database.hostname, '127.0.0.1')
assert.ok(database.pathname.endsWith('_pool_test'))
process.env.ENCRYPTION_KEY = 'alpine-ssh-maintenance-isolated-fixture'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { encryptSensitiveData } = await import('../src/lib/security.js')
const { maintainAlpineCustomerSsh, readAlpineSshInspection } = await import('../src/services/alpine-ssh-maintenance.js')
const { default: securityRoutes } = await import('../src/routes/alpine-ssh-security.js')
const { INSTANCE_OPERATION_LOCK_NAMESPACE } = await import('../src/db/advisory-locks.js')
const prefix = `ssh-patch-${randomUUID().slice(0, 8)}`
const admin = await prisma.user.create({ data: { username: `${prefix}-admin`, passwordHash: 'unused', role: 'admin' } })
const buyer = await prisma.user.create({ data: { username: `${prefix}-buyer`, passwordHash: 'unused', balance: 77 } })
const batch = await prisma.hostOnboardingBatch.create({ data: { id: randomUUID(), createdById: admin.id, name: prefix, accountLabel: 'isolated-test', defaults: {} } })
const ip = `192.0.2.${randomInt(20, 240)}`
const managementIp = `10.253.239.${randomInt(20, 240)}`
const endpoint = `https://${managementIp}:8443`
const host = await prisma.host.create({ data: { userId: admin.id, name: prefix, url: endpoint, isInstalled: true, status: 'online',
  singleTenant: true, natPublicIp: ip, natBindIp: '10.0.0.13', natPortStart: 1, natPortEnd: 65535,
  cpuAllowanceMax: 200, memoryMax: 768, customerDiskGiB: 30,
  serverCertificate: 'isolated-certificate', serverFingerprint: 'isolated-pin',
  onboardingNode: { create: { batchId: batch.id, publicIp: ip, sshFingerprint: 'SHA256:host-fixture', sshPort: 22,
    managementIp, name: prefix, status: 'succeeded', credentialsExpireAt: new Date(0) } } } })
const uuid = randomUUID(), attempt = randomUUID()
const instance = await prisma.instance.create({ data: { userId: buyer.id, hostId: host.id, name: prefix, incusId: prefix,
  status: 'running', image: 'images:alpine/3.22/cloud', cpu: 100, memory: 256, disk: 1024,
  dedicatedIpv4: true, dedicatedNetworkReady: true, ipv4: '10.10.0.2', rootPassword: encryptSensitiveData('original-isolated-password'),
  billingPrice: 9.5, expiresAt: new Date('2030-01-01'), snapshottedSpecs: { kept: 'customer-setting',
    managedCleanup: { uuid, attempt, endpointHash: createHash('sha256').update(endpoint).digest('hex') } } } })
let updated = 0, holds = 0, logins = 0, fixed = false, changed = false, failUpdate = false, sessionFail = false
const events: string[] = []
const client = { baseUrl: endpoint, request: async () => ({ name: prefix, type: 'container', profiles: [], devices: { root: { type: 'disk', path: '/', pool: 'fixture' } }, config: { 'security.privileged': 'false', 'volatile.uuid': changed ? randomUUID() : uuid, 'user.payincus.provisioning-attempt': attempt } }) } as any
const deps = {
  connect: async () => client,
  inspect: async () => ({ alpine: true, fixed, fingerprints: ['SHA256:original'] }),
  update: async () => { events.push('update'); if (!fixed) updated++; if (failUpdate) throw new Error('ALPINE_SSH_UPDATE_FAILED'); fixed = true },
  hold: async (_host: string, password: string) => { assert.equal(password, 'original-isolated-password'); holds++; events.push('hold'); return {
    verify: async () => { events.push('existing-session'); if (sessionFail) throw new Error('session disconnected') }, close: () => { events.push('close') }
  } },
  login: async (_host: string, password: string) => { assert.equal(password, 'original-isolated-password'); logins++; events.push('new-login') }
}
try {
  assert.throws(() => readAlpineSshInspection(''), /INSPECTION_FAILED/)
  assert.throws(() => readAlpineSshInspection('INCUDAL_ALPINE_SSH_FIXED'), /IDENTITY_MISSING/)
  assert.deepEqual(readAlpineSshInspection('INCUDAL_SSH_NOT_ALPINE\nSHA256:test-key'), { alpine: false, fixed: false, fingerprints: ['SHA256:test'] })
  await assert.rejects(maintainAlpineCustomerSsh(instance.id, buyer.id, deps), /ADMIN_REQUIRED/)
  assert.equal(updated, 0)
  const session = { sid: `${prefix}-session`, iat: Math.floor(Date.now() / 1000) }
  await prisma.tokenInvalidation.create({ data: { userId: admin.id, sessionId: session.sid, invalidatedAt: session.iat } })
  await assert.rejects(maintainAlpineCustomerSsh(instance.id, admin.id, deps, session), /ADMIN_REQUIRED/)
  await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } })
  changed = true
  await assert.rejects(maintainAlpineCustomerSsh(instance.id, admin.id, deps), /IDENTITY_CHANGED/)
  assert.equal(holds, 0)
  changed = false
  const task = await prisma.instanceTask.create({ data: { instanceId: instance.id, hostId: host.id, userId: buyer.id, taskType: 'stop', status: 'PENDING' } })
  await assert.rejects(maintainAlpineCustomerSsh(instance.id, admin.id, deps), /INSTANCE_BUSY/)
  assert.equal(updated, 0)
  await prisma.instanceTask.delete({ where: { id: task.id } })
  let release!: () => void, locked!: () => void
  const acquired = new Promise<void>(resolve => { locked = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const lock = prisma.$transaction(async tx => { await tx.$queryRaw`SELECT pg_advisory_xact_lock(${INSTANCE_OPERATION_LOCK_NAMESPACE}, ${instance.id})::text`; locked(); await gate })
  await acquired
  await assert.rejects(maintainAlpineCustomerSsh(instance.id, admin.id, deps), /INSTANCE_BUSY/)
  release(); await lock
  failUpdate = true
  await assert.rejects(maintainAlpineCustomerSsh(instance.id, admin.id, deps), /UPDATE_FAILED/)
  assert.equal(logins, 0)
  assert.ok(!((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).snapshottedSpecs as Record<string, unknown>)?.alpineSshSecurity)
  failUpdate = false; events.length = 0
  const result = await maintainAlpineCustomerSsh(instance.id, admin.id, deps)
  assert.equal(result.status, 'verified')
  assert.deepEqual(events, ['hold', 'update', 'existing-session', 'new-login', 'close'])
  const record = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
  for (const key of ['incusId', 'userId', 'hostId', 'rootPassword', 'status', 'billingPrice', 'expiresAt', 'ipv4', 'cpu', 'memory', 'disk'] as const) {
    assert.deepEqual(record[key], instance[key], `customer ${key} stays unchanged`)
  }
  const count = updated
  assert.equal((await maintainAlpineCustomerSsh(instance.id, admin.id, deps)).status, 'already-fixed')
  assert.equal(updated, count)
  failUpdate = true
  assert.equal((await maintainAlpineCustomerSsh(instance.id, admin.id, deps)).status,'already-fixed','patched listener never enters update even when an update would fail')
  failUpdate = false
  sessionFail = true
  await assert.rejects(maintainAlpineCustomerSsh(instance.id, admin.id, deps), /VERIFICATION_FAILED/)
  assert.equal(updated, count)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), 77)
  assert.ok(await prisma.log.count({ where: { instanceId: instance.id, result: 'error' } }) > 0)
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } })
  app.decorate('authenticateAdmin', async (request, reply) => {
    if (request.headers['x-test-admin'] !== 'yes') { reply.code(403).send({ error: 'forbidden' }); return }
    request.user = { id: admin.id, username: admin.username, role: 'admin', ...session }
  })
  let calls = 0
  await app.register(securityRoutes, { prefix: '/instances', maintain: async (id: number, actorId: number, _deps: unknown, actualSession?: { sid: string; iat: number }) => {
    assert.equal(id, instance.id); assert.equal(actorId, admin.id); assert.equal(actualSession?.sid, session.sid)
    calls++; return { instanceId: id, status: 'already-fixed', passwordLoginPreserved: true }
  } })
  try {
    const url = `/instances/${instance.id}/ssh-security`, headers = { 'x-test-admin': 'yes' }
    assert.equal((await app.inject({ method: 'POST', url, payload: {} })).statusCode, 403)
    assert.equal((await app.inject({ method: 'POST', url, headers, payload: { password: 'override' } })).statusCode, 400)
    assert.equal((await app.inject({ method: 'POST', url: '/instances/1e2/ssh-security', headers, payload: {} })).statusCode, 400)
    assert.equal((await app.inject({ method: 'POST', url, headers, payload: {} })).statusCode, 200)
    assert.equal(calls, 1)
  } finally { await app.close() }
  console.log('PASS Alpine SSH maintenance: admin-only, exact original remote identity, real PG busy lock, pending task, failure/retry, original password/session, idempotence and unchanged customer/billing data')
} finally {
  await prisma.log.deleteMany({ where: { instanceId: instance.id } })
  await prisma.instance.delete({ where: { id: instance.id } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.hostOnboardingBatch.delete({ where: { id: batch.id } })
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, buyer.id] } } })
  await closePrismaDatabase()
}
process.exit(0)
