import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { randomUUID, X509Certificate } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { Prisma } from '@prisma/client'
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use isolated local *_pool_test PostgreSQL')
const { prisma, closePrismaDatabase, getDbPoolStats } = await import('../src/db/prisma.js')
const { default: snapshotRoutes } = await import('../src/routes/snapshots.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const { loadAuthorizedOperationVerificationResource } = await import('../src/db/operation-verification-resource-authorization.js')
const { notificationOperationVerificationBinding } = await import('../src/db/operation-verification-binding.js')
const { invalidateAllConfigCache } = await import('../src/lib/config-cache.js')
const { clearTransporterCache } = await import('../src/lib/mailer.js')
const tag = 'snapshot-auth-' + randomUUID(), sid = randomUUID(), iat = Math.floor(Date.now() / 1000) + 10
const root = await mkdtemp(join(tmpdir(), tag)), keyPath = join(root, 'key.pem'), certPath = join(root, 'cert.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=snapshot-fixture', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath], { stdio: 'pipe', windowsHide: true })
const certificate = await readFile(certPath, 'utf8'), writes: Array<{ method: string; path: string }> = []
let holdRestore = false, restoreReached: (() => void) | undefined, restoreRelease: Promise<void> | undefined
let failDelete = false
const remote = createServer({ key: await readFile(keyPath), cert: certificate, ca: certificate, requestCert: true, rejectUnauthorized: true }, async (request, reply) => {
  assert.ok((request.socket as any).authorized, 'actual authenticated TLS fixture')
  reply.setHeader('content-type', 'application/json')
  if (request.url === '/1.0') return reply.end(JSON.stringify({ type: 'sync', metadata: { api_version: '1.0' } }))
  assert.ok(request.url?.startsWith('/1.0/instances/' + tag), 'only the captured test instance is touched')
  writes.push({ method: request.method!, path: request.url! })
  for await (const _chunk of request) { /* drain the actual payload */ }
  if (request.method === 'DELETE' && failDelete) { reply.statusCode = 500; return reply.end(JSON.stringify({ type: 'error', error: 'controlled deletion failure', error_code: 500 })) }
  if (request.method === 'PUT' && holdRestore) { restoreReached?.(); await restoreRelease }
  return reply.end(JSON.stringify({ type: 'sync', metadata: {} }))
})
await new Promise<void>(resolve => remote.listen(0, '127.0.0.1', resolve))
const owner = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
const admin = await prisma.user.create({ data: { username: tag + '-admin', passwordHash: 'unusable-fixture', role: 'admin' } })
const other = await prisma.user.create({ data: { username: tag + '-other', passwordHash: 'unusable-fixture' } })
const users = [owner.id, admin.id, other.id]
const savedSmtp = await prisma.systemConfig.findUnique({ where: { key: 'smtp_enabled' } })
await prisma.systemConfig.upsert({ where: { key: 'smtp_enabled' }, create: { key: 'smtp_enabled', value: 'false' }, update: { value: 'false' } })
invalidateAllConfigCache(); clearTransporterCache()
const host = await prisma.host.create({ data: { userId: owner.id, name: tag, status: 'online', url: `https://127.0.0.1:${(remote.address() as { port: number }).port}`, certPath, keyPath, serverCertificate: certificate, serverFingerprint: new X509Certificate(certificate).fingerprint256 } })
const instance = await prisma.instance.create({ data: { userId: owner.id, hostId: host.id, name: tag, incusId: tag, image: 'fixture/debian', status: 'stopped', cpu: 100, memory: 512, disk: 1024, snapshotLimit: 5 } })
let snapshotId = 0
const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } })
app.decorate('authenticateUser', async (request: any) => { const actor = request.headers['x-test-admin'] ? admin : owner; request.user = { id: actor.id, role: actor.role, username: actor.username, sid: request.headers['x-test-session'] ? sid + '-other' : sid, iat } })
await app.register(snapshotRoutes, { prefix: '/instances' })
type Operation = 'create' | 'delete' | 'restore' | 'policy'
const invoke = (op: Operation, asAdmin = false) => app.inject({ method: op === 'delete' ? 'DELETE' : op === 'policy' ? 'PUT' : 'POST',
  url: `/instances/${instance.id}/` + (op === 'policy' ? 'snapshot-policy' : op === 'create' ? 'snapshots' : `snapshots/${snapshotId}` + (op === 'restore' ? '/restore' : '')),
  headers: asAdmin ? { 'x-test-admin': '1' } : {}, ...(op === 'delete' ? {} : { payload: op === 'create' ? { name: 'current' } : op === 'policy' ? { enabled: true, intervalMinutes: 60 } : {} }) })
