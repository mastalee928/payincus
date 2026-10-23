/** Isolated real PostgreSQL only; no SSH, Incus or privileged mutation. */
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Pool } from 'pg'
import { GatewayTaskError, gatewayTaskHash, GATEWAY_TASK_STEPS, type GatewayTaskPlan } from '../src/lib/gateway-task-plan.js'
const database = new URL(process.env.DATABASE_URL || 'postgresql://localhost/invalid')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_gateway_test'), 'use isolated local *_gateway_test database')
database.searchParams.set('options', '-c timezone=Asia/Shanghai')
process.env.DATABASE_URL = database.href
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const journal = await import('../src/services/gateway-task-journal.js')
if (process.argv.includes('--claim-once')) {
  // Establish the isolated connection before measuring the claim transaction.
  await prisma.$queryRaw`SELECT 1`
  const claimed = await journal.claimManagementGatewayTask()
  console.log(JSON.stringify({ id: claimed?.id || null }))
  await closePrismaDatabase()
  process.exit(0)
}
const platformId = randomUUID(), gatewayId = randomUUID(), prefix = 'gw-test-' + randomUUID().slice(0, 8)
const admin = await prisma.user.create({ data: { username: prefix, passwordHash: 'unusable-test-hash', role: 'admin' } })
const user = await prisma.user.create({ data: { username: prefix + '-user', passwordHash: 'unusable-test-hash', role: 'user' } })
const target = { mode: 'local' as const, machineId: randomBytes(16).toString('hex'), ssh: null }
let count = 0
async function test(name: string, work: () => Promise<void>) { await work(); count++; console.log(`ok ${name}`) }
const rejects = async (work: () => Promise<unknown>, code: string) => assert.rejects(work, (error: unknown) => error instanceof GatewayTaskError && error.code === code)
const plan = (kind: GatewayTaskPlan['kind'], revision = '0'): GatewayTaskPlan => ({ schemaVersion: 1, taskId: randomUUID(), platformId, gatewayId, kind,
  basedOnRevision: revision, target, configurationHash: 'b'.repeat(64), componentHash: 'c'.repeat(64), observedStateHash: 'd'.repeat(64) })
const approve = (input: GatewayTaskPlan, actor = admin.id) => journal.approveManagementGatewayTask(input.taskId, gatewayTaskHash(input), actor,
  { verifiedAt: Date.now(), confirmation: `CONFIRM ${input.taskId}` })
const receiptFor = (input: GatewayTaskPlan, key: string, operationId: string) => ({ schemaVersion: 1, taskId: input.taskId, operationId, step: key,
  planHash: gatewayTaskHash(input), targetHash: gatewayTaskHash(input.target), evidenceHash: 'e'.repeat(64),
  configurationHash: key === 'verify-installation' ? input.configurationHash : null, issuedAt: Date.now(), outcome: 'verified' })
