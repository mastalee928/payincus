import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import ts from 'typescript'
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use isolated local *_pool_test PostgreSQL')
process.env.JWT_SECRET ||= 'email-fixture-only'
process.env.ADMIN_FRONTEND_URL = 'https://admin.example.test'
process.env.NODE_ENV = 'test'
const backupState = mkdtempSync(join(tmpdir(), 'email-review-'))
process.env.PLATFORM_BACKUP_STATE_DIR = backupState
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { adminUserEmail, parseAdminEmail } = await import('../src/services/admin-user-email.js')
const { default: routes } = await import('../src/routes/users.js')
const { createUser, get2FAMutationState, updateUserProfileIfCurrent, resetPasswordWithEmailVerification } = await import('../src/db/users.js')
const { createVerificationCode, hasPendingCode } = await import('../src/db/email-verification.js')
const { isAccessTokenInvalidated } = await import('../src/lib/security.js')
const { containsDangerousChars } = await import('../src/lib/security.js')
const { advisoryTransactionLockString, EMAIL_VERIFICATION_LOCK_NAMESPACE } = await import('../src/db/advisory-locks.js')
const { recoveryHeld } = await import('../src/services/platform-backup-core.js')
const { validateRecoverySession } = await import('../src/services/platform-recovery-operator.js')
const tag = `email-${randomUUID().slice(0, 12)}`
const oldEmail = `${tag}@example.com`, nextEmail = `next-${oldEmail}`
const admin = await prisma.user.create({ data: { username: `${tag}-admin`, role: 'admin', passwordHash: 'fixture-only' } })
const target = await prisma.user.create({ data: { username: tag, email: oldEmail, passwordHash: 'fixture-unchanged', balance: 27.43,
  twoFactorEnabled: true, twoFactorSecret: 'fixture-unchanged', twoFactorRecoveryCodes: 'fixture-unchanged' } })
