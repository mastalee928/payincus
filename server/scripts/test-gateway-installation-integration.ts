/** Real isolated PostgreSQL: preparation, reauthentication, replay and secret delivery. */
import assert from 'node:assert/strict'
import { createPublicKey, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import bcrypt from 'bcryptjs'
import { authenticator } from 'otplib'
import { gatewayTaskHash, GATEWAY_TASK_STEPS, GatewayTaskError, type GatewayTaskPlan } from '../src/lib/gateway-task-plan.js'
import { signGatewayTransport } from '../src/lib/gateway-transport.js'
import { authorizeGatewayAdministration, encryptGatewayTaskSecret } from '../src/services/gateway-admin-authorization.js'
import { QUARANTINE_RESTORED_GATEWAY_TASKS_SQL } from '../src/lib/gateway-recovery-context.js'
import { retryGatewayJournal } from '../src/services/gateway-journal-retry.js'
import { Pool } from 'pg'
const database = new URL(process.env.DATABASE_URL || 'postgresql://localhost/invalid')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_gateway_test'))
process.env.ENCRYPTION_KEY ||= 'gateway-integration-fixture-encryption-key'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const journal = await import('../src/services/gateway-task-journal.js')
if (process.argv.includes('--verify-replay')) {
  try {
    await assert.rejects(prisma.$transaction(tx => authorizeGatewayAdministration(tx, Number(process.env.GATEWAY_TEST_USER_ID),
      { password: process.env.GATEWAY_TEST_PASSWORD!, totpCode: process.env.GATEWAY_TEST_TOTP })), /MFA_REPLAYED/)
    console.log('Fresh process rejected the persisted MFA step')
  } finally { await closePrismaDatabase() }
  process.exit(0)
}
const pair = generateKeyPairSync('ed25519'), publicKey = createPublicKey(pair.privateKey).export({ type: 'spki', format: 'der' }).subarray(12).toString('base64')
const platformId = randomUUID(), gatewayId = randomUUID(), taskId = randomUUID(), password = randomBytes(24).toString('base64url')
const mfaSecret = authenticator.generateSecret(), sessionId = randomBytes(16).toString('hex')
const admin = await prisma.user.create({ data: { username: 'gateway-install-' + taskId, passwordHash: await bcrypt.hash(password, 4), role: 'admin',
  twoFactorEnabled: true, twoFactorSecret: encryptGatewayTaskSecret(mfaSecret) } })
const target = { mode: 'local' as const, machineId: randomBytes(16).toString('hex'), ssh: null }
const desired = { slot: 'a' as const, network: '10.249.80.0/24', address: '10.249.80.1', listenPort: 51980, consolePort: 18480, consoleOrigin: 'https://gateway.example.test:18480' }
const intent: GatewayTaskPlan = { schemaVersion: 1, platformId, gatewayId, taskId, kind: 'install', target, basedOnRevision: '0',
  configurationHash: gatewayTaskHash(desired), componentHash: '0'.repeat(64), observedStateHash: '0'.repeat(64) }
let checks = 0
try {
  await journal.registerManagementGateway({ id: gatewayId, platformId, name: 'Installation integration', target }, admin.id)
  const queued = await journal.createManagementGatewayTask(intent, admin.id, undefined, desired)
  assert.equal(queued.preparationState, 'queued'); assert.equal(queued.status, 'awaiting_confirmation')
  await assert.rejects(journal.approveManagementGatewayTask(taskId, gatewayTaskHash(intent), admin.id,
    { verifiedAt: Date.now(), confirmation: `CONFIRM ${taskId}`, sessionId }, tx => authorizeGatewayAdministration(tx, admin.id, { password })), /PLAN_NOT_READY/); checks++
  const preparation = await journal.claimGatewayInstallationPreparation(taskId)
  assert.ok(preparation?.leaseToken)
  assert.equal(await journal.claimGatewayInstallationPreparation(taskId), null)
  await journal.heartbeatGatewayInstallationPreparation(taskId, preparation.leaseToken)
  const rival = new Pool({ connectionString: database.href }), lock = await rival.connect()
  try {
    await lock.query('SELECT pg_advisory_lock(4123, 1)')
    let attempts = 0
    const retrying = retryGatewayJournal(async () => { attempts++; await journal.heartbeatGatewayInstallationPreparation(taskId, preparation.leaseToken!) },
      undefined, () => new Promise(resolve => setTimeout(resolve, 100)))
    await new Promise(resolve => setTimeout(resolve, 250))
    await lock.query('SELECT pg_advisory_unlock(4123, 1)')
    await retrying; assert.ok(attempts > 1); checks++
  } finally { await lock.query('SELECT pg_advisory_unlock(4123, 1)'); lock.release(); await rival.end() }
  const now = Date.now()
  const configuration = { ...desired, signedTransport: signGatewayTransport({ schemaVersion: 1, purpose: 'gateway-transport', platformId, gatewayId,
    epoch: '1', sequence: '1', issuedAt: now, expiresAt: now + 600000, slot: 'a', address: desired.address, listenPort: desired.listenPort, mtu: 1380, peers: [] }, pair.privateKey) }
  const plan = { ...intent, configurationHash: gatewayTaskHash(configuration), componentHash: 'a'.repeat(64), observedStateHash: 'b'.repeat(64) }
  const request = { task: plan, configuration, expiresAt: now + 300000 }
  const preview = { schemaVersion: 1, task: plan, planHash: gatewayTaskHash(plan), expiresAt: request.expiresAt,
    package: { verified: true, architecture: 'arm64', version: '1.7.1', sourceCommit: 'c'.repeat(40), files: 20, manifestHash: plan.componentHash, canWrite: false },
    target: { machineId: target.machineId, osId: 'debian', architecture: 'arm64' }, configuration: desired,
    transport: { epoch: '1', sequence: '1', mtu: 1380, peerCount: 0 },
    changes: { packageDirectory: '/opt/incudal-gateway/components/' + plan.componentHash, stateDirectory: '/var/lib/incudal-management-gateway/' + gatewayId,
      services: ['incudal-gateway.service', 'incudal-gateway-console.service'], interface: 'incudal-gw-a', newIndependentIdentity: true,
      consoleCertificate: 'independently-pinned', businessBackendRestart: false, consoleListenAddress: '0.0.0.0', existingFilesOverwritten: false, customerRoutesChanged: false },
    blockers: [], installable: true, canWrite: false }
  await journal.completeGatewayInstallationPreparation(taskId, preparation.leaseToken, request, preview, publicKey)
  const duplicate = await journal.createManagementGatewayTask(intent, admin.id, undefined, desired)
  assert.equal(duplicate.planHash, gatewayTaskHash(plan)); assert.equal(duplicate.preparationState, 'ready'); checks++
  const approve = (supplied: { password: string; totpCode?: string }) => journal.approveManagementGatewayTask(taskId, gatewayTaskHash(plan), admin.id,
    { verifiedAt: Date.now(), confirmation: `CONFIRM ${taskId}`, sessionId }, tx => authorizeGatewayAdministration(tx, admin.id, supplied))
  await assert.rejects(approve({ password: 'incorrect' }), /REAUTH_REQUIRED/)
  await assert.rejects(approve({ password }), /MFA_REQUIRED/)
  const code = authenticator.generate(mfaSecret)
  await approve({ password, totpCode: code })
  await approve({ password, totpCode: code }) // Same confirmed task/session is idempotent.
  assert.equal(await prisma.managementGatewayMfaReplay.count({ where: { userId: admin.id } }), 1); checks++
  await assert.rejects(prisma.$transaction(async tx => authorizeGatewayAdministration(tx, admin.id, { password, totpCode: code })), /MFA_REPLAYED/); checks++
  const restarted = await promisify(execFile)(process.execPath, ['--import', 'tsx', import.meta.filename, '--verify-replay'],
    { env: { ...process.env, GATEWAY_TEST_USER_ID: String(admin.id), GATEWAY_TEST_PASSWORD: password, GATEWAY_TEST_TOTP: code }, timeout: 15000 })
  assert.ok(restarted.stdout.includes('rejected the persisted MFA step')); checks++
  const active = await journal.claimManagementGatewayTask(taskId)
  assert.ok(active?.leaseToken)
  const bootstrap = { username: 'operator', role: 'operator', password: randomBytes(24).toString('base64url'), totpSeed: randomBytes(20).toString('base64'),
    recoveryCodes: Array.from({ length: 7 }, () => randomBytes(24).toString('base64url')) }
  const rootReceipt = { schemaVersion: 1, taskId, planHash: gatewayTaskHash(plan), targetHash: gatewayTaskHash(target), configurationHash: plan.configurationHash,
    componentHash: plan.componentHash, gatewayId, publicKey, consoleCertificateSha256: 'd'.repeat(64), installed: true, transportReady: true, canWrite: false, bootstrapAvailable: true,
    blockers: ['backup-not-configured', 'host-write-service-not-ready', 'public-certificate-maintenance-required'] }
  for (const key of GATEWAY_TASK_STEPS.install) {
    const step = await journal.beginManagementGatewayStep(taskId, active.leaseToken, key)
    await journal.completeManagementGatewayStep(taskId, active.leaseToken, key, { schemaVersion: 1, taskId, operationId: step.operationId, step: key,
      planHash: gatewayTaskHash(plan), targetHash: gatewayTaskHash(target), evidenceHash: gatewayTaskHash(rootReceipt),
      configurationHash: key === 'verify-installation' ? plan.configurationHash : null, issuedAt: Date.now(), outcome: 'verified' })
  }
  await assert.rejects(journal.finishManagementGatewayTask(taskId, active.leaseToken), /INSTALLATION_INVALID/)
  const finished = await journal.finishManagementGatewayTask(taskId, active.leaseToken, undefined,
    { receipt: rootReceipt, bootstrapEncrypted: encryptGatewayTaskSecret(JSON.stringify(bootstrap)), bootstrapExpiresAt: new Date(Date.now() + 600000) })
  assert.equal(finished.status, 'succeeded')
  assert.equal((await prisma.managementGateway.findUniqueOrThrow({ where: { id: gatewayId } })).revision, 1n)
  assert.ok(!JSON.stringify(finished, (_key, value) => typeof value === 'bigint' ? String(value) : value).includes(bootstrap.password)); checks++
  await assert.rejects(journal.takeGatewayBootstrapMaterial(taskId, admin.id, 'other-session'), /REAUTH_REQUIRED/)
  const delivered = await journal.takeGatewayBootstrapMaterial(taskId, admin.id, sessionId)
  assert.ok(JSON.stringify(delivered) === JSON.stringify(bootstrap), 'bootstrap fields must be restored exactly')
  await assert.rejects(journal.takeGatewayBootstrapMaterial(taskId, admin.id, sessionId), /BOOTSTRAP_UNAVAILABLE/)
  const privateRow = await prisma.managementGatewayTask.findUniqueOrThrow({ where: { id: taskId } })
  assert.equal(privateRow.bootstrapEncrypted, null); assert.equal(privateRow.bootstrapExpiresAt, null); checks++
  // Fault injection models a requeued interrupted intent whose worker never
  // starts. Its prior step evidence must continue reserving the physical target.
  await prisma.managementGatewayTask.update({ where: { id: taskId }, data: { status: 'queued', approvedAt: new Date(Date.now() - 120000), completedAt: null,
    credentialsEncrypted: encryptGatewayTaskSecret('expired-fixture'), credentialsExpireAt: new Date(Date.now() - 1000) } })
  await journal.expireGatewayInstallationTasks()
  const expired = await prisma.managementGatewayTask.findUniqueOrThrow({ where: { id: taskId } })
  assert.equal(expired.status, 'needs_review'); assert.equal(expired.completedAt, null)
  assert.equal(expired.credentialsEncrypted, null); assert.equal(expired.credentialsExpireAt, null)
  await assert.rejects(journal.createManagementGatewayTask({ ...intent, taskId: randomUUID(), kind: 'inspect', basedOnRevision: '1' }, admin.id), /TARGET_BUSY/); checks++
  const rollbackOnly = new Error('verified restore quarantine; roll back test transaction')
  await assert.rejects(prisma.$transaction(async tx => {
    await tx.managementGatewayTask.update({ where: { id: taskId }, data: { status: 'running', leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 60000),
      bootstrapEncrypted: encryptGatewayTaskSecret('fixture'), bootstrapExpiresAt: new Date(Date.now() + 60000) } })
    await tx.$executeRawUnsafe(QUARANTINE_RESTORED_GATEWAY_TASKS_SQL)
    const restored = await tx.managementGatewayTask.findUniqueOrThrow({ where: { id: taskId } })
    assert.equal(restored.status, 'needs_review'); assert.equal(restored.leaseToken, null)
    assert.equal(restored.bootstrapEncrypted, null); assert.equal(restored.approvedCredentialHash, null); assert.equal(restored.approvedSessionId, null)
    assert.equal(restored.errorCode, 'GATEWAY_TASK_RESTORED_REVIEW')
    throw rollbackOnly
  }), error => error === rollbackOnly); checks++
  // Password/MFA changes invalidate a queued approval before any executor step.
  const secondId = randomUUID(), secondGateway = randomUUID(), otherTarget = { ...target, machineId: randomBytes(16).toString('hex') }
  await journal.registerManagementGateway({ id: secondGateway, platformId, name: 'Changed credentials', target: otherTarget }, admin.id)
  try {
    const second = { ...intent, gatewayId: secondGateway, taskId: secondId, target: otherTarget }
    await prisma.user.update({ where: { id: admin.id }, data: { twoFactorEnabled: false } })
    await journal.createManagementGatewayTask(second, admin.id)
    await journal.approveManagementGatewayTask(secondId, gatewayTaskHash(second), admin.id,
      { verifiedAt: Date.now(), confirmation: `CONFIRM ${secondId}`, sessionId }, tx => authorizeGatewayAdministration(tx, admin.id, { password }))
    await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: await bcrypt.hash('changed-password', 4) } })
    assert.equal(await journal.claimManagementGatewayTask(secondId), null)
    assert.equal((await prisma.managementGatewayTask.findUniqueOrThrow({ where: { id: secondId } })).errorCode, 'GATEWAY_TASK_CREDENTIALS_CHANGED'); checks++
  } finally {
    await prisma.managementGatewayStep.deleteMany({ where: { task: { gatewayId: secondGateway } } })
    await prisma.managementGatewayTask.deleteMany({ where: { gatewayId: secondGateway } })
    await prisma.managementGateway.delete({ where: { id: secondGateway } })
  }
  const contextDirectory = await mkdtemp(join(tmpdir(), 'gateway-recovery-context-'))
  const oldStateDirectory = process.env.PLATFORM_BACKUP_STATE_DIR, oldMode = process.env.NODE_ENV
  const contextGateway = randomUUID(), contextTarget = { ...target, machineId: randomBytes(16).toString('hex') }
  process.env.PLATFORM_BACKUP_STATE_DIR = contextDirectory; process.env.NODE_ENV = 'test'
  try {
    await journal.registerManagementGateway({ id: contextGateway, platformId, name: 'Recovery context', target: contextTarget }, admin.id)
    const oldIntent = { ...intent, taskId: randomUUID(), gatewayId: contextGateway, target: contextTarget }
    await journal.createManagementGatewayTask(oldIntent, admin.id, undefined, desired)
    await writeFile(join(contextDirectory, 'recovery-hold.json'), JSON.stringify({ taskId: randomUUID() }), { mode: 0o600 })
    assert.equal(await journal.claimGatewayInstallationPreparation(oldIntent.taskId), null)
    assert.equal((await prisma.managementGatewayTask.findUniqueOrThrow({ where: { id: oldIntent.taskId } })).errorCode, 'GATEWAY_RECOVERY_CONTEXT_CHANGED')
    const freshIntent = { ...oldIntent, taskId: randomUUID() }
    await journal.createManagementGatewayTask(freshIntent, admin.id, undefined, desired)
    const fresh = await journal.claimGatewayInstallationPreparation(freshIntent.taskId)
    assert.ok(fresh?.leaseToken)
    await writeFile(join(contextDirectory, 'recovery-hold.json'), JSON.stringify({ taskId: randomUUID() }))
    await assert.rejects(journal.heartbeatGatewayInstallationPreparation(freshIntent.taskId, fresh.leaseToken), /RECOVERY_CONTEXT_CHANGED/)
    await journal.expireGatewayInstallationTasks()
    assert.equal((await prisma.managementGatewayTask.findUniqueOrThrow({ where: { id: freshIntent.taskId } })).status, 'failed'); checks++
  } finally {
    if (oldStateDirectory === undefined) delete process.env.PLATFORM_BACKUP_STATE_DIR; else process.env.PLATFORM_BACKUP_STATE_DIR = oldStateDirectory
    if (oldMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldMode
    await prisma.managementGatewayStep.deleteMany({ where: { task: { gatewayId: contextGateway } } })
    await prisma.managementGatewayTask.deleteMany({ where: { gatewayId: contextGateway } })
    await prisma.managementGateway.deleteMany({ where: { id: contextGateway } })
    assert.equal(dirname(resolve(contextDirectory)), resolve(tmpdir())); await rm(contextDirectory, { recursive: true, force: true })
  }
  console.log(JSON.stringify({ passed: true, checks, realPostgreSQL: true, actualPasswordAndMfa: true, replayRejected: true, oneTimeSecretDelivery: true, rootExecution: false }))
} catch (error) {
  console.error(error instanceof GatewayTaskError ? error.code : 'Gateway installation integration failed')
  process.exitCode = 1
} finally {
  await prisma.managementGatewayStep.deleteMany({ where: { task: { gatewayId } } })
  await prisma.managementGatewayTask.deleteMany({ where: { gatewayId } })
  await prisma.managementGateway.deleteMany({ where: { id: gatewayId } })
  await prisma.user.delete({ where: { id: admin.id } })
  await closePrismaDatabase()
}
