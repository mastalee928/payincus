import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const database = new URL(process.env.DATABASE_URL || 'postgresql://localhost/invalid')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'use an isolated local *_pool_test database')
database.searchParams.set('options', '-c timezone=Asia/Shanghai')
process.env.DATABASE_URL = database.href
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { claimHostOnboardingNode } = await import('../src/workers/hostOnboardingWorker.js')
const batchId = randomUUID()

try {
  const timezone = await prisma.$queryRawUnsafe<Array<{ TimeZone: string }>>('SHOW TIMEZONE')
  assert.equal(timezone[0]?.TimeZone, 'Asia/Shanghai')
  assert.equal(await prisma.hostOnboardingNode.count({ where: { deletedAt: null, status: { in: ['queued', 'running'] } } }), 0, 'test database must have no active onboarding jobs')
  await prisma.hostOnboardingBatch.create({ data: {
    id: batchId, createdById: 1, name: 'Lease regression', accountLabel: 'test', defaults: {},
    nodes: { create: { name: 'lease-regression', publicIp: `lease-${batchId}`, credentialsExpireAt: new Date(Date.now() + 3600000) } }
  } })
  const first = await claimHostOnboardingNode()
  assert.equal(first?.batchId, batchId)
  assert.equal(await claimHostOnboardingNode(), null, 'a valid UTC lease must not be reclaimed in a non-UTC database session')
  await prisma.hostOnboardingNode.update({ where: { id: first!.id }, data: { leaseUntil: new Date(Date.now() - 60000) } })
  const recovered = await claimHostOnboardingNode()
  assert.equal(recovered?.id, first!.id, 'an expired lease must remain recoverable')
  assert.notEqual(recovered?.leaseToken, first!.leaseToken)
  assert.equal(recovered?.attempt, first!.attempt, 'recovery must not impersonate an explicit retry')
  console.log('Onboarding lease timezone and recovery integration checks passed')
} finally {
  await prisma.hostOnboardingBatch.deleteMany({ where: { id: batchId } })
  await closePrismaDatabase()
}
process.exit(0)