try {
  assert.equal(await prisma.managementGatewayTask.count(), 0, 'isolated database must have no preexisting gateway tasks')
  const zone = await prisma.$queryRaw<Array<{ TimeZone: string }>>`SHOW TIMEZONE`
  assert.equal(zone[0]?.TimeZone, 'Asia/Shanghai')
  await test('active admin and physical identity enforced', async () => {
    await rejects(() => journal.registerManagementGateway({ id: gatewayId, platformId, name: prefix, target }, user.id), 'GATEWAY_TASK_ADMIN_REQUIRED')
    await journal.registerManagementGateway({ id: gatewayId, platformId, name: prefix, target }, admin.id)
    await rejects(() => journal.registerManagementGateway({ id: randomUUID(), platformId, name: prefix, target }, admin.id), 'GATEWAY_TASK_TARGET_CONFLICT')
  })
  await test('another process holding journal lock returns busy without waiting', async () => {
    const independent = new Pool({ connectionString: database.href })
    const connection = await independent.connect()
    try {
      await connection.query('SELECT pg_advisory_lock(4123, 1)')
      await rejects(() => journal.createManagementGatewayTask(plan('inspect'), admin.id), 'GATEWAY_TASK_JOURNAL_BUSY')
    } finally { await connection.query('SELECT pg_advisory_unlock(4123, 1)'); connection.release(); await independent.end() }
  })
  const inspect = plan('inspect')
  await test('concurrent idempotent submission creates one intent and no secrets in response', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => journal.createManagementGatewayTask(inspect, admin.id)))
    assert.ok(results.every(item => item.id === inspect.taskId && !('credentialsEncrypted' in item) && !('leaseToken' in item)))
    assert.equal(await prisma.managementGatewayTask.count({ where: { id: inspect.taskId } }), 1)
    await rejects(() => journal.createManagementGatewayTask({ ...inspect, configurationHash: 'f'.repeat(64) }, admin.id), 'GATEWAY_TASK_IDEMPOTENCY_CONFLICT')
    await rejects(() => journal.createManagementGatewayTask(inspect, user.id), 'GATEWAY_TASK_ADMIN_REQUIRED')
  })
  let claim = await journal.claimManagementGatewayTask()
  assert.equal(claim?.id, inspect.taskId)
  const token = claim!.leaseToken!
  await test('valid UTC lease is exclusive under non-UTC session', async () => {
    assert.equal(await journal.claimManagementGatewayTask(), null)
    const fresh = await promisify(execFile)(process.execPath, [...(import.meta.filename.endsWith('.ts') ? ['--import', 'tsx'] : []), import.meta.filename, '--claim-once'], { env: process.env })
    assert.match(fresh.stdout, /"id":null/, 'fresh Node process reloads the valid persisted lease')
    await rejects(() => journal.beginManagementGatewayStep(inspect.taskId, randomUUID(), 'verify-target'), 'GATEWAY_TASK_LEASE_LOST')
    await rejects(() => journal.beginManagementGatewayStep(inspect.taskId, token, 'inspect-environment'), 'GATEWAY_TASK_STEP_ORDER_INVALID')
    await rejects(() => journal.finishManagementGatewayTask(inspect.taskId, token), 'GATEWAY_TASK_INCOMPLETE')
  })
  await test('interrupted side effect reserves target and never replays automatically', async () => {
    const begun = await journal.beginManagementGatewayStep(inspect.taskId, token, 'verify-target')
    assert.equal(begun.reconcile, false)
    await prisma.managementGatewayTask.update({ where: { id: inspect.taskId }, data: { leaseUntil: new Date(Date.now() - 1000) } })
    assert.equal(await journal.claimManagementGatewayTask(), null)
    assert.equal((await prisma.managementGatewayTask.findUniqueOrThrow({ where: { id: inspect.taskId } })).status, 'needs_review')
    await rejects(() => journal.completeManagementGatewayStep(inspect.taskId, token, 'verify-target', receiptFor(inspect, 'verify-target', begun.operationId)), 'GATEWAY_TASK_LEASE_LOST')
    await rejects(() => journal.createManagementGatewayTask(plan('inspect'), admin.id), 'GATEWAY_TASK_TARGET_BUSY')
    await rejects(() => journal.cancelManagementGatewayTask(inspect.taskId, admin.id), 'GATEWAY_TASK_NOT_CANCELLABLE')
    await approve(inspect)
    claim = await journal.claimManagementGatewayTask()
    assert.notEqual(claim?.leaseToken, token)
    const recovered = await journal.beginManagementGatewayStep(inspect.taskId, claim!.leaseToken!, 'verify-target')
    assert.equal(recovered.reconcile, true)
    assert.equal(recovered.operationId, begun.operationId)
  })
  await test('step receipts bind exact intent and duplicate receipt is immutable', async () => {
    const renewed = claim!.leaseToken!
    for (const key of GATEWAY_TASK_STEPS.inspect) {
      await journal.heartbeatManagementGatewayTask(inspect.taskId, renewed)
      const step = await journal.beginManagementGatewayStep(inspect.taskId, renewed, key)
      const receipt = receiptFor(inspect, key, step.operationId)
      await rejects(() => journal.completeManagementGatewayStep(inspect.taskId, renewed, key, { ...receipt, taskId: randomUUID() }), 'GATEWAY_TASK_RECEIPT_INVALID')
      assert.equal((await journal.completeManagementGatewayStep(inspect.taskId, renewed, key, receipt)).duplicate, false)
      assert.equal((await journal.completeManagementGatewayStep(inspect.taskId, renewed, key, receipt)).duplicate, true)
      await rejects(() => journal.completeManagementGatewayStep(inspect.taskId, renewed, key, { ...receipt, evidenceHash: 'f'.repeat(64) }), 'GATEWAY_TASK_RECEIPT_CONFLICT')
    }
    await journal.finishManagementGatewayTask(inspect.taskId, renewed)
    assert.equal((await prisma.managementGateway.findUniqueOrThrow({ where: { id: gatewayId } })).revision, 0n, 'inspection grants no role or revision')
  })
  const install = plan('install'), other = plan('install')
  await test('exact confirmation and fresh reauthentication precede serialized approval', async () => {
    await journal.createManagementGatewayTask(install, admin.id)
    await journal.createManagementGatewayTask(other, admin.id)
    assert.equal(await journal.claimManagementGatewayTask(), null)
    await rejects(() => journal.approveManagementGatewayTask(install.taskId, gatewayTaskHash(install), admin.id, { verifiedAt: Date.now() - 130000, confirmation: `CONFIRM ${install.taskId}` }), 'GATEWAY_TASK_REAUTH_REQUIRED')
    await rejects(() => journal.approveManagementGatewayTask(install.taskId, gatewayTaskHash(install), admin.id, { verifiedAt: Date.now(), confirmation: 'yes' }), 'GATEWAY_TASK_REAUTH_REQUIRED')
    await approve(install)
    await rejects(() => approve(other), 'GATEWAY_TASK_TARGET_BUSY')
    const pending = plan('inspect')
    await assert.rejects(prisma.managementGatewayTask.create({ data: { id: pending.taskId, gatewayId, createdById: admin.id,
      kind: 'inspect', plan: pending as unknown as object, planHash: gatewayTaskHash(pending), basedOnRevision: 0, status: 'queued' } }))
  })
  await test('finish requires authenticated installation and advances revision once', async () => {
    const active = await journal.claimManagementGatewayTask(), currentToken = active!.leaseToken!
    assert.equal(active!.id, install.taskId)
    for (const key of GATEWAY_TASK_STEPS.install) {
      await journal.heartbeatManagementGatewayTask(install.taskId, currentToken)
      const step = await journal.beginManagementGatewayStep(install.taskId, currentToken, key)
      await journal.completeManagementGatewayStep(install.taskId, currentToken, key, receiptFor(install, key, step.operationId))
    }
    await journal.finishManagementGatewayTask(install.taskId, currentToken)
    await rejects(() => journal.finishManagementGatewayTask(install.taskId, currentToken), 'GATEWAY_TASK_LEASE_LOST')
    assert.equal((await prisma.managementGateway.findUniqueOrThrow({ where: { id: gatewayId } })).revision, 1n)
    await rejects(() => approve(other), 'GATEWAY_TASK_PLAN_STALE')
    await journal.cancelManagementGatewayTask(other.taskId, admin.id)
  })
  await test('expired unstarted approval fails without a remote effect', async () => {
    const expired = plan('update', '1')
    await journal.createManagementGatewayTask(expired, admin.id); await approve(expired)
    await prisma.managementGatewayTask.update({ where: { id: expired.taskId }, data: { approvalExpiresAt: new Date(Date.now() - 1000) } })
    assert.equal(await journal.claimManagementGatewayTask(), null)
    const record = await prisma.managementGatewayTask.findUniqueOrThrow({ where: { id: expired.taskId } })
    assert.equal(record.status, 'failed'); assert.equal(record.errorCode, 'GATEWAY_TASK_APPROVAL_EXPIRED')
    assert.equal(record.credentialsEncrypted, null)
  })
  await test('revoked admin loses task authority before execution', async () => {
    const queued = plan('inspect', '1')
    await journal.createManagementGatewayTask(queued, admin.id)
    await prisma.user.update({ where: { id: admin.id }, data: { status: 'banned' } })
    assert.equal(await journal.claimManagementGatewayTask(), null)
    assert.equal((await prisma.managementGatewayTask.findUniqueOrThrow({ where: { id: queued.taskId } })).errorCode, 'GATEWAY_TASK_ADMIN_REQUIRED')
    await prisma.user.update({ where: { id: admin.id }, data: { status: 'active' } })
  })
  await test('credentials rejected on local mode and expired remote credentials scrubbed', async () => {
    await rejects(() => journal.createManagementGatewayTask(plan('inspect', '1'), admin.id,
      { encrypted: 'unusable-test-value', expiresAt: new Date(Date.now() + 60000) }), 'GATEWAY_TASK_CREDENTIALS_INVALID')
    const remoteGatewayId = randomUUID(), remoteTarget = { mode: 'remote' as const, machineId: randomBytes(16).toString('hex'),
      ssh: { address: '10.1.1.1', port: 22, username: 'root' as const, fingerprint: 'SHA256:' + Buffer.alloc(32, 7).toString('base64').replace(/=+$/, '') } }
    await journal.registerManagementGateway({ id: remoteGatewayId, platformId, name: prefix + '-remote', target: remoteTarget }, admin.id)
    try {
      const remote = { ...plan('inspect'), gatewayId: remoteGatewayId, target: remoteTarget }
      await rejects(() => journal.createManagementGatewayTask(remote, admin.id, { encrypted: 'plaintext', expiresAt: new Date(Date.now() + 60000) }), 'GATEWAY_TASK_CREDENTIALS_INVALID')
      const publicTask = await journal.createManagementGatewayTask(remote, admin.id,
        { encrypted: 'a'.repeat(32) + ':' + 'b'.repeat(32) + ':cc', expiresAt: new Date(Date.now() + 60000) })
      assert.ok(!('credentialsEncrypted' in publicTask))
      await prisma.managementGatewayTask.update({ where: { id: remote.taskId }, data: { credentialsExpireAt: new Date(Date.now() - 1000) } })
      assert.equal(await journal.claimManagementGatewayTask(), null)
      const scrubbed = await prisma.managementGatewayTask.findUniqueOrThrow({ where: { id: remote.taskId } })
      assert.equal(scrubbed.errorCode, 'GATEWAY_TASK_CREDENTIALS_EXPIRED'); assert.equal(scrubbed.credentialsEncrypted, null)
    } finally {
      await prisma.managementGatewayStep.deleteMany({ where: { task: { gatewayId: remoteGatewayId } } })
      await prisma.managementGatewayTask.deleteMany({ where: { gatewayId: remoteGatewayId } })
      await prisma.managementGateway.delete({ where: { id: remoteGatewayId } })
    }
  })
  console.log(`Gateway real PostgreSQL journal integration passed: ${count}`)
} catch (error) {
  console.error('Gateway journal integration failed:', error instanceof GatewayTaskError ? error.code : error instanceof Error ? error.message : 'unknown error')
  throw error
} finally {
  await prisma.managementGatewayStep.deleteMany({ where: { task: { gatewayId } } })
  await prisma.managementGatewayTask.deleteMany({ where: { gatewayId } })
  await prisma.managementGateway.deleteMany({ where: { id: gatewayId } })
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, user.id] } } })
  await closePrismaDatabase()
}
process.exit(0)
