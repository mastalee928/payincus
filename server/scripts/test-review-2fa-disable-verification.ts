import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { createRequire } from 'node:module'
import { authenticator } from 'otplib'
import { randomUUID } from 'node:crypto'
const bcrypt: { hash(password: string, rounds: number): Promise<string> } = createRequire(import.meta.url)('bcryptjs')

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 42).toString('base64')
process.env.JWT_SECRET = 'fixture-2fa-disable-only-secret'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { encryptSensitiveData, generate2FASecret, verify2FAToken } = await import('../src/lib/security.js')
const { default: authRoutes } = await import('../src/routes/auth.js')
const { default: verificationRoutes } = await import('../src/routes/verification.js')
const prefix = randomUUID(), password = 'Fixture-disable-password1', secret = generate2FASecret()
const passwordHash = await bcrypt.hash(password, 4)
const actors = await Promise.all(['A', 'B'].map(suffix => prisma.user.create({ data: {
  username: `disable-${suffix}-${prefix}`, passwordHash, twoFactorEnabled: true,
  twoFactorSecret: encryptSensitiveData(secret), twoFactorRecoveryCodes: encryptSensitiveData('["ABCD-EFGH"]')
} })))
let currentActor = actors[0]
const app = Fastify()
// Authentication is controlled; actual routes, password/TOTP, operation grants and PostgreSQL mutations run.
app.decorate('authenticate', async request => {
  request.user = { id: currentActor.id, username: currentActor.username, role: 'user', sid: `fixture-${currentActor.id}`, iat: Math.floor(Date.now() / 1000) + 1 }
})
const originalFetch = globalThis.fetch
globalThis.fetch = async () => { throw new Error('fixture disallows external network') }
const disable = (submittedPassword = password, code = authenticator.generate(secret)) => app.inject({
  method: 'POST', url: '/auth/2fa/disable', payload: { password: submittedPassword, code }
})
const grant = (userId: number, operationType: 'disable_2fa' | 'change_password', code: string) => prisma.operationVerification.create({ data: {
  userId, operationType, code, channel: 'email', expiresAt: new Date(Date.now() + 60000)
} })
try {
  await app.register(authRoutes, { prefix: '/auth' })
  await app.register(verificationRoutes, { prefix: '/verification' })
  const missing = await disable()
  assert.equal(missing.statusCode, 403, missing.body)
  assert.equal(missing.json().code, 'VERIFICATION_REQUIRED')
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: actors[0].id } })).twoFactorEnabled, true)
  const otherOperation = await grant(actors[0].id, 'change_password', '123456')
  await prisma.operationVerification.update({ where: { id: otherOperation.id }, data: { verified: true, verifiedAt: new Date() } })
  assert.equal((await disable()).statusCode, 403, 'password-change grant cannot disable 2FA')
  const code = await grant(actors[0].id, 'disable_2fa', '654321')
  currentActor = actors[1]
  const wrongActor = await app.inject({ method: 'POST', url: '/verification/verify', payload: { operationType: 'disable_2fa', code: '654321' } })
  assert.equal(wrongActor.statusCode, 400)
  assert.equal((await disable()).statusCode, 403)
  assert.equal((await prisma.operationVerification.findUniqueOrThrow({ where: { id: code.id } })).verified, false)
  currentActor = actors[0]
  const verified = await app.inject({ method: 'POST', url: '/verification/verify', payload: { operationType: 'disable_2fa', code: '654321' } })
  assert.equal(verified.statusCode, 200, verified.body)
  assert.equal(verified.json().verified, true)
  assert.equal((await disable('wrong-fixture-password')).statusCode, 401)
  const invalidTotp = ['000000', '111111', '222222'].find(candidate => !verify2FAToken(candidate, secret))!
  assert.equal((await disable(password, invalidTotp)).statusCode, 400)
  assert.equal((await prisma.operationVerification.findUniqueOrThrow({ where: { id: code.id } })).verified, true, 'incorrect credentials cannot consume a verified grant')
  await prisma.refreshToken.create({ data: { userId: currentActor.id, username: currentActor.username, role: 'user', token: `fixture-${randomUUID()}`, expiresAt: new Date(Date.now() + 60000) } })
  const confirmed = await disable()
  assert.equal(confirmed.statusCode, 200, confirmed.body)
  assert.equal(confirmed.json().message, '2FA disabled')
  const disabled = await prisma.user.findUniqueOrThrow({ where: { id: currentActor.id } })
  assert.equal(disabled.twoFactorEnabled, false); assert.equal(disabled.twoFactorSecret, null); assert.equal(disabled.twoFactorRecoveryCodes, null)
  assert.equal(await prisma.refreshToken.count({ where: { userId: currentActor.id } }), 0)
  assert.ok(await prisma.tokenInvalidation.findFirst({ where: { userId: currentActor.id, sessionId: '__USER_LEVEL__' } }))
  assert.equal(await prisma.operationVerification.findUnique({ where: { id: code.id } }), null)
  assert.equal((await disable()).statusCode, 409, 'completed disable cannot replay')
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: actors[1].id } })).twoFactorEnabled, true)
  console.log('PASS actual Fastify/PG 2FA disable: required verification, wrong account/operation, verified route then fixed password/TOTP retry, invalid credentials preserve grant, atomic secret removal/revocation and replay protection. Controlled authentication; no external email sent.')
} finally {
  globalThis.fetch = originalFetch
  await app.close()
  await prisma.user.deleteMany({ where: { id: { in: actors.map(actor => actor.id) } } })
  await closePrismaDatabase()
}
process.exit(0)
