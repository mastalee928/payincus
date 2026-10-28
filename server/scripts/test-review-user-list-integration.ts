import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use isolated local *_pool_test database')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { getLastLoginRecordsForUsers } = await import('../src/db/login-records.js')
const { getUsersPaginated } = await import('../src/db/pagination.js')
const { default: userRoutes } = await import('../src/routes/users.js')
const tag = randomUUID().replaceAll('-', '')
const prefix = `review-list-${tag}-`
const userIds: number[] = []
let hostId: number | undefined
let collecting = false
let statements: string[] = []
let returnedLoginRows: number[] = []
const originalQuery = Client.prototype.query
Client.prototype.query = function (this: Client, ...args: any[]) {
  const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text || ''
  const measured = collecting
  if (measured) statements.push(sql)
  const measuringLogin = measured && /\bFROM login_records\b/i.test(sql)
  const callbackIndex = args.findIndex(arg => typeof arg === 'function')
  if (measuringLogin && callbackIndex >= 0) {
    const callback = args[callbackIndex]
    args[callbackIndex] = (error: Error | null, response: { rows: unknown[] } | undefined) => {
      if (!error && response) returnedLoginRows.push(response.rows.length)
      return callback(error, response)
    }
  }
  const result = Reflect.apply(originalQuery, this, args)
  if (measuringLogin && callbackIndex < 0 && result && typeof result.then === 'function') {
    return result.then((response: { rows: unknown[] }) => {
      returnedLoginRows.push(response.rows.length)
      return response
    })
  }
  return result
} as typeof Client.prototype.query

const app = Fastify()
let actorId = 0
const fixtureAuthenticate = async (request: any, reply: any) => {
  if (request.headers['x-fixture-admin'] !== 'yes') return reply.code(403).send({ code: 'FORBIDDEN' })
  request.user = { id: actorId, username: `review-list-admin-${tag}`, role: 'admin', sid: tag, iat: Math.floor(Date.now() / 1000) }
}
for (const name of ['authenticate', 'authenticateAdmin', 'authenticateUser']) app.decorate(name, fixtureAuthenticate)

async function measuredList(pageSize: number, query: Record<string, string> = {}) {
  statements = []
  returnedLoginRows = []
  collecting = true
  try {
    const response = await app.inject({ method: 'GET', url: '/users/', query: {
      search: prefix, searchFields: 'username', pageSize: String(pageSize), ...query
    }, headers: { 'x-fixture-admin': 'yes' } })
    assert.equal(response.statusCode, 200, response.body)
    return { data: response.json(), queries: [...statements], loginRows: [...returnedLoginRows] }
  } finally { collecting = false }
}