const other = await prisma.user.create({ data: { username: `${tag}-other`, passwordHash: 'fixture-only' } })
const ids = [admin.id, target.id, other.id]
const actor = { id: admin.id, sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
const source = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8')
const start = source.indexOf('async function ensureActiveAccessToken('), end = source.indexOf('// 注意: 安全响应头', start)
assert.ok(start >= 0 && end > start)
const app = Fastify()
await app.register(fastifyJwt, { secret: 'email-real-signature-fixture-only' })
new Function('fastify', 'prisma', 'isAccessTokenInvalidated', 'recoveryHeld', 'validateRecoverySession',
  ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
)(app, prisma, isAccessTokenInvalidated, recoveryHeld, validateRecoverySession)
await app.register(routes, { prefix: '/api/users' })
const token = (id = admin.id, extra: Record<string, unknown> = {}) => app.jwt.sign({ ...actor, id, role: 'admin', username: tag, ...extra })
const valid = token()
const headers = { authorization: `Bearer ${valid}`, origin: process.env.ADMIN_FRONTEND_URL }
const url = `/api/users/${target.id}/admin-email`
const get = () => app.inject({ method: 'GET', url, headers })
const put = (revision: string, email: unknown = nextEmail, overrides = {}, extra = {}) => app.inject({ method: 'PUT', url,
  headers: { ...headers, ...overrides }, payload: { revision, email, ...extra } })
const read = () => prisma.user.findUniqueOrThrow({ where: { id: target.id } })
const stableFields = (user: Awaited<ReturnType<typeof read>>) => ({ passwordHash: user.passwordHash, balance: user.balance.toString(),
  role: user.role, status: user.status, twoFactorEnabled: user.twoFactorEnabled, twoFactorSecret: user.twoFactorSecret, twoFactorRecoveryCodes: user.twoFactorRecoveryCodes })
const refresh = () => prisma.refreshToken.create({ data: { userId: target.id, username: tag, role: 'user', token: randomUUID(), expiresAt: new Date(Date.now() + 60000) } })
const reset = async () => {
  await prisma.user.update({ where: { id: target.id }, data: { email: oldEmail } })
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin', status: 'active' } })
  await prisma.user.update({ where: { id: other.id }, data: { email: null } })
  await prisma.tokenInvalidation.deleteMany({ where: { userId: { in: ids } } })
  await prisma.emailVerificationCode.deleteMany({ where: { email: { in: [oldEmail, nextEmail] } } })
}
try {
  const initial = (await get()).json()
  assert.equal(initial.userId, target.id); assert.equal(initial.email, oldEmail)
  assert.deepEqual(Object.keys(initial).sort(), ['email', 'revision', 'userId', 'username'])
  for (const value of [undefined, 'pat_fixture', 'poa_fixture', valid.slice(0, -8) + 'invalid', token(target.id), token(other.id), token(admin.id, { sid: '' }), token(admin.id, { iat: 1, exp: 2 })]) {
    const authHeaders = { origin: headers.origin, ...(value ? { authorization: `Bearer ${value}` } : {}), 'x-role': 'admin' }
    for (const method of ['GET', 'PUT'] as const) {
      const result = await app.inject({ method, url, headers: authHeaders, ...(method === 'PUT' ? { payload: { email: nextEmail, revision: initial.revision } } : {}) })
      assert.ok([401, 403].includes(result.statusCode), `${method} unauthorized: ${result.body}`)
    }
  }
  for (const state of [{ role: 'user' as const }, { role: 'admin' as const, status: 'banned' as const }]) {
    await prisma.user.update({ where: { id: admin.id }, data: state })
    assert.ok([401, 403].includes((await put(initial.revision)).statusCode))
  }
  await reset()
  await prisma.tokenInvalidation.create({ data: { userId: admin.id, sessionId: actor.sid, invalidatedAt: actor.iat } })
  assert.equal((await put(initial.revision)).statusCode, 401)
  await reset()
  await assert.rejects(adminUserEmail(target.id, { ...actor, id: other.id }), /ADMIN_ACTOR_FORBIDDEN/)
  assert.equal((await app.inject({ method: 'GET', url: `/api/users/${admin.id}/admin-email`, headers })).json().code, 'ADMIN_EMAIL_SELF')
  const current = (await get()).json()
  for (const override of [{ origin: 'https://user.example.test' }, { 'sec-fetch-site': 'cross-site' }, { host: 'demoadmin.payincus.com' }]) assert.equal((await put(current.revision, nextEmail, override)).statusCode, 403)
  for (const email of ['', 'a@b', 'a@@b.com', 'a..b@example.com', 'a@example..com', 'a@-example.com', 'a\r\nb@example.com', 'a+tag@example.com', 'a%tag@example.com', 'x'.repeat(65) + '@example.com', null]) {
    assert.equal((await put(current.revision, email)).statusCode, 400)
    assert.throws(() => parseAdminEmail(email))
  }
  for (const badId of ['0', '-1', '1x', '2147483648']) assert.equal((await app.inject({ method: 'GET', url: `/api/users/${badId}/admin-email`, headers })).statusCode, 400)
  assert.equal((await put(current.revision, nextEmail, {}, { role: 'admin' })).statusCode, 400)
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/users/${target.id}`, headers, payload: { email: nextEmail } })).json().code, 'ADMIN_EMAIL_USE_EDITOR')
  assert.equal((await put(current.revision, oldEmail.toUpperCase())).json().code, 'ADMIN_EMAIL_UNCHANGED')
  for (const email of ['FIRST.Last_1-2@example.com', 'name@example.co.uk']) {
    assert.equal(parseAdminEmail(email), email.toLowerCase())
    assert.equal(containsDangerousChars(parseAdminEmail(email).replace(/[@.]/g, '')), false, 'every accepted address works with current password-recovery character rules')
  }
  await prisma.user.update({ where: { id: other.id }, data: { email: nextEmail.toUpperCase() } })
  assert.equal((await put(current.revision)).json().code, 'ADMIN_EMAIL_TAKEN')
  await reset()
  console.log('PASS real JWT/current DB role/session, customer/forged role/PAT/OAuth/self/demo/origin/input/legacy endpoint boundaries')

  const stale = (await get()).json()
  await prisma.user.update({ where: { id: target.id }, data: { avatarStyle: 'bottts' } })
  assert.equal((await put(stale.revision)).json().code, 'ADMIN_EMAIL_CHANGED')
  const snapshot = (await get()).json(), before = stableFields(await read())
  await refresh()
  const oldCode = await createVerificationCode(oldEmail, 'password_reset'), incomingCode = await createVerificationCode(nextEmail, 'change_email')
  assert.ok(oldCode && incomingCode)
  await prisma.operationVerification.create({ data: { userId: target.id, operationType: 'change_email', code: 'fixture', channel: 'email', verified: true, verifiedAt: new Date(), expiresAt: new Date(Date.now() + 60000) } })
  const result = await put(snapshot.revision, `  ${nextEmail.toUpperCase()}  `)
  assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().email, nextEmail)
  assert.deepEqual(stableFields(await read()), before)
  assert.equal(await prisma.refreshToken.count({ where: { userId: target.id } }), 0)
  assert.ok(await isAccessTokenInvalidated(target.id, actor.iat - 2, 'old-login'))
  assert.equal(await hasPendingCode(oldEmail, 'password_reset'), false); assert.equal(await hasPendingCode(nextEmail, 'change_email'), false)
  assert.equal(await prisma.emailVerificationCode.count({ where: { email: { in: [oldEmail, nextEmail] } } }), 2, 'retain code send budget history')
  assert.equal(await prisma.operationVerification.count({ where: { userId: target.id, verifiedAt: { not: null } } }), 0)
  const log = await prisma.log.findFirstOrThrow({ where: { userId: admin.id, action: 'user.email.update' } })
  assert.ok(log.content.includes(`#${target.id}`) && !log.content.includes(oldEmail) && !log.content.includes(nextEmail), 'audit identifies actor/target with masked addresses')
  const back = (await get()).json()
  assert.equal((await put(back.revision, oldEmail)).statusCode, 200)
  assert.equal((await resetPasswordWithEmailVerification((await get2FAMutationState(target.id))!, oldCode.code, 'must-not-write')).valid, false, 'old code cannot revive after email returns')
  console.log('PASS normalized save, atomic sessions/grants/code invalidation, retained rate limit history, masked audit and unchanged credentials/money')

  await reset(); await refresh()
  const rollback = (await get()).json(), rollbackRow = await read()
  const code = await createVerificationCode(oldEmail, 'password_reset'); assert.ok(code)
  const trigger = 'email_audit_' + randomUUID().replaceAll('-', '')
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'user.email.update' AND NEW.user_id = ${admin.id} THEN RAISE EXCEPTION 'fixture-audit-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  try {
    assert.equal((await put(rollback.revision)).statusCode, 500)
    assert.deepEqual(await read(), rollbackRow); assert.equal(await prisma.refreshToken.count({ where: { userId: target.id } }), 1)
    assert.equal(await hasPendingCode(oldEmail, 'password_reset'), true)
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON logs`); await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
  }
  const concurrent = await Promise.all(Array.from({ length: 6 }, () => put(rollback.revision)))
  assert.equal(concurrent.filter(r => r.statusCode === 200).length, 1)
  assert.ok(concurrent.every(r => [200, 409].includes(r.statusCode)))
  await reset()
  const race = (await get()).json()
  const competitors = await Promise.allSettled([
    adminUserEmail(target.id, actor, { revision: race.revision, email: nextEmail }),
    createUser(`${tag}-race`, nextEmail.toUpperCase(), 'fixture-only')
  ])
  assert.equal(competitors.filter(r => r.status === 'fulfilled').length, 1)
  const created = await prisma.user.findUnique({ where: { username: `${tag}-race` } }); if (created) ids.push(created.id)
  assert.equal(await prisma.user.count({ where: { email: { equals: nextEmail, mode: 'insensitive' } } }), 1)
  if (created) await prisma.user.update({ where: { id: created.id }, data: { email: null } })
  await reset()
  await prisma.user.update({ where: { id: target.id }, data: { email: null, status: 'banned' } })
  const missingEmail = (await get()).json()
  assert.equal(missingEmail.email, null)
  assert.equal((await put(missingEmail.revision)).statusCode, 200)
  assert.equal((await read()).status, 'banned', 'setting a missing email does not unban the account')
  await prisma.user.update({ where: { id: target.id }, data: { status: 'active' } })
  await reset()
  // Re-check current admin while a PUT is waiting on a real database lock.
  const queued = (await get()).json(), unchanged = await read()
  let locked!: () => void, release!: () => void
  const ready = new Promise<void>(resolve => { locked = resolve }), hold = new Promise<void>(resolve => { release = resolve })
  let blockerPid = 0
  const blocking = prisma.$transaction(async tx => {
    blockerPid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0]!.pid
    await tx.$queryRaw`SELECT id FROM users WHERE id=${admin.id} FOR UPDATE`; locked(); await hold
    await tx.user.update({ where: { id: admin.id }, data: { role: 'user' } })
  }, { timeout: 10000 })
  await ready
  const pending = put(queued.revision)
  let waiting = false
  try {
    for (let n = 0; n < 60; n++) {
      const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE ${blockerPid} = ANY(pg_blocking_pids(pid))`
      if (Number(row!.count)) { waiting = true; break }
      await delay(20)
    }
  } finally { release(); await blocking }
  assert.equal(waiting, true, 'PUT actually waited on the actor row')
  assert.equal((await pending).statusCode, 403)
  assert.deepEqual(await read(), unchanged)
  await reset()
  // Waiting beyond the configured timeout aborts the write; releasing the lock cannot write later.
  const timed = (await get()).json(), beforeTimeout = await read()
  let verificationLocked!: () => void, releaseVerification!: () => void
  const verificationReady = new Promise<void>(resolve => { verificationLocked = resolve })
  const verificationHold = new Promise<void>(resolve => { releaseVerification = resolve })
  const verificationBlocker = prisma.$transaction(async tx => {
    await advisoryTransactionLockString(tx, EMAIL_VERIFICATION_LOCK_NAMESPACE, nextEmail)
    verificationLocked(); await verificationHold
  }, { timeout: 15000 })
  await verificationReady
  let timeoutResponse
  try { timeoutResponse = await put(timed.revision) } finally { releaseVerification(); await verificationBlocker }
  assert.equal(timeoutResponse.statusCode, 409, timeoutResponse.body)
  assert.equal(timeoutResponse.json().code, 'ADMIN_EMAIL_BUSY')
  await delay(100)
  assert.deepEqual(await read(), beforeTimeout)
  // A restore hold can start while an authorized edit is being prepared.
  writeFileSync(join(backupState, 'recovery-hold.json'), '{}')
  try { await assert.rejects(adminUserEmail(target.id, actor, { revision: timed.revision, email: nextEmail }), /ADMIN_EMAIL_FORBIDDEN/) }
  finally { unlinkSync(join(backupState, 'recovery-hold.json')) }
  assert.deepEqual(await read(), beforeTimeout)
  const profileState = (await get2FAMutationState(target.id))!
  const currentActor = { ...actor, id: other.id }
  await assert.rejects(updateUserProfileIfCurrent(profileState, { email: nextEmail }, currentActor), /PROFILE_ACTOR_FORBIDDEN/)
  console.log('PASS audit-failure total rollback, six concurrent saves once, registration collision and actual row-lock demotion fence')
  console.log('PASS recovery hold and real verification-lock timeout return without a delayed account write')
} finally {
  await app.close()
  await prisma.emailVerificationCode.deleteMany({ where: { email: { in: [oldEmail, nextEmail] } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
  await closePrismaDatabase()
  rmdirSync(backupState)
}
process.exit(0)