async function reset() {
  await prisma.tokenInvalidation.deleteMany({ where: { userId: { in: users } } })
  await prisma.user.updateMany({ where: { id: { in: users } }, data: { status: 'active', role: 'user' } }); await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
  await prisma.instanceTransfer.deleteMany({ where: { instanceId: instance.id } })
  await prisma.instance.update({ where: { id: instance.id }, data: { userId: owner.id, hostId: host.id, incusId: tag, status: 'stopped', snapshotLimit: 5, provisioningCleanupPending: false, deletionBillingPending: false } })
  await prisma.snapshot.deleteMany({ where: { instanceId: instance.id } })
  snapshotId = (await prisma.snapshot.create({ data: { instanceId: instance.id, name: 'captured', incusName: 'captured' } })).id
  await prisma.snapshotPolicy.upsert({ where: { instanceId: instance.id }, create: { instanceId: instance.id, enabled: false, intervalMinutes: 360 }, update: { enabled: false, intervalMinutes: 360, nextRunAt: null } })
}
async function blockedRequest(mutate: (tx: Prisma.TransactionClient) => Promise<unknown>, request: () => PromiseLike<any>) {
  let release!: () => void, entered!: (pid: number) => void
  const hold = new Promise<void>(resolve => { release = resolve }), ready = new Promise<number>(resolve => { entered = resolve })
  const blocker = prisma.$transaction(async tx => { await mutate(tx); const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`; entered(row.pid); await hold }, { timeout: 15000 })
  const pid = await ready; let settled = false, blocked = false
  const response = Promise.resolve(request()).then(value => { settled = true; return value })
  try {
    const deadline = Date.now() + 3500
    while (!settled && Date.now() < deadline) {
      const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`
      if (Number(row.count)) { blocked = true; break }; await delay(20)
    }
  } finally { release(); await blocker }
  assert.ok(blocked, 'request actually waited at the current database write gate')
  return await response
}
async function waitForRestoreFixture(reached: Promise<void>, response: Promise<{ statusCode: number; body: string }>, phase: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      reached,
      response.then(result => { throw Error(`${phase}: restore returned before the TLS fixture: status=${result.statusCode} body=${result.body}`) }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(`${phase}: restore fixture was not reached within 10000ms`)), 10000) })
    ])
  } finally { if (timer) clearTimeout(timer) }
}
try {
  if (process.env.REVIEW_SNAPSHOT_SINGLE_CONNECTION === '1') {
    assert.equal(process.env.DB_POOL_MAX, '1', 'single-connection regression must use one PG connection')
    for (const op of ['create', 'restore', 'delete'] as const) {
      await reset()
      await closeAllClients() // exercise both connection configuration reads, not just a warm cache
      const before = writes.length
      const result = await invoke(op)
      assert.equal(result.statusCode, op === 'create' ? 201 : 200, `${op}: ${result.body}`)
      assert.equal(writes.length, before + 1, `${op}: exactly one remote mutation`)
      const stats = getDbPoolStats()
      assert.equal(stats.totalCount, 1)
      assert.equal(stats.waitingCount, 0)
      // Fire-and-forget notification logging may briefly borrow this same connection.
      const settledUntil = Date.now() + 2000
      while (getDbPoolStats().idleCount !== 1 && Date.now() < settledUntil) await delay(10)
      assert.equal(getDbPoolStats().idleCount, 1, 'post-response logging must also return the sole connection')
    }
    console.log('PASS actual Fastify/PG/mTLS snapshot create/restore/delete with one PG connection, cold host connections and no nested pool acquisition')
  } else {
  let races = 0
  for (const op of ['create', 'delete', 'restore', 'policy'] as const) for (const change of ['ban', 'revoke', 'demote', 'owner', 'transfer']) {
    await reset(); const before = writes.length
    const result = await blockedRequest(async tx => {
      if (change === 'ban') return tx.user.update({ where: { id: owner.id }, data: { status: 'banned' } })
      if (change === 'revoke') { await tx.user.update({ where: { id: owner.id }, data: { status: 'active' } }); return tx.tokenInvalidation.create({ data: { userId: owner.id, sessionId: sid, invalidatedAt: iat } }) }
      if (change === 'demote') return tx.user.update({ where: { id: admin.id }, data: { role: 'user' } })
      if (change === 'owner') return tx.instance.update({ where: { id: instance.id }, data: { userId: other.id } })
      await tx.instance.update({ where: { id: instance.id }, data: { status: 'stopped' } })
      return tx.instanceTransfer.create({ data: { instanceId: instance.id, fromUserId: owner.id, toUserId: other.id, status: 'processing', fee: 0, snapshot: {} } })
    }, () => invoke(op, change === 'demote'))
    assert.equal(result.statusCode, ['ban', 'revoke', 'demote'].includes(change) ? 403 : 409, op + '/' + change + ': ' + result.body)
    assert.equal(writes.length, before, 'obsolete actor/target causes zero remote mutation')
    assert.equal(await prisma.snapshot.count({ where: { instanceId: instance.id } }), 1)
    assert.equal((await prisma.snapshotPolicy.findUniqueOrThrow({ where: { instanceId: instance.id } })).enabled, false)
    races++
  }
  for (const op of ['delete', 'restore'] as const) {
    await reset(); const before = writes.length
    const result = await blockedRequest(async tx => { await tx.instance.update({ where: { id: instance.id }, data: { status: 'stopped' } }); await tx.snapshot.update({ where: { id: snapshotId }, data: { incusName: 'replacement' } }) }, () => invoke(op))
    assert.equal(result.statusCode, 409); assert.equal(writes.length, before, 'changed snapshot source is not acted upon')
  }
  await reset(); const beforeRunning = writes.length
  const running = await blockedRequest(tx => tx.instance.update({ where: { id: instance.id }, data: { status: 'running' } }), () => invoke('restore'))
  assert.equal(running.statusCode, 409); assert.equal(writes.length, beforeRunning, 'state changes before restore are rechecked')
  await reset()
  let releaseRestore!: () => void
  restoreRelease = new Promise<void>(resolve => { releaseRestore = resolve })
  const reached = new Promise<void>(resolve => { restoreReached = resolve }); holdRestore = true
  const restoring = invoke('restore'); const restorePromise = Promise.resolve(restoring)
  try {
    await waitForRestoreFixture(reached, restorePromise, 'initial restore')
    const before = writes.length, deletion = await invoke('delete')
    assert.equal(deletion.statusCode, 409); assert.equal(writes.length, before, 'delete cannot remove source during restore')
    assert.equal(await prisma.snapshot.count({ where: { id: snapshotId } }), 1)
  } finally { releaseRestore(); holdRestore = false }
  assert.equal((await restorePromise).statusCode, 200)
  for (const op of ['create', 'delete', 'policy'] as const) {
    await reset(); const result = await invoke(op)
    assert.equal(result.statusCode, op === 'create' ? 201 : 200, result.body)
  }
  await reset()
  const channel = await prisma.notificationChannel.create({ data: { userId: owner.id, name: tag, type: 'email', config: { email: 'snapshot-fixture@example.test' } } })
  const actor = { id: owner.id, sid, iat }
  const resource = await prisma.$transaction(tx => loadAuthorizedOperationVerificationResource(tx, actor, 'delete_snapshot', snapshotId))
  if (resource.kind !== 'allowed') throw Error('isolated snapshot grant target unavailable')
  const grant = await prisma.operationVerification.create({ data: { userId: owner.id, operationType: 'delete_snapshot', resourceId: snapshotId,
    resourceType: notificationOperationVerificationBinding(actor, channel, resource.binding), code: 'isolated-grant-fixture', channel: 'email',
    verified: true, verifiedAt: new Date(), expiresAt: new Date(Date.now() + 600000) } })
  const initialGrant = await prisma.operationVerification.findUniqueOrThrow({ where: { id: grant.id } })
  const before = writes.length
  const otherSession = await app.inject({ method: 'DELETE', url: `/instances/${instance.id}/snapshots/${snapshotId}`, headers: { 'x-test-session': 'other' } })
  assert.equal(otherSession.statusCode, 403); assert.equal(writes.length, before)
  assert.deepEqual(await prisma.operationVerification.findUniqueOrThrow({ where: { id: grant.id } }), initialGrant)
  let releaseVerifiedRestore!: () => void
  restoreRelease = new Promise<void>(resolve => { releaseVerifiedRestore = resolve })
  const verifiedReached = new Promise<void>(resolve => { restoreReached = resolve }); holdRestore = true
  if (process.env.REVIEW_SNAPSHOT_EARLY_RESTORE_FAILURE === '1') {
    await prisma.instance.update({ where: { id: instance.id }, data: { status: 'running' } })
  }
  const verifiedRestore = Promise.resolve(invoke('restore'))
  try {
    await waitForRestoreFixture(verifiedReached, verifiedRestore, 'verified restore')
    const beforeBusy = writes.length, started = Date.now()
    assert.equal((await invoke('delete')).statusCode, 409)
    assert.ok(Date.now() - started < 5000, 'busy delete must fail at the operation gate before waiting on the in-flight restore')
    assert.equal(writes.length, beforeBusy)
  } finally { releaseVerifiedRestore(); holdRestore = false }
  assert.equal((await verifiedRestore).statusCode, 200)
  assert.deepEqual(await prisma.operationVerification.findUniqueOrThrow({ where: { id: grant.id } }), initialGrant)
  failDelete = true
  assert.equal((await invoke('delete')).statusCode, 500)
  failDelete = false
  assert.deepEqual(await prisma.operationVerification.findUniqueOrThrow({ where: { id: grant.id } }), initialGrant, 'remote failure must roll back the grant')
  assert.equal(await prisma.snapshot.count({ where: { id: snapshotId } }), 1)
  const trigger = 'snapshot_grant_' + randomUUID().replaceAll('-', '')
  try {
    await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id = ${snapshotId} THEN RAISE EXCEPTION 'controlled-delete-commit-failure'; END IF; RETURN OLD; END $$`)
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE DELETE ON snapshots FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
    assert.equal((await invoke('delete')).statusCode, 500)
    assert.deepEqual(await prisma.operationVerification.findUniqueOrThrow({ where: { id: grant.id } }), initialGrant, 'database failure must roll back the grant')
    assert.equal(await prisma.snapshot.count({ where: { id: snapshotId } }), 1)
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON snapshots`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`)
  }
  const beforeConcurrent = writes.filter(write => write.method === 'DELETE').length
  const results = await Promise.all(Array.from({ length: 8 }, () => invoke('delete')))
  assert.equal(results.filter(result => result.statusCode === 200).length, 1)
  assert.equal(writes.filter(write => write.method === 'DELETE').length, beforeConcurrent + 1)
  assert.equal((await prisma.operationVerification.findUniqueOrThrow({ where: { id: grant.id } })).verifiedAt, null)
  assert.equal(await prisma.snapshot.count({ where: { id: snapshotId } }), 0)
  assert.equal((await invoke('delete')).statusCode, 404)
  await prisma.operationVerification.delete({ where: { id: grant.id } })
  await prisma.notificationChannel.delete({ where: { id: channel.id } })
  console.log('PASS configured snapshot grant: foreign session rejects, restore conflict returns promptly without consumption, remote/database failures roll back, eight deletes dispatch and consume once')
  console.log(`PASS actual Fastify/PG snapshot routes: ${races} observed actor/owner/transfer races, changed snapshot source/current state, restore/delete mutual exclusion and valid controls; mTLS Incus fixture without Linux/customer disk acceptance`)
  }
} finally {
  await prisma.systemConfig.deleteMany({ where: { key: 'smtp_enabled' } }); if (savedSmtp) await prisma.systemConfig.create({ data: savedSmtp })
  invalidateAllConfigCache(); clearTransporterCache()
  await app.close(); await closeAllClients(); await prisma.log.deleteMany({ where: { instanceId: instance.id } }); await prisma.inboxMessage.deleteMany({ where: { userId: { in: users } } }); await prisma.instanceTransfer.deleteMany({ where: { instanceId: instance.id } }); await prisma.instance.delete({ where: { id: instance.id } }); await prisma.host.delete({ where: { id: host.id } }); await prisma.user.deleteMany({ where: { id: { in: users } } }); await closePrismaDatabase(); await new Promise<void>(resolve => remote.close(() => resolve())); await rm(root, { recursive: true, force: true })
}
process.exit(0)
