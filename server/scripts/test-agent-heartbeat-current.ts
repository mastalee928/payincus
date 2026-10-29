import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { rotateHostAgentCredentials } = await import('../src/lib/host-agent-credentials.js')
const { createAgentBodyHash, createAgentSignature, generateAgentSecret, hashAgentSecret } = await import('../src/lib/agent-auth.js')
const { encryptSensitiveData } = await import('../src/lib/security.js')
const { default: routes } = await import('../src/routes/agent.js')
const tag = randomUUID()
const user = await prisma.user.create({ data: { username: `heartbeat-current-${tag}`, passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: user.id, name: tag, url: 'https://127.0.0.1:1', portProtocol: 'tcp_udp', portProtocolRevision: 2 } })
const instance = await prisma.instance.create({ data: { userId: user.id, hostId: host.id, incusId: tag, name: tag, image: 'fixture', cpu: 1, memory: 128, disk: 1, status: 'running' } })
const actor = { id: user.id, sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
const app = Fastify()
for (const name of ['authenticate', 'authenticateAdmin']) app.decorate(name, async (request: any) => { request.user = actor })
const originalFetch = globalThis.fetch
globalThis.fetch = async () => new Response(JSON.stringify({ tag_name: 'agent-v1.0.3', assets: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
const originalTransaction = prisma.$transaction.bind(prisma)
let afterNonce: (() => Promise<unknown>) | undefined
let racePhase = 0, transactionIndex = 0, blocked = 0, blockAgent = false
const holder = new Client({ connectionString: database.href }), observer = new Client({ connectionString: database.href })
let holderPid = 0
prisma.$transaction = (async (input: any, options: any) => {
  if (typeof input === 'function' && racePhase && ++transactionIndex === racePhase) {
    await holder.query('BEGIN')
    if (blockAgent) await holder.query('SELECT id FROM host_agents WHERE host_id = $1 FOR UPDATE', [host.id])
    else await holder.query('SELECT id FROM hosts WHERE id = $1 FOR UPDATE', [host.id])
    const pending = originalTransaction(input, options)
    const deadline = Date.now() + 8000
    try {
      while (!(await observer.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS waiting', [holderPid])).rows[0].waiting) {
        assert.ok(Date.now() < deadline, 'report write must wait on the actual current-host lock')
        await new Promise(resolve => setTimeout(resolve, 15))
      }
      blocked++
      await holder.query('UPDATE host_agents SET enabled = false, status = $2 WHERE host_id = $1', [host.id, 'disabled'])
      await holder.query('COMMIT')
    } catch (error) { await holder.query('ROLLBACK'); await pending.catch(() => {}); throw error }
    return pending
  }
  const result = await originalTransaction(input, options)
  // The actual nonce transaction commits after HMAC verification; only its completion is gated.
  if (Array.isArray(input)) await afterNonce?.()
  return result
}) as typeof prisma.$transaction
const body = { version: 'current-fixture', runtime: { goos: 'linux', goarch: 'amd64' }, metrics: { heartbeatIntervalSeconds: 30 } }
const reports = { ...body, portProtocolStatus: { mode: 'tcp_udp', revision: 2, applied: true }, instances: { reportedAt: new Date().toISOString(), items: [{ name: tag, status: 'running', traffic: { rxBytes: '120', txBytes: '240' }, network: { ipv4: '192.0.2.123', ipv6: '2001:db8::123' } }] } }
const serialize = (value: unknown) => JSON.stringify(value, (_key, entry) => typeof entry === 'bigint' ? entry.toString() : entry)
const sign = (agentId: string, agentSecret: string, payload: unknown = body) => {
  const timestamp = String(Date.now()), nonce = randomUUID(), bodyHash = createAgentBodyHash(payload)
  return { 'x-incudal-agent-id': agentId, 'x-incudal-timestamp': timestamp, 'x-incudal-nonce': nonce, 'x-incudal-body-sha256': bodyHash,
    'x-incudal-signature': createAgentSignature(agentSecret, { method: 'POST', path: '/agent/heartbeat', timestamp, nonce, bodyHash }) }
}
try {
  await holder.connect(); await observer.connect(); holderPid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
  await app.register(routes, { prefix: '/agent' })
  for (const mode of ['disabled', 'status-disabled', 'rotated', 'secret-changed']) {
    const credentials = await rotateHostAgentCredentials(host.id, true, { actor })
    let expected: string | undefined
    afterNonce = async () => {
      afterNonce = undefined
      if (mode === 'rotated') await rotateHostAgentCredentials(host.id, true, { actor })
      else if (mode === 'secret-changed') {
        const replacement = generateAgentSecret()
        await prisma.hostAgent.update({ where: { hostId: host.id }, data: { secretEncrypted: encryptSensitiveData(replacement), secretHash: hashAgentSecret(replacement) } })
      }
      else await prisma.hostAgent.update({ where: { hostId: host.id }, data: mode === 'disabled' ? { enabled: false, status: 'disabled' } : { status: 'disabled' } })
      expected = JSON.stringify(await prisma.hostAgent.findUnique({ where: { hostId: host.id } }))
    }
    const originalInstance = serialize(await prisma.instance.findUnique({ where: { id: instance.id } })), originalProtocol = serialize(await prisma.host.findUnique({ where: { id: host.id } }))
    const response = await app.inject({ method: 'POST', url: '/agent/heartbeat', headers: sign(credentials.agentId, credentials.agentSecret, reports), payload: reports })
    assert.ok(expected, 'the actual authenticated nonce boundary was exercised')
    assert.equal(response.statusCode, 401, 'obsolete authenticated Agent cannot publish a heartbeat')
    assert.equal(response.json().code, 'AGENT_DISABLED')
    assert.ok(JSON.stringify(await prisma.hostAgent.findUnique({ where: { hostId: host.id } })) === expected, 'obsolete heartbeat leaves the replacement/disabled record untouched')
    assert.equal(serialize(await prisma.instance.findUnique({ where: { id: instance.id } })), originalInstance)
    assert.equal(serialize(await prisma.host.findUnique({ where: { id: host.id } })), originalProtocol)
    assert.equal(await prisma.trafficSnapshot.count({ where: { instanceId: instance.id } }), 0)
  }
  for (const [phase, directAgentLock] of [[1, false], [2, false], [3, false], [4, false], [4, true]] as const) {
    const credentials = await rotateHostAgentCredentials(host.id, true, { actor })
    await prisma.host.update({ where: { id: host.id }, data: { portProtocolAppliedRevision: 1 } })
    await prisma.instance.update({ where: { id: instance.id }, data: { status: 'stopped', ipv4: null, ipv6: null } })
    await prisma.trafficSnapshot.deleteMany({ where: { instanceId: instance.id } })
    racePhase = phase; transactionIndex = 0; blockAgent = directAgentLock
    const response = await app.inject({ method: 'POST', url: '/agent/heartbeat', headers: sign(credentials.agentId, credentials.agentSecret, reports), payload: reports })
    racePhase = 0
    assert.equal(response.statusCode, 401, 'disabled Agent cannot finish after waiting for current write authority')
    const current = await prisma.hostAgent.findUniqueOrThrow({ where: { hostId: host.id } })
    assert.equal(current.status, 'disabled'); assert.equal(current.version, null); assert.equal(current.lastSeenAt, null)
    if (phase === 1) assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).portProtocolAppliedRevision, 1)
    if (phase <= 2) assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).status, 'stopped')
    if (phase <= 3) assert.equal(await prisma.trafficSnapshot.count({ where: { instanceId: instance.id } }), 0)
  }
  assert.equal(blocked, 5)
  const credentials = await rotateHostAgentCredentials(host.id, true, { actor })
  const headers = sign(credentials.agentId, credentials.agentSecret)
  const accepted = await app.inject({ method: 'POST', url: '/agent/heartbeat', headers, payload: body })
  assert.equal(accepted.statusCode, 200)
  assert.equal(accepted.json().ok, true)
  assert.equal((await prisma.hostAgent.findUniqueOrThrow({ where: { hostId: host.id } })).status, 'online')
  assert.equal((await app.inject({ method: 'POST', url: '/agent/heartbeat', headers, payload: body })).json().code, 'AGENT_NONCE_REPLAY')
  const reportHeaders = sign(credentials.agentId, credentials.agentSecret, reports)
  const acceptedReport = await app.inject({ method: 'POST', url: '/agent/heartbeat', headers: reportHeaders, payload: reports })
  assert.equal(acceptedReport.statusCode, 200)
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).portProtocolAppliedRevision, 2)
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).status, 'running')
  assert.equal(await prisma.trafficSnapshot.count({ where: { instanceId: instance.id } }), 1)
  const concurrent = await Promise.all(Array.from({ length: 7 }, () => app.inject({ method: 'POST', url: '/agent/heartbeat', headers: sign(credentials.agentId, credentials.agentSecret, reports), payload: reports })))
  assert.ok(concurrent.every(response => response.statusCode === 200), 'concurrent reports keep a consistent lock order without lock upgrade deadlocks')
  assert.equal(await prisma.trafficSnapshot.count({ where: { instanceId: instance.id } }), 1)
  console.log('PASS actual HMAC/PostgreSQL heartbeat disabled/status-disabled/rotated/same-ID secret change, five actual pg_blocking_pids host/Agent write races for protocol/instance/traffic/heartbeat, seven concurrent/normal reports and nonce replay; metadata fetch fixture only')
} finally {
  afterNonce = undefined; racePhase = 0; prisma.$transaction = originalTransaction; globalThis.fetch = originalFetch
  await app.close(); await holder.end(); await observer.end(); await prisma.instance.delete({ where: { id: instance.id } }); await prisma.host.delete({ where: { id: host.id } }); await prisma.user.delete({ where: { id: user.id } }); await closePrismaDatabase()
}
process.exit(0)
