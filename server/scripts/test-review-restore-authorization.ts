import assert from 'node:assert/strict'
import { randomUUID, X509Certificate } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile, unlink } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'),
  'Use isolated local *_pool_test PostgreSQL')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { createRestoreTask, cancelRestoreTask } = await import('../src/db/restore-tasks.js')
const { claimNextTask, executeRestoreTask } = await import('../src/workers/restoreTaskWorker.js')
const { transferHostIdentity } = await import('../src/lib/transfer-host-identity.js')
const { default: Fastify } = await import('fastify')
const { default: backupRoutes } = await import('../src/routes/backups.js')
const tag = `restore-auth-${randomUUID()}`
const root = await mkdtemp(join(tmpdir(), tag))
const previousState = process.env.PLATFORM_BACKUP_STATE_DIR
process.env.PLATFORM_BACKUP_STATE_DIR = root
const certPath = join(root, 'cert.pem'), keyPath = join(root, 'key.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=incus-fixture', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath],
{ stdio: 'pipe', windowsHide: true })
const cert = await readFile(certPath, 'utf8')
let requests = 0, writes = 0
let remoteMode = 'connect-refused', stopPuts = 0, stopChecks = 0
let connectGate: Promise<void> | undefined, connectEntered: (() => void) | undefined
const server = createServer({ cert, key: await readFile(keyPath), ca: cert, requestCert: true, rejectUnauthorized: true }, (req, res) => {
  assert.ok((req.socket as any).authorized)
  requests++
  if (req.method !== 'GET') writes++
  if (remoteMode !== 'connect-refused') {
    const json = (status: number, metadata: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(metadata)) }
    if (req.url === '/1.0') { json(200, { type: 'sync', metadata: {} }); return }
    assert.equal(req.url, `/1.0/instances/${tag}/state`, 'pre-import refusal must not export, create or delete a copy')
    if (req.method === 'PUT') {
      stopPuts++
      json(remoteMode === 'stop-error' ? 500 : 200, remoteMode === 'stop-error'
        ? { type: 'error', error: 'fixture-stop-failed' } : { type: 'sync', metadata: {} })
    } else {
      stopChecks++
      json(200, { type: 'sync', metadata: { status: 'Running' } })
    }
    return
  }
  assert.equal(req.url, '/1.0', 'this authorization fixture must never reach instance mutations')
  connectEntered?.()
  const respond = () => { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: 'fixture-connect-refused' })) }
  if (connectGate) void connectGate.then(respond)
  else respond()
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as { port: number }).port
const owner = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
const operator = await prisma.user.create({ data: { username: tag + '-host', passwordHash: 'unusable-fixture' } })
const admin = await prisma.user.create({ data: { username: tag + '-admin', passwordHash: 'unusable-fixture', role: 'admin' } })
const other = await prisma.user.create({ data: { username: tag + '-other', passwordHash: 'unusable-fixture' } })
const users = [owner.id, operator.id, admin.id, other.id]
const host = await prisma.host.create({ data: { userId: operator.id, name: tag, status: 'online', url: `https://127.0.0.1:${port}`,
  certPath, keyPath, serverCertificate: cert, serverFingerprint: new X509Certificate(cert).fingerprint256 } })
const secondHost = await prisma.host.create({ data: { userId: operator.id, name: tag + '-other', url: host.url, certPath, keyPath } })
const instance = await prisma.instance.create({ data: { userId: owner.id, hostId: host.id, name: tag, incusId: tag,
  image: 'fixture/debian', status: 'stopped', cpu: 100, memory: 512, disk: 1024 } })
