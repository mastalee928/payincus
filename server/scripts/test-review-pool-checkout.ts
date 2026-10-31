import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Client } from 'pg'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const interval = globalThis.setInterval
globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => { const timer = interval(...args); timer.unref(); return timer }) as typeof setInterval
try { await import('../src/lib/security.js') } finally { globalThis.setInterval = interval }
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/pool-orders.js')
const { upsertPoolPrice } = await import('../src/services/host-pool-prices.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const app = Fastify(), holder = new Client({ connectionString: database.href }), monitor = new Client({ connectionString: database.href })
const tag = 'checkout-' + randomUUID().slice(0, 8), ids: number[] = [], hostIds: number[] = []
let groupId = 0, regionId = 0, imageId = 0, priceId = 0, planId = 0, packageId = 0
let actor: { id: number; username: string; role: string; sid: string; iat: number }, pending: Promise<unknown> | undefined, failure: unknown
const wait = async (check: () => Promise<boolean>) => { const deadline = Date.now() + 7000; while (!await check()) { assert.ok(Date.now() < deadline, 'real checkout operation must settle'); await delay(10) } }
try {
  await holder.connect(); await monitor.connect()
  const admin = await prisma.user.create({ data: { username: tag + '-admin', passwordHash: 'fixture', role: 'admin' } }); ids.push(admin.id)
  const buyer = await prisma.user.create({ data: { username: tag, passwordHash: 'fixture', balance: 100 } }); ids.push(buyer.id)
  const group = await prisma.hostMachineGroup.create({ data: { name: tag } }); groupId = group.id
  const region = await prisma.hostRegionGroup.create({ data: { machineGroupId: group.id, name: tag, countryCode: 'us' } }); regionId = region.id
  const image = await prisma.systemImage.create({ data: { name: tag, remoteAlias: tag + '/debian', architecture: 'x86_64', instanceType: 'container', icon: 'debian' } }); imageId = image.id
  const price = (await upsertPoolPrice({ machineGroupId: group.id, regionGroupId: region.id, resourcePreset: 'E2', diskGiB: 30, monthlyPrice: 1000, setupFee: 200 }, admin.id)).price
  priceId = price.id; planId = price.shadowPlanId!
  packageId = (await prisma.packagePlan.findUniqueOrThrow({ where: { id: planId } })).packageId
  const session = { sid: tag, iat: Math.floor(Date.now() / 1000) - 60 }
  const machine = await prisma.host.create({ data: { userId: admin.id, name: tag, url: 'https://127.0.0.1:1', singleTenant: true,
    machineGroupId: group.id, regionGroupId: region.id, resourcePreset: 'E2', customerDiskGiB: 30, status: 'online', isInstalled: true,
    architecture: 'x86_64', cpuAllowanceMax: 200, memoryMax: 768, storageSize: 38, natPublicIp: '192.0.2.20', natPortStart: 20000, natPortEnd: 30000 } }); hostIds.push(machine.id)
  await prisma.storagePool.create({ data: { hostId: machine.id, name: 'fixture', driver: 'btrfs', purpose: 'instance_data' } })
  app.decorate('authenticate', async (request: any) => { request.user = { ...actor } })
  app.decorate('authenticateAdmin', async (request: any) => { request.user = { ...actor } })
  await app.register(routes, { prefix: '/instances' })
  for (const mode of ['logout', 'all-sessions', 'banned', 'admin-logout', 'admin-demoted', 'allowed']) {
    await prisma.tokenInvalidation.deleteMany({ where: { userId: { in: ids } } })
    await prisma.user.update({ where: { id: buyer.id }, data: { status: 'active' } })
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
    actor = { ...(mode.startsWith('admin') ? admin : buyer), ...session }
    const requestId = randomUUID(), isAdmin = mode.startsWith('admin')
    const payload = isAdmin ? { requestId, username: buyer.username, name: tag, poolPriceId: price.id, image: image.remoteAlias,
      expectedTotal: 1200, billing: 'paid', chargeFirstMonth: true } : { requestId, expectedTotal: 1200,
      items: [{ poolPriceId: price.id, quantity: 1, namePrefix: tag, image: image.remoteAlias }] }
    const before = await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })
    await holder.query('BEGIN'); await holder.query('SELECT pg_advisory_xact_lock(4110, $1::int)', [buyer.id])
    const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    const operation = app.inject({ method: 'POST', url: '/instances/' + (isAdmin ? 'admin/pool-create' : 'pool-order'), payload }).then(value => value)
    pending = operation
    await wait(async () => !!(await monitor.query('SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))', [pid])).rows.length)
    if (mode === 'banned') await prisma.user.update({ where: { id: buyer.id }, data: { status: 'banned' } })
    else if (mode === 'admin-demoted') await prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
    else if (mode !== 'allowed') await prisma.tokenInvalidation.create({ data: { userId: actor.id, sessionId: mode === 'all-sessions' ? '__USER_LEVEL__' : session.sid, invalidatedAt: Math.floor(Date.now() / 1000) } })
    await holder.query('COMMIT')
    const response = await operation; pending = undefined
    console.log('checkout authorization', mode, response.statusCode, 'orders', await prisma.poolOrder.count({ where: { id: requestId } }))
    if (response.statusCode === 202) await wait(async () => await prisma.instance.count({ where: { purchaseBatchId: requestId, status: 'creating' } }) === 0)
    assert.equal(response.statusCode, mode === 'allowed' ? 202 : 403)
    if (mode !== 'allowed') {
      assert.equal(await prisma.poolOrder.count({ where: { id: requestId } }), 0)
      assert.equal(await prisma.balanceLog.count({ where: { userId: buyer.id } }), 0)
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance.toString(), before.balance.toString())
      assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: machine.id } })).cpuUsed, 0)
    } else {
      const replay = await app.inject({ method: 'POST', url: '/instances/pool-order', payload })
      assert.equal(replay.statusCode, 202)
      assert.deepEqual(replay.json().instances.map((row: any) => row.id), response.json().instances.map((row: any) => row.id))
      assert.equal(await prisma.balanceLog.count({ where: { userId: buyer.id, type: 'consume' } }), 1)
      await prisma.tokenInvalidation.create({ data: { userId: buyer.id, sessionId: session.sid, invalidatedAt: Math.floor(Date.now() / 1000) } })
      assert.equal((await app.inject({ method: 'POST', url: '/instances/pool-order', payload })).statusCode, 403, 'replay must recheck current session')
    }
  }
  console.log('PASS actual pool checkout: authorization after lock waiting, no debit/reservation after revocation, allowed purchase and safe replay')
} catch (error) { failure = error }
finally {
  await holder.query('ROLLBACK').catch(() => undefined); await pending; await app.close()
  await wait(async () => await prisma.instance.count({ where: { hostId: { in: hostIds }, status: 'creating' } }) === 0).catch(() => undefined)
  await delay(150)
  await closeAllClients()
  await prisma.log.deleteMany({ where: { userId: { in: ids } } })
  await prisma.balanceLog.deleteMany({ where: { userId: { in: ids } } })
  await prisma.instance.deleteMany({ where: { hostId: { in: hostIds } } })
  await prisma.poolOrder.deleteMany({ where: { userId: { in: ids } } })
  await prisma.host.deleteMany({ where: { id: { in: hostIds } } })
  if (priceId) await prisma.hostPoolPrice.delete({ where: { id: priceId } })
  if (planId) await prisma.packagePlan.delete({ where: { id: planId } })
  if (packageId) await prisma.package.deleteMany({ where: { id: packageId, userId: { in: ids } } })
  if (imageId) await prisma.systemImage.delete({ where: { id: imageId } })
  if (regionId) await prisma.hostRegionGroup.delete({ where: { id: regionId } })
  if (groupId) await prisma.hostMachineGroup.delete({ where: { id: groupId } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
  await holder.end(); await monitor.end(); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exitCode = 1 }
