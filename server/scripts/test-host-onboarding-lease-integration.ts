import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || 'postgresql://localhost/invalid')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'use an isolated local *_pool_test database')
database.searchParams.set('options', '-c timezone=Asia/Shanghai')
process.env.DATABASE_URL = database.href
process.env.ENCRYPTION_KEY = 'onboarding-retry-integration-fixture'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { claimHostOnboardingNode } = await import('../src/workers/hostOnboardingWorker.js')
const batchId = randomUUID()

try {
  const timezone = await prisma.$queryRawUnsafe<Array<{ TimeZone: string }>>('SHOW TIMEZONE')
  assert.equal(timezone[0]?.TimeZone, 'Asia/Shanghai')
  assert.equal(await prisma.hostOnboardingNode.count({ where: { deletedAt: null, status: { in: ['queued', 'running'] } } }), 0, 'test database must have no active onboarding jobs')
  await prisma.hostOnboardingBatch.create({ data: {
    id: batchId, createdById: 1, name: 'Lease regression', accountLabel: 'test', defaults: {},
    nodes: { create: { name: `lease-${batchId}`, publicIp: `lease-${batchId}`, credentialsExpireAt: new Date(Date.now() + 3600000) } }
  } })
  const first = await claimHostOnboardingNode()
  assert.equal(first?.batchId, batchId)
  assert.equal(await claimHostOnboardingNode(), null, 'a valid UTC lease must not be reclaimed in a non-UTC database session')
  await prisma.hostOnboardingNode.update({ where: { id: first!.id }, data: { leaseUntil: new Date(Date.now() - 60000) } })
  const recovered = await claimHostOnboardingNode()
  assert.equal(recovered?.id, first!.id, 'an expired lease must remain recoverable')
  assert.notEqual(recovered?.leaseToken, first!.leaseToken)
  assert.equal(recovered?.attempt, first!.attempt, 'recovery must not impersonate an explicit retry')
  const { default: onboardingRoutes } = await import('../src/routes/host-onboarding.js')
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } })
  app.decorate('authenticateAdmin', async (request, reply) => {
    if (request.headers['x-test-role'] !== 'admin') return reply.code(403).send({ code: 'ADMIN_REQUIRED' })
    request.user = { id: 1, username: 'fixture-admin', role: 'admin' }
  })
  await app.register(onboardingRoutes, { prefix: '/onboarding' })
  try {
    const url = `/onboarding/nodes/${first!.id}/retry`, headers = { 'x-test-role': 'admin' }
    await prisma.hostOnboardingNode.update({ where: { id: first!.id }, data: { status: 'failed', step: 'checking',
      sshFingerprint: 'old-ubuntu-identity', errorCode: 'SSH_HOST_KEY_CHANGED', leaseToken: null, leaseUntil: null,
      resolvedResources: { previousSystem: true } } })
    const denied = await app.inject({ method: 'POST', url, payload: { password: 'new-system-fixture' } })
    assert.equal(denied.statusCode, 403)
    const invalid = await app.inject({ method: 'POST', url, headers, payload: { password: 'new-system-fixture', sshFingerprint: 'unverified-override' } })
    assert.equal(invalid.statusCode, 400, 'retry does not accept a manual fingerprint override')
    const response = await app.inject({ method: 'POST', url, headers, payload: { password: 'new-system-fixture' } })
    assert.equal(response.statusCode, 200, response.body)
    const retried = await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { id: first!.id } })
    assert.equal(retried.status, 'queued')
    assert.equal(retried.sshFingerprint, null, 'ordinary retry of an unprovisioned DD host must not retain its old system identity')
    assert.equal(retried.resolvedResources, null, 'the current system must be probed again')
    assert.ok(retried.credentialsEncrypted && !retried.credentialsEncrypted.includes('new-system-fixture'))
    const audit = await prisma.log.findFirst({ where: { action: 'host.onboarding.ssh_identity_refreshed', content: { contains: batchId } } })
    assert.ok(audit?.content.includes('old-ubuntu-identity'), 'the previous identity remains in the audit record')
    await prisma.hostOnboardingNode.update({ where: { id: first!.id }, data: { status: 'failed', step: 'checking',
      managementIp: '10.90.0.2', nodePublicKey: 'existing-management-peer', sshFingerprint: 'established-identity' } })
    const established = await app.inject({ method: 'POST', url, headers, payload: { password: 'new-system-fixture' } })
    assert.equal(established.statusCode, 200, established.body)
    const kept = await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { id: first!.id } })
    assert.equal(kept.sshFingerprint, 'established-identity', 'established management identities are retained')
    assert.equal(kept.nodePublicKey, 'existing-management-peer')
    assert.equal(kept.managementIp, '10.90.0.2')
    assert.equal((await app.inject({ method: 'POST', url, headers, payload: {} })).statusCode, 409, 'an already queued task cannot be reset twice')
  } finally { await app.close() }
  console.log('Onboarding lease timezone, recovery and current-system retry integration checks passed')
} finally {
  await prisma.hostOnboardingBatch.deleteMany({ where: { id: batchId } })
  await closePrismaDatabase()
}
process.exit(0)
