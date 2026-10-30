import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mock } from 'node:test'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/notifications.js')
const { default: adminRoutes } = await import('../src/routes/admin-notification-channels.js')
const tag = 'notification-id-' + randomUUID()
const user = await prisma.user.create({ data: { username: tag, role: 'admin', passwordHash: 'unusable-fixture' } })
const channels = await Promise.all([false, true].map(isGlobal => prisma.notificationChannel.create({ data: {
  userId: user.id, name: tag, type: 'telegram', isGlobal, config: { botToken: '123456:' + 'a'.repeat(24), chatId: '123456' }
} })))
const ids = channels.map(row => row.id)
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = {
  id: user.id, username: user.username, role: user.role, sid: tag, iat: Math.floor(Date.now() / 1000) + 1
} })
app.decorate('authenticateAdmin', app.authenticate)
let remoteCalls = 0
mock.method(globalThis, 'fetch', async () => { remoteCalls++; throw Error('Invalid input must not send a notification') })
const requests = (id: string) => [
  { method: 'GET' as const, url: '/channels/' + id },
  { method: 'PATCH' as const, url: '/channels/' + id, payload: { name: 'Must not change' } },
  { method: 'DELETE' as const, url: '/channels/' + id },
  { method: 'POST' as const, url: '/channels/' + id + '/test' },
  { method: 'POST' as const, url: '/channels/' + id + '/toggle' },
  { method: 'GET' as const, url: '/global/' + id },
  { method: 'PATCH' as const, url: '/global/' + id, payload: { name: 'Must not change' } },
  { method: 'DELETE' as const, url: '/global/' + id },
  { method: 'POST' as const, url: '/global/' + id + '/test' }
]
const capture = async () => ({
  channels: await prisma.notificationChannel.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } }),
  logs: await prisma.notificationLog.findMany({ where: { channelId: { in: ids } }, orderBy: { id: 'asc' } }),
  audits: await prisma.log.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } })
})
let failure: unknown
try {
  await app.register(routes, { prefix: '/channels' }); await app.register(adminRoutes, { prefix: '/global' })
  const before = await capture()
  for (const type of ['unknown', 'TELEGRAM', 'telegram ', 12, {}, null]) {
    assert.equal((await app.inject({ method: 'POST', url: '/channels', payload: { type, name: 'Invalid', config: {} } })).statusCode, 400)
  }
  const result = await app.inject(requests('2147483648')[0])
  assert.equal(result.statusCode, 400, 'Personal notification IDs must fit PG Int before lookup')
  for (const value of ['0', '-1', '1.5', '1e3', '01', '1suffix', '%2B1', '%201', '2147483648', '9007199254740991',
    '9007199254740992', 'NaN', 'Infinity', '0x10']) {
    for (const request of requests(value)) {
      const response = await app.inject(request)
      assert.equal(response.statusCode, 400, request.method + ' ' + request.url)
    }
  }
  for (const request of requests('2147483647')) assert.equal((await app.inject(request)).statusCode, 404, request.url)
  for (const request of [requests(String(channels[0].id))[0], requests(String(channels[1].id))[5]]) {
    const response = await app.inject(request)
    assert.equal(response.statusCode, 200); assert.ok(response.json().channel.id)
    assert.ok(!response.body.includes('123456:' + 'a'.repeat(24)))
  }
  for (const status of ['unknown', 'sent%20', '1', 'sent&status=failed']) {
    assert.equal((await app.inject({ method: 'GET', url: '/channels/logs?status=' + status })).statusCode, 200)
  }
  assert.equal(remoteCalls, 0); assert.deepEqual(await capture(), before)
  console.log('PASS 126 invalid personal/global IDs return 400, nine valid absent upper bounds return 404, valid reads remain masked; invalid enums reject or normalize, zero sends and no persistent change')
} catch (error) { failure = error }
finally {
  mock.restoreAll(); await app.close()
  await prisma.notificationLog.deleteMany({ where: { channelId: { in: ids } } })
  await prisma.log.deleteMany({ where: { userId: user.id } })
  await prisma.notificationChannel.deleteMany({ where: { id: { in: ids } } })
  await prisma.user.delete({ where: { id: user.id } }); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
