import assert from 'node:assert/strict'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { randomUUID } from 'node:crypto'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 31).toString('base64')
process.env.JWT_SECRET = 'fixture-oauth-integration-secret-only'
process.env.SITE_URL = 'https://fixture.invalid'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const db = await import('../src/db/oauth.js')
const security = await import('../src/lib/security.js')
const { default: routes } = await import('../src/routes/oauth.js')
const tag = randomUUID()
const user = await prisma.user.create({ data: { username: `oauth-${tag}`, passwordHash: 'unusable-fixture', role: 'admin' } })
const second = await prisma.user.create({ data: { username: `oauth-second-${tag}`, passwordHash: 'unusable-fixture' } })
const session = { id: user.id, role: 'admin', username: user.username, sid: 'fixture-oauth-session', iat: Math.floor(Date.now() / 1000) + 1 }
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = { ...session } })
app.decorate('authenticateAdmin', async (request: any) => { request.user = { ...session } })
let signed: Record<string, unknown> | undefined
// The controlled exchange fixture records signing inputs; it never validates JWTs.
app.decorate('jwt', { sign: (payload: Record<string, unknown>) => { signed = payload; return 'fixture-jwt' } } as unknown as typeof app.jwt)
await app.register(cookie)
const originalConfig = await prisma.oAuthConfig.findUnique({ where: { provider: 'github' } })
const originalFetch = globalThis.fetch
let beforeUserResponse: (() => Promise<void>) | undefined
const identity = `provider-${tag}`
globalThis.fetch = async (input) => {
  const url = String(input)
  assert.ok(['https://github.com/login/oauth/access_token', 'https://api.github.com/user'].includes(url), 'fixture cannot contact arbitrary URLs')
  if (url.endsWith('/user')) {
    await beforeUserResponse?.()
    return new Response(JSON.stringify({ id: identity, login: 'fixture-provider' }), { status: 200 })
  }
  return new Response(JSON.stringify({ access_token: 'fixture-access-token' }), { status: 200 })
}
const freshBinding = async () => (await db.getUserOAuthBindings(user.id)).find(binding => binding.provider === 'github')!
const loginCode = async (role = 'admin') => {
  const binding = await freshBinding()
  return security.generateOAuthLoginCode({ userId: user.id, username: user.username, role,
    binding: { id: binding.id, provider: 'github', providerUserId: binding.provider_user_id } })
}
const exchange = (code: string) => app.inject({ method: 'POST', url: '/oauth/exchange-code', payload: { code } })
try {
  await prisma.oAuthConfig.upsert({ where: { provider: 'github' }, create: {
    provider: 'github', clientId: 'fixture-client', clientSecret: 'fixture-secret', enabled: true
  }, update: { clientId: 'fixture-client', clientSecret: 'fixture-secret', enabled: true } })
  await app.register(routes, { prefix: '/oauth' })
  for (const body of [{ clientId: 'fixture-client', enabled: true },
    { clientId: 'fixture-client', enabled: true, clientSecret: '' },
    { clientId: 'fixture-client', enabled: true, clientSecret: 'UNCHANGED' }]) {
    const update = await app.inject({ method: 'PUT', url: '/oauth/configs/github', payload: body })
    assert.equal(update.statusCode, 200, update.body)
    assert.equal((await db.getOAuthConfig('github'))?.client_secret, 'fixture-secret', 'empty/omitted/legacy placeholder preserves existing OAuth secret')
  }
  console.log('PASS actual OAuth config updates preserve existing secret for omitted, blank and legacy unchanged input')
  const state = await security.generateOAuthState('bind', '/profile', { userId: user.id, issuedAt: session.iat, sessionId: session.sid })
  const bind = await app.inject({ method: 'GET', url: `/oauth/callback/github?code=fixture-code&state=${encodeURIComponent(state)}` })
  assert.equal(bind.statusCode, 302)
  assert.ok(bind.headers.location?.includes('success=bound_github'), 'real callback creates binding')
  let current = await freshBinding()
  assert.equal(current.provider_user_id, identity)
  assert.notEqual(current.access_token, 'fixture-access-token', 'provider token stays encrypted')
  await assert.rejects(db.bindOAuthAccountIfCurrent(user.id, session, current, {
    provider: 'github', providerUserId: 'different-provider', accessToken: 'fixture-other'
  }), /OAUTH_BINDING_CHANGED/)
  await prisma.userOAuthBinding.update({ where: { id: current.id }, data: { providerUsername: 'concurrent-change' } })
  await assert.rejects(db.bindOAuthAccountIfCurrent(user.id, session, current, {
    provider: 'github', providerUserId: identity, accessToken: 'fixture-other'
  }), /OAUTH_BINDING_CHANGED/)
  current = await freshBinding()
  await prisma.user.update({ where: { id: user.id }, data: { status: 'banned' } })
  assert.equal(await db.updateOAuthLoginBindingIfCurrent(current, 'fixture-denied', null), false)
  await assert.rejects(db.bindOAuthAccountIfCurrent(user.id, session, current, {
    provider: 'github', providerUserId: identity, accessToken: 'fixture-other'
  }), /OAUTH_SESSION_CHANGED/)
  await prisma.user.update({ where: { id: user.id }, data: { status: 'active' } })

  const code = await loginCode()
  await prisma.user.update({ where: { id: user.id }, data: { role: 'user' } })
  const response = await exchange(code)
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(response.json().user.role, 'user', 'exchange uses current database role')
  assert.equal(signed?.role, 'user')
  assert.equal(await prisma.refreshToken.count({ where: { userId: user.id } }), 1)
  assert.equal((await exchange(code)).statusCode, 401, 'signed login code is single-use')
  await prisma.refreshToken.deleteMany({ where: { userId: user.id } })

  const lateCode = await loginCode('user')
  const previous = await freshBinding()
  await prisma.userOAuthBinding.delete({ where: { id: previous.id } })
  await db.createOAuthBinding(user.id, { provider: 'github', providerUserId: identity })
  assert.equal((await exchange(lateCode)).statusCode, 401, 're-binding the same identity cannot revive an older login code')
  assert.equal(await prisma.refreshToken.count({ where: { userId: user.id } }), 0)
  assert.equal(await db.updateOAuthLoginBindingIfCurrent(previous, 'fixture-stale', null), false, 'late login cannot write tokens onto a replacement binding')
  const logoutCode = await loginCode('user')
  await prisma.tokenInvalidation.create({ data: { userId: user.id, sessionId: '__USER_LEVEL__', invalidatedAt: Math.floor(Date.now() / 1000) } })
  assert.equal((await exchange(logoutCode)).statusCode, 401, 'revocation after callback prevents exchange')
  await prisma.tokenInvalidation.deleteMany({ where: { userId: user.id } })
  const olderAuthentication = security.generateOAuthLoginCode({ userId: user.id, username: user.username, role: 'user',
    binding: { id: (await freshBinding()).id, provider: 'github', providerUserId: identity },
    authenticatedAt: Date.now() - 5000 })
  await prisma.tokenInvalidation.create({ data: { userId: user.id, sessionId: '__USER_LEVEL__', invalidatedAt: Math.floor((Date.now() - 2000) / 1000) } })
  assert.equal((await exchange(olderAuthentication)).statusCode, 401, 'revocation during a delayed callback invalidates later minted login code')
  await prisma.tokenInvalidation.deleteMany({ where: { userId: user.id } })

  const trigger = `review_oauth_${tag.replaceAll('-', '')}`
  await prisma.refreshToken.create({ data: { userId: user.id, username: user.username, role: 'user', token: 'fixture-only-' + tag, expiresAt: new Date(Date.now() + 60000) } })
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = ${user.id} THEN RAISE EXCEPTION 'fixture-oauth-revocation-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT OR UPDATE ON token_invalidations FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  try {
    assert.equal((await app.inject({ method: 'DELETE', url: '/oauth/bindings/github' })).statusCode, 500)
    assert.equal(await prisma.userOAuthBinding.count({ where: { userId: user.id } }), 1)
    assert.equal(await prisma.refreshToken.count({ where: { userId: user.id } }), 1, 'self unbind rollback preserves session and binding')
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON token_invalidations`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
  }
  assert.equal((await app.inject({ method: 'DELETE', url: '/oauth/bindings/constructor' })).statusCode, 400)
  assert.equal((await app.inject({ method: 'DELETE', url: '/oauth/bindings/github' })).statusCode, 200)
  assert.equal(await prisma.refreshToken.count({ where: { userId: user.id } }), 0)
  assert.equal(await prisma.userOAuthBinding.count({ where: { userId: user.id } }), 0)
  await prisma.tokenInvalidation.deleteMany({ where: { userId: user.id } })
  const revokedState = await security.generateOAuthState('bind', '/profile', { userId: user.id, issuedAt: session.iat, sessionId: session.sid })
  beforeUserResponse = async () => {
    await prisma.tokenInvalidation.create({ data: { userId: user.id, sessionId: session.sid, invalidatedAt: session.iat } })
  }
  const revoked = await app.inject({ method: 'GET', url: `/oauth/callback/github?code=fixture-code&state=${encodeURIComponent(revokedState)}` })
  assert.ok(revoked.headers.location?.includes('error=invalid_session'), 'revocation while provider fetch is pending blocks binding')
  assert.equal(await prisma.userOAuthBinding.count({ where: { userId: user.id } }), 0)
  console.log('PASS real PostgreSQL/Fastify OAuth callback/exchange/unbind: encrypted tokens, binding identity/CAS, banned/revoked pending requests, authoritative role, single-use codes, replacement/late callback protection and fault rollback')
} finally {
  globalThis.fetch = originalFetch
  await app.close()
  if (originalConfig) await prisma.oAuthConfig.update({ where: { provider: 'github' }, data: {
    clientId: originalConfig.clientId, clientSecret: originalConfig.clientSecret, enabled: originalConfig.enabled
  } })
  else await prisma.oAuthConfig.delete({ where: { provider: 'github' } })
  await prisma.user.deleteMany({ where: { id: { in: [user.id, second.id] } } })
  await closePrismaDatabase()
}
process.exit(0)
