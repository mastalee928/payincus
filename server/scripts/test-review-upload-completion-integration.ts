import assert from 'node:assert/strict'
import { randomUUID, X509Certificate } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile, unlink } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock } from 'node:test'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'),
  'Use isolated local *_pool_test PostgreSQL')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { executeUploadTask, claimNextUploadTask, cleanupStaleUploadTasks, cleanupTimeoutUploadTasks } = await import('../src/workers/backupUploadWorker.js')
const { createBackupUploadTask, cancelBackupUploadTask } = await import('../src/db/backup-upload-tasks.js')
const { uploadStorageIdentity } = await import('../src/db/backup-upload-authorization.js')
const { transferHostIdentity } = await import('../src/lib/transfer-host-identity.js')
const { normalizeStorageFilename } = await import('../src/storage/path.js')
const { deleteAuthorizedBackup } = await import('../src/db/backup-deletion.js')
const { createRestoreTask } = await import('../src/db/restore-tasks.js')
const { updateStorageConfig, deleteStorageConfig } = await import('../src/db/storage-configs.js')
const { default: Fastify } = await import('fastify')
const { default: backupRoutes } = await import('../src/routes/backups.js')
const { default: storageConfigRoutes } = await import('../src/routes/storage-configs.js')
const { StorageFactory } = await import('../src/storage/factory.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const tag = `upload-finalize-${randomUUID()}`
const root = await mkdtemp(join(tmpdir(), tag))
const previousBackupStateDir = process.env.PLATFORM_BACKUP_STATE_DIR
process.env.PLATFORM_BACKUP_STATE_DIR = root
const keyPath = join(root, 'key.pem'), certPath = join(root, 'cert.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=incus-fixture', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath],
{ stdio: 'pipe', windowsHide: true })
const certificate = await readFile(certPath, 'utf8')
const payload = Buffer.from('isolated backup payload')
let exports = 0, requests = 0
let deleteMode: 'absent' | 'alreadyAbsent' | 'forbidden' | 'failure' | 'misleading' | 'present' | 'disconnect' = 'absent'
let backupDeletes = 0, backupChecks = 0
let deletionGate: Promise<void> | undefined, deletionEntered: (() => void) | undefined
const server = createServer({ key: await readFile(keyPath), cert: certificate, ca: certificate,
  requestCert: true, rejectUnauthorized: true }, (request, response) => {
  assert.ok((request.socket as any).authorized)
  requests++
  if (request.url === '/1.0') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ type: 'sync', metadata: { api_version: '1.0' } }))
  } else if (request.url === `/1.0/instances/${tag}/backups/saved/export`) {
    exports++
    response.setHeader('content-length', payload.length)
    response.end(payload)
  } else if (request.url === `/1.0/instances/${tag}/backups/saved`) {
    if (request.method === 'DELETE') {
      backupDeletes++
      deletionEntered?.()
      if (deleteMode === 'disconnect') { request.socket.destroy(); return }
      const status = deleteMode === 'forbidden' ? 403 : deleteMode === 'failure' || deleteMode === 'misleading' ? 500 : deleteMode === 'alreadyAbsent' ? 404 : 200
      const respond = () => {
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(JSON.stringify(status === 200 || deleteMode === 'misleading' ? { type: 'sync', metadata: {} } : { type: 'error', error: 'fixture-delete-failed' }))
      }
      if (deletionGate) void deletionGate.then(respond)
      else respond()
    } else {
      backupChecks++
      const status = deleteMode === 'present' ? 200 : 404
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(status === 200 ? { type: 'sync', metadata: { name: 'saved' } } : { type: 'error', error: 'not found' }))
    }
  } else {
    response.statusCode = 404
    response.end()
  }
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as { port: number }).port
const user = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: user.id, name: tag, status: 'online', url: `https://127.0.0.1:${port}`,
  certPath, keyPath, serverCertificate: certificate, serverFingerprint: new X509Certificate(certificate).fingerprint256 } })
const instance = await prisma.instance.create({ data: { userId: user.id, hostId: host.id, name: tag, incusId: tag,
  image: 'fixture/debian', status: 'stopped', cpu: 100, memory: 512, disk: 1024 } })
