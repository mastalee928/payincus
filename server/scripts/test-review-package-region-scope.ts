import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/packages.js')
const { default: hostingRoutes } = await import('../src/routes/admin-hosting.js')
const tag = 'region-scope-' + randomUUID(), app = Fastify(), users: number[] = [], hosts: number[] = [], packageIds: number[] = []
let failure: unknown
try {
  const makeUser = async (name: string, role: 'admin' | 'user' = 'user') => {
    const row = await prisma.user.create({ data: { username: tag + name, email: tag + name + '@example.invalid', passwordHash: 'unusable-fixture', role } }); users.push(row.id); return row
  }
  const admin = await makeUser('admin', 'admin'), market = await makeUser('market'), zoneOwner = await makeUser('zone'),
    viewer = await makeUser('viewer'), other = await makeUser('other'), blocked = await makeUser('blocked')
  await prisma.hostingBalanceLog.create({ data: { userId: market.id, type: 'income', amount: 1, frozen: false } })
  let actor = { id: viewer.id, username: viewer.username, role: viewer.role }
  for (const hook of ['authenticate', 'authenticateUser', 'authenticateAdmin']) app.decorate(hook, async (request: any) => { request.user = { ...actor } })
  app.decorate('requireAdmin', async (_request: any, reply: any) => { if (actor.role !== 'admin') return reply.code(403).send() })
  await app.register(routes, { prefix: '/packages' }); await app.register(hostingRoutes)
  const zone = await prisma.hostingZone.create({ data: { ownerId: zoneOwner.id, name: tag, logoUrl: 'https://example.invalid/fixture.png' } })
  const blockedZone = await prisma.hostingZone.create({ data: { ownerId: blocked.id, name: tag + '-blocked', logoUrl: 'https://example.invalid/fixture.png' } })
  const inactiveZone = await prisma.hostingZone.create({ data: { ownerId: other.id, name: tag + '-inactive', logoUrl: 'https://example.invalid/fixture.png', active: false } })
  await prisma.hostingUserBlock.create({ data: { blockerId: blocked.id, blockedUserId: viewer.id } })
  const makePackage = async (ownerId: number, label: string, options: { globalShared?: boolean; hidden?: boolean; active?: boolean;
    online?: boolean; planActive?: boolean; shareTo?: number } = {}) => {
    const host = await prisma.host.create({ data: { userId: ownerId, name: tag + label, url: 'https://127.0.0.1:1',
      countryCode: 'jp', status: options.online === false ? 'offline' : 'online' } }); hosts.push(host.id)
    const pkg = await prisma.package.create({ data: { userId: ownerId, name: tag + label, cpuMax: 100, memoryMax: 1024, diskMax: 2048,
      globalShared: options.globalShared ?? true, hidden: options.hidden ?? false, active: options.active ?? true } }); packageIds.push(pkg.id)
    await prisma.packageHost.create({ data: { packageId: pkg.id, hostId: host.id } })
    await prisma.packagePlan.create({ data: { packageId: pkg.id, name: tag, cpu: 100, memory: 1024, disk: 2048, portLimit: 1,
      snapshotLimit: 0, backupLimit: 0, siteLimit: 0, trafficLimit: 0, price: 1000, isActive: options.planActive ?? true } })
    if (options.shareTo) await prisma.packageShare.create({ data: { ownerId, packageId: pkg.id, sharedToId: options.shareTo } })
    return pkg
  }
  const official = await makePackage(admin.id, 'official'), publicMarket = await makePackage(market.id, 'market'),
    publicZone = await makePackage(zoneOwner.id, 'zone')
  const privateAdmin = await makePackage(admin.id, 'private-admin', { globalShared: false })
  const privateMarket = await makePackage(market.id, 'private-market', { globalShared: false })
  await makePackage(admin.id, 'hidden', { hidden: true }); await makePackage(admin.id, 'inactive', { active: false })
  await makePackage(admin.id, 'offline', { online: false }); const inactivePlan = await makePackage(admin.id, 'plan-inactive', { planActive: false })
  await makePackage(blocked.id, 'blocked')
  const friend = await makePackage(market.id, 'friend', { globalShared: false, shareTo: viewer.id })
  const otherFriend = await makePackage(market.id, 'other-friend', { globalShared: false, shareTo: other.id })
  await makePackage(market.id, 'inactive-friend', { active: false, globalShared: false, shareTo: viewer.id })
  await makePackage(blocked.id, 'blocked-friend', { globalShared: false, shareTo: viewer.id })
  await makePackage(zoneOwner.id, 'private-zone', { globalShared: false })
  await makePackage(zoneOwner.id, 'hidden-zone', { hidden: true })
  const snapshot = () => Promise.all([
    prisma.package.findMany({ where: { id: { in: packageIds } }, orderBy: { id: 'asc' } }),
    prisma.packageShare.findMany({ where: { packageId: { in: packageIds } }, orderBy: { id: 'asc' } }),
    prisma.host.findMany({ where: { id: { in: hosts } }, orderBy: { id: 'asc' } }),
    prisma.user.findMany({ where: { id: { in: users } }, orderBy: { id: 'asc' } }),
    prisma.packagePlan.findMany({ where: { packageId: { in: packageIds } }, orderBy: { id: 'asc' } }),
    prisma.packageHost.findMany({ where: { packageId: { in: packageIds } }, orderBy: { id: 'asc' } }),
    prisma.hostingZone.findMany({ where: { ownerId: { in: users } }, orderBy: { id: 'asc' } }),
    prisma.hostingUserBlock.findMany({ where: { blockerId: { in: users } }, orderBy: { id: 'asc' } }),
    prisma.log.findMany({ where: { userId: { in: users } }, orderBy: { id: 'asc' } }),
    prisma.hostingBalanceLog.findMany({ where: { userId: { in: users } }, orderBy: { id: 'asc' } })
  ])
  const before = await snapshot()
  const assertRegions = async (query: string, expected: number[]) => {
    const result = await app.inject({ method: 'GET', url: '/packages/regions' + query })
    assert.equal(result.statusCode, 200)
    const ids: number[] = result.json().regions.flatMap((region: { packageIds: number[] }) => region.packageIds).filter((id: number) => packageIds.includes(id))
    assert.deepEqual([...new Set(ids)].sort((a, b) => a - b), [...expected].sort((a, b) => a - b), query)
    assert.deepEqual(await snapshot(), before)
  }
  await assertRegions('', [official.id]); await assertRegions('?source=official', [official.id])
  await assertRegions('?source=market', [publicMarket.id]); await assertRegions('?source=friends', [friend.id])
  await assertRegions('?source=zone&zoneId=' + zone.id, [publicZone.id]); await assertRegions('?source=zone', [])
  await assertRegions('?source=zone&zoneId=' + blockedZone.id, [])
  await assertRegions('?source=zone&zoneId=' + inactiveZone.id, [])
  await assertRegions('?source=zone&zoneId=2147483647', [])
  actor = { id: other.id, username: other.username, role: other.role }
  await assertRegions('?source=friends', [otherFriend.id])
  actor = { id: viewer.id, username: viewer.username, role: viewer.role }
  // A shared host may also bind private packages that were never shared to this viewer.
  const friendHost = await prisma.packageHost.findFirstOrThrow({ where: { packageId: friend.id } })
  const privateBinding = await prisma.packageHost.create({ data: { hostId: friendHost.hostId, packageId: privateMarket.id } })
  const mixed = await app.inject({ method: 'GET', url: '/packages/regions?source=friends' })
  assert.equal(mixed.statusCode, 200)
  assert.deepEqual(mixed.json().regions.flatMap((region: { packageIds: number[] }) => region.packageIds).filter((id: number) => packageIds.includes(id)), [friend.id])
  await prisma.packageHost.delete({ where: { id: privateBinding.id } })
  assert.deepEqual(await snapshot(), before)
  for (const source of ['all', 'unknown', 'OFFICIAL', '', 'official&source=market', 'friends&source=friends', 'null', '%20official%20']) {
    const result = await app.inject({ method: 'GET', url: '/packages/regions?source=' + source })
    if (result.statusCode !== 400) {
      const ids = result.json().regions.flatMap((region: { packageIds: number[] }) => region.packageIds)
      console.log('Unexpected unsupported source', source, result.statusCode,
        'privateAdminVisible', ids.includes(privateAdmin.id), 'privateMarketVisible', ids.includes(privateMarket.id))
    }
    assert.equal(result.statusCode, 400, source); assert.deepEqual(await snapshot(), before)
  }
  for (const value of ['0', '-1', '1.5', '1x', 'NaN', 'Infinity', '9007199254740992', '1&zoneId=2']) {
    assert.equal((await app.inject({ method: 'GET', url: '/packages/regions?source=zone&zoneId=' + value })).statusCode, 400, value)
    assert.deepEqual(await snapshot(), before)
  }
  for (const source of ['', 'all', 'official', 'market', 'unknown']) {
    const response = await app.inject({ method: 'GET', url: '/packages/public/regions?source=' + source })
    assert.equal(response.statusCode, 200)
    const ids: number[] = response.json().regions.flatMap((region: { packageIds: number[] }) => region.packageIds).filter((id: number) => packageIds.includes(id))
    const expected = source === 'official' ? [official.id, inactivePlan.id] : source === 'market' ? [publicMarket.id] : [official.id, inactivePlan.id, publicMarket.id]
    assert.deepEqual([...new Set(ids)].sort((a, b) => a - b), expected.sort((a, b) => a - b), 'public ' + source)
    assert.deepEqual(await snapshot(), before)
  }
  for (const scope of ['hosted', 'official']) {
    const response = await app.inject({ method: 'GET', url: '/packages/?all=true&scope=' + scope + '&userId=' + market.id })
    assert.equal(response.statusCode, 200)
    const rows = response.json().packages.filter((row: { id: number }) => packageIds.includes(row.id))
    assert.ok(!rows.some((row: { id: number }) => [privateAdmin.id, privateMarket.id].includes(row.id)))
    assert.ok(rows.every((row: { owner?: { email?: string } }) => row.owner?.email === undefined))
  }
  assert.equal((await app.inject({ method: 'GET', url: '/api/admin/hosting/owners' })).statusCode, 403)
  actor = { id: admin.id, username: admin.username, role: admin.role }
  const adminList = await app.inject({ method: 'GET', url: '/packages/?all=true&scope=hosted&userId=' + market.id })
  assert.equal(adminList.statusCode, 200); assert.ok(adminList.json().packages.some((row: { id: number }) => row.id === privateMarket.id))
  assert.ok(adminList.json().packages.every((row: { owner: { id: number; email: string } }) => row.owner.id === market.id && row.owner.email === market.email))
  const ownerList = await app.inject({ method: 'GET', url: '/api/admin/hosting/owners?search=' + tag })
  assert.equal(ownerList.statusCode, 200)
  assert.ok(ownerList.json().owners.some((owner: { id: number; email: string }) => owner.id === market.id && owner.email === market.email))
  await assertRegions('?source=official', [official.id])
  assert.equal((await app.inject({ method: 'GET', url: '/packages/regions?source=all' })).statusCode, 400)
  assert.deepEqual(await snapshot(), before)
  console.log('PASS official/market/friends/zone region isolation, unsupported source rejection and administrator-only owner visibility; full state unchanged')
} catch (error) { failure = error }
finally {
  await app.close(); await prisma.log.deleteMany({ where: { userId: { in: users } } })
  await prisma.package.deleteMany({ where: { id: { in: packageIds } } }); await prisma.host.deleteMany({ where: { id: { in: hosts } } })
  await prisma.user.deleteMany({ where: { id: { in: users } } }); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
