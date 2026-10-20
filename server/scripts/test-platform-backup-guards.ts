import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { BackupError, normalizeConfig, openSecret, sealSecret, publicConfig, recoveryRequestAllowed, validatePrefix, nextScheduledTime } from '../src/services/platform-backup-core.js'
import { decryptBackup, encryptBackup, hashFile, validAssetName, validateManifest } from '../src/services/platform-backup-archive.js'
import { AliyunOssClient } from '../src/services/aliyun-oss-client.js'

process.env.ENCRYPTION_KEY = 'local-test-encryption-key-not-a-real-credential'
const workspace = await mkdtemp(join(tmpdir(), 'payincus-oss-test-'))
assert.ok(resolve(workspace).startsWith(resolve(tmpdir(), 'payincus-oss-test-')))
try {
  const secret = sealSecret('test-password-123')
  assert.equal(openSecret(secret), 'test-password-123')
  assert.throws(() => openSecret('plaintext'), /OSS_SECRET_DECRYPT_FAILED/)
  const config = normalizeConfig({ enabled: false, region: 'oss-cn-hangzhou', bucket: 'test-backup-bucket', prefix: 'backups/', accessKeyId: 'TestAccessKeyId', accessKeySecret: 'TestSecretValue', backupPassword: 'test-password-123', intervalHours: 72, retention: 1 })
  assert.equal(config.nextRunAt, null)
  assert.ok(!JSON.stringify(publicConfig(config)).includes('TestSecretValue'))
  assert.ok(!('backupPassword' in publicConfig(config)))
  assert.throws(() => normalizeConfig({ ...config, enabled: true, accessKeySecret: '', backupPassword: '' }, config))
  for (const prefix of ['../escape', '/absolute', 'a/../b', 'a\\b', 'a//b', 'a%2fb', 'a\0b']) assert.throws(() => validatePrefix(prefix))
  assert.equal(validatePrefix('backups'), 'backups/')
  assert.equal(nextScheduledTime('2026-01-30T08:00:00Z', 72, Date.parse('2026-01-30T08:00:00Z')), '2026-02-02T08:00:00.000Z')
  assert.equal(nextScheduledTime('2026-01-30T08:00:00Z', 72, Date.parse('2026-02-08T09:00:00Z')), '2026-02-11T08:00:00.000Z')
  for (const url of ['/api/health', '/api/auth/me', '/api/system-config/public?login=1', '/api/oauth/providers']) assert.equal(recoveryRequestAllowed('GET', url), true)
  assert.equal(recoveryRequestAllowed('POST', '/api/auth/check-2fa'), true)
  assert.equal(recoveryRequestAllowed('POST', '/api/auth/login'), true)
  for (const url of ['/api/instances', '/api/oauth/github/callback', '/api/agent/heartbeat', '/api/auth/register', '/api/ws', '/api/admin/system-update/start']) {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) assert.equal(recoveryRequestAllowed(method, url), false)
  }
  assert.equal(recoveryRequestAllowed('POST', '/api/system-config/public'), false)
  assert.equal(validAssetName('certs/onboarding-gateway.key.pub'), true)
  assert.equal(validAssetName('certs/../../authorized_keys.pub'), false)

  const dump = join(workspace, 'db'), env = join(workspace, 'env'), encrypted = join(workspace, 'payload.enc')
  await writeFile(dump, Buffer.alloc(256 * 1024, 61)); await writeFile(env, 'ENCRYPTION_KEY=test-archive-key\n')
  const metadata = { format: 1 as const, id: randomUUID(), installationId: randomUUID(), version: '1.6.7', createdAt: new Date().toISOString(), migrationHash: 'a'.repeat(64), postgresMajor: 16, databaseBytes: 1024 * 1024 }
  const manifest = await encryptBackup([{ name: 'database.dump', path: dump }, { name: 'runtime.env', path: env }], metadata, 'test-password-123', encrypted)
  const decoded = await decryptBackup(encrypted, 'test-password-123', join(workspace, 'decoded'))
  assert.deepEqual(decoded.manifest, manifest)
  assert.equal(await hashFile(decoded.files.get('database.dump')!), await hashFile(dump))
  await assert.rejects(decryptBackup(encrypted, 'incorrect-password', join(workspace, 'wrong')), /OSS_ARCHIVE_AUTH_FAILED/)
  assert.deepEqual(await readdir(join(workspace, 'wrong')), [])
  const changed = await readFile(encrypted); changed[45] ^= 1
  const corrupt = join(workspace, 'corrupt.enc'); await writeFile(corrupt, changed)
  await assert.rejects(decryptBackup(corrupt, 'test-password-123', join(workspace, 'tampered')), /OSS_ARCHIVE_AUTH_FAILED/)
  assert.deepEqual(await readdir(join(workspace, 'tampered')), [])
  assert.throws(() => validateManifest({ ...manifest, files: [...manifest.files, { name: '../../etc/shadow', size: 0, sha256: 'a'.repeat(64) }] }), /OSS_ARCHIVE_PATH_INVALID/)
  assert.throws(() => validateManifest({ ...manifest, files: [manifest.files[0], manifest.files[0]] }), /OSS_ARCHIVE_PATH_INVALID/)

  // Execute the installed SDK's small PUT and multipart paths. Only the HTTP
  // boundary is replaced; SDK completion callbacks retain their real null shape.
  for (const bytes of [64, 256 * 1024]) {
    const upload = new AliyunOssClient(config), payload = join(workspace, `upload-${bytes}`)
    await writeFile(payload, Buffer.alloc(bytes, 37))
    const requests: Array<{ method: string; object: string }> = []
    ;(upload.client as any).request = async (params: any) => {
      if (params.stream) for await (const _chunk of params.stream) { /* consume local SDK stream */ }
      requests.push({ method: params.method, object: params.object })
      return { res: { status: 200, headers: { etag: 'fixture-etag' } }, data: { UploadId: 'fixture-upload-id' } }
    }
    upload.client.getStream = async () => ({ stream: Readable.from([await readFile(payload)]) } as never)
    let checkpoints = 0
    try {
      const prefix = await upload.upload(config, payload, { ...metadata, bytes, sha256: await hashFile(payload) }, join(workspace, `verify-${bytes}`), async checkpoint => {
        assert.equal(checkpoint.uploadId, 'fixture-upload-id'); checkpoints++
      })
      assert.equal(checkpoints > 0, bytes >= 100 * 1024)
      assert.equal(requests.at(-1)?.object, `${prefix}complete.json`)
      assert.equal(await hashFile(join(workspace, `verify-${bytes}`)), await hashFile(payload))
      // A damaged readback must not publish a completed backup marker.
      requests.length = 0
      upload.client.getStream = async () => ({ stream: Readable.from([Buffer.from('corrupt')]) } as never)
      await assert.rejects(upload.upload(config, payload, { ...metadata, bytes, sha256: await hashFile(payload) }, join(workspace, `bad-verify-${bytes}`)), /OSS_VERIFY_FAILED/)
      assert.ok(!requests.some(r => r.object?.endsWith('/complete.json')))
    } finally { upload.close() }
  }

  const transport = new AliyunOssClient(config)
  const deleted: string[] = []
  const root = `${config.prefix}${config.installationId}/`
  const entries = [0, 1, 2, 3, 4, 5].map(i => ({ ...metadata, id: randomUUID(), installationId: config.installationId, prefix: `${root}${i}/`, bytes: 1, sha256: 'a'.repeat(64) }))
  // Exercise the real pruning loop with a controlled remote transport.
  transport.assertBackupBucket = async () => {}
  transport.backups = async () => entries
  transport.client.listV2 = async () => ({ objects: [], isTruncated: false } as never)
  transport.client.put = async () => ({} as never)
  transport.client.delete = async name => { deleted.push(name); return {} as never }
  for (const count of [1, 3, 5]) {
    deleted.length = 0
    await transport.retain({ ...config, retention: count }, new Set())
    assert.equal(deleted.length, (entries.length - count) * 3)
    assert.ok(deleted.every(key => key.startsWith(root)))
    assert.ok(deleted[0].endsWith('/complete.json'))
  }
  deleted.length = 0
  await transport.retain(config, new Set(entries.slice(1).map(b => b.prefix)))
  assert.equal(deleted.length, 0)
  transport.assertBackupBucket = async () => { throw new BackupError('OSS_AccessDenied') }
  await assert.rejects(transport.retain(config, new Set()), /OSS_AccessDenied/)
  assert.equal(deleted.length, 0)
  transport.close()

  // Route authorization is checked on every endpoint, including read-only ones.
  process.env.DATABASE_URL = 'postgresql://localhost:5432/payincus_oss_test'
  process.env.PLATFORM_BACKUP_STATE_DIR = join(workspace, 'route-state')
  const { default: Fastify } = await import('fastify')
  const { default: routes } = await import('../src/routes/admin-aliyun-oss.js')
  const appServer = Fastify()
  appServer.decorate('authenticateAdmin', async (request: any, reply: any) => {
    if (!request.headers['x-test-user']) return reply.code(401).send({ error: 'Unauthorized' })
    request.user = { id: 1, role: 'admin', username: String(request.headers['x-test-user']) }
  })
  await appServer.register(routes, { prefix: '/api/admin/aliyun-oss' })
  try {
    for (const path of ['/config', '/regions', '/tasks', '/buckets', '/objects', '/backups']) {
      assert.equal((await appServer.inject({ url: `/api/admin/aliyun-oss${path}` })).statusCode, 401)
      assert.equal((await appServer.inject({ url: `/api/admin/aliyun-oss${path}`, headers: { 'x-test-user': 'ordinary-admin' } })).statusCode, 403)
      assert.equal((await appServer.inject({ url: `/api/admin/aliyun-oss${path}`, headers: { 'x-test-user': 'admin', host: 'demoadmin.payincus.com' } })).statusCode, 403)
    }
    const state = await appServer.inject({ url: '/api/admin/aliyun-oss/config', headers: { 'x-test-user': 'admin' } })
    assert.equal(state.statusCode, 200)
    assert.equal(state.json().config, null)
    process.env.PLATFORM_BACKUP_ALLOWED_ADMIN_IDS = 'invalid'
    assert.equal((await appServer.inject({ url: '/api/admin/aliyun-oss/config', headers: { 'x-test-user': 'admin' } })).statusCode, 403)
    delete process.env.PLATFORM_BACKUP_ALLOWED_ADMIN_IDS
  } finally { await appServer.close() }

  const source = await readFile(resolve(import.meta.dirname, '../src/services/platform-backup-worker.ts'), 'utf8')
  assert.ok(source.indexOf("await client.upload(") < source.indexOf('await client.retain('), 'retention must follow verified upload')
  assert.ok(source.includes('rollbackJournal(directory)') && source.includes('protectedHealth()'), 'restore needs rollback and protected health verification')
  assert.ok(source.includes("before-authorized-keys") && source.includes("await chmod(`${INSTALL}/server/certs/onboarding-gateway.key`, 0o640)"), 'gateway recovery must save local authorization and preserve backend key access')
  const app = await readFile(resolve(import.meta.dirname, '../src/app.ts'), 'utf8')
  assert.ok(app.indexOf('if (recoveryHeld()) {') < app.indexOf('await initPrismaDatabase('), 'recovery gate precedes initialization and background jobs')
  const helper = await readFile(resolve(import.meta.dirname, '../../deploy/incudal-online-task.sh.example'), 'utf8')
  assert.ok(helper.includes('flock -n 9') && helper.includes('verify_manifest'), 'privileged workers must serialize with OTA and verify code')
  const release = await readFile(resolve(import.meta.dirname, '../../.github/workflows/release.yml'), 'utf8')
  assert.ok(release.includes('cp scripts/install-platform-backup.sh release/scripts/'), 'release artifacts must include the backup executor installer')
  console.log('Platform backup guards passed: authenticated archive, tampering, paths, schedule, retention and restore boundaries.')
} finally {
  await rm(workspace, { recursive: true, force: true })
}
