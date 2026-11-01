/** Real isolated PostgreSQL; remote commands are controlled executors, never production SSH. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Prisma } from '@prisma/client'
import { GatewayTaskError, gatewayTaskHash } from '../src/lib/gateway-task-plan.js'
import type { GatewayDomainReceipt } from '../src/services/gateway-domain-driver.js'
import type { GatewayDomainWork } from '../src/services/gateway-domain-management.js'
const database = new URL(process.env.DATABASE_URL || 'postgresql://localhost/invalid')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_gateway_test'))
process.env.ENCRYPTION_KEY ||= 'isolated-domain-fixture-encryption'
process.env.GATEWAY_PLATFORM_ID = randomUUID()
const contextDirectory = await mkdtemp(join(tmpdir(), 'gateway-domain-context-'))
const originalState = process.env.PLATFORM_BACKUP_STATE_DIR
process.env.PLATFORM_BACKUP_STATE_DIR = contextDirectory
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const service = await import('../src/services/gateway-domain-management.js')
const json = (value: unknown) => value as Prisma.InputJsonObject
const admin = await prisma.user.create({ data: { username: 'domain-' + randomUUID(), passwordHash: 'fixture-original-hash', role: 'admin' } })
const actor = { id: admin.id, sid: 'domain-' + randomUUID(), iat: Math.floor(Date.now() / 1000) }
const gateways: string[] = []
const dispatch = { available: () => true, launch: async () => {} }
let checks = 0, remoteCalls = 0
async function gateway(slot: 'a' | 'b' = 'a', channelReady = true) {
  const id = randomUUID(), installId = randomUUID()
  const target = { mode: 'remote' as const, machineId: randomUUID().replaceAll('-', ''),
    ssh: { address: '8.8.4.4', port: 22, username: 'root' as const, fingerprint: 'SHA256:' + Buffer.alloc(32, 7).toString('base64').replace(/=+$/, '') } }
  await prisma.managementGateway.create({ data: { id, platformId: process.env.GATEWAY_PLATFORM_ID!, name: 'Isolated domain fixture', mode: 'remote',
    target: json(target), targetHash: gatewayTaskHash(target), machineId: target.machineId, revision: 1n } })
  gateways.push(id)
  const channel = { schemaVersion: 1, gatewayId: id, requestId: installId, revision: '1', origin: 'https://old.example.com:18480',
    certificateSha256: 'a'.repeat(64), tlsKeySha256: 'b'.repeat(64), verified: true, transportPreserved: true }
  await prisma.managementGatewayTask.create({ data: { id: installId, gatewayId: id, createdById: admin.id, kind: 'install', status: 'succeeded',
    approvedById: admin.id, approvedAt: new Date(), approvalExpiresAt: new Date(Date.now() + 60000), completedAt: new Date(),
    basedOnRevision: 0n, plan: {}, planHash: '0'.repeat(64), installation: json({ desired: { slot, consoleOrigin: channel.origin, consolePort: 18480 },
      ...(channelReady ? { domainChannel: channel } : {}) }), installationReceipt: { consoleCertificateSha256: channel.certificateSha256 } } })
  return id
}
const input = (hostname = 'new.example.com') => ({ requestId: randomUUID(), hostname, expectedHostname: 'old.example.com' })
const receipt = (value: {
  gatewayId: string; requestId: string; origin: string; configuration: { revision: string; tlsKeySha256: string | null }
}): GatewayDomainReceipt => ({ schemaVersion: 1, gatewayId: value.gatewayId, requestId: value.requestId,
  revision: (BigInt(value.configuration.revision) + 1n).toString(), origin: value.origin, certificateSha256: 'c'.repeat(64),
  tlsKeySha256: value.configuration.tlsKeySha256 || 'b'.repeat(64), verified: true, transportPreserved: true })
const success: NonNullable<Parameters<typeof service.runGatewayDomainTask>[1]> = async value => {
  remoteCalls++; await value.progress('applying'); await value.progress('verifying'); return receipt(value)
}
async function due(id: string) {
  const row = await prisma.managementGatewayTask.findUniqueOrThrow({ where: { id } })
  await prisma.managementGatewayTask.update({ where: { id }, data: { installation: json({ ...(row.installation as unknown as GatewayDomainWork), retryAt: null }) } })
}
try {
  const first = await gateway(), backup = await gateway('b')
  assert.equal((await service.getGatewayDomain(first)).purpose, 'independent')
  assert.equal((await service.getGatewayDomain(backup)).purpose, 'backup')
  assert.equal((await service.getGatewayDomain(first)).scope, 'console'); checks++
  for (const rejected of [{ id: admin.id }, { ...actor, sid: undefined }, { ...actor, iat: undefined }]) {
    await assert.rejects(service.requestGatewayDomain(first, input(), rejected, dispatch), /WEB_SESSION_REQUIRED/)
  }
  await prisma.tokenInvalidation.create({ data: { userId: admin.id, sessionId: actor.sid, invalidatedAt: actor.iat } })
  await assert.rejects(service.requestGatewayDomain(first, input(), actor, dispatch), /WEB_SESSION_REQUIRED/)
  await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } }); checks++

  const one = input(), two = input('rival.example.com')
  const raced = await Promise.allSettled([service.requestGatewayDomain(first, one, actor, dispatch), service.requestGatewayDomain(first, two, actor, dispatch)])
  assert.equal(raced.filter(row => row.status === 'fulfilled').length, 1)
  assert.equal(raced.filter(row => row.status === 'rejected').length, 1)
  const accepted = raced[0].status === 'fulfilled' ? one : two
  await service.requestGatewayDomain(first, accepted, actor, dispatch)
  await assert.rejects(service.requestGatewayDomain(first, { ...accepted, hostname: 'other.example.com' }, actor, dispatch), /IDEMPOTENCY_CONFLICT/)
  assert.equal(await prisma.managementGatewayTask.count({ where: { gatewayId: first, kind: 'update' } }), 1)
  assert.equal((await service.runGatewayDomainTask(accepted.requestId, success)).verified, true)
  assert.equal((await service.getGatewayDomain(first)).hostname, accepted.hostname)
  assert.equal((await service.getGatewayDomain(first)).revision, '2')
  await service.requestGatewayDomain(first, accepted, actor, dispatch)
  assert.deepEqual(await service.runGatewayDomainTask(accepted.requestId, success), { claimed: false })
  await assert.rejects(service.requestGatewayDomain(first, input(), actor, dispatch), /DOMAIN_CONFLICT/)
  assert.equal(await prisma.log.count({ where: { userId: admin.id, action: 'gateway.domain.verified' } }), 1); checks++

  const backupInput = input('backup.example.com')
  await service.requestGatewayDomain(backup, backupInput, actor, dispatch)
  await service.runGatewayDomainTask(backupInput.requestId, success)
  assert.equal((await service.getGatewayDomain(backup)).purpose, 'backup'); checks++

  const old = await gateway('b', false), oldInput = { ...input(), credentials: { password: 'one-time-fixture' } }
  await assert.rejects(service.requestGatewayDomain(old, input(), actor, dispatch), /CREDENTIALS_REQUIRED/)
  await service.requestGatewayDomain(old, oldInput, actor, dispatch)
  await service.runGatewayDomainTask(oldInput.requestId, async value => {
    assert.equal(value.password, oldInput.credentials.password)
    await value.progress('preparing-channel')
    await value.progress('applying', { ...receipt(value), origin: value.configuration.origin, revision: '1', certificateSha256: 'a'.repeat(64) })
    const task = await prisma.managementGatewayTask.findUniqueOrThrow({ where: { id: oldInput.requestId } })
    assert.equal(task.credentialsEncrypted, null); assert.equal(task.credentialsExpireAt, null)
    assert.equal((await service.getGatewayDomain(old)).channelReady, true)
    return receipt(value)
  })
  assert.equal((await service.getGatewayDomain(old)).state, 'succeeded'); checks++

  const flaky = await gateway(), retryInput = input()
  await service.requestGatewayDomain(flaky, retryInput, actor, dispatch)
  await service.runGatewayDomainTask(retryInput.requestId, async () => { throw new GatewayTaskError('SSH_DISCONNECTED') })
  assert.equal((await service.getGatewayDomain(flaky)).state, 'retrying')
  assert.ok((await service.getGatewayDomain(flaky)).retryAt)
  assert.deepEqual(await service.runGatewayDomainTask(retryInput.requestId, success), { claimed: false })
  await due(retryInput.requestId)
  await prisma.managementGatewayTask.update({ where: { id: retryInput.requestId }, data: { attempt: 9 } })
  await service.runGatewayDomainTask(retryInput.requestId, async () => { throw new GatewayTaskError('GATEWAY_DOMAIN_COMMIT_UNCERTAIN') })
  const offline = await service.getGatewayDomain(flaky)
  assert.equal(offline.state, 'retrying'); assert.equal(offline.attempt, 10)
  assert.ok(Date.parse(offline.retryAt!) - Date.now() > 14 * 60000)
  await prisma.managementGatewayTask.update({ where: { id: retryInput.requestId }, data: { status: 'running', leaseToken: randomUUID(), leaseUntil: new Date(0) } })
  await service.dispatchGatewayDomainTasks(() => true, async () => { throw new Error('must first recover lease') })
  assert.equal((await service.getGatewayDomain(flaky)).errorCode, 'GATEWAY_DOMAIN_WORKER_INTERRUPTED')
  await due(retryInput.requestId)
  assert.equal((await service.runGatewayDomainTask(retryInput.requestId, success)).verified, true); checks++

  const late = await gateway(), lateInput = input()
  await service.requestGatewayDomain(late, lateInput, actor, dispatch)
  let entered!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve }), blocked = new Promise<void>(resolve => { release = resolve })
  const running = service.runGatewayDomainTask(lateInput.requestId, async value => { entered(); await blocked; return receipt(value) })
  await started
  await prisma.managementGatewayTask.update({ where: { id: lateInput.requestId }, data: { status: 'queued', leaseToken: null, leaseUntil: null } })
  release(); await running
  assert.equal((await service.getGatewayDomain(late)).hostname, 'old.example.com')
  assert.equal((await service.getGatewayDomain(late)).state, 'queued')
  assert.equal((await service.runGatewayDomainTask(lateInput.requestId, success)).verified, true); checks++

  for (const cause of ['session', 'role', 'credentials', 'plan', 'recovery', 'authorization-expired']) {
    const id = await gateway(), intent = input()
    await service.requestGatewayDomain(id, intent, actor, dispatch)
    if (cause === 'session') await prisma.tokenInvalidation.create({ data: { userId: admin.id, sessionId: '__USER_LEVEL__', invalidatedAt: actor.iat } })
    if (cause === 'role') await prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
    if (cause === 'credentials') await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: 'changed-fixture-hash' } })
    if (cause === 'plan') await prisma.managementGatewayTask.update({ where: { id: intent.requestId }, data: { plan: {} } })
    if (cause === 'authorization-expired') {
      const task = await prisma.managementGatewayTask.findUniqueOrThrow({ where: { id: intent.requestId } })
      await prisma.managementGatewayTask.update({ where: { id: intent.requestId }, data: { installation: json({
        ...(task.installation as unknown as GatewayDomainWork), authorizedAt: actor.iat - 30 * 24 * 3600 }) } })
    }
    if (cause === 'recovery') await writeFile(join(contextDirectory, 'recovery-hold.json'), JSON.stringify({ taskId: randomUUID() }))
    const before = remoteCalls
    assert.deepEqual(await service.runGatewayDomainTask(intent.requestId, success), { claimed: false })
    assert.equal(remoteCalls, before); assert.equal((await service.getGatewayDomain(id)).state, 'failed')
    await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } })
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin', passwordHash: 'fixture-original-hash' } })
    if (cause === 'recovery') await unlink(join(contextDirectory, 'recovery-hold.json'))
    if (cause === 'authorization-expired') {
      await service.requestGatewayDomain(id, intent, actor, dispatch)
      assert.equal((await service.runGatewayDomainTask(intent.requestId, success)).verified, true)
    }
    checks++
  }
  const revoked = await gateway(), revokedInput = input()
  await service.requestGatewayDomain(revoked, revokedInput, actor, dispatch)
  let passedWriteGate = false
  await service.runGatewayDomainTask(revokedInput.requestId, async value => {
    await prisma.tokenInvalidation.create({ data: { userId: admin.id, sessionId: actor.sid, invalidatedAt: actor.iat } })
    await value.progress('applying'); passedWriteGate = true; return receipt(value)
  })
  assert.equal(passedWriteGate, false); assert.equal((await service.getGatewayDomain(revoked)).state, 'failed')
  await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } }); checks++

  const unavailable = await gateway(), unavailableInput = input()
  await service.requestGatewayDomain(unavailable, unavailableInput, actor, dispatch)
  await service.dispatchGatewayDomainTasks(() => true, async () => { throw new Error('controlled unit launch failure') })
  assert.equal((await service.getGatewayDomain(unavailable)).errorCode, 'GATEWAY_DOMAIN_EXECUTOR_UNAVAILABLE'); checks++
  console.log(JSON.stringify({ passed: true, checks, realPostgreSQL: true, concurrentCAS: true, sessionRevocation: true,
    boundedBackoff: true, lateReceiptRejected: true, credentialErasure: true, realRemoteSSH: false }))
} finally {
  await prisma.managementGatewayTask.deleteMany({ where: { gatewayId: { in: gateways } } })
  await prisma.managementGateway.deleteMany({ where: { id: { in: gateways } } })
  await prisma.systemConfig.deleteMany({ where: { key: { in: gateways.map(id => 'management_gateway_domain_' + id) } } })
  await prisma.log.deleteMany({ where: { userId: admin.id } })
  await prisma.user.delete({ where: { id: admin.id } })
  await closePrismaDatabase()
  await unlink(join(contextDirectory, 'recovery-hold.json')).catch(() => {})
  await rmdir(contextDirectory)
  if (originalState === undefined) delete process.env.PLATFORM_BACKUP_STATE_DIR; else process.env.PLATFORM_BACKUP_STATE_DIR = originalState
}