const backup = await prisma.backup.create({ data: { instanceId: instance.id, incusName: 'saved', name: 'saved', status: 'ready' } })
// Public literal passes target validation; every storage transport below is replaced, so no request reaches it.
const storage = await prisma.storageConfig.create({ data: { userId: user.id, name: tag, type: 'WEBDAV', host: 'https://1.1.1.1' } })
const actor = { id: user.id, sid: randomUUID(), iat: Math.floor(Date.now() / 1000) }
const app = Fastify()
let requestActor = { ...actor, role: 'user' as const }
app.decorate('authenticateUser', async (request: any) => { request.user = requestActor })
app.decorate('authenticate', async (request: any) => { request.user = requestActor })
await app.register(backupRoutes, { prefix: '/instances' })
await app.register(storageConfigRoutes, { prefix: '/storage' })
const uploadUrl = `/instances/${instance.id}/backups/${backup.id}/upload-remote`
const queueUsers: number[] = []
const originalFactory = StorageFactory.create
const remote = new Map<string, Buffer>()
let deletes = 0, uploads = 0, failUpload = false
let failDelete = false, uploadFailure = 'fixture-storage-upload-failure'
let afterUpload: (() => Promise<void>) | undefined
StorageFactory.create = () => ({
  async uploadStream(stream, filename) {
    uploads++
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    remote.set(filename, Buffer.concat(chunks))
    await afterUpload?.()
    if (failUpload) throw new Error(uploadFailure)
  },
  async deleteFile(filename) { deletes++; if (failDelete) throw new Error('fixture-delete-refused'); remote.delete(filename) },
  async downloadStream() { throw new Error('unused fixture') },
  async testConnection() {}
})
const trigger = `upload_audit_${user.id}`
let faultInstalled = false
const deleteTrigger = `backup_delete_${user.id}`
let deleteFaultInstalled = false
async function makeTask(status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' = 'PROCESSING') {
  const currentStorage = await prisma.storageConfig.findUniqueOrThrow({ where: { id: storage.id } })
  const task = await createBackupUploadTask({ userId: user.id, hostId: host.id, instanceId: instance.id,
    backupId: backup.id, storageConfigId: storage.id, session: actor, expectedIncusId: tag,
    expectedBackupName: 'saved', expectedStorageIdentity: uploadStorageIdentity(currentStorage), expectedHostIdentity: transferHostIdentity(host) })
  assert.ok(task)
  if (status === 'PROCESSING') { const claimed = await claimNextUploadTask(host.id); assert.equal(claimed?.id, task.id); return claimed! }
  if (status !== 'PENDING') return prisma.backupUploadTask.update({ where: { id: task.id }, data: { status } })
  return task
}
try {
  const invalidId = await app.inject({ method: 'POST', url: uploadUrl, payload: { storageConfigId: -1 } })
  assert.equal(invalidId.statusCode, 400)
  const enqueue = await app.inject({ method: 'POST', url: uploadUrl, payload: { storageConfigId: storage.id } })
  assert.equal(enqueue.statusCode, 200, enqueue.body)
  const queuedId = enqueue.json().taskId
  assert.equal((await app.inject({ method: 'DELETE', url: `/storage/${storage.id}` })).statusCode, 409)
  assert.equal((await app.inject({ method: 'PATCH', url: `/storage/${storage.id}`, payload: { name: 'busy' } })).statusCode, 409)
  await prisma.user.update({ where: { id: user.id }, data: { status: 'banned' } })
  assert.equal((await app.inject({ method: 'DELETE', url: `/instances/${instance.id}/upload-tasks/${queuedId}` })).statusCode, 403)
  assert.equal(await claimNextUploadTask(host.id), null)
  assert.equal((await prisma.backupUploadTask.findUniqueOrThrow({ where: { id: queuedId } })).status, 'FAILED')
  await prisma.user.update({ where: { id: user.id }, data: { status: 'active' } })

  const other = await prisma.user.create({ data: { username: tag + '-other', passwordHash: 'unusable-fixture' } })
  queueUsers.push(other.id)
  const changes: Array<[string, () => Promise<unknown>, () => Promise<unknown>]> = [
    ['owner', () => prisma.instance.update({ where: { id: instance.id }, data: { userId: other.id } }), () => prisma.instance.update({ where: { id: instance.id }, data: { userId: user.id } })],
    ['incus name', () => prisma.instance.update({ where: { id: instance.id }, data: { incusId: tag + '-changed' } }), () => prisma.instance.update({ where: { id: instance.id }, data: { incusId: tag } })],
    ['backup name', () => prisma.backup.update({ where: { id: backup.id }, data: { incusName: 'changed' } }), () => prisma.backup.update({ where: { id: backup.id }, data: { incusName: 'saved' } })],
    ['backup state', () => prisma.backup.update({ where: { id: backup.id }, data: { status: 'deleted' } }), () => prisma.backup.update({ where: { id: backup.id }, data: { status: 'ready' } })],
    ['host identity', () => prisma.host.update({ where: { id: host.id }, data: { url: 'https://127.0.0.1:1' } }), () => prisma.host.update({ where: { id: host.id }, data: { url: host.url } })],
    ['storage owner', () => prisma.storageConfig.update({ where: { id: storage.id }, data: { userId: other.id } }), () => prisma.storageConfig.update({ where: { id: storage.id }, data: { userId: user.id } })],
    ['storage destination', () => prisma.storageConfig.update({ where: { id: storage.id }, data: { basePath: '/changed' } }), () => prisma.storageConfig.update({ where: { id: storage.id }, data: { basePath: null } })],
    ['storage credential', () => prisma.storageConfig.update({ where: { id: storage.id }, data: { password: 'changed-fixture-ciphertext' } }), () => prisma.storageConfig.update({ where: { id: storage.id }, data: { password: null } })],
    ['ban', () => prisma.user.update({ where: { id: user.id }, data: { status: 'banned' } }), () => prisma.user.update({ where: { id: user.id }, data: { status: 'active' } })],
    ['logout', () => prisma.tokenInvalidation.create({ data: { userId: user.id, sessionId: actor.sid, invalidatedAt: actor.iat } }), () => prisma.tokenInvalidation.deleteMany({ where: { userId: user.id } })],
    ['all sessions revoked', () => prisma.tokenInvalidation.create({ data: { userId: user.id, sessionId: '__USER_LEVEL__', invalidatedAt: actor.iat } }), () => prisma.tokenInvalidation.deleteMany({ where: { userId: user.id } })]
  ]
  for (const stage of ['claim', 'dispatch']) for (const [name, change, restore] of changes) {
    const task = await makeTask(stage === 'claim' ? 'PENDING' : 'PROCESSING')
    const before = { requests, exports, uploads, deletes }
    await change()
    if (stage === 'claim') assert.equal(await claimNextUploadTask(host.id), null, name)
    else await executeUploadTask(task.id)
    const result = await prisma.backupUploadTask.findUniqueOrThrow({ where: { id: task.id } })
    assert.equal(result.status, 'FAILED', `${stage}: ${name}`)
    assert.ok(result.error)
    assert.deepEqual({ requests, exports, uploads, deletes }, before, `${stage}: ${name} must cause zero remote work`)
    await restore()
  }
  const legacy = await makeTask('PENDING')
  await prisma.backupUploadTask.update({ where: { id: legacy.id }, data: { identityHash: null } })
  assert.equal(await claimNextUploadTask(host.id), null)
  assert.match((await prisma.backupUploadTask.findUniqueOrThrow({ where: { id: legacy.id } })).error!, /身份缺失/)

  const cancelled = await makeTask('PENDING')
  await Promise.all([cancelBackupUploadTask(cancelled.id, instance.id, actor), claimNextUploadTask(host.id)])
  const raced = await prisma.backupUploadTask.findUniqueOrThrow({ where: { id: cancelled.id } })
  assert.ok(['FAILED', 'PROCESSING'].includes(raced.status))
  if (raced.status === 'PROCESSING') {
    assert.equal(await cancelBackupUploadTask(cancelled.id, instance.id, actor), null)
    await prisma.backupUploadTask.update({ where: { id: cancelled.id }, data: { status: 'FAILED' } })
  }
  for (const stage of ['claim', 'dispatch']) {
    const busy = await makeTask(stage === 'claim' ? 'PENDING' : 'PROCESSING')
    const operation = await prisma.autoSnapshotOperation.create({ data: { id: randomUUID(), instanceId: instance.id,
      ownerId: user.id, hostId: host.id, incusId: tag, identityHash: 'fixture', snapshotName: 'auto-' + randomUUID() } })
    if (stage === 'claim') assert.equal(await claimNextUploadTask(host.id), null)
    else await executeUploadTask(busy.id)
    assert.equal((await prisma.backupUploadTask.findUniqueOrThrow({ where: { id: busy.id } })).status, 'PENDING')
    await prisma.autoSnapshotOperation.delete({ where: { id: operation.id } })
    assert.ok(await cancelBackupUploadTask(busy.id, instance.id, actor))
  }
  await prisma.instance.update({ where: { id: instance.id }, data: { userId: other.id } })
  requestActor = { id: other.id, sid: randomUUID(), iat: actor.iat, role: 'user' }
  assert.equal((await app.inject({ method: 'GET', url: `/instances/${instance.id}/upload-tasks/${queuedId}` })).statusCode, 404)
  requestActor = { ...actor, role: 'user' }
  await prisma.instance.update({ where: { id: instance.id }, data: { userId: user.id } })
  const changedConfig = await updateStorageConfig(storage.id, { name: tag + '-renamed' }, actor,
    (await prisma.storageConfig.findUniqueOrThrow({ where: { id: storage.id } })).updatedAt)
  await assert.rejects(updateStorageConfig(storage.id, { name: 'stale' }, actor, storage.updatedAt), /已变化/)
  const removable = await prisma.storageConfig.create({ data: { userId: user.id, name: tag, type: 'WEBDAV', host: storage.host } })
  await deleteStorageConfig(removable.id, actor)
  assert.equal(await prisma.storageConfig.findUnique({ where: { id: removable.id } }), null)
  assert.equal(changedConfig.name, tag + '-renamed')

  // Submit with stale route snapshots, bypassing the early route prechecks.
  const submit = () => createBackupUploadTask({ userId: user.id, hostId: host.id, instanceId: instance.id,
    backupId: backup.id, storageConfigId: storage.id, session: actor, expectedIncusId: tag,
    expectedBackupName: 'saved', expectedStorageIdentity: uploadStorageIdentity(changedConfig), expectedHostIdentity: transferHostIdentity(host) })
  for (const [name, change, restore] of changes) {
    await change()
    await assert.rejects(submit(), undefined, `admission: ${name}`)
    assert.equal(await prisma.backupUploadTask.count({ where: { userId: user.id, status: { in: ['PENDING', 'PROCESSING'] } } }), 0)
    await restore()
  }
  const transferred = await prisma.instanceTransfer.create({ data: { instanceId: instance.id,
    fromUserId: user.id, toUserId: other.id, snapshot: {} } })
  await assert.rejects(submit(), /正在执行/)
  await prisma.instanceTransfer.delete({ where: { id: transferred.id } })
  const pendingSnapshot = await prisma.autoSnapshotOperation.create({ data: { id: randomUUID(), instanceId: instance.id,
    ownerId: user.id, hostId: host.id, incusId: tag, identityHash: 'fixture', snapshotName: 'auto-' + randomUUID() } })
  await assert.rejects(submit(), /正在执行/)
  await prisma.autoSnapshotOperation.delete({ where: { id: pendingSnapshot.id } })
  for (const stage of ['admission', 'claim', 'dispatch']) {
    const held = stage === 'admission' ? null : await makeTask(stage === 'claim' ? 'PENDING' : 'PROCESSING')
    const before = requests
    await writeFile(join(root, 'recovery-hold.json'), '{}')
    try {
      if (stage === 'admission') await assert.rejects(submit(), /恢复保护/)
      else if (stage === 'claim') assert.equal(await claimNextUploadTask(host.id), null)
      else await executeUploadTask(held!.id)
      if (held) assert.equal((await prisma.backupUploadTask.findUniqueOrThrow({ where: { id: held.id } })).status, 'PENDING')
      assert.equal(requests, before)
    } finally { await unlink(join(root, 'recovery-hold.json')) }
    if (held) assert.ok(await cancelBackupUploadTask(held.id, instance.id, actor))
  }

  for (const stage of ['admission', 'claim', 'dispatch']) {
    const task = stage === 'admission' ? null : await makeTask(stage === 'claim' ? 'PENDING' : 'PROCESSING')
    const operation = await prisma.proxySiteOperation.create({ data: { id: randomUUID(), siteId: -1, siteKey: randomUUID(),
      instanceId: instance.id, hostId: host.id, ownerId: user.id, actorId: user.id, actorSid: actor.sid, actorIat: actor.iat,
      authority: 'user', identityHash: 'fixture', incusId: tag, revision: 1, action: 'upsert', desiredConfig: {}, requestHash: 'fixture' } })
    if (stage === 'admission') await assert.rejects(submit(), /正在执行/)
    else if (stage === 'claim') assert.equal(await claimNextUploadTask(host.id), null)
    else await executeUploadTask(task!.id)
    if (task) assert.equal((await prisma.backupUploadTask.findUniqueOrThrow({ where: { id: task.id } })).status, 'PENDING')
    await prisma.proxySiteOperation.delete({ where: { id: operation.id } })
    if (task) assert.ok(await cancelBackupUploadTask(task.id, instance.id, actor))
  }

  // Nine existing users queued on this host; parallel submissions compete for
  // the final slot using the same host lock. No transaction may exceed ten.
  const candidates = []
  for (let index = 0; index < 13; index++) {
    const candidate = await prisma.user.create({ data: { username: tag + '-q-' + index, passwordHash: 'unusable-fixture' } })
    queueUsers.push(candidate.id)
    const target = await prisma.instance.create({ data: { userId: candidate.id, hostId: host.id, name: tag, incusId: tag + index,
      image: 'fixture/debian', cpu: 100, memory: 512, disk: 1024, status: 'stopped' } })
    const savedBackup = await prisma.backup.create({ data: { instanceId: target.id, incusName: 'saved', name: 'saved', status: 'ready' } })
    const destination = await prisma.storageConfig.create({ data: { userId: candidate.id, name: tag, type: 'WEBDAV', host: storage.host } })
    candidates.push({ userId: candidate.id, hostId: host.id, instanceId: target.id, backupId: savedBackup.id, storageConfigId: destination.id,
      session: { sid: randomUUID(), iat: actor.iat }, expectedIncusId: target.incusId, expectedBackupName: 'saved',
      expectedStorageIdentity: uploadStorageIdentity(destination), expectedHostIdentity: transferHostIdentity(host) })
  }
  for (const candidate of candidates.slice(0, 9)) assert.ok(await createBackupUploadTask(candidate))
  const lastSlot = await Promise.allSettled(candidates.slice(9).map(candidate => createBackupUploadTask(candidate)))
  assert.equal(lastSlot.filter(result => result.status === 'fulfilled' && result.value).length, 1)
  assert.equal(await prisma.backupUploadTask.count({ where: { hostId: host.id, status: 'PENDING' } }), 10)
  await assert.rejects(submit(), /队列已满/)
  await prisma.backupUploadTask.deleteMany({ where: { userId: { in: queueUsers } } })

  // The row lock is held by an actual transaction, so deletion cannot pass
  // its early empty-queue check and erase a just-enqueued task via FK cascade.
  let releaseStorage!: () => void, storageLocked!: () => void
  const lockedStorage = new Promise<void>(resolve => { storageLocked = resolve })
  const release = new Promise<void>(resolve => { releaseStorage = resolve })
  const holding = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM storage_configs WHERE id = ${storage.id} FOR SHARE`
    storageLocked()
    await release
    await tx.backupUploadTask.create({ data: { userId: user.id, hostId: host.id, instanceId: instance.id,
      backupId: backup.id, storageConfigId: storage.id } })
  })
  await lockedStorage
  const deletion = deleteStorageConfig(storage.id, actor)
  const deletionAssertion = assert.rejects(deletion, /仍有上传任务/)
  releaseStorage()
  await holding
  await deletionAssertion
  assert.equal(await prisma.backupUploadTask.count({ where: { userId: user.id, status: 'PENDING' } }), 1)
  await prisma.backupUploadTask.updateMany({ where: { userId: user.id, status: 'PENDING' }, data: { status: 'FAILED' } })

  mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const originalInstance = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
  const previousAuditCount = await prisma.log.count({ where: { userId: user.id, action: 'backup.upload' } })
  // Real PostgreSQL rejects the post-completion audit insert. The remote
  // storage is an explicit in-memory boundary; Incus export uses actual mTLS.
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = ${user.id} AND NEW.action = 'backup.upload' THEN RAISE EXCEPTION 'fixture-upload-audit-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  faultInstalled = true
  const saved = await makeTask()
  await executeUploadTask(saved.id)
  const completed = await prisma.backupUploadTask.findUniqueOrThrow({ where: { id: saved.id } })
  assert.equal(completed.status, 'COMPLETED')
  assert.equal(completed.fileSize, BigInt(payload.length))
  assert.equal(completed.error, null)
  assert.ok(completed.remoteFileName?.includes(`-saved-${saved.id}-`))
  assert.deepEqual(remote.get(completed.remoteFileName!), payload, 'audit failure must preserve the successfully uploaded file')
  assert.equal(deletes, 0, 'post-completion effects must never enter upload compensation')
  assert.equal(await prisma.log.count({ where: { userId: user.id, action: 'backup.upload' } }), previousAuditCount, 'fault was actually exercised')
  assert.equal(await prisma.inboxMessage.count({ where: { userId: user.id } }), 1)
  await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON logs`)
  await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
  faultInstalled = false
  const before = { exports, uploads, deletes }
  await executeUploadTask(saved.id)
  for (const status of ['PENDING', 'FAILED'] as const) {
    const ignored = await makeTask(status)
    await executeUploadTask(ignored.id)
    if (status === 'PENDING') assert.ok(await cancelBackupUploadTask(ignored.id, instance.id, actor))
  }
  await executeUploadTask(-1)
  assert.deepEqual({ exports, uploads, deletes }, before, 'missing and non-processing tasks cause no remote work')
  assert.deepEqual(await prisma.backupUploadTask.findUniqueOrThrow({ where: { id: saved.id } }), completed)

  // Same user, instance, backup and exact time: only task identity separates
  // the filenames. The failed task must not erase the successful task's file.
  failUpload = true
  const failing = await makeTask()
  await executeUploadTask(failing.id)
  assert.equal((await prisma.backupUploadTask.findUniqueOrThrow({ where: { id: failing.id } })).status, 'FAILED')
  assert.equal(deletes, 1, 'an actual failed upload still compensates its own partial file')
  assert.deepEqual(remote.get(completed.remoteFileName!), payload)
  assert.equal(remote.size, 1)

  failUpload = false
  const concurrent = await makeTask()
  const countBeforeConcurrent = uploads
  await Promise.all([executeUploadTask(concurrent.id), executeUploadTask(concurrent.id)])
  assert.equal(uploads, countBeforeConcurrent + 1, 'one live attempt per task in the supported single backend')
  assert.equal((await prisma.backupUploadTask.findUniqueOrThrow({ where: { id: concurrent.id } })).status, 'COMPLETED')
  assert.deepEqual(await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } }), originalInstance)

  // A delayed result from an old attempt cannot finalize or fail a replacement.
  for (const shouldFail of [false, true]) {
    const stale = await makeTask()
    let replacement: typeof stale | undefined
    const replacementName = `replacement-${randomUUID()}.tar.gz`
    const replacementBytes = Buffer.from('new attempt must survive old cleanup')
    failUpload = shouldFail
    afterUpload = async () => {
      remote.set(replacementName, replacementBytes)
      replacement = await prisma.backupUploadTask.update({ where: { id: stale.id }, data: {
        attemptId: randomUUID(), remoteFileName: replacementName, progress: 'replacement' } })
    }
    await executeUploadTask(stale.id)
    assert.deepEqual(await prisma.backupUploadTask.findUniqueOrThrow({ where: { id: stale.id } }), replacement)
    assert.deepEqual(remote.get(replacementName), replacementBytes, 'old compensation cannot delete a replacement attempt file')
    await prisma.backupUploadTask.update({ where: { id: stale.id }, data: { status: 'FAILED' } })
    afterUpload = undefined
  }

  // Retry delay survives restart because it is a persisted timestamp, while
  // both attempts remain isolated even with Date frozen to the same second.
  uploadFailure = 'fixture-network-timeout'
  const retrying = await makeTask()
  failUpload = true
  await executeUploadTask(retrying.id)
  const retryPending = await prisma.backupUploadTask.findUniqueOrThrow({ where: { id: retrying.id } })
  assert.equal(retryPending.status, 'PENDING')
  assert.equal(retryPending.nextAttemptAt?.getTime(), Date.now() + 30000)
  assert.equal(await claimNextUploadTask(host.id), null)
  await cleanupStaleUploadTasks()
  assert.equal(await claimNextUploadTask(host.id), null)
  await prisma.backupUploadTask.update({ where: { id: retrying.id }, data: { nextAttemptAt: new Date(Date.now() - 1) } })
  const retryClaim = await claimNextUploadTask(host.id)
  assert.equal(retryClaim?.id, retrying.id)
  assert.notEqual(retryClaim!.attemptId, retrying.attemptId)
  assert.notEqual(retryClaim!.remoteFileName, retrying.remoteFileName)
  failUpload = false
  await executeUploadTask(retrying.id)
  assert.equal((await prisma.backupUploadTask.findUniqueOrThrow({ where: { id: retrying.id } })).status, 'COMPLETED')

  const cleanupFailure = await makeTask()
  failUpload = true
  failDelete = true
  await executeUploadTask(cleanupFailure.id)
  const retained = await prisma.backupUploadTask.findUniqueOrThrow({ where: { id: cleanupFailure.id } })
  assert.equal(retained.status, 'FAILED')
  assert.equal(retained.progress, 'cleanup_required')
  assert.equal(retained.remoteFileName, cleanupFailure.remoteFileName)
  assert.ok(remote.has(retained.remoteFileName!))
  assert.match(retained.error!, /清理未确认/)
  assert.equal(retained.nextAttemptAt, null)
  assert.equal(await claimNextUploadTask(host.id), null, 'unknown remote cleanup must not auto retry')
  failDelete = false
  failUpload = false

  const live = await makeTask()
  afterUpload = async () => {
    await cleanupStaleUploadTasks()
    await cleanupTimeoutUploadTasks()
    assert.equal((await prisma.backupUploadTask.findUniqueOrThrow({ where: { id: live.id } })).status, 'PROCESSING')
  }
  await executeUploadTask(live.id)
  afterUpload = undefined
  assert.equal((await prisma.backupUploadTask.findUniqueOrThrow({ where: { id: live.id } })).status, 'COMPLETED')
  const restarted = await makeTask()
  assert.ok(restarted.remoteFileName && restarted.attemptId, 'remote intent exists before the first network request')
  const beforeRestart = { requests, exports, uploads, deletes }
  await cleanupStaleUploadTasks()
  const interrupted = await prisma.backupUploadTask.findUniqueOrThrow({ where: { id: restarted.id } })
  assert.equal(interrupted.status, 'FAILED')
  assert.equal(interrupted.progress, 'interrupted')
  assert.equal(interrupted.remoteFileName, restarted.remoteFileName)
  await executeUploadTask(restarted.id)
  assert.deepEqual({ requests, exports, uploads, deletes }, beforeRestart)
  const missingTime = await makeTask()
  await prisma.backupUploadTask.update({ where: { id: missingTime.id }, data: { startedAt: null } })
  await cleanupTimeoutUploadTasks()
  assert.equal((await prisma.backupUploadTask.findUniqueOrThrow({ where: { id: missingTime.id } })).status, 'FAILED')
  const longIncusName = 'i'.repeat(200), longBackupName = 'b'.repeat(200)
  await prisma.instance.update({ where: { id: instance.id }, data: { incusId: longIncusName } })
  await prisma.backup.update({ where: { id: backup.id }, data: { incusName: longBackupName } })
  const longTask = await createBackupUploadTask({ userId: user.id, hostId: host.id, instanceId: instance.id,
    backupId: backup.id, storageConfigId: storage.id, session: actor, expectedIncusId: longIncusName,
    expectedBackupName: longBackupName, expectedHostIdentity: transferHostIdentity(host), expectedStorageIdentity: uploadStorageIdentity(changedConfig) })
  assert.ok(longTask)
  const longClaim = await claimNextUploadTask(host.id)
  assert.equal(longClaim?.id, longTask.id)
  assert.equal(normalizeStorageFilename(longClaim!.remoteFileName!).length, 255)
  assert.ok(longClaim!.remoteFileName!.includes(longClaim!.attemptId!))
  await cleanupStaleUploadTasks()
  await prisma.instance.update({ where: { id: instance.id }, data: { incusId: tag } })
  await prisma.backup.update({ where: { id: backup.id }, data: { incusName: 'saved' } })
  const deleteUrl = `/instances/${instance.id}/backups/${backup.id}`
  for (const mode of ['forbidden', 'failure', 'misleading', 'present', 'disconnect'] as const) {
    deleteMode = mode
    const response = await app.inject({ method: 'DELETE', url: deleteUrl })
    assert.ok(response.statusCode >= 400, `${mode}: ${response.body}`)
    assert.equal((await prisma.backup.findUniqueOrThrow({ where: { id: backup.id } })).status, 'ready')
  }
  const waitingUpload = await makeTask('PENDING')
  const beforeBlockedDelete = backupDeletes
  assert.equal((await app.inject({ method: 'DELETE', url: deleteUrl })).statusCode, 409)
  assert.equal(backupDeletes, beforeBlockedDelete)
  await cancelBackupUploadTask(waitingUpload.id, instance.id, actor)
  const expectedInstance = { id: instance.id, user_id: user.id, host_id: host.id, incus_id: tag }
  await prisma.instance.update({ where: { id: instance.id }, data: { userId: other.id } })
  await assert.rejects(deleteAuthorizedBackup(expectedInstance, { id: backup.id, incus_name: 'saved' }, actor, transferHostIdentity(host)), /归属/)
  await prisma.instance.update({ where: { id: instance.id }, data: { userId: user.id } })
  await prisma.tokenInvalidation.create({ data: { userId: user.id, sessionId: actor.sid, invalidatedAt: actor.iat } })
  assert.equal((await app.inject({ method: 'DELETE', url: deleteUrl })).statusCode, 403)
  await prisma.tokenInvalidation.deleteMany({ where: { userId: user.id } })
  assert.equal(backupDeletes, beforeBlockedDelete)
  await prisma.host.update({ where: { id: host.id }, data: { url: 'https://127.0.0.1:1' } })
  await assert.rejects(deleteAuthorizedBackup(expectedInstance, { id: backup.id, incus_name: 'saved' }, actor, transferHostIdentity(host)), /宿主身份/)
  await prisma.host.update({ where: { id: host.id }, data: { url: host.url } })
  assert.equal(backupDeletes, beforeBlockedDelete)
  deleteMode = 'absent'
  let releaseDelete!: () => void, signalDelete!: () => void
  deletionGate = new Promise<void>(resolve => { releaseDelete = resolve })
  const deleteEntered = new Promise<void>(resolve => { signalDelete = resolve })
  deletionEntered = signalDelete
  const deleting = app.inject({ method: 'DELETE', url: deleteUrl })
  // Start injection immediately; LightMyRequest is thenable.
  const deletingResponse = Promise.resolve(deleting)
  await deleteEntered
  try {
    await assert.rejects(submit(), /正在处理/)
    assert.equal(await createRestoreTask({ userId: user.id, hostId: host.id, instanceId: instance.id,
      backupId: backup.id, ownerId: user.id, session: actor, expectedBackupName: backup.incusName,
      expectedBackupCreatedAt: backup.createdAt.toISOString(), expectedHostIdentity: transferHostIdentity(host),
      originalInstanceName: tag, originalIncusId: tag }), null)
  } finally { releaseDelete() }
  assert.equal((await deletingResponse).statusCode, 200)
  deletionGate = undefined
  deletionEntered = undefined
  assert.ok(backupChecks >= 2)
  assert.equal((await prisma.backup.findUniqueOrThrow({ where: { id: backup.id } })).status, 'deleted')
  const beforeReplay = { backupDeletes, backupChecks }
  assert.equal((await app.inject({ method: 'DELETE', url: deleteUrl })).statusCode, 200)
  assert.deepEqual({ backupDeletes, backupChecks }, beforeReplay)
  await prisma.backup.update({ where: { id: backup.id }, data: { status: 'ready' } })
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${deleteTrigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = ${backup.id} AND NEW.status = 'deleted' THEN RAISE EXCEPTION 'fixture-backup-delete-commit-failed'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${deleteTrigger} BEFORE UPDATE ON backups FOR EACH ROW EXECUTE FUNCTION ${deleteTrigger}()`)
  deleteFaultInstalled = true
  assert.equal((await app.inject({ method: 'DELETE', url: deleteUrl })).statusCode, 500)
  assert.equal((await prisma.backup.findUniqueOrThrow({ where: { id: backup.id } })).status, 'ready')
  await prisma.$executeRawUnsafe(`DROP TRIGGER ${deleteTrigger} ON backups`)
  await prisma.$executeRawUnsafe(`DROP FUNCTION ${deleteTrigger}()`)
  deleteFaultInstalled = false
  deleteMode = 'alreadyAbsent'
  assert.equal((await app.inject({ method: 'DELETE', url: deleteUrl })).statusCode, 200)
  assert.equal((await prisma.backup.findUniqueOrThrow({ where: { id: backup.id } })).status, 'deleted')
  console.log('PASS backup deletion: real mTLS 403/500/disconnect/present retain ready row, exact-resource absence required, old owner/revoked session/active upload blocked, deletion fences new upload and restore through remote confirmation, terminal replay performs no remote calls')
  console.log('PASS persisted per-attempt filenames, exact UUID results/compensation, 30-second retry delay, cleanup failure receipt/no retry, startup interruption with remote filename retention, null-start cleanup, and live-attempt exclusion')
  console.log('PASS real PG/Fastify upload admission + claim + dispatch: 11 changed targets/session cases at each boundary, legacy rejection, owner-only history, cancellation/claim race, snapshot/proxy/transfer fencing, ten-job host limit and storage deletion race; mTLS export completion, audit failure, same-second files, replay, concurrent execution, instance preservation and compensation. Storage and authentication middleware are fixtures; database authorization and routes are real.')
} finally {
  await app.close()
  mock.timers.reset()
  StorageFactory.create = originalFactory
  if (faultInstalled) {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON logs`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`)
  }
  if (deleteFaultInstalled) {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${deleteTrigger} ON backups`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${deleteTrigger}()`)
  }
  await prisma.backupUploadTask.deleteMany({ where: { hostId: host.id } })
  await prisma.autoSnapshotOperation.deleteMany({ where: { hostId: host.id } })
  await prisma.proxySiteOperation.deleteMany({ where: { hostId: host.id } })
  await prisma.tokenInvalidation.deleteMany({ where: { userId: user.id } })
  await prisma.storageConfig.delete({ where: { id: storage.id } })
  await prisma.log.deleteMany({ where: { userId: user.id } })
  await prisma.inboxMessage.deleteMany({ where: { userId: user.id } })
  await prisma.instance.deleteMany({ where: { hostId: host.id } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.delete({ where: { id: user.id } })
  await prisma.user.deleteMany({ where: { id: { in: queueUsers } } })
  await closeAllClients()
  await closePrismaDatabase()
  await new Promise<void>(resolve => server.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
  if (previousBackupStateDir === undefined) delete process.env.PLATFORM_BACKUP_STATE_DIR
  else process.env.PLATFORM_BACKUP_STATE_DIR = previousBackupStateDir
}
process.exit(0)
