import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { mock } from 'node:test'
import type { Prisma } from '@prisma/client'
import Fastify from 'fastify'
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/instances.js')
const { default: batchRoutes } = await import('../src/routes/batch-config.js')
const { boostInstanceProcessesAuthorized: boost } = await import('../src/db/instance-process-boost.js')
const { getInstanceById } = await import('../src/db/instances.js')
const { getHostById } = await import('../src/db/hosts.js')
const { IncusClient } = await import('../src/lib/incus/incus-client.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const { stopSessionCleanup } = await import('../src/lib/terminal-proxy.js')
const tag = 'process-boost-' + randomUUID()
const admin = await prisma.user.create({ data: { username: tag, role: 'admin', passwordHash: 'unusable-fixture' } })
const owner = await prisma.user.create({ data: { username: tag + '-owner', passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: owner.id, name: tag, url: 'https://127.0.0.1:1' } })
const pkg = await prisma.package.create({ data: { userId: owner.id, name: tag, cpuMax: 1000, memoryMax: 4096, diskMax: 8192 } })
const instance = await prisma.instance.create({ data: { userId: owner.id, hostId: host.id, name: tag, incusId: tag,
  packageId: pkg.id, image: 'fixture/debian', status: 'running', cpu: 100, memory: 512, disk: 1024, limitsProcesses: null } })
const actor = { id: admin.id, username: admin.username, role: 'admin', sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
const app = Fastify()
let afterAuth: (() => Promise<unknown>) | undefined
app.decorate('authenticate', async (request: any) => { request.user = { ...actor }; await afterAuth?.() })
app.decorate('authenticateAdmin', app.authenticate)
app.decorate('authenticateUser', app.authenticate)
const state = { config: { 'limits.processes': '500', keep: 'unchanged' }, devices: { eth0: { type: 'nic', name: 'eth0' } } }
let rejectWrite = false, beforeWrite: (() => Promise<void>) | undefined, writes = 0
mock.method(IncusClient.prototype, 'connect', async function (this: InstanceType<typeof IncusClient>) { this.connected = true; return {} })
mock.method(IncusClient.prototype, 'request', async (method: string, path: string, body: any) => {
  assert.equal(path, `/1.0/instances/${tag}`)
  if (method === 'GET') return structuredClone(state)
  assert.equal(method, 'PUT'); writes++; await beforeWrite?.()
  if (rejectWrite) throw Error('controlled process PUT failure')
  Object.assign(state.config, body.config); return {}
})
const submit = () => app.inject({ method: 'POST', url: `/instances/${instance.id}/boost-processes`, payload: {} })
const submitBatch = (limit: number) => app.inject({ method: 'POST', url: `/hosts/${host.id}/instances/batch-config`,
  payload: { instanceIds: [instance.id], config: { limitsProcesses: limit } } })
const snapshot = async () => ({ expected: (await getInstanceById(instance.id))!, originalHost: (await getHostById(host.id))! })
const originalTransaction = prisma.$transaction
async function reset(limit: number | null = null) {
  afterAuth = undefined; beforeWrite = undefined; rejectWrite = false; writes = 0; state.config['limits.processes'] = String(limit ?? 500)
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin', status: 'active' } })
  await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } })
  await prisma.instanceTransfer.deleteMany({ where: { instanceId: instance.id } })
  await prisma.autoSnapshotOperation.deleteMany({ where: { instanceId: instance.id } })
  await prisma.proxySiteOperation.deleteMany({ where: { instanceId: instance.id } })
  await prisma.host.update({ where: { id: host.id }, data: { userId: owner.id, url: host.url, createdAt: host.createdAt } })
  await prisma.package.update({ where: { id: pkg.id }, data: { instanceType: 'container' } })
  await prisma.instance.update({ where: { id: instance.id }, data: { userId: owner.id, incusId: tag, createdAt: instance.createdAt,
    limitsProcesses: limit, status: 'running', provisioningCleanupPending: false, deletionBillingPending: false, expiresAt: null } })
}
let failure: unknown
try {
  await app.register(routes, { prefix: '/instances' })
  await app.register(batchRoutes, { prefix: '/hosts' })
  for (const previous of [null, 650]) {
    await reset(previous); rejectWrite = true
    const failed = await submit(); assert.equal(failed.statusCode, 500)
    assert.equal(failed.json().code, 'PROCESS_LIMIT_BOOST_PARTIAL_FAILURE')
    assert.equal(failed.json().details.previousDatabaseLimit, previous)
    assert.equal(failed.json().details.databaseLimit, previous)
    assert.equal(failed.json().details.incusLimitApplied, 'unknown')
    assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).limitsProcesses, previous)
    rejectWrite = false
    const retry = await submit(); assert.equal(retry.statusCode, 200); assert.equal(retry.json().newLimit, 1000)
    assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).limitsProcesses, 1000)
    assert.equal(state.config['limits.processes'], '1000')
    const count = writes
    assert.equal((await submit()).statusCode, 400); assert.equal(writes, count)
  }
  await reset(1200); await prisma.package.update({ where: { id: pkg.id }, data: { instanceType: 'vm' } })
  assert.equal((await submit()).json().newLimit, 2000)
  assert.equal(state.config.keep, 'unchanged'); assert.deepEqual(state.devices, { eth0: { type: 'nic', name: 'eth0' } })
  console.log('PASS null and explicit limits survive failure; retry, container/vm caps and unrelated configuration remain correct')
  for (const kind of ['demoted', 'banned', 'session', 'all-sessions']) {
    await reset()
    afterAuth = async () => {
      if (kind === 'demoted') await prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
      else if (kind === 'banned') await prisma.user.update({ where: { id: admin.id }, data: { status: 'banned' } })
      else await prisma.tokenInvalidation.create({ data: { userId: admin.id,
        sessionId: kind === 'session' ? actor.sid : '__USER_LEVEL__', invalidatedAt: actor.iat } })
    }
    const denied = await submit(); afterAuth = undefined
    assert.equal(denied.statusCode, 403, kind); assert.equal(writes, 0)
    assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).limitsProcesses, null)
  }
  console.log('PASS Fastify route rejects current role/status/session revocation with zero remote writes')
  const mutations: Record<string, (tx: Prisma.TransactionClient) => Promise<unknown>> = {
    owner: tx => tx.instance.update({ where: { id: instance.id }, data: { userId: admin.id } }),
    identity: tx => tx.instance.update({ where: { id: instance.id }, data: { incusId: tag + '-changed' } }),
    recreated: tx => tx.instance.update({ where: { id: instance.id }, data: { createdAt: new Date(instance.createdAt.getTime() + 1000) } }),
    hostOwner: tx => tx.host.update({ where: { id: host.id }, data: { userId: admin.id } }),
    hostAddress: tx => tx.host.update({ where: { id: host.id }, data: { url: host.url + '/changed' } }),
    hostRecreated: tx => tx.host.update({ where: { id: host.id }, data: { createdAt: new Date(host.createdAt.getTime() + 1000) } }),
    demoted: tx => tx.user.update({ where: { id: admin.id }, data: { role: 'user' } }),
    session: async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${admin.id} FOR UPDATE`
      return tx.tokenInvalidation.create({ data: { userId: admin.id, sessionId: actor.sid, invalidatedAt: actor.iat } })
    }
  }
  for (const [name, mutate] of Object.entries(mutations)) {
    await reset(); const target = await snapshot()
    let release!: () => void, ready!: (pid: number) => void
    const held = new Promise<void>(resolve => { release = resolve }), entered = new Promise<number>(resolve => { ready = resolve })
    const blocker = prisma.$transaction(async tx => {
      await mutate(tx); const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
      ready(row.pid); await held
    }, { timeout: 10000 })
    const pid = await entered
    const pending = boost(target.expected, target.originalHost, actor).then(() => 'accepted', () => 'rejected')
    try {
      let blocked = false
      for (const until = Date.now() + 800; Date.now() < until;) {
        const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`
        if (Number(row.count)) { blocked = true; break }; await delay(10)
      }
      assert.equal(blocked, true, name + ' must wait on the actual PostgreSQL lock')
    } finally { release(); await blocker }
    assert.equal(await pending, 'rejected', name); assert.equal(writes, 0)
  }
  console.log('PASS eight actual PostgreSQL identity/account lock competitors reject stale targets before dispatch')
  for (const kind of ['creating', 'expired', 'cleanup', 'transfer', 'snapshot', 'proxy']) {
    await reset()
    if (kind === 'creating') await prisma.instance.update({ where: { id: instance.id }, data: { status: 'creating' } })
    if (kind === 'expired') await prisma.instance.update({ where: { id: instance.id }, data: { expiresAt: new Date(0) } })
    if (kind === 'cleanup') await prisma.instance.update({ where: { id: instance.id }, data: { provisioningCleanupPending: true } })
    if (kind === 'transfer') await prisma.instanceTransfer.create({ data: { instanceId: instance.id, fromUserId: owner.id, toUserId: admin.id, snapshot: {} } })
    if (kind === 'snapshot') await prisma.autoSnapshotOperation.create({ data: { id: randomUUID(), instanceId: instance.id,
      ownerId: owner.id, hostId: host.id, incusId: tag, identityHash: tag, snapshotName: tag } })
    if (kind === 'proxy') await prisma.proxySiteOperation.create({ data: { id: randomUUID(), siteId: 0, siteKey: randomUUID(),
      instanceId: instance.id, hostId: host.id, ownerId: owner.id, actorId: admin.id, actorSid: actor.sid, actorIat: actor.iat,
      authority: 'admin', identityHash: tag, incusId: tag, revision: 1, action: 'upsert', desiredConfig: {}, requestHash: tag } })
    assert.equal((await submit()).statusCode, 409, kind); assert.equal(writes, 0)
  }
  console.log('PASS busy, expired, cleanup, transfer, snapshot and proxy operations block process changes')
  for (const firstFails of [false, true]) {
  await reset(); rejectWrite = firstFails
  let release!: () => void, ready!: () => void
  const held = new Promise<void>(resolve => { release = resolve }), entered = new Promise<void>(resolve => { ready = resolve })
  beforeWrite = async () => { ready(); await held }
  const first = submit(); void first.then(() => {})
  await entered
  try {
    const started = Date.now(), busy = await submit()
    assert.equal(busy.statusCode, 409); assert.ok(Date.now() - started < 2000, 'busy audit must not wait on the first operation')
    const batchStarted = Date.now(), batchBusy = await submitBatch(700)
    assert.equal(batchBusy.json().failedCount, 1); assert.ok(Date.now() - batchStarted < 3000)
    assert.equal(writes, 1)
  } finally { release() }
  assert.equal((await first).statusCode, firstFails ? 500 : 200); beforeWrite = undefined; rejectWrite = false
  assert.equal((await submitBatch(700)).json().successCount, 1)
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).limitsProcesses, 700)
  assert.equal(state.config['limits.processes'], '700')
  }
  console.log('PASS concurrent boost/batch requests are fenced, busy responses return promptly and subsequent configuration wins')
  await reset(650)
  let callbackFinished = false, commitFailure: unknown
  prisma.$transaction = (async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) =>
    originalTransaction.call(prisma, async tx => {
      const result = await callback(tx)
      await tx.$executeRawUnsafe('CREATE TEMP TABLE boost_commit_parent (id INTEGER PRIMARY KEY) ON COMMIT DROP')
      await tx.$executeRawUnsafe('CREATE TEMP TABLE boost_commit_failure (id INTEGER REFERENCES boost_commit_parent(id) DEFERRABLE INITIALLY DEFERRED) ON COMMIT DROP')
      await tx.$executeRawUnsafe('INSERT INTO boost_commit_failure(id) VALUES (-1)')
      callbackFinished = true; return result
    }, options).catch(error => { commitFailure = error; throw error })) as typeof prisma.$transaction
  const failedCommit = await submit(); prisma.$transaction = originalTransaction
  assert.equal(callbackFinished, true); assert.match(String(commitFailure), /foreign key|constraint/i)
  assert.equal(failedCommit.statusCode, 500); assert.equal(failedCommit.json().code, 'PROCESS_LIMIT_BOOST_PARTIAL_FAILURE')
  assert.equal(failedCommit.json().details.databaseLimit, 650); assert.equal(state.config['limits.processes'], '1000')
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).limitsProcesses, 650)
  assert.ok(await prisma.log.findFirst({ where: { action: 'instance.boost_processes', result: 'failed', content: { contains: `instance #${instance.id}:` } } }))
  console.log('PASS real deferred-constraint COMMIT failure retains old DB value and reports remote uncertainty with durable failed audit')
} catch (error) { failure = error }
finally {
  prisma.$transaction = originalTransaction; afterAuth = undefined; beforeWrite = undefined
  mock.restoreAll(); await app.close(); await closeAllClients(); stopSessionCleanup()
  await prisma.log.deleteMany({ where: { OR: [{ userId: { in: [admin.id, owner.id] } },
    { action: 'instance.boost_processes', content: { contains: `instance #${instance.id}:` } },
    { action: 'instance.batch_config_failed', content: { contains: `instance #${instance.id} (` } }] } })
  await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } })
  await prisma.instanceTransfer.deleteMany({ where: { instanceId: instance.id } })
  await prisma.autoSnapshotOperation.deleteMany({ where: { instanceId: instance.id } })
  await prisma.proxySiteOperation.deleteMany({ where: { instanceId: instance.id } })
  await prisma.instance.delete({ where: { id: instance.id } }); await prisma.package.delete({ where: { id: pkg.id } })
  await prisma.host.delete({ where: { id: host.id } }); await prisma.user.deleteMany({ where: { id: { in: [admin.id, owner.id] } } })
  await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }; process.exit(0)