try {
  const admin = await prisma.user.create({ data: { username: `review-list-admin-${tag}`, passwordHash: 'unusable-fixture', role: 'admin' } })
  actorId = admin.id
  userIds.push(admin.id)
  const createdAt = Date.now() - 3600000
  await prisma.user.createMany({ data: Array.from({ length: 100 }, (_, index) => ({
    username: `${prefix}${String(index).padStart(3, '0')}`, passwordHash: 'unusable-fixture', createdAt: new Date(createdAt + index),
    ...(index === 0 ? { avatarBadgeId: 'review-fixture-badge', twoFactorEnabled: true, twoFactorSecret: 'unusable-2fa-fixture',
      balance: '12.34', hostingBalance: '56.78', email: 'demo@payincus.com' } : {})
  })) })
  const users = await prisma.user.findMany({ where: { username: { startsWith: prefix } }, orderBy: { username: 'asc' } })
  userIds.push(...users.map(user => user.id))
  const target = users[0]!
  const empty = users[99]!
  const other = await prisma.user.create({ data: { username: `review-list-outside-${tag}`, passwordHash: 'unusable-fixture' } })
  userIds.push(other.id)
  const host = await prisma.host.create({ data: { userId: admin.id, name: `review-list-${tag}`, url: 'https://127.0.0.1:1' } })
  hostId = host.id
  await prisma.instance.createMany({ data: (['running', 'stopped', 'error', 'deleted'] as const).map((status, index) => ({
    userId: target.id, hostId: host.id, name: `review-list-${tag}-${index}`, incusId: `fixture-${tag}-${index}`,
    image: 'fixture', status, cpu: 100, memory: 512, disk: 1024
  })) })
  const instance = await prisma.instance.findFirstOrThrow({ where: { hostId: host.id } })
  await prisma.userOAuthBinding.create({ data: { userId: target.id, provider: 'github', providerUserId: tag, accessToken: 'unusable-oauth-fixture' } })
  await prisma.userOAuthBinding.create({ data: { userId: users[1]!.id, provider: 'google', providerUserId: tag } })
  await prisma.userPoints.create({ data: { userId: target.id, points: 7, totalEarned: 11 } })
  await prisma.hostingBalanceLog.createMany({ data: [
    { userId: target.id, type: 'income', amount: 2, frozen: true },
    { userId: target.id, type: 'income', amount: 3, frozen: true },
    { userId: target.id, type: 'income', amount: 100, frozen: false },
  ] })
  await prisma.balanceLog.createMany({ data: [
    { userId: target.id, type: 'consume', amount: 10, balanceBefore: 20, balanceAfter: 10, instanceId: instance.id },
    { userId: target.id, type: 'refund', amount: 3, balanceBefore: 10, balanceAfter: 13, instanceId: instance.id },
    { userId: target.id, type: 'refund', amount: 100, balanceBefore: 13, balanceAfter: 113 },
  ] })
  await prisma.loginRecord.createMany({ data: Array.from({ length: 2000 }, (_, index) => ({
    userId: target.id, ip: '192.0.2.1', createdAt: new Date(createdAt + index), userAgent: 'fixture-history'
  })) })
  const newestTime = new Date(createdAt + 10000)
  await prisma.loginRecord.create({ data: { userId: target.id, ip: '192.0.2.2', createdAt: newestTime } })
  const newest = await prisma.loginRecord.create({ data: { userId: target.id, ip: '192.0.2.3', country: 'fixture-country',
    city: 'fixture-city', userAgent: 'fixture-latest', createdAt: newestTime } })
  await prisma.loginRecord.create({ data: { userId: other.id, ip: '192.0.2.99', createdAt: new Date(newestTime.getTime() + 1) } })
  await app.register(userRoutes, { prefix: '/users' })
  await measuredList(1) // Warm the driver before comparing real SQL statement counts.
  const one = await measuredList(1)
  const hundred = await measuredList(100)
  assert.equal(one.data.users.length, 1)
  assert.equal(hundred.data.users.length, 100)
  assert.equal(hundred.queries.length, one.queries.length, 'query count must not grow with users per page')
  assert.ok(hundred.queries.length >= 7, 'the test must observe real database statements')
  assert.ok(hundred.queries.length < 20, `unexpected query count: ${hundred.queries.length}`)
  assert.deepEqual(hundred.loginRows, [1], 'database returns only the latest row, not all 2002 history rows')
  const row = hundred.data.users.find((user: any) => user.id === target.id)
  assert.equal(row.avatarBadgeId, 'review-fixture-badge')
  assert.equal(row.twoFAEnabled, true)
  assert.equal(row.instanceCount, 3, 'deleted instances stay excluded')
  assert.equal(row.hasGithubBinding, true)
  assert.equal(row.balance, 12.34)
  assert.equal(row.hostingBalance, 56.78)
  assert.equal(row.hostingBalanceFrozen, 5)
  assert.equal(row.totalConsume, 7, 'historical positive consume and only instance refunds retain existing net-consume semantics')
  assert.equal(row.points, 7)
  assert.equal(row.totalEarnedPoints, 11)
  assert.equal(row.lastLogin.ip, '192.0.2.3')
  assert.equal(row.lastLogin.createdAt, newestTime.toISOString())
  assert.equal(hundred.data.users.find((user: any) => user.id === users[1]!.id).hasGithubBinding, false)
  const zero = hundred.data.users.find((user: any) => user.id === empty.id)
  for (const key of ['instanceCount', 'balance', 'hostingBalance', 'hostingBalanceFrozen', 'totalConsume', 'points', 'totalEarnedPoints']) assert.equal(zero[key], 0)
  assert.equal(zero.lastLogin, null)
  assert.equal(zero.avatarBadgeId, null)
  assert.equal(zero.twoFAEnabled, false)
  assert.equal(zero.hasGithubBinding, false)
  const serialized = JSON.stringify(hundred.data)
  for (const secret of ['unusable-fixture', 'unusable-2fa-fixture', 'unusable-oauth-fixture', '192.0.2.99']) assert.ok(!serialized.includes(secret))

  const exact = await measuredList(100, { search: target.username, exact: 'true' })
  assert.equal(exact.data.total, 1)
  assert.equal(exact.data.users[0].id, target.id)
  const capped = await measuredList(1000)
  assert.equal(capped.data.pageSize, 100)
  const beyond = await measuredList(100, { page: '2' })
  assert.equal(beyond.data.users.length, 0)
  assert.equal(beyond.data.total, 100)
  const helper = await getUsersPaginated({ search: target.username, searchFields: ['username'], exactMatch: true })
  assert.equal(helper.items[0]!.avatar_badge_id, 'review-fixture-badge', 'pagination helper preserves badge independently of HTTP projection')
  const latest = await getLastLoginRecordsForUsers([target.id, target.id, empty.id])
  assert.equal(latest.size, 2)
  assert.equal(latest.get(target.id)?.id, newest.id, 'ID breaks equal creation-time ties deterministically')
  assert.equal(latest.get(empty.id), null)
  assert.equal((await getLastLoginRecordsForUsers([])).size, 0)
  const demo = await app.inject({ method: 'GET', url: '/users/', query: { search: target.username, searchFields: 'username', exact: 'true' },
    headers: { 'x-fixture-admin': 'yes', host: 'demoadmin.payincus.com' } })
  assert.equal(demo.statusCode, 200, demo.body)
  assert.equal(demo.json().users[0].lastLogin.ip, '已隐藏')
  assert.equal(demo.json().users[0].lastLogin.country, null)
  assert.equal(demo.json().users[0].lastLogin.city, null)
  assert.equal((await app.inject({ method: 'GET', url: '/users/' })).statusCode, 403, 'route retains its admin authentication boundary')
  console.log(`User list integration passed: 1/100-user pages both use ${hundred.queries.length} SQL statements; 2002 login rows reduce to 1 returned row; badge, counts, financial aggregates, search/pagination, empty values and demo redaction preserved`)
} finally {
  collecting = false
  Client.prototype.query = originalQuery
  await app.close()
  if (hostId !== undefined) {
    await prisma.instance.deleteMany({ where: { hostId } })
    await prisma.host.delete({ where: { id: hostId } })
  }
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await closePrismaDatabase()
}
// Imported route dependencies may own maintenance timers; all fixture resources
// and the database pool above have completed their explicit cleanup.
process.exit(0)
