import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Client } from 'pg'
import type { Prisma } from '@prisma/client'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use isolated local *_pool_test PostgreSQL')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { processAgentInstanceReport } = await import('../src/services/agent-instance-report.js')
const { rotateHostAgentCredentials } = await import('../src/lib/host-agent-credentials.js')
const { INSTANCE_OPERATION_LOCK_NAMESPACE } = await import('../src/db/advisory-locks.js')
const tag = `agent-identity-${randomUUID()}`
const owner = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
const recipient = await prisma.user.create({ data: { username: `${tag}-other`, passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: owner.id, name: tag, url: 'https://127.0.0.1:1' } })
const replacement = await prisma.host.create({ data: { userId: owner.id, name: `${tag}-replacement`, url: 'https://127.0.0.1:1' } })
const instance = await prisma.instance.create({ data: { userId: owner.id, hostId: host.id, incusId: tag, name: tag,
  image: 'fixture', cpu: 1, memory: 128, disk: 1, status: 'running', monthlyTrafficUsed: 100n } })
await prisma.userQuota.create({ data: { userId: owner.id, monthlyTrafficUsed: 1000n } })
await prisma.userQuota.create({ data: { userId: recipient.id, monthlyTrafficUsed: 2000n } })
const actor = { id: owner.id, sid: randomUUID(), iat: Math.floor(Date.now() / 1000) + 1 }
const { agent } = await rotateHostAgentCredentials(host.id, true, { actor })
const holder = new Client({ connectionString: database.href }), observer = new Client({ connectionString: database.href })
const initialSample = new Date('2026-01-01T00:00:00Z')
const payload = { reportedAt: new Date().toISOString(), items: [{ name: tag, status: 'running',
  traffic: { rxBytes: '30', txBytes: '40' }, network: { ipv4: '192.0.2.111' } }] }
const originalFindMany = prisma.instance.findMany.bind(prisma.instance)
const originalTransaction = prisma.$transaction.bind(prisma)
let afterLookup: (() => Promise<void>) | undefined
let afterStatus: (() => Promise<void>) | undefined
let beforeTraffic: (() => Promise<void>) | undefined
let transactionCount = 0, holderPid = 0, observedWaits = 0
let snapshotFailure = false
type TargetChange = 'owner' | 'host' | 'incus'
const changeData = (change: TargetChange): Prisma.InstanceUpdateInput => change === 'owner'
  ? { user: { connect: { id: recipient.id } } }
  : change === 'host' ? { host: { connect: { id: replacement.id } }, incusId: `${tag}-replacement` } : { incusId: `${tag}-renamed` }

prisma.instance.findMany = (async (...args: Parameters<typeof originalFindMany>) => {
  const rows = await originalFindMany(...args)
  const hook = afterLookup; afterLookup = undefined
  await hook?.()
  return rows
}) as typeof prisma.instance.findMany
prisma.$transaction = (async (input: Parameters<typeof originalTransaction>[0], options?: Parameters<typeof originalTransaction>[1]) => {
  if (typeof input !== 'function') return originalTransaction(input, options)
  const phase = ++transactionCount
  const hook = phase === 2 ? beforeTraffic : undefined
  if (hook) { beforeTraffic = undefined; await hook() }
  const pending = originalTransaction(async tx => {
    if (snapshotFailure && phase === 2) {
      // Fail the real database transaction after the shared baseline was updated.
      const originalUpsert = tx.dailyTraffic.upsert.bind(tx.dailyTraffic)
      tx.dailyTraffic.upsert = (async (...args: Parameters<typeof originalUpsert>) => {
        await originalUpsert(...args)
        throw new Error('review injected daily traffic transaction failure')
      }) as unknown as typeof tx.dailyTraffic.upsert
    }
    return input(tx)
  }, options)
  if (hook) {
    try {
      const deadline = Date.now() + 3500
      while (!(await observer.query('SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS waiting', [holderPid])).rows[0].waiting) {
        assert.ok(Date.now() < deadline, 'traffic write must wait on the actual lifecycle or instance row lock')
        await delay(10)
      }
      observedWaits++
      await holder.query('COMMIT')
    } catch (error) { await holder.query('ROLLBACK'); await pending.catch(() => {}); throw error }
  }
  const result = await pending
  if (phase === 1) { const hook = afterStatus; afterStatus = undefined; await hook?.() }
  return result
}) as typeof prisma.$transaction

