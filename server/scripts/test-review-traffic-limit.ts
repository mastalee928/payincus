import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use isolated local *_pool_test PostgreSQL')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/traffic.js')
const tag = `traffic-limit-${randomUUID()}`
const owner = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: owner.id, name: tag, url: 'https://127.0.0.1:1', certPath: '', keyPath: '' } })
const instance = await prisma.instance.create({ data: { userId: owner.id, hostId: host.id, name: tag, incusId: tag,
  image: 'fixture', cpu: 50, memory: 256, disk: 1024, status: 'stopped', monthlyTrafficLimit: 1024n, monthlyTrafficUsed: 100n } })
await prisma.userQuota.create({ data: { userId: owner.id, monthlyTrafficUsed: 200n, monthlyTrafficLimit: 2048n } })
const app = Fastify()
for (const hook of ['authenticate', 'authenticateUser', 'authenticateAdmin', 'requireAdmin']) {
  app.decorate(hook, async (request: any) => { request.user = { id: owner.id, username: owner.username, role: 'admin' } })
}
try {
  await app.register(routes)
  for (const target of ['instance', 'user']) {
    const url = target === 'instance' ? `/instances/${instance.id}/traffic/limit` : `/users/${owner.id}/traffic/limit`
    const read = async () => target === 'instance'
      ? (await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).monthlyTrafficLimit
      : (await prisma.userQuota.findUniqueOrThrow({ where: { userId: owner.id } })).monthlyTrafficLimit
    const put = (payload: object) => app.inject({ method: 'PUT', url, payload })
    const original = await read()
    const omitted = await put({})
    assert.equal(omitted.statusCode, 400, `${target}: omission must not silently remove the existing limit; ${omitted.body}`)
    assert.equal(await read(), original)
    const nullBody = await app.inject({ method: 'PUT', url, headers: { 'content-type': 'application/json' }, payload: 'null' })
    assert.equal(nullBody.statusCode, 400); assert.equal(await read(), original)
    for (const invalid of [-1, '-1', 1.5, '1.5', 'not-a-number', {}, [], ' ', '9223372036854775808', 1024]) {
      const response = await put({ monthlyLimit: invalid })
      assert.equal(response.statusCode, 400, `${target}/${JSON.stringify(invalid)}: ${response.body}`)
      assert.equal(await read(), original)
    }
    for (const valid of ['0', ' 4096 ', '9223372036854775807', null, '', '2048']) {
      const response = await put({ monthlyLimit: valid })
      assert.equal(response.statusCode, 200, response.body)
      assert.equal(await read(), valid === null || valid === '' ? null : BigInt(valid))
    }
  }
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).monthlyTrafficUsed, 100n)
  assert.equal((await prisma.userQuota.findUniqueOrThrow({ where: { userId: owner.id } })).monthlyTrafficUsed, 200n)
  assert.equal(await prisma.balanceLog.count({ where: { userId: owner.id } }), 0)
  console.log('PASS actual traffic limit routes: omitted/null body rejected without clearing, invalid types/negative/decimal/overflow rejected, zero/max/string/null/explicit-empty compatibility and usage/accounting preserved. Local PostgreSQL and stopped fixture; auth hook only.')
} finally {
  await app.close(); await prisma.instance.delete({ where: { id: instance.id } })
  await prisma.host.delete({ where: { id: host.id } }); await prisma.user.delete({ where: { id: owner.id } }); await closePrismaDatabase()
}
// security.ts starts application cleanup timers on import.
process.exit(0)
