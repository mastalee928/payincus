import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { get2FAMutationState, replace2FAStateIfCurrent } = await import('../src/db/users.js')
const { invalidateSessionAccessToken, invalidateUserAccessTokens, revokeRefreshToken, isAccessTokenInvalidated } = await import('../src/lib/security.js')
const user = await prisma.user.create({ data: {
  username: `cas-fixture-${randomUUID()}`, passwordHash: 'fixture-old-hash',
  twoFactorEnabled: true, twoFactorSecret: 'fixture-secret', twoFactorRecoveryCodes: '["A","B","C"]'
} })
const state = async () => {
  const current = await get2FAMutationState(user.id)
  assert.ok(current)
  return current
}
try {
  const original = await state()
  const sameCode = await Promise.all(Array.from({ length: 8 }, () => replace2FAStateIfCurrent(original, { twoFactorRecoveryCodes: '["B","C"]' })))
  assert.equal(sameCode.filter(Boolean).length, 1, 'one recovery-code snapshot can only be consumed once')
  assert.equal((await state()).twoFactorRecoveryCodes, '["B","C"]')
  assert.equal(await replace2FAStateIfCurrent(original, { twoFactorRecoveryCodes: '["A","C"]' }), false, 'an old array cannot restore a consumed code')

  const passwordState = await state()
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: 'fixture-new-hash' } })
  assert.equal(await replace2FAStateIfCurrent(passwordState, { twoFactorEnabled: false }), false)
  const secretState = await state()
  await prisma.user.update({ where: { id: user.id }, data: { twoFactorSecret: 'fixture-new-secret' } })
  assert.equal(await replace2FAStateIfCurrent(secretState, { twoFactorEnabled: false }), false)
  const activeState = await state()
  await prisma.user.update({ where: { id: user.id }, data: { status: 'banned' } })
  assert.equal(await replace2FAStateIfCurrent(activeState, { twoFactorEnabled: false }), false)
  await prisma.user.update({ where: { id: user.id }, data: { status: 'active', twoFactorEnabled: false } })

  const setupState = await state()
  const setups = await Promise.all([
    replace2FAStateIfCurrent(setupState, { twoFactorSecret: 'fixture-setup-A', twoFactorRecoveryCodes: 'fixture-codes-A' }),
    replace2FAStateIfCurrent(setupState, { twoFactorSecret: 'fixture-setup-B', twoFactorRecoveryCodes: 'fixture-codes-B' })
  ])
  assert.equal(setups.filter(Boolean).length, 1)
  const setup = await state()
  assert.equal(setup.twoFactorRecoveryCodes?.slice(-1), setup.twoFactorSecret?.slice(-1), 'secret and recovery-code generation are committed together')
  const changes = await Promise.all([
    replace2FAStateIfCurrent(setup, { twoFactorEnabled: true }),
    replace2FAStateIfCurrent(setup, { twoFactorSecret: 'fixture-replaced-secret', twoFactorRecoveryCodes: 'fixture-replaced-codes' })
  ])
  assert.equal(changes.filter(Boolean).length, 1, 'setup/enable race must not enable a replacement secret')

  const sessionState = await state()
  const session = { sid: 'fixture-session', iat: 100 }
  await prisma.tokenInvalidation.create({ data: { userId: user.id, sessionId: session.sid, invalidatedAt: 100 } })
  assert.equal(await replace2FAStateIfCurrent(sessionState, { twoFactorRecoveryCodes: 'fixture-denied' }, session), false)
  assert.equal(await replace2FAStateIfCurrent(sessionState, { twoFactorRecoveryCodes: 'fixture-denied' }, {}), false)
  await prisma.tokenInvalidation.create({ data: { userId: user.id, sessionId: '__USER_LEVEL__', invalidatedAt: 150 } })
  assert.equal(await replace2FAStateIfCurrent(sessionState, { twoFactorRecoveryCodes: 'fixture-denied' }, { sid: 'fixture-another', iat: 149 }), false)
  assert.equal(await replace2FAStateIfCurrent(sessionState, { twoFactorRecoveryCodes: 'fixture-current' }, { sid: 'fixture-another', iat: 151 }), true)
  await prisma.tokenInvalidation.deleteMany({ where: { userId: user.id } })
  await prisma.refreshToken.create({ data: { userId: user.id, username: user.username, role: 'user', token: `fixture-${randomUUID()}`, expiresAt: new Date(Date.now() + 60000) } })
  const atomicState = await state()
  const trigger = `review_revoke_${randomUUID().replaceAll('-', '')}`
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = ${user.id} THEN RAISE EXCEPTION 'fixture-revocation-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT OR UPDATE ON token_invalidations FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  try {
    await assert.rejects(replace2FAStateIfCurrent(atomicState, { twoFactorEnabled: !atomicState.twoFactorEnabled }, undefined, true), /fixture-revocation-failure/)
    assert.equal((await state()).twoFactorEnabled, atomicState.twoFactorEnabled, 'failed revocation must roll back the 2FA change')
    assert.equal(await prisma.refreshToken.count({ where: { userId: user.id } }), 1, 'failed revocation rolls back refresh deletion')
    await assert.rejects(invalidateUserAccessTokens(user.id), /fixture-revocation-failure/)
    await assert.rejects(invalidateSessionAccessToken(user.id, 'fixture-session'), /fixture-revocation-failure/)
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON token_invalidations`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
  }
  assert.equal(await replace2FAStateIfCurrent(atomicState, { twoFactorEnabled: !atomicState.twoFactorEnabled }, undefined, true), true)
  assert.equal(await prisma.refreshToken.count({ where: { userId: user.id } }), 0)
  assert.ok(await prisma.tokenInvalidation.findFirst({ where: { userId: user.id, sessionId: '__USER_LEVEL__' } }))
  const originalDelete = prisma.refreshToken.deleteMany
  prisma.refreshToken.deleteMany = (async () => { throw new Error('fixture-delete-failure') }) as typeof originalDelete
  try { await assert.rejects(revokeRefreshToken('fixture'), /fixture-delete-failure/) }
  finally { prisma.refreshToken.deleteMany = originalDelete }
  const originalFindInvalidation = prisma.tokenInvalidation.findUnique
  prisma.tokenInvalidation.findUnique = (async () => { throw new Error('fixture-read-failure') }) as typeof originalFindInvalidation
  try { await assert.rejects(isAccessTokenInvalidated(user.id, 999), /fixture-read-failure/) }
  finally { prisma.tokenInvalidation.findUnique = originalFindInvalidation }
  console.log('PASS real PostgreSQL 2FA CAS: duplicate recovery-code consumption, stale states, concurrent setup/enable, paired secret/codes, atomic revocation and failure rollback')
} finally {
  await prisma.user.delete({ where: { id: user.id } })
  await closePrismaDatabase()
}
process.exit(0)
