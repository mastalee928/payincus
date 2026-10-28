import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { claimLightTask, claimNextTask } = await import('../src/workers/instanceTaskWorker.js')
const { cancelInstanceTask } = await import('../src/db/instance-tasks.js')
const prefix = `claim-${randomUUID()}`
const user = await prisma.user.create({ data: { username: prefix, passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: user.id, name: prefix, url: 'https://127.0.0.1:1' } })
let number = 0
async function task(type: 'start' | 'rebuild' = 'start', instanceId?: number) {
  const instance = instanceId ? { id: instanceId } : await prisma.instance.create({ data: {
    userId: user.id, hostId: host.id, name: `${prefix}-${++number}`, incusId: `${prefix}-${number}`, image: 'fixture/debian',
    cpu: 100, memory: 1024, disk: 2048, status: 'stopped'
  } })
  return prisma.instanceTask.create({ data: { userId: user.id, hostId: host.id, instanceId: instance.id, taskType: type } })
}
try {
  const tasks = await Promise.all(Array.from({ length: 12 }, () => task()))
  for (const item of tasks) await claimLightTask(host.id, item.id)
  assert.equal(await prisma.instanceTask.count({ where: { hostId: host.id, status: 'PROCESSING' } }), 5, 'claim enforces current concurrency inside host lock')
  assert.equal(await claimNextTask(host.id), null, 'heavy claim must respect running light tasks')
  await prisma.instanceTask.deleteMany({ where: { hostId: host.id } })
  const one = await task()
  const same = await task('start', one.instanceId)
  assert.ok(await claimLightTask(host.id, one.id))
  assert.equal(await claimLightTask(host.id, same.id), null, 'same instance cannot have two processing light tasks after advisory lock releases')
  assert.equal(await cancelInstanceTask(one.id), null, 'claimed task cannot be cancelled')
  await prisma.instanceTask.deleteMany({ where: { hostId: host.id } })
  const cancelled = await task()
  assert.ok(await cancelInstanceTask(cancelled.id))
  assert.equal(await claimLightTask(host.id, cancelled.id), null)
  assert.equal((await prisma.instanceTask.findUniqueOrThrow({ where: { id: cancelled.id } })).status, 'FAILED')
  const wrongHost = await task()
  assert.equal(await claimLightTask(host.id + 100000, wrongHost.id), null, 'host binding is checked before claim')
  await prisma.instanceTask.deleteMany({ where: { hostId: host.id } })
  const heavy = await task('rebuild')
  assert.equal(await claimLightTask(host.id, heavy.id), null, 'heavy task cannot enter the light path')
  assert.ok(await claimNextTask(host.id))
  const light = await task()
  assert.equal(await claimLightTask(host.id, light.id), null)
  assert.equal(await claimNextTask(host.id), null)

  await prisma.instanceTask.deleteMany({ where: { hostId: host.id } })
  for (const type of ['start', 'rebuild'] as const) {
    const pending = await task(type)
    const operation = await prisma.autoSnapshotOperation.create({ data: { id: randomUUID(), instanceId: pending.instanceId,
      ownerId: user.id, hostId: host.id, incusId: 'fixture', identityHash: 'fixture', snapshotName: 'auto-' + randomUUID() } })
    assert.equal(type === 'start' ? await claimLightTask(host.id, pending.id) : await claimNextTask(host.id), null,
      'an unfinished automatic snapshot fences both light and heavy task claims')
    assert.equal((await prisma.instanceTask.findUniqueOrThrow({ where: { id: pending.id } })).status, 'PENDING')
    await prisma.autoSnapshotOperation.update({ where: { id: operation.id }, data: { state: 'succeeded' } })
    assert.ok(type === 'start' ? await claimLightTask(host.id, pending.id) : await claimNextTask(host.id))
    await prisma.instanceTask.delete({ where: { id: pending.id } })
  }
  console.log('PASS real PostgreSQL task claiming: five-light limit, same-instance exclusion, cancellation, host/type binding and heavy exclusivity')
} finally {
  await prisma.autoSnapshotOperation.deleteMany({ where: { hostId: host.id } })
  await prisma.instance.deleteMany({ where: { hostId: host.id } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.delete({ where: { id: user.id } })
  await closePrismaDatabase()
}
process.exit(0)
