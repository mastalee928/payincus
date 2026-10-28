import assert from 'node:assert/strict'
import Fastify from 'fastify'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const db = await import('../src/db/users.js')
const { deleteOAuthBinding } = await import('../src/db/oauth.js')
const { default: routes } = await import('../src/routes/users.js')
const tag = randomUUID().replaceAll('-', '').slice(0, 12)
const admin = await prisma.user.create({ data: { username: `admin-${tag}`, passwordHash: 'unusable-fixture', role: 'admin' } })
const target = await prisma.user.create({ data: { username: `target-${tag}`, passwordHash: 'unusable-fixture', quota: { create: {} } } })
const ids = [admin.id, target.id]
const actor = { id: admin.id, username: admin.username, role: 'admin', sid: 'fixture-admin-session', iat: Math.floor(Date.now() / 1000) + 1 }
const app = Fastify()
app.decorate('authenticateAdmin', async (request: any) => { request.user = { ...actor } })
app.decorate('authenticate', async (request: any) => { request.user = { ...actor } })
app.decorate('authenticateUser', async (request: any) => { request.user = { ...actor } })
const call = (method: 'POST' | 'PATCH' | 'DELETE', suffix: string, payload?: object) => app.inject({ method, url: `/users/${target.id}${suffix}`, ...(payload ? { payload } : {}) })
const seedSession = () => prisma.refreshToken.create({ data: {
  userId: target.id, username: target.username, role: 'user', token: `fixture-${randomUUID()}`, expiresAt: new Date(Date.now() + 60000)
} })
const seedOAuth = () => prisma.userOAuthBinding.create({ data: { userId: target.id, provider: 'github', providerUserId: `fixture-${randomUUID()}` } })
const trigger = `review_admin_${tag}`
try {
  await app.register(routes, { prefix: '/users' })
  const creations = await Promise.all(Array.from({ length: 6 }, (_, i) => app.inject({ method: 'POST', url: '/users/', payload: {
    username: `created${tag}${i}`, email: i % 2 ? `Create-${tag}@example.com` : `create-${tag}@example.com`, role: 'user', status: 'banned'
  } })))
  assert.equal(creations.filter(r => r.statusCode === 200).length, 1, 'case variants cannot allocate the same email twice')
  assert.ok(creations.every(r => r.statusCode === 200 || r.statusCode === 400), 'conflicts are business errors')
  const created = creations.find(r => r.statusCode === 200)!.json()
  ids.push(created.user.id)
  const createdRow = await prisma.user.findUniqueOrThrow({ where: { id: created.user.id }, include: { quota: true } })
  assert.equal(createdRow.status, 'banned', 'new account is never committed active before a later ban')
  assert.ok(createdRow.quota)
  assert.ok(await bcrypt.compare(created.initialPassword, createdRow.passwordHash))

  await seedSession()
  const reset = await call('POST', '/reset-password', { password: 'Fixture#9276Pass' })
  assert.equal(reset.statusCode, 200, reset.body)
  assert.equal(reset.json().password, undefined)
  assert.equal(reset.json().newPassword, undefined)
  assert.ok(await bcrypt.compare('Fixture#9276Pass', (await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).passwordHash))
  assert.equal(await prisma.refreshToken.count({ where: { userId: target.id } }), 0)
  assert.ok(await prisma.tokenInvalidation.findUnique({ where: { userId_sessionId: { userId: target.id, sessionId: '__USER_LEVEL__' } } }))

  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = ${target.id} THEN RAISE EXCEPTION 'fixture-admin-revocation-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT OR UPDATE ON token_invalidations FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  try {
    await seedSession()
    await seedOAuth()
    await prisma.user.update({ where: { id: target.id }, data: { twoFactorEnabled: true, twoFactorSecret: 'fixture-secret', twoFactorRecoveryCodes: 'fixture-codes' } })
    const before = await db.get2FAMutationState(target.id)
    for (const [method, suffix, payload] of [
      ['POST', '/reset-password', { password: 'Fixture#3297Changed' }],
      ['POST', '/disable-2fa', undefined],
      ['DELETE', '/oauth/github', undefined],
      ['PATCH', '/status', { status: 'banned' }],
      ['POST', '/revoke-sessions', undefined],
      ['PATCH', '/role', { role: 'admin' }]
    ] as const) {
      const result = await call(method, suffix, payload)
      assert.equal(result.statusCode, 500, `injected persistence failure must be reported: ${suffix}`)
      assert.deepEqual(await db.get2FAMutationState(target.id), before, `account state rolls back: ${suffix}`)
      assert.equal(await prisma.refreshToken.count({ where: { userId: target.id } }), 1, `refresh revocation rolls back: ${suffix}`)
      assert.equal(await prisma.userOAuthBinding.count({ where: { userId: target.id } }), 1)
    }
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON token_invalidations`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
  }
  assert.equal((await call('POST', '/disable-2fa')).statusCode, 200)
  assert.equal((await db.get2FAMutationState(target.id))?.twoFactorSecret, null)
  await seedSession()
  assert.equal((await call('DELETE', '/oauth/github')).statusCode, 200)
  assert.equal(await prisma.userOAuthBinding.count({ where: { userId: target.id } }), 0)
  assert.equal(await prisma.refreshToken.count({ where: { userId: target.id } }), 0)
  await seedSession()
  assert.equal((await call('PATCH', '/status', { status: 'banned' })).statusCode, 200)
  assert.equal(await prisma.refreshToken.count({ where: { userId: target.id } }), 0)
  assert.equal((await call('PATCH', '/status', { status: 'active' })).statusCode, 200)

  await prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
  const beforeRole = await db.get2FAMutationState(target.id)
  for (const [method, suffix, payload] of [
    ['POST', '/reset-password', { password: 'Fixture#3297Changed' }],
    ['PATCH', '/status', { status: 'banned' }],
    ['PATCH', '/role', { role: 'admin' }],
    ['POST', '/revoke-sessions', undefined]
  ] as const) assert.equal((await call(method, suffix, payload)).statusCode, 403, 'stale administrator role is rejected at commit')
  await assert.rejects(db.createUser(`denied${tag}`, `denied-${tag}@example.com`, 'unusable-fixture', 'user', { actor }), /PROFILE_ACTOR_FORBIDDEN/)
  await assert.rejects(db.disable2FAComplete(target.id, actor), /ADMIN_ACTOR_FORBIDDEN/)
  await assert.rejects(deleteOAuthBinding(target.id, 'github', actor), /ADMIN_ACTOR_FORBIDDEN/)
  await assert.rejects(db.deleteUser(target.id, actor), /ADMIN_ACTOR_FORBIDDEN/)
  assert.deepEqual(await db.get2FAMutationState(target.id), beforeRole)
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
  await prisma.tokenInvalidation.create({ data: { userId: admin.id, sessionId: actor.sid, invalidatedAt: actor.iat } })
  assert.equal((await call('PATCH', '/status', { status: 'banned' })).statusCode, 403, 'logout blocks in-flight administration')
  await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } })

  const disposable = await prisma.user.create({ data: { username: `disposable-${tag}`, passwordHash: 'unusable-fixture' } })
  ids.push(disposable.id)
  let launch!: () => void
  const ready = new Promise<void>(resolve => { launch = resolve })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const promote = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${disposable.id} FOR UPDATE`
    await tx.user.update({ where: { id: disposable.id }, data: { role: 'admin' } })
    launch()
    await gate
  })
  await ready
  const deletion = db.deleteUser(disposable.id, actor)
  // Promotion owns the target row; deletion must inspect the committed new role after it releases.
  release()
  await promote
  await assert.rejects(deletion, /CANNOT_DELETE_ADMIN/)
  await prisma.user.update({ where: { id: disposable.id }, data: { role: 'user', balance: 1 } })
  await assert.rejects(db.deleteUser(disposable.id, actor), db.UserDeletionConflictError)
  await prisma.user.update({ where: { id: disposable.id }, data: { balance: 0 } })
  await db.deleteUser(disposable.id, actor)
  console.log('PASS real PostgreSQL/Fastify admin accounts: email allocation, initial status/quota, reset, atomic ban/2FA/OAuth/role/session rollback, stale actor/session, deletion promotion and balance protection')
} finally {
  await app.close()
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
  await closePrismaDatabase()
}
process.exit(0)
