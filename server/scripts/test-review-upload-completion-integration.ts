import assert from 'node:assert/strict'
import { randomUUID, X509Certificate } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock } from 'node:test'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'),
  'Use isolated local *_pool_test PostgreSQL')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { executeUploadTask } = await import('../src/workers/backupUploadWorker.js')
const { StorageFactory } = await import('../src/storage/factory.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const tag = `upload-finalize-${randomUUID()}`
const root = await mkdtemp(join(tmpdir(), tag))
const keyPath = join(root, 'key.pem'), certPath = join(root, 'cert.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=incus-fixture', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath],
{ stdio: 'pipe', windowsHide: true })
const certificate = await readFile(certPath, 'utf8')
const payload = Buffer.from('isolated backup payload')
let exports = 0
const server = createServer({ key: await readFile(keyPath), cert: certificate, ca: certificate,
  requestCert: true, rejectUnauthorized: true }, (request, response) => {
  assert.ok((request.socket as any).authorized)
  if (request.url === '/1.0') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ type: 'sync', metadata: { api_version: '1.0' } }))
  } else if (request.url === `/1.0/instances/${tag}/backups/saved/export`) {
    exports++
    response.setHeader('content-length', payload.length)
    response.end(payload)
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
const storage = await prisma.storageConfig.create({ data: { userId: user.id, name: tag, type: 'WEBDAV', host: 'https://invalid.example.test' } })
const originalFactory = StorageFactory.create
const remote = new Map<string, Buffer>()
let deletes = 0, uploads = 0, failUpload = false
StorageFactory.create = () => ({
  async uploadStream(stream, filename) {
    uploads++
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    remote.set(filename, Buffer.concat(chunks))
    if (failUpload) throw new Error('fixture-storage-upload-failure')
  },
  async deleteFile(filename) { deletes++; remote.delete(filename) },
  async downloadStream() { throw new Error('unused fixture') },
  async testConnection() {}
})
const trigger = `upload_audit_${user.id}`
let faultInstalled = false
async function makeTask(status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' = 'PROCESSING') {
  return prisma.backupUploadTask.create({ data: { userId: user.id, hostId: host.id, instanceId: instance.id,
    backupId: backup.id, storageConfigId: storage.id, status, startedAt: new Date() } })
}
try {
  mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const originalInstance = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
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
  assert.equal(await prisma.log.count({ where: { userId: user.id, action: 'backup.upload' } }), 0, 'fault was actually exercised')
  assert.equal(await prisma.inboxMessage.count({ where: { userId: user.id } }), 1)
  await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON logs`)
  await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
  faultInstalled = false
  const before = { exports, uploads, deletes }
  await executeUploadTask(saved.id)
  for (const status of ['PENDING', 'FAILED'] as const) await executeUploadTask((await makeTask(status)).id)
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
  console.log('PASS upload completion: real PG audit failure, mTLS export, same-second task filenames, completed backup preservation, replay/no-task rejection, concurrent execution and failed-upload compensation; storage is a fixture')
} finally {
  mock.timers.reset()
  StorageFactory.create = originalFactory
  if (faultInstalled) {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON logs`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`)
  }
  await prisma.backupUploadTask.deleteMany({ where: { hostId: host.id } })
  await prisma.storageConfig.delete({ where: { id: storage.id } })
  await prisma.log.deleteMany({ where: { userId: user.id } })
  await prisma.inboxMessage.deleteMany({ where: { userId: user.id } })
  await prisma.instance.delete({ where: { id: instance.id } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.delete({ where: { id: user.id } })
  await closeAllClients()
  await closePrismaDatabase()
  await new Promise<void>(resolve => server.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
}
process.exit(0)
