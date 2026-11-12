import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
const directory = await mkdtemp(join(tmpdir(), 'management-repair-'))
process.env.PLATFORM_BACKUP_STATE_DIR = directory
process.env.NODE_ENV = 'test'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { repairHostManagement, repairHostManagementQueue } = await import('../src/services/host-management-repair.js')
const { encryptSensitiveData } = await import('../src/lib/security.js')
const { generateAgentId, generateAgentSecret, hashAgentSecret } = await import('../src/lib/agent-auth.js')
const { issueHostAgentInstallToken, rotateHostAgentCredentials } = await import('../src/lib/host-agent-credentials.js')
const { panelCertificatePaths } = await import('../src/lib/incus/certificate-paths.js')
const tag = 'management-' + randomUUID().slice(0, 8)
const admin = await prisma.user.create({ data: { username: tag, passwordHash: 'fixture', role: 'admin' } })
const batchId = randomUUID()
await prisma.hostOnboardingBatch.create({ data: { id: batchId, createdById: admin.id, name: tag, accountLabel: 'fixture', defaults: {} } })
let sequence = 0, verifyCalls = 0, agentCalls = 0, fail = false
let verifying: (() => Promise<void>) | undefined
const hostIds: number[] = []
async function fixture(legacy = true) {
  const seq = ++sequence, secret = generateAgentSecret()
  const host = await prisma.host.create({ data: { userId: admin.id, name: tag + seq, url: `https://10.253.240.${seq + 1}:8443`,
    singleTenant: true, isInstalled: true, managementSshHost: `10.253.240.${seq + 1}`, managementSshPort: 22,
    serverCertificate: 'fixed-original-certificate', serverFingerprint: 'fixed-original-fingerprint',
    agent: { create: { agentId: generateAgentId(), secretHash: hashAgentSecret(secret), secretEncrypted: encryptSensitiveData(secret),
      enabled: true, status: 'offline', installTokenHash: legacy ? randomUUID() : null, installTokenExpiresAt: new Date(0) } },
    onboardingNode: { create: { batchId, name: tag + seq, publicIp: `192.0.2.${seq}`, managementIp: `10.253.240.${seq + 1}`,
      sshPort: 22, sshFingerprint: 'SHA256:' + 'a'.repeat(43), nodePublicKey: 'b'.repeat(43) + '=', status: 'succeeded', credentialsExpireAt: new Date(0) } }
  }, include: { agent: true, onboardingNode: true } })
  hostIds.push(host.id)
  return host
}
const deps = {
  verify: async (host: { serverCertificate: string | null; serverFingerprint: string | null }, signal: AbortSignal) => {
    verifyCalls++; signal.throwIfAborted()
    assert.equal(host.serverCertificate, 'fixed-original-certificate'); assert.equal(host.serverFingerprint, 'fixed-original-fingerprint')
    await verifying?.()
    if (fail) throw Error('fixture offline')
  },
  repairAgent: async (nodeId: string, input: { agentId: string; agentSecret: string; expiresAt: number }, signal?: AbortSignal) => {
    agentCalls++; signal?.throwIfAborted()
    const node = await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { id: nodeId }, include: { host: { include: { agent: true } } } })
    assert.equal(node.host!.agent!.agentId, input.agentId)
    assert.equal(hashAgentSecret(input.agentSecret), node.host!.agent!.secretHash)
    assert.ok(input.expiresAt > Date.now() && input.expiresAt < Date.now() + 30000)
  }
}
const snapshot = (id: number) => prisma.host.findUniqueOrThrow({ where: { id }, include: { agent: true } })
const state = (host: { managementRepair: unknown }) => host.managementRepair as { status: string; error?: string; attempts: number }
const due = async (id: number) => {
  const value = state(await snapshot(id))
  await prisma.host.update({ where: { id }, data: { managementRepair: { ...value, nextAttemptAt: new Date(0).toISOString() } } })
}
try {
  const historical = await fixture()
  await repairHostManagementQueue(deps)
  const repaired = await snapshot(historical.id)
  assert.equal(repaired.certPath, panelCertificatePaths().certPath)
  assert.equal(repaired.keyPath, panelCertificatePaths().keyPath)
  assert.equal(repaired.agent!.agentId, historical.agent!.agentId)
  assert.equal(repaired.agent!.secretHash, historical.agent!.secretHash)
  assert.equal(state(repaired).status, 'waiting-heartbeat')
  assert.equal(agentCalls, 1)
  await repairHostManagement(historical.id, deps)
  assert.equal(agentCalls, 1, 'backoff prevents immediate repeat')
  await prisma.hostAgent.update({ where: { hostId: historical.id }, data: { lastSeenAt: new Date(), version: 'v1.0.4', status: 'online' } })
  await due(historical.id)
  await repairHostManagementQueue(deps)
  assert.equal(state(await snapshot(historical.id)).status, 'done')
  assert.equal(agentCalls, 1, 'fresh heartbeat completes without more writes')
  console.log('PASS historical missing certificate + invalidated Agent: automatic queue repairs original identity and waits for actual heartbeat')

  const cert = await fixture(false)
  await repairHostManagement(cert.id, deps)
  assert.equal(state(await snapshot(cert.id)).status, 'done'); assert.equal(agentCalls, 1)
  const retry = await fixture(); fail = true
  await repairHostManagement(retry.id, deps)
  assert.equal((await snapshot(retry.id)).certPath, null)
  assert.equal(state(await snapshot(retry.id)).status, 'retry')
  const retriesBefore = await prisma.log.findMany({ where: { action: 'host.management.repair_retry', content: { contains: `(#${retry.id})` } } })
  assert.equal(retriesBefore.length, 1)
  assert.match(retriesBefore[0].content, /核验原 TLS 管理连接.*下次自动重试/)
  await due(retry.id); await repairHostManagement(retry.id, deps)
  assert.equal(await prisma.log.count({ where: { action: 'host.management.repair_retry', content: { contains: `(#${retry.id})` } } }), 2, 'same repeated failure retains each attempted repair in searchable history')
  const calls = verifyCalls
  await repairHostManagement(retry.id, deps); assert.equal(verifyCalls, calls)
  fail = false; await due(retry.id); await repairHostManagement(retry.id, deps)
  assert.equal(state(await snapshot(retry.id)).status, 'waiting-heartbeat')
  console.log('PASS certificate-only recovery; unreachable TLS retains missing paths and retries after persisted backoff')

  const lost = await fixture()
  await prisma.host.update({ where: { id: lost.id }, data: panelCertificatePaths() })
  await repairHostManagement(lost.id, { ...deps, repairAgent: async (...args) => {
    await deps.repairAgent(...args)
    throw Error('receipt lost after remote configuration was applied')
  } })
  assert.equal(state(await snapshot(lost.id)).status, 'retry')
  await prisma.hostAgent.update({ where: { hostId: lost.id }, data: { lastSeenAt: new Date(), version: 'v1.0.4', status: 'online' } })
  await due(lost.id)
  const afterLost = agentCalls
  await repairHostManagementQueue(deps)
  assert.equal(state(await snapshot(lost.id)).status, 'done')
  assert.equal(agentCalls, afterLost, 'a verified heartbeat resolves a lost repair receipt without another write')
  console.log('PASS lost receipt completes automatically from the same current signed identity heartbeat')
  const stoppedAgent = await fixture(false)
  await prisma.host.update({ where: { id: stoppedAgent.id }, data: panelCertificatePaths() })
  await prisma.hostAgent.update({ where: { hostId: stoppedAgent.id }, data: { version: 'v1.0.6', lastSeenAt: new Date(Date.now() - 6 * 60000) } })
  const beforeReconnect = agentCalls
  await repairHostManagementQueue(deps)
  assert.equal(agentCalls, beforeReconnect + 1, 'stale established Agent is automatically reconciled over original trusted channel')
  assert.equal(state(await snapshot(stoppedAgent.id)).status, 'waiting-heartbeat')
  assert.equal((await snapshot(stoppedAgent.id)).agent!.agentId, stoppedAgent.agent!.agentId)
  await prisma.hostAgent.update({ where: { hostId: stoppedAgent.id }, data: { lastSeenAt: new Date(), status: 'online' } })
  await due(stoppedAgent.id); await repairHostManagementQueue(deps)
  assert.equal(state(await snapshot(stoppedAgent.id)).status, 'done')
  assert.equal(agentCalls, beforeReconnect + 1)
  console.log('PASS established Agent disappears -> automatic current-config repair -> same identity heartbeat confirms recovery without customer restart')

  for (const mode of ['disabled', 'revoked', 'new-installer', 'pending-install', 'wrong-binding', 'revoked-admin', 'not-installed', 'hold']) {
    const host = await fixture(); const before = agentCalls
    if (mode === 'disabled') await prisma.hostAgent.update({ where: { hostId: host.id }, data: { enabled: false, status: 'disabled' } })
    if (mode === 'revoked') await prisma.hostAgent.update({ where: { hostId: host.id }, data: { installTokenHash: null } })
    if (mode === 'new-installer') await prisma.hostAgent.update({ where: { hostId: host.id }, data: { installTokenKeepsIdentity: true } })
    if (mode === 'pending-install') await prisma.host.update({ where: { id: host.id }, data: { installPending: true } })
    if (mode === 'not-installed') await prisma.host.update({ where: { id: host.id }, data: { isInstalled: false } })
    if (mode === 'wrong-binding') await prisma.host.update({ where: { id: host.id }, data: { managementSshHost: '10.253.241.5' } })
    if (mode === 'revoked-admin') await prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
    if (mode === 'hold') await writeFile(join(directory, 'recovery-hold.json'), '{}')
    await repairHostManagement(host.id, deps)
    assert.equal(agentCalls, before, mode + ' must not reinstall credentials')
    assert.equal((await snapshot(host.id)).agent!.agentId, host.agent!.agentId)
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
    if (mode === 'hold') await rm(join(directory, 'recovery-hold.json'))
    if (mode === 'revoked-admin') {
      await due(host.id)
      await repairHostManagement(host.id, deps)
      assert.equal(state(await snapshot(host.id)).status, 'waiting-heartbeat', 'restored authority recovers through the same checks without manual state reset')
    }
  }
  console.log('PASS disabled/revoked/new-token/pending-install/binding/admin/restore guards produce zero Agent writes')

  const raced = await fixture()
  let entered!: () => void, release!: () => void
  const enteredGate = new Promise<void>(resolve => { entered = resolve }), releaseGate = new Promise<void>(resolve => { release = resolve })
  verifying = async () => { entered(); await releaseGate }
  const repairing = repairHostManagement(raced.id, deps)
  await enteredGate
  const actor = { id: admin.id, sid: randomUUID(), iat: Math.floor(Date.now() / 1000) + 1 }
  let rotated = false
  const rotating = rotateHostAgentCredentials(raced.id, true, { actor }).then(value => { rotated = true; return value })
  await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(rotated, false)
  release(); await repairing; verifying = undefined
  const fresh = await rotating
  assert.notEqual(fresh.agentId, raced.agent!.agentId)
  await due(raced.id); const count = agentCalls
  await repairHostManagement(raced.id, deps)
  assert.equal(agentCalls, count); assert.equal(state(await snapshot(raced.id)).error, 'AGENT_REPAIR_IDENTITY_SUPERSEDED')
  await issueHostAgentInstallToken(raced.id, true, { actor })
  assert.equal((await snapshot(raced.id)).agent!.agentId, fresh.agentId)
  console.log('PASS credential rotation serializes behind repair and is never undone by a later automatic scan')
} finally {
  verifying = undefined
  await prisma.hostOnboardingBatch.delete({ where: { id: batchId } })
  await prisma.host.deleteMany({ where: { id: { in: hostIds } } })
  await prisma.user.delete({ where: { id: admin.id } })
  await closePrismaDatabase(); await rm(directory, { recursive: true, force: true })
}
process.exit(0)
