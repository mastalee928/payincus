import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { randomUUID } from 'node:crypto'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 23).toString('base64')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: initRoutes } = await import('../src/routes/custom-init-commands.js')
const { default: terminalRoutes } = await import('../src/routes/terminal-saved-commands.js')
const { getTerminalSavedCommandById } = await import('../src/db/terminal-saved-commands.js')
const user = await prisma.user.create({ data: { username: `command-review-${randomUUID()}`, passwordHash: 'unusable-fixture' } })
const app = Fastify()
const session = { id: user.id, username: user.username, role: 'user', sid: 'fixture-command-session', iat: Math.floor(Date.now() / 1000) + 1 }
const auth = async (request: any) => { request.user = { ...session } }
app.decorate('authenticate', auth); app.decorate('authenticateUser', auth)
await app.register(initRoutes, { prefix: '/init' })
await app.register(terminalRoutes, { prefix: '/terminal' })
const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload })
const put = (url: string, payload: object) => app.inject({ method: 'PUT', url, payload })
try {
  // Route IDs must fit the PostgreSQL Int column before any command lookup/write.
  const untouched = await prisma.customInitCommand.create({ data: {
    userId: user.id, name: 'ID boundary fixture', command: 'echo fixture', distros: '["debian"]'
  } })
  const beforeLogs = await prisma.log.count({ where: { userId: user.id } })
  const invalidIds = ['2147483648', '4294967296', '9007199254740991', '9007199254740992',
    '0', '-1', '1.5', '1e2', '0x10', '01', '1junk', 'NaN', 'Infinity', '+1', ' 1', '1 ']
  for (const id of invalidIds) {
    for (const method of ['GET', 'PUT', 'DELETE'] as const) {
      const response = await app.inject({ method, url: `/init/${encodeURIComponent(id)}`,
        ...(method === 'PUT' ? { payload: { name: 'Must not change' } } : {}) })
      assert.equal(response.statusCode, 400, `${method} ${id}: ${response.statusCode}`)
    }
  }
  for (const method of ['GET', 'PUT', 'DELETE'] as const) {
    const response = await app.inject({ method, url: '/init/2147483647',
      ...(method === 'PUT' ? { payload: { name: 'Missing record' } } : {}) })
    assert.equal(response.statusCode, 404, `${method}: maximum valid but missing ID`)
  }
  assert.deepEqual(await prisma.customInitCommand.findUniqueOrThrow({ where: { id: untouched.id } }), untouched)
  assert.equal(await prisma.log.count({ where: { userId: user.id } }), beforeLogs)
  assert.equal((await app.inject({ method: 'GET', url: `/init/${untouched.id}` })).json().command.name, untouched.name)
  await prisma.customInitCommand.delete({ where: { id: untouched.id } })
  console.log('PASS initialization command IDs: 48 invalid requests rejected, Int maximum remains valid and no records/audits changed')

  for (const route of ['/init', '/terminal']) {
    assert.equal((await post(route, { name: '   ', command: 'echo fixture', distros: ['debian'] })).statusCode, 400)
    assert.equal((await post(route, { name: 'Fixture', command: ' \n\t', distros: ['debian'] })).statusCode, 400)
  }
  await prisma.customInitCommand.createMany({ data: Array.from({ length: 49 }, (_, i) => ({ userId: user.id, name: `Fixture-${i}`, command: 'echo fixture', distros: '["debian"]' })) })
  const initCreates = await Promise.all(Array.from({ length: 10 }, () => post('/init', { name: 'Final slot', command: 'echo fixture', distros: ['debian'] })))
  assert.equal(initCreates.filter(r => r.statusCode === 201).length, 1)
  assert.equal(await prisma.customInitCommand.count({ where: { userId: user.id } }), 50)
  const initId = initCreates.find(r => r.statusCode === 201)!.json().id
  const initUpdates = await Promise.all([put(`/init/${initId}`, { name: 'Changed name' }), put(`/init/${initId}`, { command: 'echo changed' })])
  assert.ok(initUpdates.every(r => r.statusCode === 200))
  const init = await prisma.customInitCommand.findUniqueOrThrow({ where: { id: initId } })
  assert.deepEqual([init.name, init.command], ['Changed name', 'echo changed'], 'independent concurrent patches are preserved')
  assert.equal((await put(`/init/${initId}`, { command: '   ' })).statusCode, 400)
  await prisma.terminalSavedCommand.createMany({ data: Array.from({ length: 99 }, (_, i) => ({ userId: user.id, name: `Fixture-${i}`, command: 'echo fixture' })) })
  const createLogsBefore = await prisma.log.count({ where: { userId: user.id, action: 'terminal.saved_command.create' } })
  const terminalCreates = await Promise.all(Array.from({ length: 10 }, () => post('/terminal', { name: 'Final slot', command: 'echo fixture' })))
  assert.equal(terminalCreates.filter(r => r.statusCode === 201).length, 1)
  assert.equal(terminalCreates.filter(r => r.statusCode === 400 && r.json().code === 'MAX_COMMANDS_REACHED').length, 9,
    'All losing requests must report the quota, not an unrelated server error')
  assert.equal(await prisma.terminalSavedCommand.count({ where: { userId: user.id } }), 100)
  assert.equal(await prisma.log.count({ where: { userId: user.id, action: 'terminal.saved_command.create' } }), createLogsBefore + 1)
  const atLimit = await prisma.terminalSavedCommand.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } })
  const fullRetry = await post('/terminal', { name: 'Still full', command: 'echo fixture' })
  assert.equal(fullRetry.statusCode, 400); assert.equal(fullRetry.json().code, 'MAX_COMMANDS_REACHED')
  assert.deepEqual(await prisma.terminalSavedCommand.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } }), atLimit)
  assert.equal(await prisma.log.count({ where: { userId: user.id, action: 'terminal.saved_command.create' } }), createLogsBefore + 1)
  console.log('PASS terminal quota: 99 plus ten concurrent creates gives one receipt/audit and nine explicit quota rejections; full retry preserves all 100 rows')
  const terminalId = terminalCreates.find(r => r.statusCode === 201)!.json().command.id
  const terminalUpdates = await Promise.all([put(`/terminal/${terminalId}`, { name: 'Changed name' }), put(`/terminal/${terminalId}`, { command: 'echo changed' })])
  assert.ok(terminalUpdates.every(r => r.statusCode === 200))
  const terminal = await getTerminalSavedCommandById(terminalId, user.id)
  assert.deepEqual([terminal?.name, terminal?.command], ['Changed name', 'echo changed'], 'serial edits read current encrypted fields instead of stale copies')
  const deleted = await Promise.all([app.inject({ method: 'DELETE', url: `/terminal/${terminalId}` }), put(`/terminal/${terminalId}`, { name: 'After delete' })])
  assert.equal(deleted[0].statusCode, 200)
  assert.ok([200, 404].includes(deleted[1].statusCode), deleted[1].body)
  assert.equal(await prisma.terminalSavedCommand.count({ where: { id: terminalId } }), 0)
  assert.equal((await put(`/terminal/${terminalId}`, { name: 'After delete' })).statusCode, 404)
  await prisma.tokenInvalidation.create({ data: { userId: user.id, sessionId: session.sid, invalidatedAt: session.iat } })
  assert.equal((await put(`/init/${initId}`, { name: 'Revoked' })).statusCode, 403)
  assert.equal((await post('/terminal', { name: 'Revoked', command: 'echo fixture' })).statusCode, 403)
  assert.equal((await app.inject({ method: 'DELETE', url: `/init/${initId}` })).statusCode, 403)
  await prisma.tokenInvalidation.deleteMany({ where: { userId: user.id } })
  await prisma.user.update({ where: { id: user.id }, data: { status: 'banned' } })
  assert.equal((await put(`/init/${initId}`, { name: 'Banned' })).statusCode, 403)
  assert.equal((await post('/terminal', { name: 'Banned', command: 'echo fixture' })).statusCode, 403)
  assert.equal((await prisma.customInitCommand.findUniqueOrThrow({ where: { id: initId } })).name, 'Changed name')
  console.log('PASS real PostgreSQL/Fastify commands: normalized blank rejection, concurrent limits, independent edits, delete race, revoked/banned writes')
} finally {
  await app.close()
  await prisma.user.delete({ where: { id: user.id } })
  await closePrismaDatabase()
}
process.exit(0)
