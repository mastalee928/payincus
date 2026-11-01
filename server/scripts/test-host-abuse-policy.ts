// Actual PostgreSQL transactions, Fastify routes and Agent HMAC authentication.
// The web identity decorator and release metadata response are test boundaries;
// no customer's host or firewall is contacted by this test.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import Fastify from 'fastify'
import { Client } from 'pg'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && /_(?:pool_)?test$/.test(database.pathname), 'Use isolated local test PostgreSQL')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { ABUSE_POLICY_KEY, ABUSE_CAPABILITY, readAbusePolicy, abuseInstruction, normalizeAbuseStatus, listAbuseHosts, retryAbuseHosts, retryAllAbuseHosts } = await import('../src/services/host-abuse-policy.js')
const { default: policyRoutes } = await import('../src/routes/host-abuse-policy.js')
const interval = globalThis.setInterval
globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => { const timer = interval(...args); timer.unref(); return timer }) as typeof setInterval
try { await import('../src/lib/security.js') } finally { globalThis.setInterval = interval }
const { default: agentRoutes } = await import('../src/routes/agent.js')
const { rotateHostAgentCredentials } = await import('../src/lib/host-agent-credentials.js')
const { createAgentBodyHash, createAgentSignature } = await import('../src/lib/agent-auth.js')
assert.equal(await prisma.host.count(), 0, 'Dedicated empty test host inventory required')
assert.equal(await prisma.systemConfig.count({ where: { key: ABUSE_POLICY_KEY } }), 0)
const tag = `abuse-${randomUUID()}`
const admin = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-test-password', role: 'admin' } })
const actor = { id: admin.id, username: admin.username, role: 'admin' as const, sid: randomUUID(), iat: Math.floor(Date.now() / 1000) + 1 }
let webActor = { ...actor }
await prisma.host.createMany({ data: Array.from({ length: 107 }, (_, index) => ({ userId: admin.id, name: `${tag}-${String(index).padStart(3, '0')}`, url: 'https://127.0.0.1:1' })) })
const hosts = await prisma.host.findMany({ where: { userId: admin.id }, orderBy: { id: 'asc' } })
await prisma.hostAgent.createMany({ data: hosts.map((host, index) => ({ hostId: host.id, agentId: `${tag}-${index}`, secretHash: 'unusable', secretEncrypted: 'unusable', enabled: true,
  capabilities: index === 106 ? [] : [ABUSE_CAPABILITY], lastSeenAt: index === 105 ? new Date(Date.now() - 600000) : new Date() })) })
