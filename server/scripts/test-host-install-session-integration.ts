import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/hosts.js')
const { issueHostAgentInstallToken, consumeHostAgentInstallToken } = await import('../src/lib/host-agent-credentials.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const tag = 'install-session-' + randomUUID().slice(0, 8)
const actor = await prisma.user.create({ data: { username: tag, role: 'admin', passwordHash: 'fixture' } })
const owner = await prisma.user.create({ data: { username: tag + '-owner', passwordHash: 'fixture' } })
const host = await prisma.host.create({ data: { userId: owner.id, name: tag, url: 'https://127.0.0.1:1', isInstalled: true,
  status: 'online', certPath: 'original-client.crt', keyPath: 'original-client.key', serverCertificate: 'original-server', serverFingerprint: 'original-pin' } })
const app = Fastify()
const identity = { ...actor, sid: randomUUID(), iat: Math.floor(Date.now()/1000) + 1 }
let afterAuth: (() => Promise<unknown>) | undefined
for (const name of ['authenticate', 'authenticateAdmin']) app.decorate(name, async (request: any) => { request.user = identity; await afterAuth?.() })
app.decorate('authenticateOptional', async () => {})
try {
  await app.register(routes, { prefix: '/hosts' })
  const before = await prisma.host.findUniqueOrThrow({ where: { id: host.id } })
  const result = await app.inject({ method: 'POST', url: `/hosts/${host.id}/regenerate-install` })
  assert.equal(result.statusCode, 200, result.body)
  const prepared = await prisma.host.findUniqueOrThrow({ where: { id: host.id } })
  assert.equal(prepared.isInstalled, true); assert.equal(prepared.installPending, true)
  for (const field of ['certPath', 'keyPath', 'serverCertificate', 'serverFingerprint', 'status', 'url'] as const) assert.equal(prepared[field], before[field])
  const issued = await issueHostAgentInstallToken(host.id, true, { hostInstallToken: prepared.installToken! })
  assert.ok((await consumeHostAgentInstallToken(issued.installToken)).agentSecret)
  const failed = await app.inject({ method: 'POST', url: `/hosts/${host.id}/verify` })
  assert.equal(failed.statusCode, 409, 'existing pin is used even in a pending session; failed connection never resets identity')
  const retained = await prisma.host.findUniqueOrThrow({ where: { id: host.id } })
  assert.equal(retained.installPending, true); assert.equal(retained.certPath, before.certPath); assert.equal(retained.serverFingerprint, before.serverFingerprint)
  for (const architecture of ['x86_64', 'aarch64']) {
    await prisma.host.update({ where: { id: host.id }, data: { singleTenant: true, architecture, cpuAllowanceMax: 200, memoryMax: 768, storageSize: 38, customerDiskGiB: 30 } })
    const customer = await prisma.instance.create({ data: { hostId: host.id, userId: owner.id, name: tag, incusId: tag, image: 'alpine/3.22', status: 'running', cpu: 200, memory: 768, disk: 30720 } })
    const refusesInstall = async () => {
      assert.equal((await app.inject({ method: 'POST', url: `/hosts/${host.id}/regenerate-install` })).statusCode, 409)
      for (const suffix of ['', '?os=alpine']) assert.equal((await app.inject({ method: 'GET', url: `/hosts/install.sh/${prepared.installToken}${suffix}` })).statusCode, 409)
      const current = await prisma.host.findUniqueOrThrow({ where: { id: host.id } })
      for (const key of ['installPending', 'installToken', 'serverFingerprint', 'serverCertificate', 'certPath', 'keyPath'] as const) assert.equal(current[key], prepared[key])
    }
    await refusesInstall()
    await prisma.instance.update({ where: { id: customer.id }, data: { status: 'deleted', provisioningCleanupPending: true } })
    await refusesInstall()
    await prisma.instance.update({ where: { id: customer.id }, data: { provisioningCleanupPending: false } })
    await prisma.instanceTask.create({ data: { hostId: host.id, instanceId: customer.id, userId: owner.id, taskType: 'recreate', status: 'FAILED',
      replacementState: { targetPhase: 'cleanup_pending' } } })
    await refusesInstall()
    await prisma.instance.delete({ where: { id: customer.id } })
    console.log('PASS', architecture, 'occupied dedicated host and unfinished cleanup reject full installers without changing original identity')
  }
  await prisma.host.update({ where: { id: host.id }, data: { securityHardening: { maintenance: { phase: 'waiting-boot' } } } })
  assert.equal((await app.inject({ method: 'POST', url: `/hosts/${host.id}/regenerate-install` })).statusCode, 409)
  await prisma.host.update({ where: { id: host.id }, data: { securityHardening: (await import('@prisma/client')).Prisma.DbNull } })
  afterAuth = () => prisma.user.update({ where: { id: actor.id }, data: { role: 'user' } })
  const denied = await app.inject({ method: 'POST', url: `/hosts/${host.id}/regenerate-install` })
  assert.equal(denied.statusCode, 409)
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).installToken, prepared.installToken)
  afterAuth = undefined; await prisma.user.update({ where: { id: actor.id }, data: { role: 'admin' } })
  await prisma.tokenInvalidation.create({ data: { userId: actor.id, sessionId: identity.sid, invalidatedAt: identity.iat } })
  assert.equal((await app.inject({ method: 'POST', url: `/hosts/${host.id}/regenerate-install` })).statusCode, 409)
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).installToken, prepared.installToken)
  console.log('PASS actual installer routes preserve installed state/TLS pin; pending installer can fetch Agent config; current demotion/session revocation block issuance')
} finally {
  await app.close(); await closeAllClients()
  await prisma.instance.deleteMany({ where: { hostId: host.id } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.deleteMany({ where: { id: { in: [actor.id, owner.id] } } })
  await closePrismaDatabase()
}
process.exit(0)
