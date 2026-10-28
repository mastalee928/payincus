import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const email = await import('../src/db/host-notification-email-tasks.js')
const { finalizeInstanceTaskAttempt, failExpiredInstanceTaskAttempt } = await import('../src/workers/instanceTaskWorker.js')
const { getInstancesToSync } = await import('../src/services/status-scheduler.js')
const tag = `queue-${randomUUID()}`
const user = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: user.id, name: tag, url: 'https://127.0.0.1:1', status: 'online' } })
const now = Date.now()
const old = new Date(now - 15 * 60000)
const newStart = new Date(now - 1000)
const common = { userId: user.id, hostId: host.id, email: 'fixture@example.test', username: tag, hostName: tag,
  title: 'Fixture', content: 'Fixture', scheduledFor: new Date() }
try {
  const fresh = await prisma.hostNotificationEmailTask.create({ data: { ...common, status: 'PROCESSING', startedAt: newStart } })
  const stale = await prisma.hostNotificationEmailTask.create({ data: { ...common, status: 'PROCESSING', startedAt: old } })
  const malformed = await prisma.hostNotificationEmailTask.create({ data: { ...common, status: 'PROCESSING', startedAt: null } })
  assert.equal(await email.cleanupTimeoutHostNotificationEmailTasks(), 2, 'timeout handles both expired and missing start without stealing current attempt')
  assert.equal((await prisma.hostNotificationEmailTask.findUniqueOrThrow({ where: { id: fresh.id } })).status, 'PROCESSING')
  assert.equal((await prisma.hostNotificationEmailTask.findUniqueOrThrow({ where: { id: malformed.id } })).status, 'PENDING')
  await prisma.hostNotificationEmailTask.update({ where: { id: stale.id }, data: { status: 'PROCESSING', startedAt: newStart } })
  assert.equal(await email.markHostNotificationEmailTaskSent(stale.id, old, 0), false, 'late completion cannot mark a new attempt SENT')
  assert.equal(await email.retryOrFailHostNotificationEmailTask(stale.id, 0, 'late failure', old), false)
  assert.equal((await prisma.hostNotificationEmailTask.findUniqueOrThrow({ where: { id: stale.id } })).retryCount, 0)
  assert.equal(await email.retryOrFailHostNotificationEmailTask(stale.id, 0, 'current failure', newStart), true)
  assert.equal(await email.retryOrFailHostNotificationEmailTask(stale.id, 0, 'duplicate failure', newStart), false, 'duplicate completion cannot increment retry twice')
  await prisma.hostNotificationEmailTask.update({ where: { id: stale.id }, data: { status: 'PROCESSING', startedAt: new Date(now + 1) } })
  assert.equal(await email.markHostNotificationEmailTaskSent(stale.id, newStart, 0), false)
  assert.equal(await email.markHostNotificationEmailTaskSent(stale.id, new Date(now + 1), 1), true)
  await prisma.hostNotificationEmailTask.update({ where: { id: fresh.id }, data: { retryCount: 3 } })
  assert.equal(await email.retryOrFailHostNotificationEmailTask(fresh.id, 3, 'retry budget exhausted', newStart), true)
  assert.equal((await prisma.hostNotificationEmailTask.findUniqueOrThrow({ where: { id: fresh.id } })).status, 'FAILED')

  const instance = await prisma.instance.create({ data: { userId: user.id, hostId: host.id, name: tag, incusId: tag,
    image: 'fixture/debian', cpu: 100, memory: 1024, disk: 2048, status: 'stopped', updatedAt: old, lastSyncedAt: old } })
  const task = await prisma.instanceTask.create({ data: { userId: user.id, hostId: host.id, instanceId: instance.id,
    taskType: 'start', status: 'PROCESSING', startedAt: newStart, retryCount: 1 } })
  assert.equal(await finalizeInstanceTaskAttempt(task.id, { startedAt: old, retryCount: 1 }, 'COMPLETED'), false)
  assert.equal(await finalizeInstanceTaskAttempt(task.id, { startedAt: newStart, retryCount: 0 }, 'FAILED', 'old failure'), false)
  assert.equal(await finalizeInstanceTaskAttempt(task.id, { startedAt: null, retryCount: 1 }, 'COMPLETED'), false)
  assert.equal(await finalizeInstanceTaskAttempt(task.id, { startedAt: newStart, retryCount: 1 }, 'COMPLETED'), true)
  assert.equal(await finalizeInstanceTaskAttempt(task.id, { startedAt: newStart, retryCount: 1 }, 'FAILED', 'duplicate'), false)
  assert.equal((await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })).status, 'COMPLETED')
  const candidate = await prisma.instanceTask.create({ data: { userId: user.id, hostId: host.id, instanceId: instance.id,
    taskType: 'start', status: 'PROCESSING', startedAt: old, retryCount: 0 } })
  await prisma.instanceTask.update({ where: { id: candidate.id }, data: { startedAt: newStart, retryCount: 1 } })
  assert.equal(await failExpiredInstanceTaskAttempt(candidate, 'stale cleanup'), false, 'old candidate cannot fail a renewed attempt')
  const current = await prisma.instanceTask.findUniqueOrThrow({ where: { id: candidate.id } })
  assert.equal(await failExpiredInstanceTaskAttempt(current, 'fresh cleanup'), false, 'even current attempt needs timeout')
  await prisma.instanceTask.update({ where: { id: candidate.id }, data: { startedAt: null } })
  const missing = await prisma.instanceTask.findUniqueOrThrow({ where: { id: candidate.id } })
  assert.equal(await failExpiredInstanceTaskAttempt(missing, 'missing start'), true)
  assert.equal(await failExpiredInstanceTaskAttempt(missing, 'duplicate'), false)
  const heavy = await prisma.instanceTask.create({ data: { userId: user.id, hostId: host.id, instanceId: instance.id,
    taskType: 'rebuild', status: 'PROCESSING', startedAt: old } })
  assert.equal(await failExpiredInstanceTaskAttempt(heavy, 'heavy still allowed'), false, 'heavy attempt has 30min budget')
  await prisma.instanceTask.update({ where: { id: heavy.id }, data: { startedAt: new Date(now - 35 * 60000) } })
  assert.equal(await failExpiredInstanceTaskAttempt(await prisma.instanceTask.findUniqueOrThrow({ where: { id: heavy.id } }), 'heavy expired'), true)
  await prisma.instance.createMany({ data: Array.from({ length: 165 }, (_, i) => ({
    userId: user.id, hostId: host.id, name: `${tag}-${i}`, incusId: `${tag}-${i}`, image: 'fixture/debian', cpu: 100,
    memory: 1024, disk: 2048, status: 'running', lastSyncedAt: new Date(), updatedAt: new Date()
  })) })
  const due = await getInstancesToSync(50)
  assert.ok(due.some(row => row.id === instance.id), '165 recent rows cannot crowd out an overdue stopped instance')
  assert.ok(!due.some(row => row.hostId === host.id && row.id !== instance.id), 'recently synchronized running rows are filtered in the DB before take')
  console.log('PASS real PostgreSQL queue/sync: null-start timeout, current attempt preserved, stale mail/task finalization, retry budget and old due selection under 165 fresh rows')
} finally {
  await prisma.instance.deleteMany({ where: { hostId: host.id } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.delete({ where: { id: user.id } })
  await closePrismaDatabase()
}
process.exit(0)