const restore = async () => {
  transactionCount = 0; afterLookup = undefined; afterStatus = undefined; beforeTraffic = undefined; snapshotFailure = false
  await prisma.instance.update({ where: { id: instance.id }, data: { userId: owner.id, hostId: host.id, incusId: tag,
    status: 'running', ipv4: null, monthlyTrafficUsed: 100n, lastSyncedAt: null } })
  await prisma.trafficSnapshot.upsert({ where: { instanceId: instance.id }, create: { instanceId: instance.id, rxRaw: 10n, txRaw: 10n, updatedAt: initialSample },
    update: { rxRaw: 10n, txRaw: 10n, updatedAt: initialSample } })
  await prisma.dailyTraffic.deleteMany({ where: { instanceId: instance.id } })
  await prisma.userQuota.update({ where: { userId: owner.id }, data: { monthlyTrafficUsed: 1000n } })
  await prisma.userQuota.update({ where: { userId: recipient.id }, data: { monthlyTrafficUsed: 2000n } })
}
const assertAccountingUnchanged = async () => {
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).monthlyTrafficUsed, 100n)
  assert.equal((await prisma.userQuota.findUniqueOrThrow({ where: { userId: owner.id } })).monthlyTrafficUsed, 1000n)
  assert.equal((await prisma.userQuota.findUniqueOrThrow({ where: { userId: recipient.id } })).monthlyTrafficUsed, 2000n)
  const snapshot = await prisma.trafficSnapshot.findUniqueOrThrow({ where: { instanceId: instance.id } })
  assert.equal(snapshot.rxRaw, 10n); assert.equal(snapshot.txRaw, 10n); assert.equal(snapshot.updatedAt.getTime(), initialSample.getTime())
  assert.equal(await prisma.dailyTraffic.count({ where: { instanceId: instance.id } }), 0)
}
try {
  await holder.connect(); await observer.connect()
  holderPid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
  for (const phase of ['lookup', 'status'] as const) for (const change of ['owner', 'host', 'incus'] as const) {
    await restore()
    const mutate = async () => { await prisma.instance.update({ where: { id: instance.id }, data: changeData(change) }) }
    if (phase === 'lookup') afterLookup = mutate
    else afterStatus = mutate
    const result = await processAgentInstanceReport(host.id, payload, agent)
    assert.equal(result.errors, 0)
    assert.equal(result.statusUpdated, phase === 'lookup' ? 0 : 1, `${phase}/${change}: stale status rejected`)
    assert.equal(result.trafficUpdated, 0, `${phase}/${change}: stale traffic rejected`)
    await assertAccountingUnchanged()
    if (phase === 'lookup') assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).ipv4, null)
  }
  for (const kind of ['lifecycle', 'instance'] as const) for (const change of ['owner', 'host', 'incus'] as const) {
    await restore()
    beforeTraffic = async () => {
      await holder.query('BEGIN')
      if (kind === 'lifecycle') await holder.query('SELECT pg_advisory_xact_lock($1, $2)', [INSTANCE_OPERATION_LOCK_NAMESPACE, instance.id])
      await holder.query('SELECT id FROM instances WHERE id = $1 FOR UPDATE', [instance.id])
      if (change === 'owner') await holder.query('UPDATE instances SET user_id = $2 WHERE id = $1', [instance.id, recipient.id])
      else if (change === 'host') await holder.query('UPDATE instances SET host_id = $2, incus_id = $3 WHERE id = $1', [instance.id, replacement.id, `${tag}-replacement`])
      else await holder.query('UPDATE instances SET incus_id = $2 WHERE id = $1', [instance.id, `${tag}-renamed`])
    }
    const result = await processAgentInstanceReport(host.id, payload, agent)
    assert.equal(result.errors, 0, `${kind}/${change}: no deadlock or report error`)
    assert.equal(result.trafficUpdated, 0, `${kind}/${change}: identity rechecked after lock wait`)
    await assertAccountingUnchanged()
  }
  assert.equal(observedWaits, 6)
  await restore()
  const accepted = await processAgentInstanceReport(host.id, payload, agent)
  assert.equal(accepted.statusUpdated, 1); assert.equal(accepted.trafficUpdated, 1); assert.equal(accepted.trafficDeltaBytes, '50')
  const concurrent = await Promise.all(Array.from({ length: 4 }, () => processAgentInstanceReport(host.id, payload, agent)))
  assert.ok(concurrent.every(result => result.errors === 0 && result.trafficDeltaBytes === '0'))
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).monthlyTrafficUsed, 150n)
  assert.equal((await prisma.userQuota.findUniqueOrThrow({ where: { userId: owner.id } })).monthlyTrafficUsed, 1050n)
  assert.equal((await prisma.userQuota.findUniqueOrThrow({ where: { userId: recipient.id } })).monthlyTrafficUsed, 2000n)
  const daily = await prisma.dailyTraffic.findFirstOrThrow({ where: { instanceId: instance.id } })
  assert.equal(daily.rxTotal, 20n); assert.equal(daily.txTotal, 30n)
  await restore(); snapshotFailure = true
  const failed = await processAgentInstanceReport(host.id, payload, agent)
  assert.equal(failed.errors, 1); assert.equal(failed.trafficUpdated, 0)
  await assertAccountingUnchanged()
  console.log('PASS actual Agent report/PostgreSQL: owner/host/Incus changes after lookup/status, six real advisory/row-lock waits, normal and four concurrent reports, accounting rollback; no remote host operations')
} finally {
  prisma.instance.findMany = originalFindMany; prisma.$transaction = originalTransaction
  await holder.query('ROLLBACK').catch(() => {}); await holder.end(); await observer.end()
  await prisma.instance.delete({ where: { id: instance.id } })
  await prisma.host.deleteMany({ where: { id: { in: [host.id, replacement.id] } } })
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, recipient.id] } } })
  await closePrismaDatabase()
}
process.exit(0)
