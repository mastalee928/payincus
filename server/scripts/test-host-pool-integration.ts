/** Run only against an isolated PostgreSQL database with the pool migration applied. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'

const url = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.pathname.endsWith('_pool_test'), 'Use a dedicated local *_pool_test database')
process.env.JWT_SECRET ||= 'pool-integration-test-only-secret'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { deleteHost, selectAndReserveHostWithLock } = await import('../src/db/hosts.js')
const { upsertPoolPrice, upsertPoolPrices, deletePoolPrice, poolInventory, publicPoolCatalog } = await import('../src/services/host-pool-prices.js')
const { lockHostGroups } = await import('../src/services/host-groups.js')
const { checkPackageSoldOut, checkPackagesSoldOut } = await import('../src/db/packages.js')
const { placePoolOrder, getPoolOrderResult } = await import('../src/services/pool-orders.js')
const { compensateFailedInstancePurchase } = await import('../src/db/instance-provisioning-compensation.js')
const { default: inventoryRoutes } = await import('../src/routes/host-inventory.js')
const { default: orderRoutes } = await import('../src/routes/pool-orders.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')

const prefix = `pool-test-${randomUUID().slice(0, 8)}`
const owner = await prisma.user.create({ data: { username: `${prefix}-admin`, passwordHash: 'unusable-test-hash', role: 'admin' } })
const buyer = await prisma.user.create({ data: { username: `${prefix}-buyer`, passwordHash: 'unusable-test-hash', balance: 1000 } })
const other = await prisma.user.create({ data: { username: `${prefix}-other`, passwordHash: 'unusable-test-hash', balance: 1000 } })
const group = await prisma.hostMachineGroup.create({ data: { name: prefix } })
const region = await prisma.hostRegionGroup.create({ data: { machineGroupId: group.id, name: 'Test region', countryCode: 'us' } })
const systemImage = await prisma.systemImage.create({ data: { name: prefix, remoteAlias: `${prefix}/debian`, architecture: 'x86_64', instanceType: 'container', icon: 'debian' } })
const priceInput = { machineGroupId: group.id, regionGroupId: region.id, resourcePreset: 'E2' as const, diskGiB: 30, monthlyPrice: 1000, setupFee: 200 }
const price = (await upsertPoolPrice(priceInput, owner.id)).price
let hostSequence = 0
async function host(diskGiB = 30, extra: Record<string, unknown> = {}) {
  const machine = await prisma.host.create({ data: { userId: owner.id, name: `${prefix}-${++hostSequence}`, url: 'https://127.0.0.1:1',
    singleTenant: true, machineGroupId: group.id, regionGroupId: region.id, resourcePreset: 'E2', customerDiskGiB: diskGiB,
    status: 'online', isInstalled: true, architecture: 'x86_64', cpuAllowanceMax: 200, memoryMax: 768, storageSize: diskGiB + 8,
    natPublicIp: `192.0.2.${hostSequence}`, natPortStart: 20000, natPortEnd: 30000, ...extra } })
  await prisma.storagePool.create({ data: { hostId: machine.id, name: 'test', driver: 'btrfs', purpose: 'instance_data' } })
  return machine
}
const instanceData = (hostId: number, suffix: string) => ({ hostId, userId: buyer.id, name: `${prefix}-${suffix}`, incusId: `${prefix}-${suffix}`, image: systemImage.remoteAlias, cpu: 200, memory: 768, disk: 30 * 1024 })
const item = (quantity = 1, poolPriceId = price.id) => ({ poolPriceId, quantity, namePrefix: `${prefix}-vm`, image: systemImage.remoteAlias })
const order = (quantity = 1) => ({ requestId: randomUUID(), items: [item(quantity)], expectedTotal: quantity * 1200 })
const waitFor = async (check: () => Promise<boolean>) => {
  for (let attempt = 0; attempt < 80; attempt++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  assert.fail('Timed out waiting for local compensation')
}
const app = Fastify()
app.decorate('authenticateAdmin', async (request: any, reply: any) => {
  if (request.headers['x-test-role'] !== 'admin') return reply.code(403).send({ code: 'FORBIDDEN' })
  request.user = { id: owner.id, username: owner.username, role: 'admin' }
})
app.decorate('authenticate', async (request: any, reply: any) => {
  if (!request.headers['x-test-role']) return reply.code(401).send({ code: 'UNAUTHORIZED' })
  request.user = { id: request.headers['x-test-role'] === 'other' ? other.id : buyer.id, username: buyer.username, role: 'user' }
})
await app.register(inventoryRoutes, { prefix: '/inventory-api' })
await app.register(orderRoutes, { prefix: '/instances' })

try {
  const last = await host()
  // Database enforcement applies even to raw/alternate insert paths.
  const claims = await Promise.allSettled([
    prisma.instance.create({ data: instanceData(last.id, 'claim-a') }),
    prisma.instance.create({ data: instanceData(last.id, 'claim-b') })
  ])
  assert.equal(claims.filter(result => result.status === 'fulfilled').length, 1)
  await assert.rejects(() => deleteHost(last.id), /HOST_HAS_INSTANCES/)
  await prisma.instance.updateMany({ where: { hostId: last.id }, data: { status: 'deleted' } })
  await deleteHost(last.id)

  const available = await host()
  const before = Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance)
  await assert.rejects(() => placePoolOrder(buyer.id, buyer.username, order(2)), error => (error as any).code === 'POOL_STOCK_SHORT')
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), before)
  assert.equal(await prisma.instance.count({ where: { hostId: available.id } }), 0)
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: available.id } })).cpuUsed, 0)
  assert.equal(await prisma.balanceLog.count({ where: { userId: buyer.id, type: 'consume' } }), 0)

  // Concurrent retries of one intent must produce one debit and the same instances.
  const intent = order()
  const repeated = await Promise.all([placePoolOrder(buyer.id, buyer.username, intent), placePoolOrder(buyer.id, buyer.username, intent)])
  assert.deepEqual(repeated[0].instances.map(value => value.id), repeated[1].instances.map(value => value.id))
  assert.equal(await prisma.poolOrder.count({ where: { id: intent.requestId } }), 1)
  assert.equal(await prisma.balanceLog.count({ where: { userId: buyer.id, type: 'consume' } }), 1)
  assert.equal(await getPoolOrderResult(other.id, intent.requestId), null)
  await assert.rejects(() => placePoolOrder(buyer.id, buyer.username, { ...intent, expectedTotal: 1300 }), error => (error as any).code === 'POOL_ORDER_INVALID')
  // Fake hosts point to closed loopback ports: no remote machine is contacted.
  const instanceId = repeated[0].instances[0].id
  await waitFor(async () => (await getPoolOrderResult(buyer.id, intent.requestId))!.instances[0].refunded)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), before, 'setup fee and monthly fee both refunded')
  await Promise.all([compensateFailedInstancePurchase(instanceId, buyer.id, available.id), compensateFailedInstancePurchase(instanceId, buyer.id, available.id)])
  assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId, type: 'refund' } }), 1)
  assert.equal((await getPoolOrderResult(buyer.id, intent.requestId))!.instances[0].sshPort, null)

  // The last machine is sold once when two different users pay concurrently.
  await host()
  const compete = await Promise.allSettled([placePoolOrder(buyer.id, buyer.username, order()), placePoolOrder(other.id, other.username, order())])
  assert.equal(compete.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(compete.filter(result => result.status === 'rejected' && (result.reason as any).code === 'POOL_STOCK_SHORT').length, 1)
  for (const result of compete) if (result.status === 'fulfilled') await waitFor(async () => {
    const record = await prisma.instanceBillingRecord.findFirst({ where: { instanceId: result.value.instances[0].id, type: 'refund' } })
    return !!record
  })

  const source = await host(30, { singleTenant: false })
  const target = await host()
  const moving = await prisma.instance.create({ data: instanceData(source.id, 'move') })
  await prisma.instanceTask.create({ data: { instanceId: moving.id, hostId: source.id, userId: buyer.id, taskType: 'change_host', targetHostId: target.id } })
  await assert.rejects(() => deleteHost(target.id), /HOST_HAS_PENDING_TASKS/)
  await assert.rejects(() => prisma.instance.create({ data: instanceData(target.id, 'reserved') }), /HOST_SINGLE_TENANT_OCCUPIED/)
  assert.equal((await poolInventory()).find(row => row.machineGroupId === group.id && row.diskGiB === 30)?.idle, 0)

  const offline = await host(30, { status: 'offline' })
  const noStorage = await host()
  await prisma.storagePool.deleteMany({ where: { hostId: noStorage.id } })
  const noPrice = await host(60)
  const inventory = await app.inject({ method: 'GET', url: '/inventory-api/inventory', headers: { 'x-test-role': 'admin' } })
  assert.equal(inventory.statusCode, 200)
  const machineRows = inventory.json().hosts
  assert.equal(machineRows.find((value: any) => value.id === target.id).sellReason, 'reserved')
  assert.equal(machineRows.find((value: any) => value.id === offline.id).stock, 'unavailable')
  assert.equal(machineRows.find((value: any) => value.id === noPrice.id).sellReason, 'no-price')
  const catalog = await publicPoolCatalog()
  assert.equal(catalog.regions.find(value => value.id === region.id)?.products[0].idle, 0)
  assert.equal(await prisma.$transaction(tx => selectAndReserveHostWithLock(tx, { hostId: noPrice.id, cpu: 100, memory: 128, disk: 1024 })), null, 'ordinary packages cannot use dedicated stock')
  const ordinary = await prisma.package.create({ data: { userId: owner.id, name: prefix, cpuMax: 100, memoryMax: 128, diskMax: 1024 } })
  await prisma.packageHost.create({ data: { packageId: ordinary.id, hostId: noPrice.id } })
  assert.equal(await checkPackageSoldOut(ordinary.id), true)
  assert.equal((await checkPackagesSoldOut([ordinary.id])).get(ordinary.id), true)

  // Prepare at the old price, then change the price while checkout waits for its transaction lock.
  let unlock!: () => void, signalLocked!: () => void
  const locked = new Promise<void>(resolve => { signalLocked = resolve })
  const release = new Promise<void>(resolve => { unlock = resolve })
  const priceChange = prisma.$transaction(async tx => {
    await lockHostGroups(tx); signalLocked(); await release
    await tx.hostPoolPrice.update({ where: { id: price.id }, data: { monthlyPrice: 1100 } })
  }, { timeout: 15000 })
  await locked
  const pending = placePoolOrder(buyer.id, buyer.username, order()).then(() => null, error => error)
  try {
    await waitFor(async () => (await prisma.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 734821 AND objid = 1 AND NOT granted) AS waiting`)[0].waiting)
  } finally { unlock() }
  await priceChange
  assert.equal((await pending)?.code, 'POOL_PRICE_CHANGED', 'checkout must recheck pricing after the lock')

  const changed = order()
  await upsertPoolPrice({ ...priceInput, monthlyPrice: 1100 }, owner.id)
  await assert.rejects(() => placePoolOrder(buyer.id, buyer.username, changed), error => (error as any).code === 'POOL_PRICE_CHANGED')
  await assert.rejects(() => upsertPoolPrices([{ ...priceInput, monthlyPrice: 0 }], owner.id, [2147483647]))
  assert.equal(Number((await prisma.hostPoolPrice.findUniqueOrThrow({ where: { id: price.id } })).monthlyPrice), 1100, 'matrix edits roll back if any removal is invalid')
  await upsertPoolPrices([{ ...priceInput, monthlyPrice: 0, setupFee: 0 }], owner.id)
  assert.equal(Number((await prisma.hostPoolPrice.findUniqueOrThrow({ where: { id: price.id } })).monthlyPrice), 0, 'zero-price products stay on sale')

  for (const method of ['GET', 'DELETE'] as const) {
    const response = await app.inject({ method, url: `/inventory-api/inventory/${noPrice.id}${method === 'GET' ? '/ssh' : ''}`, headers: { 'x-test-role': 'user' } })
    assert.equal(response.statusCode, 403)
  }
  const ssh = await app.inject({ method: 'GET', url: `/inventory-api/inventory/${noPrice.id}/ssh`, headers: { 'x-test-role': 'admin' } })
  assert.equal(ssh.headers['cache-control'], 'no-store')
  assert.equal(ssh.json().command, null)
  const sshPayload = { host: '192.0.2.20', port: 2222, username: 'ops' }
  assert.equal((await app.inject({ method: 'PATCH', url: `/inventory-api/inventory/${noPrice.id}/ssh`, headers: { 'x-test-role': 'user' }, payload: sshPayload })).statusCode, 403)
  assert.equal((await app.inject({ method: 'PATCH', url: `/inventory-api/inventory/${noPrice.id}/ssh`, headers: { 'x-test-role': 'admin' }, payload: sshPayload })).statusCode, 200)
  const savedSsh = await app.inject({ method: 'GET', url: `/inventory-api/inventory/${noPrice.id}/ssh`, headers: { 'x-test-role': 'admin' } })
  assert.equal(savedSsh.json().command, "ssh -p 2222 'ops@192.0.2.20'")
  const excessive = await app.inject({ method: 'PATCH', url: '/inventory-api/inventory/spec', headers: { 'x-test-role': 'admin' }, payload: { hostIds: [noPrice.id], resourcePreset: 'E2', customerDiskGiB: 500 } })
  assert.equal(excessive.statusCode, 400)
  assert.equal(excessive.json().code, 'RESOURCE_DISK_INSUFFICIENT')
  const foreignOrder = await app.inject({ method: 'GET', url: `/instances/pool-orders/${intent.requestId}`, headers: { 'x-test-role': 'other' } })
  assert.equal(foreignOrder.statusCode, 404)
  const invalidDelete = await app.inject({ method: 'DELETE', url: '/inventory-api/inventory/0', headers: { 'x-test-role': 'admin' } })
  assert.equal(invalidDelete.statusCode, 400)

  // Different configurations and quantities share one debit, with a separate ledger per instance.
  await upsertPoolPrice(priceInput, owner.id)
  const larger = (await upsertPoolPrice({ ...priceInput, diskGiB: 60, monthlyPrice: 1500, setupFee: 300 }, owner.id)).price
  await host(); await host()
  const mixedIntent = { requestId: randomUUID(), items: [item(2), { ...item(1, larger.id), namePrefix: `${prefix}-large` }], expectedTotal: 4200 }
  const mixed = await placePoolOrder(buyer.id, buyer.username, mixedIntent)
  assert.equal(mixed.total, 4200)
  assert.equal(mixed.instances.length, 3)
  const purchases = await prisma.instanceBillingRecord.findMany({ where: { purchaseBatchId: mixed.batchId, type: 'newPurchase' } })
  assert.deepEqual(purchases.map(record => Number(record.amount)).sort((a, b) => a - b), [12, 12, 18])
  assert.equal(new Set(purchases.map(record => record.balanceLogId)).size, 1)
  await waitFor(async () => (await getPoolOrderResult(buyer.id, mixed.batchId))!.instances.every(instance => instance.refunded))
  const largerInstance = await prisma.instance.findFirstOrThrow({ where: { purchaseBatchId: mixed.batchId, poolPriceId: larger.id } })
  assert.equal(Number(largerInstance.billingPrice), 15, 'renewal excludes the one-time setup fee')
  await deletePoolPrice(larger.id)
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: largerInstance.id } })).packagePlanId, largerInstance.packagePlanId, 'removing a price must preserve paid-instance identity')
  assert.equal((await prisma.packagePlan.findUniqueOrThrow({ where: { id: largerInstance.packagePlanId! } })).isActive, false)

  await upsertPoolPrice({ ...priceInput, monthlyPrice: 0, setupFee: 0 }, owner.id)
  await host()
  const free = await placePoolOrder(buyer.id, buyer.username, { ...order(), expectedTotal: 0 })
  await waitFor(async () => (await getPoolOrderResult(buyer.id, free.batchId))!.instances[0].status === 'error')
  assert.equal((await getPoolOrderResult(buyer.id, free.batchId))!.instances[0].refundPending, false, 'zero-price failures must not wait forever for a refund')

  const raced = await host()
  const race = await Promise.allSettled([deleteHost(raced.id), prisma.instance.create({ data: instanceData(raced.id, 'delete-race') })])
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1, 'deletion cannot remove a concurrently assigned machine')
  console.log('PASS pool integration: reservations, cart rollback, replay, cross-user access, refund, pricing and deletion races')
} finally {
  await app.close()
  await closeAllClients()
  await closePrismaDatabase()
}
// The imported auth helpers have process-wide maintenance intervals.
process.exit(0)
