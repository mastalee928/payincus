import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/redeem-codes.js')
const tag = 'redeem-scope-' + randomUUID()
const app = Fastify()
let failure: unknown
try {
const owner = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
const stranger = await prisma.user.create({ data: { username: tag + '-other', passwordHash: 'unusable-fixture' } })
const hosts = await Promise.all([0, 1].map(index => prisma.host.create({ data: {
  name: tag + index, userId: owner.id, url: 'https://127.0.0.1:1'
} })))
const instance = await prisma.instance.create({ data: { userId: owner.id, hostId: hosts[0].id, name: tag, incusId: tag,
  image: 'fixture/debian', status: 'running', cpu: 100, memory: 512, disk: 1024 } })
let actor = owner
app.decorate('authenticate', async (request: any) => { request.user = {
  id: actor.id, username: actor.username, role: actor.role, sid: tag, iat: Math.floor(Date.now() / 1000) + 1
} })
const code = (hostId: number, used = false) => prisma.redeemCode.create({ data: {
  hostId, createdById: owner.id, code: randomUUID(), codeType: 'c', codeValue: 100, maxUses: 10, usedCount: used ? 1 : 0
} })
const codes = await Promise.all([code(hosts[0].id), code(hosts[0].id, true), code(hosts[1].id)])
const usage = await prisma.redeemCodeUsage.create({ data: { redeemCodeId: codes[1].id, userId: owner.id, instanceId: instance.id } })
const base = (hostId: number) => `/hosts/${hostId}/redeem-codes`
const capture = async () => ({
  codes: await prisma.redeemCode.findMany({ where: { hostId: { in: hosts.map(host => host.id) } }, orderBy: { id: 'asc' } }),
  usage: await prisma.redeemCodeUsage.findMany({ where: { userId: owner.id }, orderBy: { id: 'asc' } }),
  hosts: await prisma.host.findMany({ where: { id: { in: hosts.map(host => host.id) } }, orderBy: { id: 'asc' } }),
  instance: await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } }),
  logs: await prisma.log.findMany({ where: { userId: { in: [owner.id, stranger.id] } }, orderBy: { id: 'asc' } })
})
const batch = (ids: number[]) => app.inject({ method: 'POST', url: base(hosts[0].id) + '/batch-delete', payload: { ids } })
  await app.register(routes)
  const before = await capture()
  for (const request of [
    { method: 'PATCH' as const, url: base(hosts[0].id) + '/' + codes[2].id, payload: { enabled: false } },
    { method: 'DELETE' as const, url: base(hosts[0].id) + '/' + codes[2].id },
    { method: 'GET' as const, url: base(hosts[1].id) + '/' + codes[1].id + '/usages' }
  ]) assert.equal((await app.inject(request)).statusCode, 404)
  assert.deepEqual(await capture(), before)
  actor = stranger
  assert.equal((await app.inject({ method: 'GET', url: base(hosts[0].id) })).statusCode, 403)
  assert.equal((await batch([codes[0].id])).statusCode, 403)
  actor = owner; assert.deepEqual(await capture(), before)
  const usages = await app.inject({ method: 'GET', url: base(hosts[0].id) + '/' + codes[1].id + '/usages' })
  assert.equal(usages.statusCode, 200); assert.equal(usages.json().total, 1); assert.equal(usages.json().usages[0].id, usage.id)
  console.log('PASS single-code host scope, usage isolation and unrelated actor rejection preserve all records')
  for (const missing of [codes[2].id, 2147483647]) {
    const response = await batch([codes[0].id, codes[1].id, missing])
    assert.equal(response.statusCode, 404)
    assert.deepEqual(await capture(), before, 'Rejected mixed batch must neither delete valid codes nor disable used codes')
  }
  assert.equal((await batch([codes[0].id, codes[0].id])).statusCode, 400)
  assert.deepEqual(await capture(), before)
  const validBatch = await batch([codes[0].id, codes[1].id])
  assert.equal(validBatch.statusCode, 409); assert.equal(validBatch.json().code, 'REDEEM_CODE_USED')
  assert.equal(await prisma.redeemCode.findUnique({ where: { id: codes[0].id } }), null)
  assert.deepEqual(await prisma.redeemCode.findUniqueOrThrow({ where: { id: codes[1].id } }), { ...codes[1], enabled: false })
  assert.deepEqual(await prisma.redeemCode.findUniqueOrThrow({ where: { id: codes[2].id } }), codes[2])
  assert.deepEqual(await prisma.redeemCodeUsage.findUniqueOrThrow({ where: { id: usage.id } }), usage)
  const remaining = await capture()
  assert.deepEqual(remaining.hosts, before.hosts)
  assert.deepEqual(remaining.instance, before.instance)
  assert.deepEqual(remaining.logs, before.logs)
  console.log('PASS invalid cross-host/missing/duplicate batches change nothing; valid mixed batch deletes unused, disables used and preserves usage plus other host')
} catch (error) { failure = error }
finally {
  await app.close()
  // Include partial setup failures; only this run's exact fixture identities are removed.
  const users = await prisma.user.findMany({ where: { username: { in: [tag, tag + '-other'] } }, select: { id: true } })
  const userIds = users.map(user => user.id)
  const hosts = await prisma.host.findMany({ where: { userId: { in: userIds } }, select: { id: true } })
  await prisma.redeemCodeUsage.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.redeemCode.deleteMany({ where: { hostId: { in: hosts.map(host => host.id) } } })
  await prisma.log.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.instance.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.host.deleteMany({ where: { id: { in: hosts.map(host => host.id) } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
