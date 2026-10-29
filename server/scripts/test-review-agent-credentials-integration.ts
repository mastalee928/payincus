import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { randomUUID, createHash } from 'node:crypto'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const credentials = await import('../src/lib/host-agent-credentials.js')
const { encryptSensitiveData, decryptSensitiveData } = await import('../src/lib/security.js')
const { hashAgentSecret } = await import('../src/lib/agent-auth.js')
const { default: routes } = await import('../src/routes/agent.js')
const tag = randomUUID()
const user = await prisma.user.create({ data: { username: `agent-credentials-${tag}`, passwordHash: 'unusable-fixture' } })
const other = await prisma.user.create({ data: { username: `agent-other-${tag}`, passwordHash: 'unusable-fixture' } })
const admin = await prisma.user.create({ data: { username: `agent-admin-${tag}`, passwordHash: 'unusable-fixture', role: 'admin' } })
const host = await prisma.host.create({ data: { userId: user.id, name: tag, url: 'https://127.0.0.1:1', installToken: `host-${tag}`, installTokenExpire: new Date(Date.now() + 60000) } })
const actor = { id: user.id, username: user.username, role: 'user', sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
const adminActor = { ...actor, id: admin.id, username: admin.username, role: 'admin' }
let currentActor = actor
let afterAuthentication: (() => Promise<unknown>) | undefined
const app = Fastify()
for (const name of ['authenticate', 'authenticateAdmin']) app.decorate(name, async (request: any) => { request.user = { ...currentActor }; await afterAuthentication?.() })
const originalFetch = globalThis.fetch
globalThis.fetch = async () => new Response(JSON.stringify({ tag_name: 'agent-v1.0.3', assets: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
const rotate = () => credentials.rotateHostAgentCredentials(host.id, true, { actor })
const issue = () => credentials.issueHostAgentInstallToken(host.id, true, { actor })
const snapshot = () => prisma.hostAgent.findUniqueOrThrow({ where: { hostId: host.id } })
const trigger = `review_agent_${tag.replaceAll('-', '')}`
try {
  await app.register(routes, { prefix: '/agent' })
  const original = await rotate()
  await prisma.hostAgentNonce.create({ data: { agentId: original.agentId, nonce: tag, expiresAt: new Date(Date.now() + 60000) } })
  const before = await snapshot()
  afterAuthentication = () => prisma.host.update({ where: { id: host.id }, data: { userId: other.id } })
  const transferred = await app.inject({ method: 'POST', url: `/agent/hosts/${host.id}/install-command`, payload: {} })
  assert.equal(transferred.statusCode, 403, transferred.body)
  assert.deepEqual(await snapshot(), before)
  afterAuthentication = undefined
  await prisma.host.update({ where: { id: host.id }, data: { userId: user.id } })
  afterAuthentication = () => prisma.user.update({ where: { id: user.id }, data: { status: 'banned' } })
  const banned = await app.inject({ method: 'POST', url: `/agent/hosts/${host.id}/install-command`, payload: {} })
  assert.equal(banned.statusCode, 403, banned.body)
  assert.deepEqual(await snapshot(), before)
  afterAuthentication = undefined
  await prisma.user.update({ where: { id: user.id }, data: { status: 'active' } })
  await prisma.tokenInvalidation.create({ data: { userId: user.id, sessionId: actor.sid, invalidatedAt: actor.iat } })
  await assert.rejects(issue(), /AGENT_ACTOR_FORBIDDEN/)
  await prisma.tokenInvalidation.deleteMany({ where: { userId: user.id } })

  currentActor = adminActor
  afterAuthentication = () => prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
  for (const action of ['credentials', 'install-command']) {
    const response = await app.inject({ method: 'POST', url: `/agent/admin/hosts/${host.id}/${action}`, payload: {} })
    assert.equal(response.statusCode, 403, response.body)
    assert.deepEqual(await snapshot(), before)
  }
  afterAuthentication = undefined
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })

  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.host_id = ${host.id} AND NEW.install_token_hash IS NOT NULL THEN RAISE EXCEPTION 'fixture-agent-token-write-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON host_agents FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  try {
    await assert.rejects(issue(), /fixture-agent-token-write-failure/)
    assert.deepEqual(await snapshot(), before, 'token persistence failure rolls back identity rotation')
    assert.equal(await prisma.hostAgentNonce.count({ where: { agentId: original.agentId } }), 1, 'nonce removal rolls back too')
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON host_agents`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
  }
  const issues = await Promise.all(Array.from({ length: 7 }, issue))
  const current = await snapshot()
  const latest = issues.find(r => createHash('sha256').update(r.installToken).digest('hex') === current.installTokenHash)!
  assert.ok(latest)
  assert.equal(current.agentId, latest.agent.agentId, 'stored token belongs to the same committed identity')
  const redeemed = await Promise.all(issues.map(r => credentials.consumeHostAgentInstallToken(r.installToken).then(value => value, () => null)))
  assert.equal(redeemed.filter(Boolean).length, 1, 'only the latest serialized issuance remains valid')
  const valid = redeemed.find(Boolean)!
  assert.equal(valid.agent.agentId, current.agentId)
  assert.equal(hashAgentSecret(valid.agentSecret), current.secretHash)
  assert.equal(await prisma.hostAgentNonce.count({ where: { agentId: original.agentId } }), 0)
  const singleUse = await issue()
  const repeats = await Promise.all(Array.from({ length: 7 }, () => credentials.consumeHostAgentInstallToken(singleUse.installToken).then(() => true, () => false)))
  assert.equal(repeats.filter(Boolean).length, 1)

  const corrupted = await issue()
  const saved = await snapshot()
  await prisma.hostAgent.update({ where: { hostId: host.id }, data: { secretEncrypted: 'corrupt-fixture-ciphertext' } })
  await assert.rejects(credentials.consumeHostAgentInstallToken(corrupted.installToken), /AGENT_SECRET_INVALID/)
  assert.equal((await snapshot()).installTokenHash, saved.installTokenHash, 'decrypt failure does not consume token')
  await prisma.hostAgent.update({ where: { hostId: host.id }, data: { secretEncrypted: encryptSensitiveData('fixture-wrong-secret') } })
  await assert.rejects(credentials.consumeHostAgentInstallToken(corrupted.installToken), /AGENT_SECRET_INVALID/)
  assert.equal((await snapshot()).installTokenUsedAt, null, 'secret/hash mismatch does not consume token')
  await prisma.hostAgent.update({ where: { hostId: host.id }, data: { secretEncrypted: saved.secretEncrypted } })
  assert.equal((await credentials.consumeHostAgentInstallToken(corrupted.installToken)).agentSecret, decryptSensitiveData(saved.secretEncrypted))
  for (const invalidSecret of ['', 'fixture-too-short', 'ias_' + 'A'.repeat(31), 'ias_' + 'A'.repeat(97), 'ias_' + '!'.repeat(43), 'ias_' + 'A'.repeat(43) + '\n']) {
    const issued = await issue()
    const validState = await snapshot()
    await prisma.hostAgent.update({ where: { hostId: host.id }, data: { secretEncrypted: encryptSensitiveData(invalidSecret), secretHash: hashAgentSecret(invalidSecret) } })
    const beforeInvalid = await snapshot()
    const response = await app.inject({ method: 'GET', url: `/agent/install-config/${issued.installToken}` })
    assert.equal(response.statusCode, 403, 'invalid stored secret cannot be issued as install configuration')
    assert.ok(JSON.stringify(await snapshot()) === JSON.stringify(beforeInvalid), 'invalid secret leaves the one-time token and Agent record unchanged')
    await prisma.hostAgent.update({ where: { hostId: host.id }, data: { secretEncrypted: validState.secretEncrypted, secretHash: validState.secretHash } })
    const repaired = await app.inject({ method: 'GET', url: `/agent/install-config/${issued.installToken}` })
    assert.equal(repaired.statusCode, 200)
    assert.equal(repaired.headers['cache-control'], 'no-store')
    assert.equal((await snapshot()).installTokenHash, null)
    assert.equal((await app.inject({ method: 'GET', url: `/agent/install-config/${issued.installToken}` })).statusCode, 403)
  }
  for (const length of [32, 96]) {
    const issued = await issue(), boundarySecret = 'ias_' + 'A'.repeat(length)
    await prisma.hostAgent.update({ where: { hostId: host.id }, data: { secretEncrypted: encryptSensitiveData(boundarySecret), secretHash: hashAgentSecret(boundarySecret) } })
    const response = await app.inject({ method: 'GET', url: `/agent/install-config/${issued.installToken}` })
    assert.equal(response.statusCode, 200, 'valid format boundaries remain usable')
    assert.equal((await snapshot()).installTokenHash, null)
  }
  const expired = await issue()
  await prisma.hostAgent.update({ where: { hostId: host.id }, data: { installTokenExpiresAt: new Date(Date.now() - 1000) } })
  await assert.rejects(credentials.consumeHostAgentInstallToken(expired.installToken), /AGENT_INSTALL_TOKEN_EXPIRED/)
  const notRotated = await snapshot()
  await assert.rejects(credentials.issueHostAgentInstallToken(host.id, true, { hostInstallToken: 'wrong-fixture-token' }), /AGENT_INSTALL_TOKEN_INVALID/)
  assert.deepEqual(await snapshot(), notRotated)
  const hostInstall = await credentials.issueHostAgentInstallToken(host.id, true, { hostInstallToken: `host-${tag}` })
  assert.ok(hostInstall.installToken)
  await prisma.host.update({ where: { id: host.id }, data: { isInstalled: true } })
  await assert.rejects(credentials.issueHostAgentInstallToken(host.id, true, { hostInstallToken: `host-${tag}` }), /AGENT_INSTALL_TOKEN_INVALID/)
  console.log('PASS real PostgreSQL/Fastify Agent credentials: current host ownership, ban/revoke/admin demotion, identity+nonce+token atomic rollback, concurrent issuance/one-time consumption, corrupt decrypt/hash and six invalid-format token preservation/repaired retries/two valid boundaries, legacy host-token authority; release lookup is a fetch fixture')
} finally {
  globalThis.fetch = originalFetch
  await app.close()
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id, admin.id] } } })
  await closePrismaDatabase()
}
process.exit(0)