const backup = await prisma.backup.create({ data: { instanceId: instance.id, name: 'saved', incusName: 'saved', status: 'ready' } })
const storage = await prisma.storageConfig.create({ data: { userId: owner.id, name: tag, type: 'WEBDAV', host: 'https://1.1.1.1' } })
const actor = { id: owner.id, sid: randomUUID(), iat: Math.floor(Date.now() / 1000) }
let requestActor = { ...actor, role: 'user' as 'user' | 'admin' }
const app = Fastify()
app.decorate('authenticateUser', async (request: any) => { request.user = requestActor })
app.decorate('authenticate', async (request: any) => { request.user = requestActor })
await app.register(backupRoutes, { prefix: '/instances' })
const url = `/instances/${instance.id}/restore`
function data(actorId = owner.id, target = instance, saved = backup) {
  return { userId: actorId, ownerId: owner.id, hostId: host.id, instanceId: target.id, backupId: saved.id,
    session: actor, expectedBackupName: saved.incusName, expectedBackupCreatedAt: saved.createdAt.toISOString(),
    expectedHostIdentity: transferHostIdentity(host), originalInstanceName: target.name, originalIncusId: target.incusId }
}
async function makeTask(stage = 'claim', actorId = owner.id) {
  const id = await createRestoreTask(data(actorId))
  assert.ok(id)
  if (stage === 'dispatch') { const claimed = await claimNextTask(host.id); assert.equal(claimed?.id, id) }
  return prisma.restoreTask.findUniqueOrThrow({ where: { id } })
}
async function finish(id: number) { await prisma.restoreTask.update({ where: { id }, data: { status: 'FAILED' } }) }
const trigger = `restore_enqueue_${owner.id}`
let triggerInstalled = false
try {
  // Owner, host owner and current administrator retain their distinct authorization paths.
  for (const person of [owner, operator, admin]) {
    requestActor = { ...actor, id: person.id, role: person.role as 'user' | 'admin' }
    const response = await app.inject({ method: 'POST', url: `${url}/${backup.id}`, payload: {} })
    assert.equal(response.statusCode, 200, response.body)
    const task = await prisma.restoreTask.findUniqueOrThrow({ where: { id: response.json().taskId } })
    assert.equal(task.userId, person.id); assert.equal(task.ownerId, owner.id)
    assert.match(task.tempInstanceName!, /^restore-[0-9a-f]{32}$/)
    assert.ok(task.identityHash && task.actorSid)
    assert.equal((await app.inject({ method: 'DELETE', url: `${url}/${task.id}` })).statusCode, 200)
    const before = requests
    assert.equal((await app.inject({ method: 'POST', url: `${url}/${task.id}/rollback` })).statusCode, 409)
    assert.equal(requests, before, 'cancelled task cannot become a rollback mutation')
  }
  requestActor = { ...actor, role: 'user' }
  const changes: Array<[string, () => Promise<unknown>, () => Promise<unknown>]> = [
    ['owner', () => prisma.instance.update({ where: { id: instance.id }, data: { userId: other.id } }), () => prisma.instance.update({ where: { id: instance.id }, data: { userId: owner.id } })],
    ['host', () => prisma.instance.update({ where: { id: instance.id }, data: { hostId: secondHost.id } }), () => prisma.instance.update({ where: { id: instance.id }, data: { hostId: host.id } })],
    ['incus name', () => prisma.instance.update({ where: { id: instance.id }, data: { incusId: tag + '-changed' } }), () => prisma.instance.update({ where: { id: instance.id }, data: { incusId: tag } })],
    ['deleted instance', () => prisma.instance.update({ where: { id: instance.id }, data: { status: 'deleted' } }), () => prisma.instance.update({ where: { id: instance.id }, data: { status: 'stopped' } })],
    ['backup name', () => prisma.backup.update({ where: { id: backup.id }, data: { incusName: 'changed' } }), () => prisma.backup.update({ where: { id: backup.id }, data: { incusName: 'saved' } })],
    ['backup date', () => prisma.backup.update({ where: { id: backup.id }, data: { createdAt: new Date(0) } }), () => prisma.backup.update({ where: { id: backup.id }, data: { createdAt: backup.createdAt } })],
    ['backup state', () => prisma.backup.update({ where: { id: backup.id }, data: { status: 'deleted' } }), () => prisma.backup.update({ where: { id: backup.id }, data: { status: 'ready' } })],
    ['backup owner', () => prisma.backup.update({ where: { id: backup.id }, data: { instanceId: -1 } }), () => prisma.backup.update({ where: { id: backup.id }, data: { instanceId: instance.id } })],
    ['host identity', () => prisma.host.update({ where: { id: host.id }, data: { url: 'https://127.0.0.1:1' } }), () => prisma.host.update({ where: { id: host.id }, data: { url: host.url } })],
    ['host pin', () => prisma.host.update({ where: { id: host.id }, data: { serverFingerprint: 'changed' } }), () => prisma.host.update({ where: { id: host.id }, data: { serverFingerprint: host.serverFingerprint } })],
    ['host owner', () => prisma.host.update({ where: { id: host.id }, data: { userId: other.id } }), () => prisma.host.update({ where: { id: host.id }, data: { userId: operator.id } })],
    ['ban', () => prisma.user.update({ where: { id: owner.id }, data: { status: 'banned' } }), () => prisma.user.update({ where: { id: owner.id }, data: { status: 'active' } })],
    ['logout', () => prisma.tokenInvalidation.create({ data: { userId: owner.id, sessionId: actor.sid, invalidatedAt: actor.iat } }), () => prisma.tokenInvalidation.deleteMany({ where: { userId: owner.id } })],
    ['all sessions', () => prisma.tokenInvalidation.create({ data: { userId: owner.id, sessionId: '__USER_LEVEL__', invalidatedAt: actor.iat } }), () => prisma.tokenInvalidation.deleteMany({ where: { userId: owner.id } })]
  ]
  // A second real instance satisfies the backup FK while testing reassignment.
  const sibling = await prisma.instance.create({ data: { userId: owner.id, hostId: host.id, incusId: tag + '-sibling', name: tag,
    image: 'fixture/debian', status: 'stopped', cpu: 100, memory: 512, disk: 1024 } })
  changes.find(item => item[0] === 'backup owner')![1] = () => prisma.backup.update({ where: { id: backup.id }, data: { instanceId: sibling.id } })
  for (const stage of ['admission', 'claim', 'dispatch']) for (const [name, change, restore] of changes) {
    const task = stage === 'admission' ? null : await makeTask(stage)
    const before = requests
    await change()
    if (stage === 'admission') await assert.rejects(createRestoreTask(data()), (error: unknown) => error instanceof Error, name)
    else if (stage === 'claim') assert.equal(await claimNextTask(host.id), null, name)
    else await executeRestoreTask(task!.id)
    if (task) {
      const result = await prisma.restoreTask.findUniqueOrThrow({ where: { id: task.id } })
      assert.equal(result.status, 'FAILED', `${stage}/${name}`); assert.ok(result.error)
    }
    assert.equal(requests, before, `${stage}/${name}: zero remote work including cleanup`)
    await restore()
  }
  for (const stage of ['admission', 'claim', 'dispatch']) {
    const task = stage === 'admission' ? null : await makeTask(stage, admin.id)
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
    if (stage === 'admission') await assert.rejects(createRestoreTask(data(admin.id)), /权限/)
    else if (stage === 'claim') assert.equal(await claimNextTask(host.id), null)
    else await executeRestoreTask(task!.id)
    if (task) assert.equal((await prisma.restoreTask.findUniqueOrThrow({ where: { id: task.id } })).status, 'FAILED')
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
  }
  for (const stage of ['claim', 'dispatch']) {
    const legacy = await makeTask(stage)
    await prisma.restoreTask.update({ where: { id: legacy.id }, data: { identityHash: null } })
    if (stage === 'claim') assert.equal(await claimNextTask(host.id), null)
    else await executeRestoreTask(legacy.id)
    assert.equal((await prisma.restoreTask.findUniqueOrThrow({ where: { id: legacy.id } })).status, 'FAILED')
  }
  // Each independent workflow blocks admission and leaves already queued requests pending.
  const workflows: Array<[string, () => Promise<unknown>, () => Promise<unknown>]> = [
    ['snapshot', () => prisma.autoSnapshotOperation.create({ data: { id: randomUUID(), instanceId: instance.id, ownerId: owner.id,
      hostId: host.id, incusId: tag, identityHash: 'fixture', snapshotName: randomUUID() } }), () => prisma.autoSnapshotOperation.deleteMany({ where: { instanceId: instance.id } })],
    ['proxy', () => prisma.proxySiteOperation.create({ data: { id: randomUUID(), siteId: -1, siteKey: randomUUID(), instanceId: instance.id,
      hostId: host.id, ownerId: owner.id, actorId: owner.id, actorSid: actor.sid, actorIat: actor.iat,
      authority: 'user', identityHash: 'fixture', incusId: tag, revision: 1, action: 'upsert', desiredConfig: {}, requestHash: 'fixture' } }), () => prisma.proxySiteOperation.deleteMany({ where: { instanceId: instance.id } })],
    ['transfer', () => prisma.instanceTransfer.create({ data: { instanceId: instance.id, fromUserId: owner.id, toUserId: other.id, snapshot: {} } }), () => prisma.instanceTransfer.deleteMany({ where: { instanceId: instance.id } })],
    ['instance task', () => prisma.instanceTask.create({ data: { instanceId: instance.id, hostId: host.id, userId: owner.id, taskType: 'rebuild' } }), () => prisma.instanceTask.deleteMany({ where: { instanceId: instance.id } })],
    ['upload task', () => prisma.backupUploadTask.create({ data: { instanceId: instance.id, hostId: host.id, userId: owner.id, backupId: backup.id,
      storageConfigId: storage.id } }), () => prisma.backupUploadTask.deleteMany({ where: { instanceId: instance.id } })],
    ['provisioning cleanup', () => prisma.instance.update({ where: { id: instance.id }, data: { provisioningCleanupPending: true } }), () => prisma.instance.update({ where: { id: instance.id }, data: { provisioningCleanupPending: false } })],
    ['deletion billing', () => prisma.instance.update({ where: { id: instance.id }, data: { deletionBillingPending: true } }), () => prisma.instance.update({ where: { id: instance.id }, data: { deletionBillingPending: false } })]
  ]
  for (const stage of ['admission', 'claim', 'dispatch']) for (const [name, set, clear] of workflows) {
    const task = stage === 'admission' ? null : await makeTask(stage)
    const before = requests
    await set()
    if (stage === 'admission') await assert.rejects(createRestoreTask(data()), /正在执行/, name)
    else if (stage === 'claim') assert.equal(await claimNextTask(host.id), null, name)
    else await executeRestoreTask(task!.id)
    if (task) assert.equal((await prisma.restoreTask.findUniqueOrThrow({ where: { id: task.id } })).status, 'PENDING', name)
    assert.equal(requests, before)
    await clear()
    if (task) assert.ok(await cancelRestoreTask(task.id, instance.id, actor))
  }
  for (const stage of ['admission', 'claim', 'dispatch']) {
    const task = stage === 'admission' ? null : await makeTask(stage)
    await writeFile(join(root, 'recovery-hold.json'), '{}')
    try {
      if (stage === 'admission') await assert.rejects(createRestoreTask(data()), /恢复保护/)
      else if (stage === 'claim') assert.equal(await claimNextTask(host.id), null)
      else await executeRestoreTask(task!.id)
      if (task) assert.equal((await prisma.restoreTask.findUniqueOrThrow({ where: { id: task.id } })).status, 'PENDING')
    } finally { await unlink(join(root, 'recovery-hold.json')) }
    if (task) assert.ok(await cancelRestoreTask(task.id, instance.id, actor))
  }
  const queued = await makeTask()
  assert.equal(await createRestoreTask(data()), null)
  assert.equal(await cancelRestoreTask(queued.id, sibling.id, actor), null)
  await prisma.tokenInvalidation.create({ data: { userId: owner.id, sessionId: actor.sid, invalidatedAt: actor.iat } })
  assert.equal((await app.inject({ method: 'DELETE', url: `${url}/${queued.id}` })).statusCode, 403)
  await prisma.tokenInvalidation.deleteMany({ where: { userId: owner.id } })
  await prisma.instance.update({ where: { id: instance.id }, data: { userId: other.id } })
  await assert.rejects(cancelRestoreTask(queued.id, instance.id, actor), /权限/)
  assert.ok(await cancelRestoreTask(queued.id, instance.id, { ...actor, id: other.id }))
  await prisma.instance.update({ where: { id: instance.id }, data: { userId: owner.id } })
  const raced = await makeTask()
  await Promise.all([cancelRestoreTask(raced.id, instance.id, actor), claimNextTask(host.id)])
  const result = await prisma.restoreTask.findUniqueOrThrow({ where: { id: raced.id } })
  assert.ok(['FAILED', 'PROCESSING'].includes(result.status))
  if (result.status === 'PROCESSING') assert.equal(await cancelRestoreTask(raced.id, instance.id, actor), null)
  await finish(raced.id)

  // Only 10 PENDING requests fit, even when distinct instances contend for the final slot.
  const candidates = []
  for (let index = 0; index < 15; index++) {
    const target = await prisma.instance.create({ data: { userId: owner.id, hostId: host.id, name: tag, incusId: tag + '-q-' + index,
      image: 'fixture/debian', status: 'stopped', cpu: 100, memory: 512, disk: 1024 } })
    const saved = await prisma.backup.create({ data: { instanceId: target.id, name: 'saved', incusName: 'saved', status: 'ready' } })
    candidates.push(data(owner.id, target, saved))
  }
  for (const target of candidates.slice(0, 9)) assert.ok(await createRestoreTask(target))
  await Promise.allSettled(candidates.slice(9).map(target => createRestoreTask(target)))
  assert.equal(await prisma.restoreTask.count({ where: { hostId: host.id, status: 'PENDING' } }), 10)
  assert.equal((await app.inject({ method: 'POST', url: `${url}/${backup.id}`, payload: {} })).statusCode, 429)
  const pending = await prisma.restoreTask.findMany({ where: { hostId: host.id, status: 'PENDING' } })
  assert.equal(new Set(pending.map(item => item.tempInstanceName)).size, 10)
  await prisma.restoreTask.updateMany({ where: { hostId: host.id, status: 'PENDING' }, data: { status: 'FAILED' } })

  // PG failure rolls back admission completely, releasing the same locks for a subsequent request.
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.instance_id = ${instance.id} THEN RAISE EXCEPTION 'fixture-restore-enqueue-refused'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON restore_tasks FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  triggerInstalled = true
  await assert.rejects(createRestoreTask(data()), /fixture-restore-enqueue-refused/)
  assert.equal(await prisma.restoreTask.count({ where: { instanceId: instance.id, status: 'PENDING' } }), 0)
  await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON restore_tasks`)
  await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
  triggerInstalled = false

  // Accepted authorization reaches real mTLS. Duplicate execution and a stale attempt's failure cannot mutate its successor.
  const accepted = await makeTask('dispatch')
  let release!: () => void
  connectGate = new Promise<void>(resolve => { release = resolve })
  const entered = new Promise<void>(resolve => { connectEntered = resolve })
  const before = requests
  const execution = executeRestoreTask(accepted.id)
  const nextAttempt = randomUUID()
  try {
    await Promise.race([entered, execution.then(() => { throw new Error('dispatch exited before mTLS') })])
    await executeRestoreTask(accepted.id)
    assert.equal(requests, before + 1)
    await prisma.restoreTask.update({ where: { id: accepted.id }, data: { attemptId: nextAttempt, progress: 'successor' } })
  } finally { release(); await execution }
  const successor = await prisma.restoreTask.findUniqueOrThrow({ where: { id: accepted.id } })
  assert.equal(successor.status, 'PROCESSING'); assert.equal(successor.attemptId, nextAttempt); assert.equal(successor.progress, 'successor')
  await finish(accepted.id)
  connectGate = undefined; connectEntered = undefined
  const refused = await makeTask('dispatch')
  await executeRestoreTask(refused.id)
  assert.equal((await prisma.restoreTask.findUniqueOrThrow({ where: { id: refused.id } })).progress, 'preparation_failed')
  const terminalRequests = requests
  await executeRestoreTask(refused.id); await executeRestoreTask(-1); await executeRestoreTask(-1)
  assert.equal((await app.inject({ method: 'POST', url: `${url}/${refused.id}/rollback` })).statusCode, 409)
  assert.equal(requests, terminalRequests)
  for (const person of [operator, admin]) {
    const permitted = await makeTask('dispatch', person.id)
    const count = requests
    await executeRestoreTask(permitted.id)
    assert.equal(requests, count + 1, 'host owner and admin must pass current dispatch authorization')
    assert.equal((await prisma.restoreTask.findUniqueOrThrow({ where: { id: permitted.id } })).progress, 'preparation_failed')
  }
  assert.equal(writes, 0)
  for (const mode of ['stop-error', 'stop-unconfirmed']) {
    remoteMode = mode; stopPuts = 0; stopChecks = 0
    const task = await makeTask('dispatch')
    await executeRestoreTask(task.id)
    const failed = await prisma.restoreTask.findUniqueOrThrow({ where: { id: task.id } })
    assert.equal(failed.status, 'FAILED'); assert.equal(failed.progress, 'import_not_started')
    assert.equal(stopPuts, 1); assert.equal(stopChecks, mode === 'stop-error' ? 1 : 2)
    const beforeRollback = requests
    assert.equal((await app.inject({ method: 'POST', url: `${url}/${task.id}/rollback` })).statusCode, 409)
    assert.equal(requests, beforeRollback)
    assert.equal((await prisma.backup.findUniqueOrThrow({ where: { id: backup.id } })).status, 'ready')
  }
  console.log('PASS worker mTLS stop failure and success-but-running abort before backup export/import/cleanup; backup records retained and no pre-import rollback side effects')
  console.log('PASS real PG/Fastify restore authorization: owner/host-owner/admin, 14 target/session changes at admission/claim/dispatch, admin demotion, legacy tasks, workflow/recovery fences, cancellation races, ten-task host limit, rollback-safe rejection, enqueue DB fault and attempt CAS. Real mTLS only covers accepted dispatch and refusal; no real Incus disk restore or SIGKILL evidence.')
} finally {
  if (triggerInstalled) {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON restore_tasks`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`)
  }
  await app.close()
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
  await prisma.restoreTask.deleteMany({ where: { hostId: { in: [host.id, secondHost.id] } } })
  await prisma.autoSnapshotOperation.deleteMany({ where: { hostId: host.id } })
  await prisma.proxySiteOperation.deleteMany({ where: { hostId: host.id } })
  await prisma.instanceTransfer.deleteMany({ where: { fromUserId: { in: users } } })
  await prisma.instanceTask.deleteMany({ where: { hostId: host.id } })
  await prisma.backupUploadTask.deleteMany({ where: { hostId: host.id } })
  await prisma.storageConfig.deleteMany({ where: { userId: { in: users } } })
  await prisma.backup.deleteMany({ where: { instance: { userId: { in: users } } } })
  await prisma.instance.deleteMany({ where: { userId: { in: users } } })
  await prisma.host.deleteMany({ where: { id: { in: [host.id, secondHost.id] } } })
  await prisma.tokenInvalidation.deleteMany({ where: { userId: { in: users } } })
  await prisma.log.deleteMany({ where: { userId: { in: users } } })
  await prisma.user.deleteMany({ where: { id: { in: users } } })
  await closePrismaDatabase()
  if (previousState === undefined) delete process.env.PLATFORM_BACKUP_STATE_DIR
  else process.env.PLATFORM_BACKUP_STATE_DIR = previousState
  await rm(root, { recursive: true, force: true })
}
// Route imports install application maintenance intervals; all owned resources
// above must close successfully before the standalone fixture exits.
process.exit(0)
