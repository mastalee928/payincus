import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/packages.js')
const tag = 'plan-bounds-' + randomUUID(), app = Fastify(), users: number[] = [], packages: number[] = []
let failure: unknown
try {
  for (const role of ['admin', 'user'] as const) {
    const user = await prisma.user.create({ data: { username: tag + role, passwordHash: 'unusable-fixture', role } }); users.push(user.id)
  }
  let actor = { id: users[0], username: tag, role: 'admin' }
  for (const hook of ['authenticate', 'authenticateUser', 'authenticateAdmin']) app.decorate(hook, async (request: any) => { request.user = { ...actor } })
  await app.register(routes, { prefix: '/packages' })
  const pkg = await prisma.package.create({ data: { userId: users[0], name: tag, cpuMax: 10000, memoryMax: 62144, diskMax: 104857600 } }); packages.push(pkg.id)
  const baseline = { name: 'Boundary plan', cpu: 100, memory: 1024, disk: 2048, portLimit: 1, snapshotLimit: 1,
    backupLimit: 1, siteLimit: 1, swapSize: 0, trafficLimit: '1024', price: 1000, billingCycle: 1 }
  const initial = await app.inject({ method: 'POST', url: `/packages/${pkg.id}/plans`, payload: baseline })
  assert.equal(initial.statusCode, 200, initial.body)
  const planId = initial.json().id
  const state = async () => ({
    users: await prisma.user.findMany({ where: { id: { in: users } }, orderBy: { id: 'asc' } }),
    packages: await prisma.package.findMany({ where: { id: { in: packages } }, orderBy: { id: 'asc' } }),
    plans: await prisma.packagePlan.findMany({ where: { packageId: { in: packages } }, orderBy: { id: 'asc' } }),
    logs: await prisma.log.findMany({ where: { userId: { in: users } }, orderBy: { id: 'asc' } }),
    ledger: await prisma.balanceLog.findMany({ where: { userId: { in: users } }, orderBy: { id: 'asc' } })
  })
  const before = await state()
  const submit = (method: 'POST' | 'PUT', payload: Record<string, unknown>) => app.inject({ method,
    url: method === 'POST' ? `/packages/${pkg.id}/plans` : `/packages/${pkg.id}/plans/${planId}`,
    payload: method === 'POST' ? { ...baseline, name: 'Candidate', ...payload } : payload })
  let rejected = 0
  const reject = async (payload: Record<string, unknown>) => {
    for (const method of ['POST', 'PUT'] as const) {
      const response = await submit(method, payload)
      assert.equal(response.statusCode, 400, method + ' invalid field ' + Object.keys(payload).join(','))
      assert.deepEqual(await state(), before); rejected++
    }
  }
  const bounds: Array<[string, number, number]> = [
    ['cpu', 15, 10000], ['memory', 128, 62144], ['disk', 512, 104857600],
    ['portLimit', 0, 2147483647], ['snapshotLimit', 0, 2147483647], ['backupLimit', 0, 2147483647], ['siteLimit', 0, 2147483647],
    ['swapSize', 0, 1048576], ['price', 0, 99999999], ['billingCycle', 1, 120], ['sortOrder', -1000000, 1000000]
  ]
  for (const [field, min, max] of bounds) for (const value of [min - 1, max + 1, min + 0.5, String(min), null, false, Number.MAX_SAFE_INTEGER + 1]) {
    await reject({ [field]: value })
  }
  for (const value of ['-1', '1.5', '1e3', '', null, 1, '9223372036854775808', 'Infinity', '2suffix']) await reject({ trafficLimit: value })
  for (const field of ['isActive', 'isSoldOut']) for (const value of [0, 1, 'false', null]) await reject({ [field]: value })
  for (const value of [-1, 1000000, 1.001, '1', false]) await reject({ trafficResetPrice: value })
  for (const value of [0, 101, 99.999, '99', false]) await reject({ slaGuarantee: value })
  for (const value of ['-1Mbit', 'InfinityMbit', 'NaNMbit', '1e3Mbit', {}, 10]) await reject({ trafficLimitSpeed: value })
  actor = { id: users[1], username: tag, role: 'user' }
  for (const method of ['POST', 'PUT'] as const) assert.equal((await submit(method, { name: 'Forbidden' })).statusCode, 403)
  assert.deepEqual(await state(), before)
  actor = { id: users[0], username: tag, role: 'admin' }
  for (const boundary of [0, 1] as const) {
    const values = Object.fromEntries(bounds.map(([field, min, max]) => [field, boundary === 0 ? min : max]))
    const payload = { ...values, trafficLimit: boundary ? '9223372036854775807' : '0',
      trafficResetPrice: boundary ? 999999.99 : 0, slaGuarantee: boundary ? 100 : 1,
      trafficLimitSpeed: boundary ? '1.5Gbit' : '0', isActive: Boolean(boundary), isSoldOut: Boolean(boundary) }
    const response = await submit('PUT', payload); assert.equal(response.statusCode, 200, response.body)
    const row = await prisma.packagePlan.findUniqueOrThrow({ where: { id: planId } })
    for (const [field, value] of Object.entries(values)) assert.equal(Number(row[field as keyof typeof row]), value, field)
    assert.equal(row.trafficLimit, BigInt(payload.trafficLimit)); assert.equal(Number(row.trafficResetPrice), payload.trafficResetPrice)
    assert.equal(Number(row.slaGuarantee), payload.slaGuarantee); assert.equal(row.trafficLimitSpeed, boundary ? '1500Mbit' : '0')
    assert.equal(row.isActive, payload.isActive); assert.equal(row.isSoldOut, payload.isSoldOut)
  }
  assert.equal(await prisma.instance.count({ where: { packageId: { in: packages } } }), 0)
  const after = await state(); assert.deepEqual(after.users, before.users); assert.deepEqual(after.packages, before.packages); assert.deepEqual(after.ledger, before.ledger)
  console.log('PASS', rejected, 'create/update invalid field requests preserve full state; foreign user denied; numeric low/high, PG bigint max and valid line speed stored exactly; no instance delivery')
} catch (error) { failure = error }
finally {
  await app.close(); await prisma.log.deleteMany({ where: { userId: { in: users } } })
  await prisma.package.deleteMany({ where: { id: { in: packages } } }); await prisma.user.deleteMany({ where: { id: { in: users } } })
  await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
