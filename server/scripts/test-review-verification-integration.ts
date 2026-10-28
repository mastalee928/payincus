import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { createVerificationCode, verifyCode, cleanupExpiredCodes, hasPendingCode } = await import('../src/db/email-verification.js')
const { isOperationVerified, claimOperationVerificationRequirement } = await import('../src/lib/operation-verification.js')
const { get2FAMutationState, resetPasswordWithEmailVerification, updateUserProfileIfCurrent, createRegisteredUser } = await import('../src/db/users.js')
const prefix = `verify-${randomUUID()}`
const email = `${prefix}@example.test`
const brute = `brute-${email}`, legacy = `legacy-${email}`, replay = `replay-${email}`
const user = await prisma.user.create({ data: { username: prefix, passwordHash: 'unusable-fixture' } })
const admin = await prisma.user.create({ data: { username: `admin-${prefix}`, passwordHash: 'unusable-fixture', role: 'admin' } })
const registrationEmail = `register-${email}`
const registrationIds: number[] = []
try {
  const generated = await Promise.all(Array.from({ length: 12 }, (_, i) => createVerificationCode(i % 2 ? email.toUpperCase() : email, 'register')))
  assert.equal(generated.filter(Boolean).length, 5, 'parallel requests share the per-email hourly budget')
  assert.equal(await prisma.emailVerificationCode.count({ where: { email } }), 5)
  assert.equal(await createVerificationCode(email, 'password_reset'), null, 'changing purpose cannot evade the send budget')
  const pending = await prisma.emailVerificationCode.findFirstOrThrow({ where: { email, expiresAt: { gt: new Date() } } })
  assert.equal(await prisma.emailVerificationCode.count({ where: { email, expiresAt: { gt: new Date() } } }), 1)
  await cleanupExpiredCodes()
  assert.equal(await prisma.emailVerificationCode.count({ where: { email } }), 5, 'expiry cleanup retains recent send history')
  await prisma.emailVerificationCode.update({ where: { id: pending.id }, data: { code: '123456' } })
  assert.equal(await verifyCode(email, '123456', 'register'), true)
  assert.equal(await hasPendingCode(email, 'register'), false)
  assert.equal(await createVerificationCode(email, 'register'), null, 'consumption cannot erase the send history')

  const codes = await createVerificationCode(brute, 'password_reset')
  assert.ok(codes)
  const wrong = codes.code === '111111' ? '222222' : '111111'
  assert.equal(await verifyCode(brute, codes.code, 'register'), false, 'wrong-purpose code is rejected')
  const failures = await Promise.all(Array.from({ length: 8 }, () => verifyCode(brute, wrong, 'password_reset')))
  assert.ok(failures.every(result => !result))
  assert.equal((await prisma.emailVerificationCode.findFirstOrThrow({ where: { email: brute } })).attempts, 5)
  assert.equal(await verifyCode(brute, codes.code, 'password_reset'), false, 'exhausted code cannot succeed')
  assert.equal(await hasPendingCode(brute, 'password_reset'), false)

  await prisma.emailVerificationCode.create({ data: { email: legacy, purpose: 'general', code: '654321', expiresAt: new Date(Date.now() + 60000) } })
  assert.equal(await verifyCode(legacy, '654321', 'password_reset'), false)
  assert.equal(await verifyCode(legacy, '654321', 'change_email'), false)
  assert.equal(await verifyCode(legacy, '654321', 'register'), true, 'legacy unscoped code can only finish registration')
  const one = await createVerificationCode(replay, 'change_email')
  assert.ok(one)
  const consumers = await Promise.all(Array.from({ length: 8 }, () => verifyCode(replay, one.code, 'change_email')))
  assert.equal(consumers.filter(Boolean).length, 1, 'verification consumption is single-use under concurrency')
  await prisma.emailVerificationCode.updateMany({ where: { email }, data: { createdAt: new Date(Date.now() - 61 * 60000), expiresAt: new Date(0) } })
  await cleanupExpiredCodes()
  assert.equal(await prisma.emailVerificationCode.count({ where: { email } }), 0)
  assert.ok(await createVerificationCode(email, 'register'), 'budget reopens after the actual hour expires')

  const expired = await prisma.operationVerification.create({ data: { userId: user.id, operationType: 'change_password', code: 'fixture-hash',
    channel: 'email', verified: true, verifiedAt: new Date(), expiresAt: new Date(Date.now() - 1) } })
  assert.equal(await isOperationVerified(user.id, 'change_password'), false)
  assert.equal((await claimOperationVerificationRequirement(user.id, 'change_password')).verified, false, 'fresh verification timestamp cannot revive an expired grant')
  await prisma.operationVerification.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() + 60000) } })
  assert.equal(await isOperationVerified(user.id, 'change_password'), true)
  const claims = await Promise.all(Array.from({ length: 8 }, () => claimOperationVerificationRequirement(user.id, 'change_password')))
  assert.equal(claims.filter(result => result.verified).length, 1)
  await prisma.user.update({ where: { id: user.id }, data: { email: replay, twoFactorEnabled: true, twoFactorSecret: 'fixture-secret', twoFactorRecoveryCodes: 'fixture-codes' } })
  const resetCode = await createVerificationCode(replay, 'password_reset')
  assert.ok(resetCode)
  const resetState = await get2FAMutationState(user.id)
  assert.ok(resetState)
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: 'concurrent-fixture-hash' } })
  await assert.rejects(resetPasswordWithEmailVerification(resetState, resetCode.code, 'fixture-reset-hash'), /AUTHENTICATION_STATE_CHANGED/)
  assert.equal(await hasPendingCode(replay, 'password_reset'), true, 'stale account update must roll back consumption')
  const currentState = await get2FAMutationState(user.id)
  assert.ok(currentState)
  await prisma.refreshToken.create({ data: { userId: user.id, username: user.username, role: 'user', token: `fixture-${randomUUID()}`, expiresAt: new Date(Date.now() + 60000) } })
  const trigger = `review_reset_${randomUUID().replaceAll('-', '')}`
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = ${user.id} THEN RAISE EXCEPTION 'fixture-reset-revocation-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT OR UPDATE ON token_invalidations FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  try {
    await assert.rejects(resetPasswordWithEmailVerification(currentState, resetCode.code, 'fixture-reset-hash'), /fixture-reset-revocation-failure/)
    assert.equal(await hasPendingCode(replay, 'password_reset'), true)
    assert.deepEqual(await get2FAMutationState(user.id), currentState, 'all authentication fields roll back on revocation failure')
    assert.equal(await prisma.refreshToken.count({ where: { userId: user.id } }), 1)
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON token_invalidations`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
  }
  const resets = await Promise.all(Array.from({ length: 6 }, () => resetPasswordWithEmailVerification(currentState, resetCode.code, 'fixture-reset-hash')))
  assert.equal(resets.filter(result => result.valid).length, 1, 'only one reset can consume a code')
  assert.equal((await get2FAMutationState(user.id))?.passwordHash, 'fixture-reset-hash')
  assert.equal((await get2FAMutationState(user.id))?.twoFactorEnabled, false)
  assert.equal((await get2FAMutationState(user.id))?.twoFactorSecret, null)
  assert.equal(await prisma.refreshToken.count({ where: { userId: user.id } }), 0)
  assert.equal(await hasPendingCode(replay, 'password_reset'), false)
  assert.ok(await prisma.tokenInvalidation.findFirst({ where: { userId: user.id, sessionId: '__USER_LEVEL__' } }))
  await prisma.tokenInvalidation.deleteMany({ where: { userId: user.id } })
  const actor = { id: user.id, sid: 'fixture-profile-session', iat: Math.floor(Date.now() / 1000) + 1 }
  const grant = (operationType: 'change_email' | 'change_password') => prisma.operationVerification.create({ data: {
    userId: user.id, operationType, code: 'fixture-only', channel: 'email', verified: true,
    verifiedAt: new Date(), expiresAt: new Date(Date.now() + 60000)
  } })
  const newEmail = `profile-${email}`
  const profileCode = await createVerificationCode(newEmail, 'change_email')
  assert.ok(profileCode)
  await grant('change_email'); await grant('change_password')
  const staleProfile = await get2FAMutationState(user.id)
  assert.ok(staleProfile)
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: 'concurrent-profile-password' } })
  await assert.rejects(updateUserProfileIfCurrent(staleProfile, { email: newEmail, passwordHash: 'fixture-profile-password' }, actor, profileCode.code), /AUTHENTICATION_STATE_CHANGED/)
  assert.equal(await hasPendingCode(newEmail, 'change_email'), true)
  assert.equal(await prisma.operationVerification.count({ where: { userId: user.id, verified: true } }), 2, 'stale password cannot burn grants')
  const profileState = await get2FAMutationState(user.id)
  assert.ok(profileState)
  const collision = await prisma.user.create({ data: { username: `collision-${prefix}`, passwordHash: 'unusable-fixture', email: newEmail.toUpperCase() } })
  registrationIds.push(collision.id)
  await assert.rejects(updateUserProfileIfCurrent(profileState, { email: newEmail }, actor, profileCode.code), /EMAIL_ALREADY_REGISTERED/)
  assert.equal(await hasPendingCode(newEmail, 'change_email'), true, 'email collision rolls back code consumption')
  await prisma.user.update({ where: { id: collision.id }, data: { email: null } })
  await prisma.refreshToken.create({ data: { userId: user.id, username: user.username, role: 'user', token: `fixture-${randomUUID()}`, expiresAt: new Date(Date.now() + 60000) } })
  const profileTrigger = `review_profile_${randomUUID().replaceAll('-', '')}`
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${profileTrigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = ${user.id} THEN RAISE EXCEPTION 'fixture-profile-revocation-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${profileTrigger} BEFORE INSERT OR UPDATE ON token_invalidations FOR EACH ROW EXECUTE FUNCTION ${profileTrigger}()`)
  try {
    await assert.rejects(updateUserProfileIfCurrent(profileState, { email: newEmail, passwordHash: 'fixture-profile-password' }, actor, profileCode.code), /fixture-profile-revocation-failure/)
    assert.deepEqual(await get2FAMutationState(user.id), profileState)
    assert.equal(await hasPendingCode(newEmail, 'change_email'), true)
    assert.equal(await prisma.refreshToken.count({ where: { userId: user.id } }), 1)
    assert.equal(await prisma.operationVerification.count({ where: { userId: user.id, verified: true } }), 2)
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${profileTrigger} ON token_invalidations`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${profileTrigger}()`)
  }
  const profiles = await Promise.allSettled(Array.from({ length: 6 }, () => updateUserProfileIfCurrent(profileState, {
    email: newEmail, passwordHash: 'fixture-profile-password'
  }, actor, profileCode.code)))
  assert.equal(profiles.filter(r => r.status === 'fulfilled' && r.value).length, 1)
  assert.equal(await prisma.refreshToken.count({ where: { userId: user.id } }), 0)
  assert.equal(await prisma.operationVerification.count({ where: { userId: user.id, verified: true } }), 0)
  const updatedProfile = await get2FAMutationState(user.id)
  assert.ok(updatedProfile)
  await assert.rejects(updateUserProfileIfCurrent(updatedProfile, { avatarStyle: 'bottts' }, { ...actor, iat: 1 }), /AUTHENTICATION_STATE_CHANGED/)
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
  await assert.rejects(updateUserProfileIfCurrent(updatedProfile, { avatarStyle: 'bottts' }, { ...actor, id: admin.id }), /PROFILE_ACTOR_FORBIDDEN/)
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
  assert.equal(await updateUserProfileIfCurrent(updatedProfile, { avatarStyle: 'bottts' }, { ...actor, id: admin.id }), true, 'current admin can update target without consuming target grants')
  const registerCode = await createVerificationCode(registrationEmail, 'register')
  assert.ok(registerCode)
  await assert.rejects(createRegisteredUser({ username: prefix, email: registrationEmail, passwordHash: 'unusable-fixture', emailCode: registerCode.code }), /USER_EXISTS/)
  assert.equal(await hasPendingCode(registrationEmail, 'register'), true, 'username collision cannot consume registration code')
  await assert.rejects(createRegisteredUser({ username: `reg-${prefix}`, email: registrationEmail, passwordHash: 'unusable-fixture', emailCode: registerCode.code, inviteCode: 'missing-fixture-invite' }), /INVITE_CODE_UNAVAILABLE/)
  assert.equal(await hasPendingCode(registrationEmail, 'register'), true, 'failed invite claim rolls back user, quota and code')
  assert.equal(await prisma.user.count({ where: { username: `reg-${prefix}` } }), 0)
  const registrations = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => createRegisteredUser({
    username: `reg-${i}-${prefix}`, email: registrationEmail, passwordHash: 'unusable-fixture', emailCode: registerCode.code
  })))
  for (const result of registrations) if (result.status === 'fulfilled') registrationIds.push(result.value.userId)
  assert.equal(registrations.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(await hasPendingCode(registrationEmail, 'register'), false)
  console.log('PASS real PostgreSQL: send/attempt/purpose/single-use, reset/profile stale-state and revocation rollback, current actor role/session, registration code+user+invite atomicity')
} finally {
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, ...registrationIds] } } })
  await prisma.emailVerificationCode.deleteMany({ where: { email: { in: [email, brute, legacy, replay, registrationEmail, `profile-${email}`] } } })
  await prisma.user.delete({ where: { id: user.id } })
  await closePrismaDatabase()
}
process.exit(0)
