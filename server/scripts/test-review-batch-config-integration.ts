import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mock } from 'node:test'
import Fastify from 'fastify'
import { Client } from 'pg'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use isolated local *_pool_test database')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/batch-config.js')
const { withBatchInstanceMutation } = await import('../src/db/batch-config-mutations.js')
const { advisoryTransactionLock, INSTANCE_OPERATION_LOCK_NAMESPACE } = await import('../src/db/advisory-locks.js')
const { IncusClient } = await import('../src/lib/incus/incus-client.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const tag = randomUUID().replaceAll('-', '')
const userIds: number[] = []
const hostIds: number[] = []
const instanceIds: number[] = []
const session = { sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
const app = Fastify()
let currentActor: { id: number; username: string; role: string; sid: string; iat: number }
let afterAuthentication: (() => Promise<unknown>) | undefined
let afterSelection: (() => Promise<unknown>) | undefined
app.decorate('authenticate', async (request: any) => { request.user = { ...currentActor }; await afterAuthentication?.() })
const remote = new Map<string, { config: Record<string, unknown>; devices: Record<string, Record<string, string>> }>()
let beforeRemote: ((method: string, path: string) => Promise<void>) | undefined
let failRemotePut = false
let connectionFailures = 0
const mutations: string[] = []
const originalQuery = Client.prototype.query
mock.method(Client.prototype, 'query', function (this: Client, ...args: any[]) {
  const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text || ''
  const action = afterSelection
  const callbackIndex = args.findIndex(arg => typeof arg === 'function')
  if (action && /FROM "public"\."instances"/.test(sql) && /"id" IN/.test(sql) && callbackIndex >= 0) {
    afterSelection = undefined
    const callback = args[callbackIndex]
    args[callbackIndex] = (error: Error | null, result: unknown) => {
      if (error) return callback(error, result)
      action().then(() => callback(null, result), failure => callback(failure))
    }
  }
  return Reflect.apply(originalQuery, this, args)
})
mock.method(IncusClient.prototype, 'connect', async function (this: InstanceType<typeof IncusClient>) {
  if (connectionFailures-- > 0) throw new Error('ECONNRESET fixture connection')
  this.connected = true
  return {}
})
mock.method(IncusClient.prototype, 'request', async (method: string, path: string, body: any, timeout: number) => {
  assert.ok(timeout > 0 && timeout <= 90000, 'remote calls must fit inside the transaction budget')
  await beforeRemote?.(method, path)
  const name = path.split('/').at(-1)!
  const state = remote.get(name)
  if (!state) throw new Error('fixture remote target does not exist')
  if (method === 'GET') return structuredClone(state)
  mutations.push(`${method}:${name}`)
  if (method === 'PUT' && failRemotePut) throw new Error('fixture advanced update rejected')
  if (body.config) state.config = { ...state.config, ...body.config }
  if (body.devices) state.devices = method === 'PUT' ? structuredClone(body.devices) : { ...state.devices, ...structuredClone(body.devices) }
  return {}
})

const makeUser = async (label: string, role: 'admin' | 'user' = 'user') => {
  const user = await prisma.user.create({ data: { username: `batch-${tag}-${label}`, passwordHash: 'unusable-fixture', role } })
  userIds.push(user.id)
  return user
}
const submit = (hostId: number, ids: number[], config: Record<string, unknown>) => app.inject({ method: 'POST',
  url: `/hosts/${hostId}/instances/batch-config`, payload: { instanceIds: ids, config } })
const trigger = `review_batch_${tag}`
let triggerInstalled = false
try {
  const admin = await makeUser('admin', 'admin')
  const owner = await makeUser('owner')
  const buyer = await makeUser('buyer')
  const other = await makeUser('other')
  currentActor = { ...session, id: admin.id, username: admin.username, role: 'admin' }
  const host = await prisma.host.create({ data: { userId: owner.id, name: tag, url: 'https://127.0.0.1:1', status: 'online',
    singleTenant: true, cpuAllowanceMax: 1000, memoryMax: 4096, customerDiskGiB: 8,
    cpuUsed: 100, memoryUsed: 512, diskUsed: 1024 } })
  hostIds.push(host.id)
  const instance = await prisma.instance.create({ data: { userId: buyer.id, hostId: host.id, name: tag, incusId: `batch-${tag}`,
    image: 'fixture', status: 'running', dedicatedIpv4: true, dedicatedNetworkReady: true,
    ipv4: '10.0.0.2', ipv6: '2001:db8::2', cpu: 100, memory: 512, disk: 1024, swapSize: 128 } })
  instanceIds.push(instance.id)
  remote.set(instance.incusId, { config: {}, devices: {
    root: { type: 'disk', path: '/', pool: 'fixture', size: '1024MB' },
    eth0: { type: 'nic', name: 'eth0', network: 'fixture' },
    eth1: { type: 'nic', nictype: 'routed', name: 'eth1', 'ipv6.address': '2001:db8::2' },
    'proxy-tcp-22': { type: 'proxy', listen: 'tcp:192.0.2.1:22', connect: 'tcp:10.0.0.2:22' }
  } })
  await app.register(routes, { prefix: '/hosts' })

  for (const change of [
    () => prisma.user.update({ where: { id: admin.id }, data: { status: 'banned' } }),
    () => prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } }),
    () => prisma.tokenInvalidation.create({ data: { userId: admin.id, sessionId: session.sid, invalidatedAt: session.iat } }),
  ]) {
    afterAuthentication = change
    const denied = await submit(host.id, [instance.id], { snapshotLimit: 8 })
    assert.equal(denied.statusCode, 200, denied.body)
    assert.equal(denied.json().failedCount, 1)
    assert.match(denied.json().failedItems[0].error, /FORBIDDEN/)
    assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).snapshotLimit, null)
    afterAuthentication = undefined
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin', status: 'active' } })
    await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } })
  }
  assert.equal(mutations.length, 0)

  currentActor = { ...session, id: owner.id, username: owner.username, role: 'user' }
  assert.equal((await submit(host.id, [instance.id], { swapSize: 512 })).statusCode, 403)
  afterAuthentication = () => prisma.host.update({ where: { id: host.id }, data: { userId: other.id } })
  assert.equal((await submit(host.id, [instance.id], { snapshotLimit: 8 })).statusCode, 403)
  afterAuthentication = undefined
  await prisma.host.update({ where: { id: host.id }, data: { userId: owner.id } })
  assert.equal((await submit(host.id, [instance.id], { snapshotLimit: 8 })).json().successCount, 1)
  currentActor = { ...session, id: admin.id, username: admin.username, role: 'admin' }

  // A previously selected target may be transferred before the queue reaches it.
  await prisma.instance.update({ where: { id: instance.id }, data: { userId: other.id } })
  await assert.rejects(withBatchInstanceMutation(instance, currentActor, false, async () => { throw new Error('must not run') }), /TARGET_CHANGED/)
  await prisma.instance.update({ where: { id: instance.id }, data: { userId: buyer.id } })
  afterSelection = () => prisma.instance.update({ where: { id: instance.id }, data: { userId: other.id } })
  const transferredAfterSelection = await submit(host.id, [instance.id], { snapshotLimit: 9 })
  assert.match(transferredAfterSelection.json().failedItems[0].error, /TARGET_CHANGED/)
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).snapshotLimit, 8)
  await prisma.instance.update({ where: { id: instance.id }, data: { userId: buyer.id } })
  for (const data of [
    { status: 'error' as const }, { status: 'suspended' as const }, { provisioningCleanupPending: true },
    { deletionBillingPending: true }, { dedicatedNetworkReady: false }, { expiresAt: new Date(1) }
  ]) {
    await prisma.instance.update({ where: { id: instance.id }, data })
    const denied = await submit(host.id, [instance.id], { snapshotLimit: 9 })
    assert.equal(denied.json().failedCount, 1)
    assert.match(denied.json().failedItems[0].error, /INSTANCE_NOT_READY/)
    await prisma.instance.update({ where: { id: instance.id }, data: { status: 'running', provisioningCleanupPending: false,
      deletionBillingPending: false, dedicatedNetworkReady: true, expiresAt: null } })
  }
  const pending = await prisma.instanceTransfer.create({ data: { instanceId: instance.id, fromUserId: buyer.id, toUserId: other.id, snapshot: {} } })
  assert.match((await submit(host.id, [instance.id], { snapshotLimit: 9 })).json().failedItems[0].error, /INSTANCE_BUSY/)
  await prisma.instanceTransfer.delete({ where: { id: pending.id } })
  const task = await prisma.instanceTask.create({ data: { instanceId: instance.id, hostId: host.id, userId: buyer.id, taskType: 'restart' } })
  assert.match((await submit(host.id, [instance.id], { snapshotLimit: 9 })).json().failedItems[0].error, /INSTANCE_BUSY/)
  await prisma.instanceTask.delete({ where: { id: task.id } })

  // A real shared advisory lock rejects a second operation without remote writes.
  let release!: () => void
  let acquired!: () => void
  const acquiredSignal = new Promise<void>(resolve => { acquired = resolve })
  const blocked = prisma.$transaction(async tx => {
    await advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instance.id)
    acquired()
    await new Promise<void>(resolve => { release = resolve })
  }, { timeout: 10000 })
  await acquiredSignal
  try {
    const before = mutations.length
    const busy = await submit(host.id, [instance.id], { cpu: 150 })
    assert.match(busy.json().failedItems[0].error, /BATCH_CONFIG_BUSY/)
    assert.deepEqual(busy.json().retryPayload.instanceIds, [instance.id])
    assert.equal(mutations.length, before)
  } finally { release(); await blocked }

  // Failed connection can be retried, and the retry reads current state afresh.
  connectionFailures = 1
  assert.equal((await submit(host.id, [instance.id], { cpu: 200, memory: 768, disk: 2048, swapEnabled: true,
    swapSize: 256, limitsProcesses: 800, limitsRead: '10MB', portLimit: 7, siteLimit: 3, monthlyTrafficLimit: '12345' })).json().successCount, 1)
  const updated = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
  const used = await prisma.host.findUniqueOrThrow({ where: { id: host.id } })
  assert.equal(updated.cpu, 200); assert.equal(updated.memory, 768); assert.equal(updated.disk, 2048)
  assert.equal(updated.swapSize, 256); assert.equal(updated.swapEnabled, true); assert.equal(updated.limitsProcesses, 800)
  assert.equal(updated.portLimit, 7); assert.equal(updated.siteLimit, 3); assert.equal(updated.monthlyTrafficLimit, 12345n)
  assert.deepEqual([used.cpuUsed, used.memoryUsed, used.diskUsed], [200, 768, 2048])
  assert.equal((await submit(host.id, [instance.id], { cpu: 200, memory: 768, disk: 2048 })).json().successCount, 1)
  assert.deepEqual((({ cpuUsed, memoryUsed, diskUsed }) => [cpuUsed, memoryUsed, diskUsed])(await prisma.host.findUniqueOrThrow({ where: { id: host.id } })), [200, 768, 2048])
  for (const key of ['hostId', 'incusId', 'userId', 'dedicatedIpv4', 'dedicatedNetworkReady', 'ipv4', 'ipv6', 'billingPrice', 'expiresAt'] as const) assert.deepEqual(updated[key], instance[key])
  assert.ok(remote.get(instance.incusId)!.devices.eth1)
  assert.ok(remote.get(instance.incusId)!.devices['proxy-tcp-22'])

  const beforeFailure = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
  failRemotePut = true
  const partial = await submit(host.id, [instance.id], { cpu: 300, limitsProcesses: 900, snapshotLimit: 15 })
  assert.equal(partial.json().failedCount, 1)
  assert.equal(partial.json().failedItems[0].requiresReview, true)
  assert.equal(partial.json().retryPayload, undefined)
  assert.match(partial.json().failedItems[0].error, /远端配置可能已变更/)
  assert.deepEqual(await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } }), beforeFailure)
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).cpuUsed, 200)
  assert.equal(remote.get(instance.incusId)!.config['limits.cpu.allowance'], '300%')
  assert.ok(await prisma.log.findFirst({ where: { instanceId: instance.id, action: 'instance.batch_config_failed', content: { contains: 'remote_advanced' } } }))
  failRemotePut = false

  // A host accounting failure rolls all instance DB fields back; it cannot
  // undo a remote patch, so the API must retain a durable review error.
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = ${host.id} AND NEW.cpu_used <> OLD.cpu_used THEN RAISE EXCEPTION 'fixture-host-accounting-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON hosts FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  triggerInstalled = true
  const failedCommit = await submit(host.id, [instance.id], { cpu: 350, memory: 900, backupLimit: 18, limitsProcesses: 950 })
  assert.equal(failedCommit.json().failedItems[0].requiresReview, true)
  assert.match(failedCommit.json().failedItems[0].error, /database_commit/)
  assert.deepEqual(await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } }), beforeFailure)
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).cpuUsed, 200)
  assert.ok(await prisma.log.findFirst({ where: { instanceId: instance.id, action: 'instance.batch_config_failed', content: { contains: 'database_commit' } } }))
  await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON hosts`)
  await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
  triggerInstalled = false

  // During the actual remote mutation the shared operation lock stays held.
  beforeRemote = async (method) => {
    if (method !== 'PATCH') return
    const free = await prisma.$transaction(async tx => {
      const row = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(${INSTANCE_OPERATION_LOCK_NAMESPACE}, ${instance.id}) AS locked`
      return row[0]?.locked
    })
    assert.equal(free, false)
  }
  assert.equal((await submit(host.id, [instance.id], { cpu: 400 })).json().successCount, 1)
  beforeRemote = undefined
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).cpuUsed, 400)

  let remoteEntered!: () => void
  let remoteRelease!: () => void
  const remoteEnteredSignal = new Promise<void>(resolve => { remoteEntered = resolve })
  beforeRemote = async method => {
    if (method !== 'PATCH') return
    beforeRemote = undefined
    remoteEntered()
    await new Promise<void>(resolve => { remoteRelease = resolve })
  }
  const firstBatch = submit(host.id, [instance.id], { cpu: 500 })
  await remoteEnteredSignal
  try {
    const startedAt = Date.now()
    const overlap = await submit(host.id, [instance.id], { cpu: 600 })
    assert.equal(overlap.json().failedCount, 1)
    assert.match(overlap.json().failedItems[0].error, /BATCH_CONFIG_BUSY/)
    assert.ok(Date.now() - startedAt < 5000, 'a conflicting request including its audit must return within a bounded wait')
    assert.ok(!overlap.json().failedItems[0].error.includes('未能持久化'))
    assert.ok(await prisma.log.findFirst({ where: { userId: null, instanceId: null, action: 'instance.batch_config_failed',
      content: { contains: `instance #${instance.id} (${instance.incusId})` } } }), 'busy result persists even while account/instance FK targets are locked')
  } finally { remoteRelease() }
  assert.equal((await firstBatch).json().successCount, 1)
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).cpuUsed, 500)
  assert.equal((await submit(host.id, [instance.id], { cpu: 600 })).json().successCount, 1)
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).cpuUsed, 600, 'retry uses fresh 500 CPU baseline, not the stale selected snapshot')
  console.log('Batch configuration integration passed: current actor/session/host ownership, original target identity, readiness/tasks/transfer gates, shared lock, bounded retry, atomic fields/accounting, dedicated network preservation and durable partial-remote errors')
} finally {
  afterAuthentication = undefined
  afterSelection = undefined
  beforeRemote = undefined
  if (triggerInstalled) {
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON hosts`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
  }
  await app.close()
  await closeAllClients()
  mock.restoreAll()
  await prisma.log.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.log.deleteMany({ where: { userId: null, action: { in: ['instance.batch_config_failed', 'instance.batch_config'] }, content: { contains: tag } } })
  await prisma.instance.deleteMany({ where: { id: { in: instanceIds } } })
  await prisma.host.deleteMany({ where: { id: { in: hostIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await closePrismaDatabase()
}
process.exit(0)
