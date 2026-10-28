import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'),
  'Use isolated local *_pool_test PostgreSQL')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const tickets = await import('../src/db/tickets.js')
const { default: routes } = await import('../src/routes/tickets.js')
const tag = `ticket-page-${randomUUID()}`
const user = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: user.id, name: tag, url: 'https://127.0.0.1:1', certPath: '', keyPath: '' } })
const app = Fastify()
let role = 'user'
app.decorate('authenticate', async (request: any) => { request.user = { id: user.id, role } })
app.decorate('authenticateAdmin', async (_request: any, reply: any) => reply.code(403).send({ error: 'FORBIDDEN' }))
app.decorate('requireAdmin', async (_request: any, reply: any) => {
  if (role !== 'admin') return reply.code(403).send({ error: 'FORBIDDEN' })
})
try {
  await app.register(routes, { prefix: '/tickets' })
  for (let index = 0; index < 23; index++) {
    await prisma.ticket.create({ data: { userId: user.id, hostId: host.id, subject: `${tag} ${index}`,
      updatedAt: new Date(Date.now() - index * 1000) } })
  }
  const ticket = await prisma.ticket.findFirstOrThrow({ where: { userId: user.id }, orderBy: { id: 'asc' } })
  await prisma.ticketMessage.createMany({ data: Array.from({ length: 23 }, (_, index) => ({
    ticketId: ticket.id, senderId: user.id, content: `${tag} message ${index}`, createdAt: new Date(Date.now() + index * 1000)
  })) })
  const endpoints = ['/tickets/', `/tickets/hosts/${host.id}`, '/tickets/my-hosts', `/tickets/${ticket.id}/messages`]
  const get = async (url: string) => {
    const response = await app.inject({ method: 'GET', url })
    assert.equal(response.statusCode, 200, `${url}: ${response.body}`)
    return response.json()
  }
  for (const endpoint of endpoints) {
    for (const page of ['0', '-1', '1.5', '2suffix', 'NaN', 'Infinity', '9007199254740992', '2147483647', '1e2', '0x10', '']) {
      const result = await get(`${endpoint}?page=${page}&pageSize=100`)
      assert.equal(result.page, 1, endpoint + ': invalid integer or overflowing offset must use first page')
      assert.equal(result.pageSize, 100)
      assert.equal(result.total, 23)
      assert.equal((result.tickets ?? result.messages).length, 23)
    }
    for (const pageSize of ['0', '-1', '1.5', '2suffix', 'NaN', 'Infinity', '9007199254740992', '1e2', '0x10']) {
      const result = await get(`${endpoint}?page=1&pageSize=${pageSize}`)
      assert.equal(result.pageSize, endpoint.endsWith('/messages') ? 50 : 10)
    }
    const repeated = await get(`${endpoint}?page=2&page=3&pageSize=5&pageSize=6&search=foo&search=bar`)
    assert.equal(repeated.page, 1)
    assert.equal(repeated.total, 23, 'repeated search values cannot crash trim()')
    const second = await get(`${endpoint}?page=2&pageSize=10`)
    const third = await get(`${endpoint}?page=3&pageSize=10`)
    assert.equal(second.page, 2); assert.equal(second.pageSize, 10); assert.equal(second.totalPages, 3)
    assert.equal((second.tickets ?? second.messages).length, 10)
    assert.equal((third.tickets ?? third.messages).length, 3)
    assert.equal(new Set([...(second.tickets ?? second.messages), ...(third.tickets ?? third.messages)].map((row: { id: number }) => row.id)).size, 13)
    const boundary = await get(`${endpoint}?page=21474837&pageSize=100`)
    assert.equal(boundary.page, 21474837, 'largest bounded page remains valid')
    assert.equal((boundary.tickets ?? boundary.messages).length, 0)
    assert.equal((await get(`${endpoint}?page=21474838&pageSize=100`)).page, 1)
    assert.equal((await get(`${endpoint}?pageSize=101`)).pageSize, 100)
  }
  for (const search of ['2147483648', '9007199254740992', '999999999999999999999', '1e2', '0x10']) {
    const expected = await prisma.ticket.create({ data: { userId: user.id, hostId: host.id, subject: `literal ${search}` } })
    for (const endpoint of endpoints.slice(0, 3)) {
      const found = await get(`${endpoint}?search=${search}`)
      assert.deepEqual(found.tickets.map((row: { id: number }) => row.id), [expected.id], 'out-of-range IDs remain ordinary text searches')
    }
    await prisma.ticket.delete({ where: { id: expected.id } })
  }
  assert.equal((await get(`/tickets/?search=${ticket.id}`)).tickets.some((row: { id: number }) => row.id === ticket.id), true)
  for (const page of [Number.MAX_SAFE_INTEGER, Infinity, NaN, 2.5, -1, 2147483647]) {
    const options = { page, pageSize: 100 }
    for (const result of await Promise.all([
      tickets.getUserTickets(user.id, options), tickets.getHostTickets(host.id, options),
      tickets.getOwnerAllTickets(user.id, options), tickets.getTicketMessages(ticket.id, options)
    ])) {
      assert.equal(result.page, 1, 'DB helpers independently reject unsafe offsets')
      assert.equal(result.total, 23)
    }
  }
  assert.equal(await prisma.ticket.count({ where: { userId: user.id } }), 23)
  assert.equal(await prisma.ticketMessage.count({ where: { senderId: user.id } }), 23)
  role = 'admin'
  let rejectedIds = 0
  for (const id of ['2147483648', '9007199254740991', '9007199254740992', '1.5', '1e2', '0x10', '-1', '0', '1suffix']) {
    const calls = [
      { method: 'GET', url: `/tickets/${id}` },
      { method: 'GET', url: `/tickets/${id}/support-context` },
      { method: 'GET', url: `/tickets/${id}/messages` },
      { method: 'GET', url: `/tickets/attachments/${id}/content` },
      { method: 'GET', url: `/tickets/hosts/${id}` },
      { method: 'GET', url: `/tickets/my-hosts?hostId=${id}` },
      { method: 'POST', url: `/tickets/${id}/messages`, payload: { content: 'invalid target reply' } },
      { method: 'POST', url: `/tickets/${id}/close` },
      { method: 'PATCH', url: `/tickets/${id}/status`, payload: { status: 'open' } },
      { method: 'DELETE', url: `/tickets/${id}/messages/1` },
      { method: 'DELETE', url: `/tickets/${ticket.id}/messages/${id}` },
      { method: 'POST', url: `/tickets/${id}/internal-notes`, payload: { content: 'invalid target note' } },
      { method: 'POST', url: `/tickets/${id}/notify`, payload: { content: 'invalid target notification' } },
      { method: 'POST', url: `/tickets/${id}/links`, payload: { objectType: 'host', objectId: host.id } },
      { method: 'POST', url: `/tickets/${ticket.id}/links`, payload: { objectType: 'host', objectId: id } },
      { method: 'POST', url: '/tickets/', payload: { subject: 'invalid target', content: 'must not create a ticket', instanceId: id } },
    ] as const
    for (const call of calls) {
      const response = await app.inject(call)
      assert.equal(response.statusCode, 400, `${call.method} ${call.url}: ${response.body}`)
      rejectedIds++
    }
  }
  for (const id of [2147483648, Number.MAX_SAFE_INTEGER, 1.5, -1, 0]) {
    for (const call of [
      { method: 'POST', url: `/tickets/${ticket.id}/links`, payload: { objectType: 'host', objectId: id } },
      { method: 'POST', url: '/tickets/', payload: { subject: 'invalid target', content: 'must not create a ticket', instanceId: id } },
    ] as const) {
      const response = await app.inject(call)
      assert.equal(response.statusCode, 400, `${call.method} ${call.url} numeric ID ${id}: ${response.body}`)
      rejectedIds++
    }
  }
  assert.equal((await app.inject({ method: 'GET', url: '/tickets/2147483647' })).statusCode, 404, 'maximum PostgreSQL Int ID is valid but absent')
  role = 'user'
  assert.equal((await app.inject({ method: 'GET', url: `/tickets/${ticket.id}` })).statusCode, 200)
  assert.equal(await prisma.ticket.count({ where: { userId: user.id } }), 23)
  assert.equal(await prisma.ticketMessage.count({ where: { senderId: user.id } }), 23)
  assert.equal(await prisma.ticketInternalNote.count({ where: { ticketId: ticket.id } }), 0)
  assert.equal(await prisma.ticketObjectLink.count({ where: { ticketId: ticket.id } }), 0)
  assert.equal(await prisma.inboxMessage.count({ where: { userId: user.id } }), 0)
  console.log(`PASS ${rejectedIds} invalid PostgreSQL ID path/query/body cases, maximum ID 404 and ordinary ticket 200; no writes`)
  console.log('PASS real PG/Fastify ticket pagination: four routes/helpers, malformed/unsafe/offset boundary/repeated query inputs, valid second/last pages, 100-item limit and literal large-number searches; records unchanged. Authentication middleware is a fixture; no browser or production evidence.')
} finally {
  await app.close()
  await prisma.ticket.deleteMany({ where: { userId: user.id } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.delete({ where: { id: user.id } })
  await closePrismaDatabase()
}
process.exit(process.exitCode || 0)