const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } })
app.decorate('authenticateAdmin', async (request, reply) => {
  if (request.headers['x-web-test-denied']) return reply.code(403).send({ code: 'FORBIDDEN' })
  request.user = { ...webActor }
})
app.decorate('authenticate', async request => { request.user = { ...webActor } })
await app.register(policyRoutes, { prefix: '/hosts' })
await app.register(agentRoutes, { prefix: '/agent' })
const originalFetch = globalThis.fetch
globalThis.fetch = async () => new Response(JSON.stringify({ tag_name: 'agent-v1.0.3', assets: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
const holder = new Client({ connectionString: database.href }), observer = new Client({ connectionString: database.href })
const trigger = `abuse_audit_${randomUUID().replaceAll('-', '')}`
const queueTrigger = `abuse_queue_${randomUUID().replaceAll('-', '')}`
let triggerInstalled = false, queueTriggerInstalled = false, blocked = 0
const save = (revision: number, blockBt = true, blockMining = true) => app.inject({ method: 'PUT', url: '/hosts/abuse-policy', payload: { revision, blockBt, blockMining } })
const retry = (revision: number) => app.inject({ method: 'POST', url: '/hosts/abuse-policy/retry', payload: { revision } })
const logCount = () => prisma.log.count({ where: { userId: admin.id, action: { startsWith: 'host.abuse_policy.' } } })
const cleanRetry = () => prisma.systemConfig.deleteMany({ where: { OR: [{ key: { startsWith: 'host_abuse_retry_v1_' } }, { key: { startsWith: 'host_abuse_queue_error_v1_' } }] } })
const snapshot = async () => JSON.stringify(await prisma.systemConfig.findMany({ where: { OR: [{ key: ABUSE_POLICY_KEY }, { key: { startsWith: 'host_abuse_retry_v1_' } }, { key: { startsWith: 'host_abuse_queue_error_v1_' } }] }, orderBy: { key: 'asc' } }))
async function waitForBlocker(pid: number) {
  const deadline = Date.now() + 1500
  while (!(await observer.query('SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS waiting', [pid])).rows[0].waiting) {
    assert.ok(Date.now() < deadline, 'real write must be waiting on the held administrator row')
    await delay(10)
  }
  blocked++
}
async function installAuditFailure() {
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = ${admin.id} AND NEW.action LIKE 'host.abuse_policy.%' THEN RAISE EXCEPTION 'fixture-abuse-audit-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  triggerInstalled = true
}
async function removeAuditFailure() {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON logs`)
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`)
  triggerInstalled = false
}
async function removeQueueFailure() {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${queueTrigger} ON system_configs`)
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${queueTrigger}()`)
  queueTriggerInstalled = false
}
try {
  await holder.connect(); await observer.connect()
  const holderPid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number
  assert.deepEqual(await readAbusePolicy(), { revision: 0, blockBt: false, blockMining: false })
  assert.equal(await abuseInstruction(hosts[0].id), null)
  assert.equal((await listAbuseHosts({})).summary.unconfigured, 107)
  for (const payload of [{}, { revision: -1, blockBt: true, blockMining: true }, { revision: 0.5, blockBt: true, blockMining: true },
    { revision: 2147483648, blockBt: true, blockMining: true }, { revision: 0, blockBt: {}, blockMining: true },
    { revision: 0, blockBt: true, blockMining: true, command: 'sh' }]) {
    assert.equal((await app.inject({ method: 'PUT', url: '/hosts/abuse-policy', payload })).statusCode, 400)
  }
  for (const url of ['/hosts/abuse-policy?page=0', '/hosts/abuse-policy?state=unknown', '/hosts/abuse-policy?command=sh']) {
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, 400)
  }
  assert.equal((await app.inject({ method: 'GET', url: '/hosts/abuse-policy', headers: { 'x-web-test-denied': '1' } })).statusCode, 403)
  assert.equal((await save(0)).statusCode, 200)
  let policy = await readAbusePolicy()
  assert.deepEqual(policy, { revision: 1, blockBt: true, blockMining: true })
  const inventory = await listAbuseHosts({})
  assert.equal(inventory.total, 107); assert.equal(inventory.pages, 6); assert.equal(inventory.hosts.length, 20)
  assert.equal(inventory.summary.pending, 105); assert.equal(inventory.summary.offline, 1); assert.equal(inventory.summary.unsupported, 1)
  // The default applies to future hosts without copying per-host policy rows.
  const added = await prisma.host.create({ data: { userId: admin.id, name: `${tag}-new`, url: 'https://127.0.0.1:1' } })
  assert.deepEqual(await abuseInstruction(added.id), { ...policy, retryNonce: 0 })
  assert.equal((await listAbuseHosts({ search: added.name })).hosts[0].errorCode, 'HOST_AGENT_NOT_INSTALLED')
  assert.equal((await listAbuseHosts({ search: hosts[106].name })).hosts[0].errorCode, 'HOST_AGENT_UPGRADE_REQUIRED')
  const race = await Promise.all([save(1, false, true), save(1, true, false)])
  assert.deepEqual(race.map(response => response.statusCode).sort(), [200, 409], 'one CAS winner only')
  policy = await readAbusePolicy(); assert.equal(policy.revision, 2)
  assert.equal(await logCount(), 2)
  // Audit INSERT failure rolls desired policy and retry nonces back together.
  await installAuditFailure()
  let before = await snapshot(), auditBefore = await logCount()
  assert.equal((await save(2)).statusCode, 500)
  assert.equal(await snapshot(), before); assert.equal(await logCount(), auditBefore)
  await assert.rejects(retryAbuseHosts([hosts[1].id, hosts[2].id], 2, actor))
  assert.equal(await snapshot(), before); assert.equal(await logCount(), auditBefore)
  await removeAuditFailure()
  // Real signed heartbeat obtains the global desired policy, then reports it.
  const credentials = await rotateHostAgentCredentials(hosts[0].id, true, { actor })
  const sign = (body: unknown) => {
    const timestamp = String(Date.now()), nonce = randomUUID(), bodyHash = createAgentBodyHash(body)
    return { 'x-incudal-agent-id': credentials.agentId, 'x-incudal-timestamp': timestamp, 'x-incudal-nonce': nonce, 'x-incudal-body-sha256': bodyHash,
      'x-incudal-signature': createAgentSignature(credentials.agentSecret, { method: 'POST', path: '/agent/heartbeat', timestamp, nonce, bodyHash }) }
  }
  const heartbeat = (status?: unknown, supported = true) => {
    const payload = { version: '1.0.3', capabilities: supported ? [ABUSE_CAPABILITY] : [], abusePolicyStatus: status }
    return app.inject({ method: 'POST', url: '/agent/heartbeat', headers: sign(payload), payload })
  }
  let response = await heartbeat()
  assert.equal(response.statusCode, 200, response.body)
  assert.deepEqual(response.json().abusePolicy, { ...policy, retryNonce: 0 })
  let report = { ...policy, retryNonce: 0, applied: true, attempts: 1, errorCode: null, nextRetryAt: null, checkedAt: new Date().toISOString() }
  response = await heartbeat(report); assert.equal(response.statusCode, 200, response.body)
  let first = (await listAbuseHosts({ search: hosts[0].name })).hosts[0]
  assert.equal(first.state, 'applied')
  for (const stale of [{ ...report, revision: 1 }, { ...report, retryNonce: 1 }, { ...report, blockBt: !report.blockBt }, { ...report, blockMining: !report.blockMining }]) {
    assert.equal((await heartbeat(stale)).statusCode, 200)
    assert.equal((await listAbuseHosts({ search: hosts[0].name })).hosts[0].state,
      stale.blockBt !== report.blockBt || stale.blockMining !== report.blockMining ? 'conflict' : 'pending')
  }
  assert.equal((await heartbeat({ ...report, applied: false, errorCode: 'APPLY_FAILED', attempts: 3, nextRetryAt: new Date(Date.now() + 30000).toISOString() })).statusCode, 200)
  first = (await listAbuseHosts({ search: hosts[0].name })).hosts[0]
  assert.equal(first.state, 'retrying'); assert.equal(first.attempts, 3); assert.ok(first.nextRetryAt)
  assert.equal((await heartbeat(report)).statusCode, 200)
  // One bulk action crosses all pages, skipping applied and unsupported hosts.
  response = await retry(policy.revision)
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(response.json().queued, 105); assert.equal(response.json().failed, 0)
  assert.equal(response.json().results.length, 105)
  for (const host of hosts.slice(1, 106)) assert.equal((await abuseInstruction(host.id))!.retryNonce, 1)
  assert.equal((await abuseInstruction(hosts[0].id))!.retryNonce, 0)
  assert.equal((await abuseInstruction(hosts[106].id))!.retryNonce, 0)
  assert.equal((await listAbuseHosts({ state: 'attention', page: 6 })).hosts.length, 7)
  // Only the 20-second budget is controlled; both successful and failed batches
  // still execute real PostgreSQL transactions and route refreshes.
  let ticks = 0
  let partial = await retryAllAbuseHosts(policy.revision, actor, () => ++ticks < 3 ? 0 : 20000)
  assert.equal(partial.queued, 100); assert.equal(partial.failed, 5)
  let failedIds = partial.results.filter(row => !row.success).map(row => row.id)
  for (const id of failedIds) {
    const stored = JSON.parse((await prisma.systemConfig.findUniqueOrThrow({ where: { key: 'host_abuse_queue_error_v1_' + id } })).value)
    assert.equal(stored.revision, policy.revision); assert.equal(stored.code, 'ABUSE_RETRY_TIMEOUT'); assert.ok(Date.parse(stored.at))
    const refreshed = (await app.inject({ method: 'GET', url: '/hosts/abuse-policy?search=' + hosts.find(host => host.id === id)!.name })).json().hosts[0]
    assert.equal(refreshed.queueErrorCode, 'ABUSE_RETRY_TIMEOUT'); assert.equal(refreshed.queueErrorAt, stored.at)
    assert.notEqual(refreshed.state, 'applied'); assert.equal((await abuseInstruction(id))!.retryNonce, 1)
  }
  await retryAbuseHosts(failedIds, policy.revision, actor)
  for (const id of failedIds) assert.equal((await listAbuseHosts({ search: hosts.find(host => host.id === id)!.name })).hosts[0].queueErrorCode, null)
  const failId = failedIds[0]
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${queueTrigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key = 'host_abuse_retry_v1_${failId}' THEN RAISE EXCEPTION 'fixture-abuse-queue-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${queueTrigger} BEFORE INSERT OR UPDATE ON system_configs FOR EACH ROW EXECUTE FUNCTION ${queueTrigger}()`)
  queueTriggerInstalled = true
  partial = await retryAllAbuseHosts(policy.revision, actor, () => 0)
  assert.equal(partial.queued, 100); assert.equal(partial.failed, 5)
  failedIds = partial.results.filter(row => !row.success).map(row => row.id)
  for (const id of failedIds) {
    assert.equal((await abuseInstruction(id))!.retryNonce, 2, 'failed batch must roll every nonce back')
    assert.equal((await listAbuseHosts({ search: hosts.find(host => host.id === id)!.name })).hosts[0].queueErrorCode, 'ABUSE_RETRY_FAILED')
  }
  await removeQueueFailure()
  await retryAbuseHosts(failedIds, policy.revision, actor)
  for (const id of failedIds) assert.equal((await listAbuseHosts({ search: hosts.find(host => host.id === id)!.name })).hosts[0].queueErrorCode, null)
  ticks = 0
  const deniedAudits = await prisma.log.count({ where: { action: 'host.abuse_policy.retry_attempt', content: { contains: `administrator ${actor.id};` } } })
  partial = await retryAllAbuseHosts(policy.revision, actor, async () => {
    if (++ticks === 3) await prisma.tokenInvalidation.create({ data: { userId: admin.id, sessionId: actor.sid, invalidatedAt: actor.iat } })
    return 0
  })
  assert.equal(partial.queued, 100); assert.equal(partial.failed, 5)
  for (const result of partial.results.filter(row => !row.success)) {
    assert.equal(result.code, 'FORBIDDEN'); assert.equal((await abuseInstruction(result.id))!.retryNonce, 3)
    assert.equal(await prisma.systemConfig.count({ where: { key: 'host_abuse_queue_error_v1_' + result.id } }), 0,
      'revocation may write an attempt audit, never nonce or diagnostic configuration')
  }
  assert.equal(await prisma.log.count({ where: { action: 'host.abuse_policy.retry_attempt', content: { contains: `administrator ${actor.id};` } } }), deniedAudits + 1)
  await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } })
  ticks = 0
  const staleTimeout = await retryAllAbuseHosts(policy.revision, actor, async () => {
    if (++ticks === 3) { await retryAbuseHosts(failedIds, policy.revision, actor); return 20000 }
    return 0
  })
  assert.equal(staleTimeout.failed, 5)
  for (const id of failedIds) {
    assert.equal((await abuseInstruction(id))!.retryNonce, 4)
    assert.equal((await listAbuseHosts({ search: hosts.find(host => host.id === id)!.name })).hosts[0].queueErrorCode, null,
      'an older timeout must not overwrite a concurrent successful retry')
  }
  // A diagnostic row may fail independently of the already committed batches.
  // Keep the partial result and persist an independent audit of that failure.
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${queueTrigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key LIKE 'host_abuse_queue_error_v1_%' THEN RAISE EXCEPTION 'fixture-abuse-diagnostic-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${queueTrigger} BEFORE INSERT OR UPDATE ON system_configs FOR EACH ROW EXECUTE FUNCTION ${queueTrigger}()`)
  queueTriggerInstalled = true
  const beforeDiagnosticAudit = await prisma.log.count({ where: { action: 'host.abuse_policy.retry_attempt', content: { contains: `administrator ${actor.id};` } } })
  ticks = 0
  partial = await retryAllAbuseHosts(policy.revision, actor, () => ++ticks < 3 ? 0 : 20000)
  assert.equal(partial.queued, 100); assert.equal(partial.failed, 5, 'diagnostic failure must not discard successful batch results')
  for (const id of failedIds) assert.equal((await abuseInstruction(id))!.retryNonce, 4, 'diagnostic failure must not advance a failed host')
  assert.equal(await prisma.log.count({ where: { action: 'host.abuse_policy.retry_attempt', content: { contains: `administrator ${actor.id};` } } }), beforeDiagnosticAudit + 1)
  const diagnosticAudit = await prisma.log.findFirstOrThrow({ where: { action: 'host.abuse_policy.retry_attempt', content: { contains: 'diagnostics=ABUSE_RETRY_FAILED' } }, orderBy: { id: 'desc' } })
  assert.ok(failedIds.every(id => diagnosticAudit.content.includes(`${id}:ABUSE_RETRY_TIMEOUT`)), 'audit retains each failed host and its original cause')
  assert.ok(!diagnosticAudit.content.includes('fixture-abuse-diagnostic-failure'), 'audit stores a safe code, not raw database errors')
  // If the fallback audit also fails, do not claim that failure was persisted.
  // Install after the first batch so its successful transaction remains real.
  const firstBatchHost = partial.results.find(row => row.success)!.id
  const firstBatchNonce = (await abuseInstruction(firstBatchHost))!.retryNonce
  ticks = 0
  await assert.rejects(retryAllAbuseHosts(policy.revision, actor, async () => {
    if (++ticks < 3) return 0
    await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'host.abuse_policy.retry_attempt' THEN RAISE EXCEPTION 'fixture-abuse-attempt-audit-failure'; END IF; RETURN NEW; END $$`)
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
    triggerInstalled = true
    return 20000
  }), /fixture-abuse-attempt-audit-failure/)
  assert.equal((await abuseInstruction(firstBatchHost))!.retryNonce, firstBatchNonce + 1, 'audit failure cannot undo a previously committed batch')
  for (const id of failedIds) assert.equal((await abuseInstruction(id))!.retryNonce, 4)
  assert.equal(await prisma.log.count({ where: { action: 'host.abuse_policy.retry_attempt', content: { contains: `administrator ${actor.id};` } } }), beforeDiagnosticAudit + 1)
  await removeAuditFailure()
  await removeQueueFailure()
  console.log('PASS diagnostic transaction failure preserves committed batches and writes an independent per-host failure audit')
  console.log('PASS bulk retry: first batch commits, deadline and real PG second-batch failure survive refresh, successful retry clears diagnostics, mid-batch session revocation only appends failure audit')
  await retryAbuseHosts([hosts[0].id], policy.revision, actor)
  await heartbeat(report)
  await heartbeat({ ...report, checkedAt: new Date(Date.now() - 600000).toISOString() })
  assert.equal((await listAbuseHosts({ search: hosts[0].name })).hosts[0].state, 'pending', 'a fresh heartbeat cannot turn an old firewall inspection into current success')
  await heartbeat(report)
  assert.equal((await listAbuseHosts({ search: hosts[0].name })).hosts[0].state, 'pending', 'old retry nonce cannot satisfy a new retry')
  report = { ...report, retryNonce: 1, checkedAt: new Date().toISOString() }
  await heartbeat(report)
  assert.equal((await listAbuseHosts({ search: hosts[0].name })).hosts[0].state, 'applied')
  const validConfig = await prisma.systemConfig.findUniqueOrThrow({ where: { key: ABUSE_POLICY_KEY } })
  await prisma.systemConfig.update({ where: { key: ABUSE_POLICY_KEY }, data: { value: '{broken' } })
  const invalidPolicyHeartbeat = await heartbeat(report)
  assert.equal(invalidPolicyHeartbeat.statusCode, 200)
  assert.equal(invalidPolicyHeartbeat.json().abusePolicy, null, 'invalid optional policy must not block host heartbeat, protocol or upgrades')
  assert.ok(invalidPolicyHeartbeat.json().portProtocol)
  assert.equal((await app.inject({ method: 'GET', url: '/hosts/abuse-policy' })).json().code, 'ABUSE_POLICY_INVALID')
  await prisma.systemConfig.update({ where: { key: ABUSE_POLICY_KEY }, data: { value: validConfig.value } })
  assert.equal((await heartbeat(report, false)).json().abusePolicy, null)
  assert.equal((await listAbuseHosts({ search: hosts[0].name })).hosts[0].state, 'unsupported')
  await heartbeat(report)
  const noncePayload = { version: '1.0.3', capabilities: [ABUSE_CAPABILITY], abusePolicyStatus: report }, signed = sign(noncePayload)
  assert.equal((await app.inject({ method: 'POST', url: '/agent/heartbeat', headers: signed, payload: noncePayload })).statusCode, 200)
  assert.equal((await app.inject({ method: 'POST', url: '/agent/heartbeat', headers: signed, payload: noncePayload })).json().code, 'AGENT_NONCE_REPLAY')
  await prisma.hostAgent.update({ where: { hostId: hosts[0].id }, data: { enabled: false, status: 'disabled' } })
  assert.equal((await listAbuseHosts({ search: hosts[0].name })).hosts[0].errorCode, 'HOST_AGENT_DISABLED')
  before = JSON.stringify(await prisma.hostAgent.findUniqueOrThrow({ where: { hostId: hosts[0].id } }))
  assert.equal((await heartbeat(report)).statusCode, 401)
  assert.equal(JSON.stringify(await prisma.hostAgent.findUniqueOrThrow({ where: { hostId: hosts[0].id } })), before)
  for (const invalid of [null, [], { ...report, attempts: -1 }, { ...report, revision: 0 }, { ...report, checkedAt: 'bad date' },
    { ...report, checkedAt: new Date(Date.now() + 600000).toISOString() }, { ...report, retryNonce: -1 }]) assert.equal(normalizeAbuseStatus(invalid), null)
  // Immediate session/role revocation cannot be bypassed by a stale web actor.
  await prisma.tokenInvalidation.create({ data: { userId: admin.id, sessionId: actor.sid, invalidatedAt: actor.iat } })
  before = await snapshot(); assert.equal((await save(policy.revision)).statusCode, 403); assert.equal(await snapshot(), before)
  await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } })
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
  assert.equal((await save(policy.revision)).statusCode, 403); assert.equal(await snapshot(), before)
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
  // Gate the actual authorization row. Revocation commits while the request is
  // in flight; the resumed transaction reads the current role/session.
  for (const mode of ['session', 'role'] as const) {
    await holder.query('BEGIN'); await holder.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [admin.id])
    const pending: Promise<{ statusCode: number }> = save(policy.revision).then(value => value)
    try {
      await waitForBlocker(holderPid)
      if (mode === 'session') await holder.query('INSERT INTO token_invalidations(user_id,session_id,invalidated_at) VALUES($1,$2,$3)', [admin.id, actor.sid, actor.iat])
      else await holder.query('UPDATE users SET role=$2 WHERE id=$1', [admin.id, 'user'])
      await holder.query('COMMIT')
    } catch (error) { await holder.query('ROLLBACK'); await pending; throw error }
    assert.equal((await pending).statusCode, 403)
    assert.equal(await snapshot(), before)
    await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } })
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
  }
  assert.equal(blocked, 2)
  // An explicit later disable is another desired revision, not a fabricated
  // successful receipt; capable hosts receive it on their normal heartbeat.
  ticks = 0
  const expired = await retryAllAbuseHosts(policy.revision, actor, () => ++ticks === 1 ? 0 : 20000)
  assert.ok(expired.failed > 0)
  const expiredHost = hosts.find(host => host.id === expired.results[0].id)!
  assert.equal((await listAbuseHosts({ search: expiredHost.name })).hosts[0].queueErrorCode, 'ABUSE_RETRY_TIMEOUT')
  assert.equal((await save(policy.revision, false, false)).statusCode, 200)
  policy = await readAbusePolicy(); assert.equal(policy.revision, 3)
  assert.equal((await listAbuseHosts({ search: expiredHost.name })).hosts[0].queueErrorCode, null, 'new desired revision invalidates old queue failure without deleting audit history')
  assert.equal((await listAbuseHosts({})).summary.applied, 0)
  assert.deepEqual(await abuseInstruction(added.id), { revision: 3, blockBt: false, blockMining: false, retryNonce: 0 })
  await prisma.hostAgent.update({ where: { hostId: hosts[0].id }, data: { enabled: true, status: 'online' } })
  report = { ...report, revision: 8, retryNonce: 5, blockBt: true, checkedAt: new Date().toISOString() }
  assert.equal((await heartbeat(report)).statusCode, 200)
  assert.equal((await listAbuseHosts({ state: 'conflict' })).hosts[0].state, 'conflict', 'restored older policy is not an endless pending task')
  const conflictRetry = await retryAbuseHosts([hosts[0].id], policy.revision, actor)
  assert.equal(conflictRetry.results[0].code, 'ABUSE_POLICY_CONFLICT')
  await prisma.systemConfig.delete({ where: { key: ABUSE_POLICY_KEY } })
  assert.equal((await listAbuseHosts({ state: 'conflict' })).summary.conflict, 1, 'absent restored policy does not hide existing host protection')
  assert.equal((await save(0, true, true)).statusCode, 200)
  policy = await readAbusePolicy(); assert.equal(policy.revision, 9, 'explicit save exceeds the authenticated host revision')
  report = { ...report, ...policy, retryNonce: 11, checkedAt: new Date().toISOString() }
  await heartbeat(report)
  await retryAbuseHosts([hosts[0].id], policy.revision, actor)
  assert.equal((await abuseInstruction(hosts[0].id))?.retryNonce, 12, 'retry repairs a restored old nonce in one action')
  report = { ...report, retryNonce: 12, checkedAt: new Date().toISOString() }
  await heartbeat(report)
  assert.equal((await listAbuseHosts({ search: hosts[0].name })).hosts[0].state, 'applied')
  console.log('PASS restored older/missing policy and retry nonce: protection retained, explicit global save issues revision 9, one bulk retry converges nonce 12')
  await heartbeat({ ...report, revision: 2147483647 })
  assert.equal((await listAbuseHosts({ search: hosts[0].name })).hosts[0].errorCode, 'ABUSE_POLICY_UNTRUSTED_REVISION')
  assert.equal((await save(policy.revision, true, true)).statusCode, 200, 'one host cannot exhaust the global revision space')
  policy = await readAbusePolicy(); assert.equal(policy.revision, 10)
  await prisma.hostAgent.updateMany({ where: { hostId: { in: hosts.map(host => host.id) } }, data: { enabled: false } })
  await prisma.tokenInvalidation.create({ data: { userId: admin.id, sessionId: actor.sid, invalidatedAt: actor.iat } })
  const beforeDeniedRetry = await snapshot()
  const beforeDeniedAudit = await prisma.log.count({ where: { action: 'host.abuse_policy.retry_attempt', content: { contains: `administrator ${actor.id};` } } })
  assert.equal((await retry(policy.revision)).statusCode, 403, 'empty retry selection still requires current administrator authorization')
  assert.equal(await snapshot(), beforeDeniedRetry, 'denied initial retry cannot write desired policy, nonce or queue diagnostics')
  assert.equal(await prisma.log.count({ where: { action: 'host.abuse_policy.retry_attempt', content: { contains: `administrator ${actor.id};` } } }), beforeDeniedAudit + 1)
  console.log('PASS abuse policy real PG/Fastify: schema, CAS race, audit rollback, 108-host inventory, cross-page bulk retry, future-host inheritance, actual HMAC/replay/disabled Agent, stale revision/nonce/flags, offline/unsupported, immediate and two observed in-flight administrator revocations; no host firewall writes')
} finally {
  globalThis.fetch = originalFetch
  if (triggerInstalled) await removeAuditFailure()
  if (queueTriggerInstalled) await removeQueueFailure()
  await holder.query('ROLLBACK').catch(() => {}); await holder.end(); await observer.end(); await app.close()
  await prisma.log.deleteMany({ where: { userId: admin.id } })
  await prisma.log.deleteMany({ where: { action: 'host.abuse_policy.retry_attempt', content: { contains: `administrator ${actor.id};` } } })
  await prisma.host.deleteMany({ where: { userId: admin.id } })
  await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } })
  await cleanRetry(); await prisma.systemConfig.deleteMany({ where: { key: ABUSE_POLICY_KEY } })
  await prisma.user.delete({ where: { id: admin.id } })
  await closePrismaDatabase()
}
