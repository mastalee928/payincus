import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import ts from 'typescript'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { isAccessTokenInvalidated } = await import('../src/lib/security.js')
const tag = 'auth-current-' + randomUUID(), app = Fastify(), users: number[] = []
let failure: unknown
try {
  await app.register(jwt, { secret: randomUUID() })
  // Execute the unchanged application hooks without starting its business workers/listener.
  const source = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8')
  const start = source.indexOf('async function ensureActiveAccessToken(')
  const end = source.indexOf('// 注意: 安全响应头已由 @fastify/helmet 处理', start)
  assert.ok(start >= 0 && end > start)
  const hookSource = source.slice(start, end)
  for (const name of ['authenticate', 'authenticateAdmin', 'authenticateUser', 'requireAdmin']) {
    assert.ok(hookSource.includes(`fastify.decorate('${name}'`))
  }
  const compiled = ts.transpileModule(hookSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  new Function('fastify', 'prisma', 'isAccessTokenInvalidated', compiled)(app, prisma, isAccessTokenInvalidated)
  for (const [path, hooks] of [['read', [app.authenticate]], ['admin', [app.authenticateAdmin]],
    ['regular', [app.authenticateUser]], ['combined', [app.authenticate, app.requireAdmin]]] as const) {
    app.get('/' + path, { onRequest: [...hooks] }, async request => ({ id: request.user.id, username: request.user.username, role: request.user.role }))
  }
  const first = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture', role: 'admin' } }); users.push(first.id)
  const other = await prisma.user.create({ data: { username: tag + '-other', passwordHash: 'unusable-fixture', role: 'user' } }); users.push(other.id)
  const issuedAt = Math.floor(Date.now() / 1000)
  const token = (userId: number, sid: string, role: 'user' | 'admin' = 'admin', iat = issuedAt) => {
    const payload = { id: userId, sid, role, username: 'stale-name', iat }
    return app.jwt.sign(payload)
  }
  const firstToken = token(first.id, tag), secondSession = token(first.id, tag + '-session2'), otherToken = token(other.id, tag, 'user')
  let requests = 0
  const check = async (path: string, accessToken: string | undefined, status: number, code?: string) => {
    requests++
    const result = await app.inject({ method: 'GET', url: '/' + path, headers: accessToken ? { authorization: 'Bearer ' + accessToken } : {} })
    assert.equal(result.statusCode, status, `${path} expected ${status}`)
    if (code) assert.equal(result.json().code, code)
    return result.json()
  }
  for (let count = 0; count < 3; count++) {
    assert.equal((await check('read', firstToken, 200)).username, first.username)
    await check('admin', firstToken, 200); await check('combined', firstToken, 200)
  }
  await prisma.user.update({ where: { id: first.id }, data: { role: 'user', username: tag + '-new' } })
  const downgraded = await check('read', firstToken, 200)
  assert.equal(downgraded.username, tag + '-new'); assert.equal(downgraded.role, 'user')
  await check('admin', firstToken, 403, 'ADMIN_REQUIRED'); await check('combined', firstToken, 403, 'ADMIN_REQUIRED')
  await check('regular', firstToken, 200)
  await prisma.user.update({ where: { id: first.id }, data: { role: 'admin' } })
  await check('admin', firstToken, 200); await check('regular', firstToken, 403, 'USER_ONLY')
  await prisma.user.update({ where: { id: first.id }, data: { status: 'banned' } })
  for (const path of ['read', 'admin', 'regular', 'combined']) await check(path, firstToken, 401, 'ACCOUNT_BANNED')
  await check('regular', otherToken, 200)
  await prisma.user.update({ where: { id: first.id }, data: { status: 'active' } })
  await check('read', firstToken, 200)
  await prisma.tokenInvalidation.create({ data: { userId: first.id, sessionId: tag, invalidatedAt: issuedAt } })
  for (const path of ['read', 'admin', 'regular', 'combined']) await check(path, firstToken, 401, 'SESSION_INVALIDATED')
  await check('read', secondSession, 200); await check('regular', otherToken, 200)
  await check('read', token(first.id, tag, 'admin', issuedAt + 1), 200)
  await prisma.tokenInvalidation.create({ data: { userId: first.id, sessionId: '__USER_LEVEL__', invalidatedAt: issuedAt } })
  await check('read', secondSession, 401, 'SESSION_INVALIDATED'); await check('regular', otherToken, 200)
  await prisma.tokenInvalidation.deleteMany({ where: { userId: first.id } })
  // Failure of either current-state read fails closed even after a successful warm request.
  for (const delegate of [prisma.user, prisma.tokenInvalidation]) {
    const original = delegate.findUnique
    let reads = 0
    delegate.findUnique = (async () => { reads++; throw new Error('fixture-current-auth-read-failure') }) as unknown as typeof original
    try { await check('read', firstToken, 401); assert.equal(reads, 1) }
    finally { delegate.findUnique = original }
    await check('read', firstToken, 200)
  }
  await check('read', undefined, 401); await check('read', 'invalid', 401)
  await prisma.user.delete({ where: { id: first.id } })
  await check('read', firstToken, 401, 'UNAUTHORIZED')
  assert.equal(await prisma.log.count({ where: { userId: other.id } }), 0)
  console.log(`PASS ${requests} original application auth-hook requests with real JWT/PG: warm authorization never caches stale role, status, username, session or account revocation; other users and sessions remain isolated, database failure refuses access`)
} catch (error) { failure = error }
finally { await app.close(); await prisma.user.deleteMany({ where: { id: { in: users } } }); await closePrismaDatabase() }
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
