import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { randomUUID, createHash } from 'node:crypto'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const credentials = await import('../src/lib/host-agent-credentials.js')
const { encryptSensitiveData, decryptSensitiveData } = await import('../src/lib/security.js')
const { hashAgentSecret, createAgentBodyHash, createAgentSignature } = await import('../src/lib/agent-auth.js')
const { default: routes } = await import('../src/routes/agent.js')
const { guestProtectionReady, guestProtectionReadyWhere } = await import('../src/lib/guest-network-protection.js')
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
const heartbeat = (agentId: string, agentSecret: string) => {
  const body = { version: 'v1.0.4', runtime: { goos: 'linux', goarch: 'amd64' }, metrics: { heartbeatIntervalSeconds: 30 } }
  const timestamp = String(Date.now()), nonce = randomUUID(), bodyHash = createAgentBodyHash(body)
  return app.inject({ method: 'POST', url: '/agent/heartbeat', payload: body, headers: {
    'x-incudal-agent-id': agentId, 'x-incudal-timestamp': timestamp, 'x-incudal-nonce': nonce, 'x-incudal-body-sha256': bodyHash,
    'x-incudal-signature': createAgentSignature(agentSecret, { method: 'POST', path: '/agent/heartbeat', timestamp, nonce, bodyHash }) } })
}
try {
  await app.register(routes, { prefix: '/agent' })
  const original = await rotate()
  // Real signed HTTP handlers persist host-clock checks on the controller
  // timeline without extending old checks or weakening nonce authentication.
  for (const offset of [14000,-14000,65000]) {
    await prisma.hostAgent.update({where:{hostId:host.id},data:{lastReport:{}}})
    const timestamp=String(Date.now()+offset),nonce=randomUUID()
    const body={version:'v1.0.6',capabilities:['guest-network-protection-v1'],guestProtectionStatus:{applied:true,checkedAt:new Date(Number(timestamp)-10000).toISOString()}}
    const bodyHash=createAgentBodyHash(body)
    const headers={'x-incudal-agent-id':original.agentId,'x-incudal-timestamp':timestamp,'x-incudal-nonce':nonce,'x-incudal-body-sha256':bodyHash,
      'x-incudal-signature':createAgentSignature(original.agentSecret,{method:'POST',path:'/agent/heartbeat',timestamp,nonce,bodyHash})}
    assert.equal((await app.inject({method:'POST',url:'/agent/heartbeat',payload:body,headers})).statusCode,200)
    const stored=await snapshot(), accepted=offset!==65000
    assert.equal(guestProtectionReady(stored),accepted)
    assert.equal(await prisma.hostAgent.count({where:{id:stored.id,...guestProtectionReadyWhere()}}),accepted?1:0,'SQL inventory and in-memory gate agree')
    assert.equal((await app.inject({method:'POST',url:'/agent/heartbeat',payload:body,headers})).statusCode,401,'same signed packet cannot be replayed')
    assert.deepEqual(await snapshot(),stored,'replay cannot refresh receipt age')
  }
  await prisma.hostAgent.update({where:{hostId:host.id},data:{lastReport:{}}})
  const packet=async (signedAt:number,applied:boolean) => {
    const timestamp=String(signedAt),nonce=randomUUID(),body={capabilities:['guest-network-protection-v1'],guestProtectionStatus:{applied,checkedAt:new Date(signedAt-1000).toISOString()}}
    const bodyHash=createAgentBodyHash(body)
    return app.inject({method:'POST',url:'/agent/heartbeat',payload:body,headers:{'x-incudal-agent-id':original.agentId,'x-incudal-timestamp':timestamp,'x-incudal-nonce':nonce,'x-incudal-body-sha256':bodyHash,
      'x-incudal-signature':createAgentSignature(original.agentSecret,{method:'POST',path:'/agent/heartbeat',timestamp,nonce,bodyHash})}})
  }
  const sendTime=Date.now()
  assert.equal((await packet(sendTime,false)).statusCode,200)
  const failedReceipt=await snapshot()
  assert.equal((await packet(sendTime-10000,true)).statusCode,200)
  assert.deepEqual(await snapshot(),failedReceipt,'delayed older success cannot replace a newer failure or refresh lastSeenAt')
  assert.equal(guestProtectionReady(await snapshot()),false)
  // An out-of-bound clock report must not erase the last ordered failure.
  assert.equal((await packet(Date.now()+65000,true)).statusCode,200)
  assert.equal(guestProtectionReady(await snapshot()),false)
  assert.equal((await snapshot()).lastReport && ((await snapshot()).lastReport as any).signedAt, sendTime)
  assert.equal((await packet(sendTime-5000,true)).statusCode,200)
  assert.equal(guestProtectionReady(await snapshot()),false,'invalid clock report cannot reset ordering and admit an older success')
  assert.equal((await packet(Date.now(),true)).statusCode,200)
  assert.equal(guestProtectionReady(await snapshot()),true,'new valid heartbeat restores readiness without waiting for the bad clock')
  const originalHost = await prisma.host.findUniqueOrThrow({ where: { id: host.id } })
  for (const bbr of [
    { state: 'pending', error: 'BBR_CAPABILITY_UNAVAILABLE' },
    { state: 'pending', error: 'BBR_CONFIG_CONFLICT' },
    { state: 'pending', error: 'BBR_HOST_APPLY_FAILED', hostApplied: false },
    { state: 'unsupported', error: 'BBR_KERNEL_UNAVAILABLE' },
    { state: 'applied', hostApplied: true, persistent: true }
  ]) {
    const timestamp = String(Date.now()), nonce = randomUUID(), body = {
      version: 'v1.0.7', runtime: { goos: 'linux', goarch: 'amd64', bbr },
      capabilities: ['guest-network-protection-v1'], guestProtectionStatus: { applied: true, checkedAt: new Date(Number(timestamp) - 1000).toISOString() }
    }
    const bodyHash = createAgentBodyHash(body)
    const response = await app.inject({ method: 'POST', url: '/agent/heartbeat', payload: body, headers: {
      'x-incudal-agent-id': original.agentId, 'x-incudal-timestamp': timestamp, 'x-incudal-nonce': nonce, 'x-incudal-body-sha256': bodyHash,
      'x-incudal-signature': createAgentSignature(original.agentSecret, { method: 'POST', path: '/agent/heartbeat', timestamp, nonce, bodyHash })
    } })
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().poolHostBbr, false, 'ordinary host is excluded from machine-pool BBR')
    const stored = await snapshot()
    assert.equal(stored.status, 'online'); assert.equal(guestProtectionReady(stored), true)
    assert.deepEqual((stored.lastReport as any).runtime.bbr, bbr, 'BBR errors remain observable without losing heartbeat')
    assert.deepEqual(await prisma.host.findUniqueOrThrow({ where: { id: host.id } }), originalHost, 'optional BBR reports cannot alter machine-pool host state')
  }
  await prisma.host.update({ where: { id: host.id }, data: { singleTenant: true } })
  const poolResponse = await packet(Date.now(), true)
  assert.equal(poolResponse.statusCode, 200)
  assert.equal(poolResponse.json().poolHostBbr, true, 'legacy pool host is selected even without onboarding node/marker')
  await prisma.host.update({ where: { id: host.id }, data: { singleTenant: originalHost.singleTenant } })
  console.log('PASS signed BBR pending/failure/unsupported/applied heartbeats preserve online status, security receipt and original host')
  await prisma.hostAgentNonce.deleteMany({where:{agentId:original.agentId}})
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
  assert.equal((await heartbeat(original.agentId, original.agentSecret)).statusCode, 200, 'unconsumed installer must not disconnect the running Agent')
  assert.equal(current.agentId, latest.agent.agentId, 'stored token belongs to the same committed identity')
  const redeemed = await Promise.all(issues.map(r => credentials.consumeHostAgentInstallToken(r.installToken).then(value => value, () => null)))
  assert.equal(redeemed.filter(Boolean).length, 1, 'only the latest serialized issuance remains valid')
  const valid = redeemed.find(Boolean)!
  assert.equal(valid.agent.agentId, current.agentId)
  assert.equal(hashAgentSecret(valid.agentSecret), current.secretHash)
  assert.equal(current.agentId, original.agentId, 'preparing and consuming installers preserves the active identity')
  assert.equal(current.secretHash, before.secretHash)
  assert.equal(await prisma.hostAgentNonce.count({ where: { agentId: original.agentId, nonce: tag } }), 1, 'installer issuance must retain replay protection for the active Agent')
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
  const validActive = await snapshot()
  assert.equal((await heartbeat(validActive.agentId, decryptSensitiveData(validActive.secretEncrypted)!)).statusCode, 200, 'expired installer leaves active heartbeat working')
  await rotate()
  assert.equal((await heartbeat(validActive.agentId, decryptSensitiveData(validActive.secretEncrypted)!)).statusCode, 401, 'explicit rotation still revokes the old identity')
  assert.equal(await prisma.hostAgentNonce.count({ where: { agentId: validActive.agentId } }), 0)
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
