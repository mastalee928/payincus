import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mock } from 'node:test'
import Fastify from 'fastify'
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/snapshots.js')
const { IncusClient } = await import('../src/lib/incus/incus-client.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const tag = 'snapshot-id-' + randomUUID()
const user = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: user.id, name: tag, url: 'https://127.0.0.1:1' } })
const instance = await prisma.instance.create({ data: { userId: user.id, hostId: host.id, name: tag, incusId: tag,
  image: 'fixture/debian', status: 'stopped', cpu: 100, memory: 512, disk: 1024, snapshotLimit: 5 } })
const snapshot = await prisma.snapshot.create({ data: { instanceId: instance.id, name: tag, incusName: tag } })
const app = Fastify()
app.decorate('authenticateUser', async (request: any) => {
  request.user = { id: user.id, username: user.username, role: 'user', sid: tag, iat: Math.floor(Date.now() / 1000) + 10 }
})
let remoteCalls = 0
mock.method(IncusClient.prototype, 'connect', async () => { remoteCalls++; throw Error('ID validation must not connect to any host') })
const operationId = randomUUID()
const requests = (id: string) => [
  { method: 'GET' as const, url: `/instances/${id}/snapshots` },
  { method: 'POST' as const, url: `/instances/${id}/snapshots`, payload: { name: 'fixture' } },
  { method: 'DELETE' as const, url: `/instances/${id}/snapshots/${snapshot.id}` },
  { method: 'POST' as const, url: `/instances/${id}/snapshots/${snapshot.id}/restore`, payload: {} },
  { method: 'GET' as const, url: `/instances/${id}/snapshot-policy` },
  { method: 'PUT' as const, url: `/instances/${id}/snapshot-policy`, payload: { enabled: false } },
  { method: 'POST' as const, url: `/instances/${id}/snapshot-policy/operations/${operationId}/retry` },
  { method: 'DELETE' as const, url: `/instances/${instance.id}/snapshots/${id}` },
  { method: 'POST' as const, url: `/instances/${instance.id}/snapshots/${id}/restore`, payload: {} }
]
const capture = async () => ({ instance: await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } }),
  snapshot: await prisma.snapshot.findUniqueOrThrow({ where: { id: snapshot.id } }),
  policy: await prisma.snapshotPolicy.findUnique({ where: { instanceId: instance.id } }),
  operations: await prisma.autoSnapshotOperation.findMany({ where: { instanceId: instance.id } }),
  audits: await prisma.log.findMany({ where: { userId: user.id } }) })
let failure: unknown
try {
  await app.register(routes, { prefix: '/instances' })
  const before = await capture()
  const overflow = await app.inject(requests('2147483648')[0])
  assert.equal(overflow.statusCode, 400, 'PostgreSQL Int overflow must be rejected before querying the instance')
  const invalid = ['0', '-1', '1.5', '1e3', '1suffix', '01', '%2B1', '%201', '2147483648', '9007199254740991', '9007199254740992', 'NaN', 'Infinity', '0x10']
  for (const id of invalid) for (const request of requests(id)) {
    const response = await app.inject(request)
    assert.equal(response.statusCode, 400, request.method + ' ' + request.url + ': ' + response.body)
    assert.equal(response.json().code, 'INVALID_ID')
  }
  for (const request of requests('2147483647').filter((_, index) => index !== 6)) {
    assert.equal((await app.inject(request)).statusCode, 404, request.url + ' valid but absent Int boundary')
  }
  const list = await app.inject({ method: 'GET', url: `/instances/${instance.id}/snapshots` })
  assert.equal(list.statusCode, 200); assert.equal(list.json().length, 1); assert.equal(list.json()[0].id, snapshot.id)
  assert.equal((await app.inject({ method: 'GET', url: `/instances/${instance.id}/snapshot-policy` })).statusCode, 200)
  assert.equal(remoteCalls, 0); assert.deepEqual(await capture(), before)
  console.log('PASS 126 malformed/overflow snapshot requests return 400; eight valid absent Int boundaries return 404; existing list/policy work and all records/audits remain unchanged')
} catch (error) { failure = error }
finally {
  mock.restoreAll(); await app.close(); await closeAllClients()
  await prisma.log.deleteMany({ where: { userId: user.id } }); await prisma.snapshot.delete({ where: { id: snapshot.id } })
  await prisma.instance.delete({ where: { id: instance.id } }); await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.delete({ where: { id: user.id } }); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }; process.exit(0)
