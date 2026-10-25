import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { chmod, chown, copyFile, lstat, mkdir, readdir, readFile, rm, stat, statfs, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parse as parseEnv } from 'dotenv'
import { AliyunOssClient, sanitizedOssError } from './aliyun-oss-client.js'
import { atomicFileCopy, decryptBackup, encryptBackup, hashFile, validAssetName, type BackupManifest, type BackupSource } from './platform-backup-archive.js'
import { BACKUP_INTERVALS, BACKUP_RETENTIONS, backupRoot, BackupError, ensure, openSecret, readJson, recoveryHeld, sealSecret, statePath, validateBucket, validateId, validatePrefix, validateRegion, writeBackupConfig, writeJson, type BackupConfig, type BackupTaskRequest, type BackupTaskResult } from './platform-backup-core.js'
import { appliedBackupMigrations, captureDatabaseBackup, createBackupRestoreDatabase, databaseMetadata, localDatabaseAdmin, migrateBackupDatabase, normalizedDumpHash, pgQuery, postgresConnection, quoteIdentifier, restoreDatabase, schemaFingerprint, verifyDatabaseBackup, verifyRestoredDatabase, type DatabaseIntegrity } from './platform-backup-database.js'
import { assertBackupVersion, assertMigrationHistory, normalizedReleaseSchema, releaseMigrationHash, releaseMigrations } from './platform-backup-compatibility.js'
import { exportReadableDatabase } from './platform-backup-database.js'
import { createReadableZip, readableZipName, validReadableZipName } from './platform-backup-readable.js'
import { refreshRestoredGateway } from './platform-backup-gateway.js'
import { QUARANTINE_RESTORED_GATEWAY_TASKS_SQL } from '../lib/gateway-recovery-context.js'
import { mergeBackupEnvironment } from './platform-backup-environment.js'
import { CONTROLLER_BACKUP_FILES, restoreControllerIdentity } from './platform-backup-controller.js'

const exec = promisify(execFile)
const INSTALL = '/opt/incudal'
const CONTROLLER_ROOT = '/var/lib/incudal-gateway-controller'
async function verifyControllerEnrollment() {
  const app = process.env.INCUDAL_APP_DIR || (existsSync(`${INSTALL}/current`) ? `${INSTALL}/current` : INSTALL)
  try { await exec('/usr/bin/python3', ['-I', '-B', join(app, 'scripts/enroll-gateway-controller.py'), '--verify'], { timeout: 30000 }) }
  catch { throw new BackupError('OSS_CONTROLLER_IDENTITY_INVALID', 409) }
}
interface RestorePlan { id: string; createdBy: number; expiresAt: string; manifest: BackupManifest; prefix: string; files: Array<[string, string]>; compatibility?: { targetVersion: string; postgresMajor: number; migrationHash: string; releaseHash: string; schemaHash: string } }
interface RestoreJournal { taskId: string; database: string; staging: string; rollback: string; stage: string; config: BackupConfig; files: Array<{ target: string; saved: string | null; mode: number }> }
const holdPath = () => join(backupRoot(), 'recovery-hold.json')
const taskDir = (id: string) => statePath('private', validateId(id))
async function service(action: 'stop' | 'start' | 'restart') {
  try { await exec('/usr/bin/systemctl', [action, 'incudal-backend.service'], { timeout: 90000 }) }
  catch { throw new BackupError('OSS_BACKEND_SERVICE_FAILED', 503) }
}
async function freeSpace(bytes: number) {
  const info = await statfs(backupRoot()); ensure(info.bavail * info.bsize > bytes + 256 * 1024 ** 2, 'OSS_DISK_SPACE_LOW', 409)
}
async function version(): Promise<string> {
  const root = process.env.INCUDAL_APP_DIR || (existsSync(`${INSTALL}/current`) ? `${INSTALL}/current` : INSTALL)
  const metadata = await readJson<{ version?: string }>(join(root, 'version.json'))
  const pkg = await readJson<{ version: string }>(join(root, 'package.json'))
  const result = metadata?.version || pkg?.version
  ensure(result, 'OSS_VERSION_UNKNOWN', 503); return result.replace(/^v/, '')
}

export async function verifyBackupCompatibility(manifest: BackupManifest, staging: string, directory: string, expected?: RestorePlan['compatibility']) {
  const app = process.env.INCUDAL_APP_DIR || (existsSync(`${INSTALL}/current`) ? `${INSTALL}/current` : INSTALL)
  const current = await databaseMetadata(), targetVersion = await version(), release = await releaseMigrations(app)
  assertBackupVersion(manifest.version, targetVersion)
  ensure(manifest.postgresMajor === current.postgresMajor, 'OSS_POSTGRES_VERSION_MISMATCH', 409)
  assertMigrationHistory(await appliedBackupMigrations(), release, true)
  const raw = await databaseMetadata(staging)
  // The authenticated manifest must describe exactly what was restored.
  ensure(raw.migrationHash === manifest.migrationHash, 'OSS_MIGRATION_HISTORY_MISMATCH', 409)
  const rows = await appliedBackupMigrations(staging)
  assertMigrationHistory(rows, release)
  const targetDirectory = join(directory, `target-schema-${randomUUID()}`)
  await mkdir(targetDirectory, { mode: 0o700 })
  await schemaFingerprint(targetDirectory, 'target')
  const schemaHash = normalizedDumpHash(normalizedReleaseSchema(await readFile(join(targetDirectory, 'schema-target.sql'), 'utf8'), release))
  const compatibility = { targetVersion, postgresMajor: current.postgresMajor, migrationHash: current.migrationHash, releaseHash: releaseMigrationHash(release), schemaHash }
  if (expected) ensure(JSON.stringify(expected) === JSON.stringify(compatibility), 'OSS_PREVIEW_TARGET_CHANGED', 409)
  // Canonicalize only release-verified newline aliases in the isolated database.
  for (const [i, row] of rows.entries()) if (row.checksum !== release[i].checksum) {
    await pgQuery('UPDATE "_prisma_migrations" SET checksum=$1 WHERE migration_name=$2 AND checksum=$3', [release[i].checksum, row.migration_name, row.checksum], staging)
  }
  if (rows.length < release.length) await migrateBackupDatabase(app, staging)
  assertMigrationHistory(await appliedBackupMigrations(staging), release, true)
  const restoredDirectory = join(directory, `restored-schema-${randomUUID()}`)
  await mkdir(restoredDirectory, { mode: 0o700 })
  await schemaFingerprint(restoredDirectory, 'restored', staging)
  const restoredHash = normalizedDumpHash(normalizedReleaseSchema(await readFile(join(restoredDirectory, 'schema-restored.sql'), 'utf8'), release))
  ensure(restoredHash === schemaHash, 'OSS_BACKUP_SCHEMA_MISMATCH', 409)
  return compatibility
}
async function listSources(): Promise<BackupSource[]> {
  const sources: BackupSource[] = [{ name: 'runtime.env', path: `${INSTALL}/.env` }]
  const addDirectory = async (path: string, prefix: string, required: boolean) => {
    if (!existsSync(path)) { ensure(!required, 'OSS_REQUIRED_ASSET_MISSING', 503); return }
    ensure((await lstat(path)).isDirectory() && !(await lstat(path)).isSymbolicLink(), 'OSS_ASSET_SYMLINK', 503)
    for (const file of (await readdir(path)).sort()) {
      if (file === '.gitkeep' || file === 'lock') continue
      ensure(validAssetName(`${prefix}/${file}`), 'OSS_UNSUPPORTED_ASSET', 503)
      sources.push({ name: `${prefix}/${file}`, path: join(path, file) })
    }
  }
  await addDirectory(`${INSTALL}/server/certs`, 'certs', true)
  const localGateway = process.env.ONBOARDING_GATEWAY_HOST && ['127.0.0.1', 'localhost', '::1'].includes(process.env.ONBOARDING_GATEWAY_HOST)
  if (localGateway) {
    sources.push({ name: 'gateway.conf', path: '/etc/wireguard/incudal-mgmt.conf' }, { name: 'management.key', path: '/root/.ssh/incudal-host-management' }, { name: 'management.pub', path: '/root/.ssh/incudal-host-management.pub' })
    await addDirectory('/var/lib/incudal-onboarding', 'peers', true)
  }
  if (existsSync(CONTROLLER_ROOT)) {
    await verifyControllerEnrollment()
    const enrolled = await readJson<{ platformId: string }>(join(CONTROLLER_ROOT, 'enrollment.json'), 8192)
    const environment = parseEnv(await readFile(`${INSTALL}/.env`, 'utf8'))
    ensure(enrolled && enrolled.platformId === environment.GATEWAY_PLATFORM_ID, 'OSS_CONTROLLER_PLATFORM_MISMATCH')
    for (const name of CONTROLLER_BACKUP_FILES) sources.push({ name, path: join(CONTROLLER_ROOT, name.slice('controller/'.length)) })
  }
  for (const source of sources) {
    const info = await lstat(source.path)
    ensure(info.isFile() && !info.isSymbolicLink() && info.size <= 1024 * 1024, 'OSS_ASSET_INVALID', 503)
  }
  // Custom certificate locations require an explicit adapter; never silently omit them.
  for (const name of ['PANEL_CRT_PATH', 'PANEL_KEY_PATH', 'ONBOARDING_GATEWAY_KEY_PATH']) if (process.env[name]) {
    ensure(sources.some(s => resolve(s.path) === resolve(process.env[name]!)), 'OSS_CUSTOM_ASSET_UNSUPPORTED', 503)
  }
  return sources
}
async function snapshotAssets(directory: string) {
  const sources = await listSources(); const snapshot: BackupSource[] = []
  for (const [i, source] of sources.entries()) {
    const path = join(directory, `asset-${i}`); await copyFile(source.path, path); await chmod(path, 0o600)
    snapshot.push({ name: source.name, path })
  }
  return { sources, snapshot }
}
async function verifyAssetSnapshot(original: BackupSource[], snapshot: BackupSource[]) {
  const current = await listSources()
  ensure(JSON.stringify(original) === JSON.stringify(current), 'OSS_SOURCE_CHANGED', 409)
  for (let i = 0; i < original.length; i++) ensure(await hashFile(original[i].path) === await hashFile(snapshot[i].path), 'OSS_SOURCE_CHANGED', 409)
}
async function pinnedBackups() {
  const pinned = new Set<string>()
  for (const name of await readdir(statePath('private', ''))) {
    if (!/^[0-9a-f-]{36}$/.test(name)) continue
    const plan = await readJson<RestorePlan>(join(taskDir(name), 'plan.json'), 4 * 1024 * 1024)
    if (plan && Date.parse(plan.expiresAt) > Date.now()) pinned.add(plan.prefix)
    else if (plan) await rm(taskDir(name), { recursive: true, force: true })
  }
  return pinned
}
async function cleanupInterruptedUploads(client: AliyunOssClient, config: BackupConfig, currentId: string) {
  for (const id of await readdir(statePath('private', ''))) {
    if (id === currentId || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id)) continue
    const directory = taskDir(id)
    if (existsSync(join(directory, 'journal.json')) || existsSync(join(directory, 'plan.json'))) continue
    const checkpoint = await readJson<{ bucket: string; region: string; installationId: string; prefix: string; name: string; uploadId: string | null; readableZipName?: string }>(join(directory, 'upload-checkpoint.json'))
    if (!checkpoint || checkpoint.bucket !== config.bucket || checkpoint.region !== config.region || checkpoint.installationId !== config.installationId || checkpoint.prefix !== config.prefix) continue
    const prefix = `${config.prefix}${config.installationId}/${id}/`
    ensure((checkpoint.name === `${prefix}payload.enc` || (checkpoint.readableZipName && validReadableZipName(checkpoint.readableZipName) && checkpoint.name === `${prefix}${checkpoint.readableZipName}`)) && (!checkpoint.readableZipName || validReadableZipName(checkpoint.readableZipName)) && (checkpoint.uploadId === null || (typeof checkpoint.uploadId === 'string' && checkpoint.uploadId.length <= 1024)), 'OSS_CHECKPOINT_INVALID')
    let committed = false
    try { await client.client.head(`${prefix}complete.json`); committed = true }
    catch (error) { if ((error as { code?: string }).code !== 'NoSuchKey' && (error as { name?: string }).name !== 'NoSuchKeyError') throw error }
    if (checkpoint.uploadId) {
      try { await client.client.abortMultipartUpload(checkpoint.name, checkpoint.uploadId) }
      catch (error) { if ((error as { code?: string }).code !== 'NoSuchUpload' && (error as { name?: string }).name !== 'NoSuchUploadError') throw error }
    }
    if (!committed) {
      await client.client.delete(`${prefix}payload.enc`)
      if (checkpoint.readableZipName) await client.client.delete(`${prefix}${checkpoint.readableZipName}`)
    }
    await rm(directory, { recursive: true, force: true })
  }
}
function safeGatewayConfig(value: string) {
  // Do not restore WireGuard PostUp/PostDown or any shell-executing directive.
  let section = ''
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue
    if (line === '[Interface]' || line === '[Peer]') { section = line; continue }
    const match = /^([A-Za-z]+)\s*=\s*([^\r\n]+)$/.exec(line)
    ensure(match && (section === '[Interface]' ? ['PrivateKey', 'Address', 'ListenPort', 'MTU'] : ['PublicKey', 'PresharedKey', 'AllowedIPs', 'Endpoint', 'PersistentKeepalive']).includes(match[1]), 'OSS_GATEWAY_CONFIG_UNSUPPORTED')
    ensure(/^[A-Za-z0-9+/=:.,\[\] -]+$/.test(match[2]), 'OSS_GATEWAY_CONFIG_UNSUPPORTED')
  }
  return value
}
async function prepareFiles(plan: RestorePlan, directory: string) {
  const files = new Map(plan.files); const actions: Array<{ source: string; target: string; mode: number }> = []
  const preparedEnv = join(directory, 'prepared.env')
  const controllerPresent = CONTROLLER_BACKUP_FILES.some(name => files.has(name))
  let controllerPlatformId: string | undefined
  if (controllerPresent) {
    ensure(CONTROLLER_BACKUP_FILES.every(name => files.has(name)), 'OSS_REQUIRED_ASSET_MISSING')
    await verifyControllerEnrollment()
    const restored = restoreControllerIdentity(await readFile(files.get('controller/signing.pem')!, 'utf8'),
      await readFile(files.get('controller/identity.json')!, 'utf8'), await readFile(files.get('controller/enrollment.json')!, 'utf8'),
      await readFile(join(CONTROLLER_ROOT, 'enrollment.json'), 'utf8'))
    const enrollment = join(directory, 'prepared-controller-enrollment.json')
    await writeFile(enrollment, restored.enrollment, { flag: 'wx', mode: 0o600 })
    files.set('controller/enrollment.json', enrollment)
    controllerPlatformId = restored.platformId
  }
  const restoredGateway = files.has('gateway.conf') ? safeGatewayConfig(await readFile(files.get('gateway.conf')!, 'utf8')) : undefined
  await writeFile(preparedEnv, mergeBackupEnvironment(await readFile(`${INSTALL}/.env`, 'utf8'), await readFile(files.get('runtime.env')!, 'utf8'), restoredGateway, controllerPlatformId), { flag: 'wx', mode: 0o600 })
  actions.push({ source: preparedEnv, target: `${INSTALL}/.env`, mode: 0o640 })
  const gatewayPresent = files.has('gateway.conf')
  if (gatewayPresent) {
    ensure(['management.key', 'management.pub', 'certs/onboarding-gateway.key'].every(name => files.has(name)), 'OSS_REQUIRED_ASSET_MISSING')
    ensure(['localhost', '127.0.0.1', '::1'].includes(process.env.ONBOARDING_GATEWAY_HOST || ''), 'OSS_GATEWAY_MAPPING_REQUIRED', 409)
    safeGatewayConfig(await readFile(files.get('gateway.conf')!, 'utf8'))
    ensure(existsSync('/etc/wireguard') && existsSync('/root/.ssh') && existsSync('/var/lib/incudal-onboarding'), 'OSS_GATEWAY_SETUP_REQUIRED', 409)
  }
  for (const [name, source] of files) {
    let target: string | undefined
    if (name.startsWith('certs/')) target = join(INSTALL, 'server', name)
    if (name.startsWith('peers/')) target = join('/var/lib/incudal-onboarding', name.slice(6))
    if (name === 'gateway.conf') target = '/etc/wireguard/incudal-mgmt.conf'
    if (name === 'management.key') target = '/root/.ssh/incudal-host-management'
    if (name === 'management.pub') target = '/root/.ssh/incudal-host-management.pub'
    if ((CONTROLLER_BACKUP_FILES as readonly string[]).includes(name)) target = join(CONTROLLER_ROOT, name.slice('controller/'.length))
    if (target) {
      if (existsSync(target)) ensure(!(await lstat(target)).isSymbolicLink(), 'OSS_ASSET_SYMLINK')
      actions.push({ source, target, mode: name.startsWith('certs/') ? 0o640 : 0o600 })
    }
  }
  return actions
}

async function rollbackJournal(directory: string): Promise<boolean> {
  const journal = await readJson<RestoreJournal>(join(directory, 'journal.json'), 4 * 1024 * 1024)
  if (!journal) return false
  await service('stop')
  const q = quoteIdentifier, literal = (value: string) => `'${value.replace(/'/g, "''")}'`
  const names = (await localDatabaseAdmin(`SELECT datname FROM pg_database WHERE datname IN (${literal(journal.database)}, ${literal(journal.rollback)});`)).split('\n')
  if (names.includes(journal.rollback)) {
    if (names.includes(journal.database)) {
      const failed = `incudal_failed_${journal.taskId.replace(/-/g, '')}`
      await localDatabaseAdmin(`ALTER DATABASE ${q(journal.database)} WITH ALLOW_CONNECTIONS false; SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=${literal(journal.database)} AND pid<>pg_backend_pid(); ALTER DATABASE ${q(journal.database)} RENAME TO ${q(failed)};`)
    }
    await localDatabaseAdmin(`ALTER DATABASE ${q(journal.rollback)} RENAME TO ${q(journal.database)};`)
  }
  await localDatabaseAdmin(`ALTER DATABASE ${q(journal.database)} WITH ALLOW_CONNECTIONS true;`)
  const gid = Number((await exec('/usr/bin/id', ['-g', 'incudal'])).stdout.trim())
  const gatewayBefore = journal.files.some(f => f.target === '/etc/wireguard/incudal-mgmt.conf') ? await readFile('/etc/wireguard/incudal-mgmt.conf', 'utf8') : null
  for (const file of journal.files) {
    if (file.saved) { await atomicFileCopy(file.saved, file.target); await chmod(file.target, file.mode); await chown(file.target, 0, file.mode === 0o640 ? gid : 0) }
    else await unlink(file.target).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err })
  }
  if (gatewayBefore !== null) await refreshRestoredGateway(gatewayBefore)
  if (journal.files.some(file => file.target.startsWith(CONTROLLER_ROOT + '/'))) await verifyControllerEnrollment()
  // These ciphertexts belong to the original environment key restored above.
  // This also makes an explicit rollback in a later process restore credentials.
  await writeBackupConfig({ ...journal.config, enabled: false, nextRunAt: null, testedRevision: null })
  await chown(statePath('inbox', 'config.json'), Number((await exec('/usr/bin/id', ['-u', 'incudal'])).stdout.trim()), gid)
  process.env.ENCRYPTION_KEY = parseEnv(await readFile(`${INSTALL}/.env`, 'utf8')).ENCRYPTION_KEY
  const held = await readJson<Record<string, unknown>>(holdPath())
  if (held) await writeJson(holdPath(), { ...held, mode: 'rollback', snapshot: null }, 0o640)
  journal.stage = 'rolled_back_review'; await writeJson(join(directory, 'journal.json'), journal)
  await service('start')
  await protectedHealth()
  return true
}

async function protectedHealth(expectedHeld = true) {
  for (let i = 0; i < 30; i++) {
    try {
      const response = await fetch('http://127.0.0.1:3001/api/health', { signal: AbortSignal.timeout(2000), redirect: 'error' })
      const value = await response.json() as { recoveryHeld?: boolean }
      if (response.ok && value.recoveryHeld === expectedHeld) return
    } catch { /* wait for the single protected backend */ }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new BackupError('OSS_PROTECTED_START_FAILED', 503)
}

export async function runPlatformBackupTask(request: BackupTaskRequest): Promise<void> {
  ensure(process.platform === 'linux' && process.getuid?.() === 0, 'OSS_ROOT_HELPER_REQUIRED', 503)
  const id = validateId(request.id); ensure(['backup', 'preview', 'restore', 'resume', 'rollback'].includes(request.kind), 'OSS_TASK_INVALID')
  ensure(Number.isSafeInteger(request.createdBy) && request.createdBy >= 0 && Date.now() - Date.parse(request.createdAt) < 300000, 'OSS_TASK_EXPIRED')
  validateRegion(request.config.region); validateBucket(request.config.bucket); validatePrefix(request.config.prefix); validateId(request.config.installationId)
  ensure(BACKUP_INTERVALS.includes(request.config.intervalHours as never) && BACKUP_RETENTIONS.includes(request.config.retention as never), 'OSS_CONFIG_INVALID')
  const directory = taskDir(id); await mkdir(directory, { recursive: false, mode: 0o700 })
  const result: BackupTaskResult = { id, kind: request.kind, status: 'running', createdAt: request.createdAt, updatedAt: new Date().toISOString(), stage: 'preflight' }
  const update = async (stage: string, status: BackupTaskResult['status'] = 'running') => { result.stage = stage; result.status = status; result.updatedAt = new Date().toISOString(); await writeJson(statePath('results', `${id}.json`), result, 0o640) }
  await update('preflight')
  // Local recovery must remain usable even if old OSS credentials cannot decrypt.
  let client: AliyunOssClient | null = null
  let preserve = false
  try {
    if (request.kind === 'backup' || request.kind === 'preview') client = new AliyunOssClient(request.config)
    await pinnedBackups()
    if (request.kind === 'backup') {
      ensure(client, 'OSS_CLIENT_REQUIRED')
      ensure(request.config.backupPassword, 'OSS_BACKUP_PASSWORD_REQUIRED', 409)
      ensure(!recoveryHeld(), 'OSS_RECOVERY_HELD', 409)
      await client.assertBackupBucket(request.config.region)
      await cleanupInterruptedUploads(client, request.config, id)
      const metadata = await databaseMetadata(); await freeSpace(metadata.bytes * 10)
      const { sources, snapshot } = await snapshotAssets(directory)
      const dump = join(directory, 'database.dump'); await update('exporting')
      const database = await captureDatabaseBackup(dump, directory); const snapshotAt = database.snapshotAt
      await update('checking_database'); await verifyDatabaseBackup(dump, database.report, directory, id)
      const integrity = join(directory, 'database-integrity.json'); await writeJson(integrity, database.report)
      await verifyAssetSnapshot(sources, snapshot)
      await update('encrypting'); const encrypted = join(directory, 'payload.enc')
      const archivedConfig = join(directory, 'backup-config.json'); await writeJson(archivedConfig, request.config)
      const backupSources = [{ name: 'database.dump', path: dump }, { name: 'database-globals.sql', path: database.globals }, { name: 'database-integrity.json', path: integrity }, { name: 'backup.config', path: archivedConfig }, ...snapshot]
      const manifest = await encryptBackup(backupSources, {
        format: 1, id, installationId: request.config.installationId, createdAt: snapshotAt,
        version: await version(), migrationHash: database.metadata.migrationHash, postgresMajor: database.metadata.postgresMajor, databaseBytes: database.metadata.bytes
      }, openSecret(request.config.backupPassword), encrypted)
      const sqlSources = await exportReadableDatabase(dump, database.report, directory)
      const readableManifest = join(directory, 'readable-manifest.json'); await writeJson(readableManifest, manifest)
      const app = process.env.INCUDAL_APP_DIR || (existsSync(`${INSTALL}/current`) ? `${INSTALL}/current` : INSTALL)
      const readable = join(directory, readableZipName(snapshotAt))
      const readableZip = await createReadableZip([...backupSources, ...sqlSources,
        { name: 'manifest.json', path: readableManifest },
        { name: '恢复说明.md', path: join(app, 'scripts/platform-backup-recovery-guide.md') },
        { name: 'payincus-recovery.py', path: join(app, 'scripts/platform-backup-recovery.py') }], snapshotAt, openSecret(request.config.backupPassword), readable)
      result.bytes = (await stat(encrypted)).size
      await update('uploading')
      // Record intent even for a small PUT or a failure before the first SDK
      // checkpoint. Cleanup must cover completed but uncommitted ciphertext too.
      await writeJson(join(directory, 'upload-checkpoint.json'), { bucket: request.config.bucket, region: request.config.region, installationId: request.config.installationId,
        prefix: request.config.prefix, name: `${request.config.prefix}${request.config.installationId}/${id}/payload.enc`, uploadId: null, readableZipName: readableZip.name })
      result.objectPrefix = await client.upload(request.config, encrypted, { format: 1, id, installationId: manifest.installationId,
        createdAt: manifest.createdAt, version: manifest.version, bytes: result.bytes, sha256: await hashFile(encrypted), readableZip }, join(directory, 'verify.enc'),
      checkpoint => writeJson(join(directory, 'upload-checkpoint.json'), { bucket: request.config.bucket, region: request.config.region, installationId: request.config.installationId, prefix: request.config.prefix, name: checkpoint.name, uploadId: checkpoint.uploadId, readableZipName: readableZip.name }), readable)
      await update('retaining')
      try { await client.retain(request.config, await pinnedBackups()) }
      catch { result.error = 'OSS_RETENTION_FAILED'; await update('complete', 'warning'); return }
      await update('complete', 'success')
    } else if (request.kind === 'preview') {
      ensure(client, 'OSS_CLIENT_REQUIRED')
      ensure(!recoveryHeld(), 'OSS_RECOVERY_HELD', 409)
      const source = await client.index(validatePrefix(request.sourcePrefix))
      await freeSpace(source.bytes * 5)
      await update('downloading'); const encrypted = join(directory, 'payload.enc'); await client.download(source, encrypted)
      await update('verifying')
      const archive = await decryptBackup(encrypted, openSecret(request.password || ''), join(directory, 'decoded'))
      await freeSpace(archive.manifest.databaseBytes * 2 + source.bytes * 2)
      ensure(archive.manifest.id === source.id && archive.manifest.installationId === source.installationId, 'OSS_ARCHIVE_INVALID')
      const current = await databaseMetadata()
      assertBackupVersion(archive.manifest.version, await version())
      ensure(archive.manifest.postgresMajor === current.postgresMajor, 'OSS_POSTGRES_VERSION_MISMATCH', 409)
      const staging = `incudal_check_${id.replace(/-/g, '')}`
      const integrity = archive.files.has('database-integrity.json') ? await readJson<DatabaseIntegrity>(archive.files.get('database-integrity.json')!) : undefined
      ensure(!archive.files.has('database-integrity.json') || integrity, 'OSS_DATABASE_INTEGRITY_INVALID')
      await createBackupRestoreDatabase(staging, integrity || undefined)
      let compatibility: RestorePlan['compatibility']
      try {
        await update('checking_database'); await restoreDatabase(archive.files.get('database.dump')!, staging)
        if (archive.files.has('database-integrity.json')) {
          const expected = await readJson<DatabaseIntegrity>(archive.files.get('database-integrity.json')!); ensure(expected, 'OSS_DATABASE_INTEGRITY_INVALID')
          await verifyRestoredDatabase(staging, expected, directory, 'preview', archive.files.get('database.dump')!)
        }
        await update('checking_compatibility')
        compatibility = await verifyBackupCompatibility(archive.manifest, staging, directory)
      } finally { await localDatabaseAdmin(`DROP DATABASE IF EXISTS ${quoteIdentifier(staging)} WITH (FORCE);`) }
      const plan: RestorePlan = { id, createdBy: request.createdBy, expiresAt: new Date(Date.now() + 15 * 60000).toISOString(), manifest: archive.manifest, prefix: source.prefix, files: [...archive.files], compatibility }
      await prepareFiles(plan, directory)
      await writeJson(join(directory, 'plan.json'), plan)
      result.preview = { version: plan.manifest.version, createdAt: plan.manifest.createdAt, files: plan.files.length, expiresAt: plan.expiresAt }
      result.objectPrefix = source.prefix; preserve = true; await update('preview_ready', 'success')
    } else if (request.kind === 'restore') {
      ensure(!recoveryHeld(), 'OSS_RECOVERY_HELD', 409)
      const previewId = validateId(request.previewId)
      ensure(request.confirmation === `RESTORE ${previewId}`, 'OSS_CONFIRMATION_REQUIRED')
      const plan = await readJson<RestorePlan>(join(taskDir(previewId), 'plan.json'), 4 * 1024 * 1024)
      ensure(plan && plan.createdBy === request.createdBy && Date.parse(plan.expiresAt) > Date.now(), 'OSS_PREVIEW_EXPIRED', 409)
      ensure(plan.compatibility, 'OSS_PREVIEW_EXPIRED', 409)
      // Consume before side effects. The authenticated package is root-private and immutable to the API user.
      await unlink(join(taskDir(previewId), 'plan.json'))
      const actions = await prepareFiles(plan, directory)
      const files = new Map(plan.files), { database } = postgresConnection()
      const staging = `incudal_restore_${id.replace(/-/g, '')}`, rollback = `incudal_before_${id.replace(/-/g, '')}`
      await freeSpace((await databaseMetadata()).bytes + plan.manifest.databaseBytes * 2)
      const journal: RestoreJournal = { taskId: id, database, staging, rollback, stage: 'prepared', config: request.config, files: [] }
      // Persistent across application and database restarts; gate is created before stopping any writer.
      await writeJson(holdPath(), { taskId: id, createdAt: new Date().toISOString(), reason: 'restore', mode: 'restore',
        snapshot: { createdAt: plan.manifest.createdAt, version: plan.manifest.version } }, 0o640)
      preserve = true
      await writeJson(join(directory, 'journal.json'), journal)
      await update('stopping'); await service('stop')
      const integrity = files.has('database-integrity.json') ? await readJson<DatabaseIntegrity>(files.get('database-integrity.json')!) : undefined
      ensure(!files.has('database-integrity.json') || integrity, 'OSS_DATABASE_INTEGRITY_INVALID')
      await createBackupRestoreDatabase(staging, integrity || undefined)
      await update('restoring_database'); await restoreDatabase(files.get('database.dump')!, staging)
      if (files.has('database-integrity.json')) {
        const expected = await readJson<DatabaseIntegrity>(files.get('database-integrity.json')!); ensure(expected, 'OSS_DATABASE_INTEGRITY_INVALID')
        await verifyRestoredDatabase(staging, expected, directory, 'restore', files.get('database.dump')!)
      }
      await update('checking_compatibility')
      await verifyBackupCompatibility(plan.manifest, staging, directory, plan.compatibility)
      // Expire every restored session and API credential. They may have been revoked since the snapshot.
      await pgQuery('DELETE FROM refresh_tokens', [], staging)
      await pgQuery('UPDATE public_api_tokens SET revoked_at=NOW() WHERE revoked_at IS NULL', [], staging)
      await pgQuery('UPDATE oauth_access_tokens SET revoked_at=NOW() WHERE revoked_at IS NULL', [], staging)
      await pgQuery('UPDATE oauth_refresh_tokens SET revoked_at=NOW() WHERE revoked_at IS NULL', [], staging)
      await pgQuery(`INSERT INTO token_invalidations (user_id, session_id, invalidated_at, created_at) SELECT id, '__USER_LEVEL__', EXTRACT(EPOCH FROM NOW())::integer, NOW() FROM users ON CONFLICT (user_id, session_id) DO UPDATE SET invalidated_at=EXCLUDED.invalidated_at`, [], staging)
      // Historical queue items must not execute again after a database rewind.
      // Existing workers use several enum/status shapes, so enumerate only task
      // tables and discover their legal terminal labels before changing them.
      const taskColumns = await pgQuery<{ table_name: string; udt_name: string }>("SELECT table_name, udt_name FROM information_schema.columns WHERE table_schema='public' AND column_name='status' AND table_name LIKE '%\\_tasks' ESCAPE '\\'", [], staging)
      for (const column of taskColumns) {
        const labels = await pgQuery<{ enumlabel: string }>('SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname=$1', [column.udt_name], staging)
        const terminal = labels.find(l => l.enumlabel === 'FAILED' || l.enumlabel === 'failed')?.enumlabel
        if (terminal) await pgQuery(`UPDATE ${quoteIdentifier(column.table_name)} SET status=$1 WHERE status::text IN ('pending','running','PENDING','PROCESSING','RUNNING')`, [terminal], staging)
      }
      await pgQuery("UPDATE host_onboarding_nodes SET status='failed', step='recovery_review', credentials_encrypted=NULL, lease_token=NULL, lease_until=NULL WHERE status IN ('queued','running')", [], staging)
      await pgQuery(QUARANTINE_RESTORED_GATEWAY_TASKS_SQL, [], staging)
      await pgQuery('UPDATE hosts SET pool_faulted=true WHERE single_tenant=true', [], staging)
      for (const [i, action] of actions.entries()) {
        const saved = existsSync(action.target) ? join(directory, `before-${i}`) : null
        if (saved) { await copyFile(action.target, saved); await chmod(saved, 0o600) }
        journal.files.push({ target: action.target, saved, mode: action.mode })
      }
      // Gateway setup changes local SSH authorization as a derived side effect.
      // Save it locally for rollback; never trust authorized_keys from an archive.
      if (files.has('gateway.conf')) {
        const target = '/root/.ssh/authorized_keys'
        if (existsSync(target)) ensure((await lstat(target)).isFile() && !(await lstat(target)).isSymbolicLink(), 'OSS_ASSET_SYMLINK')
        const saved = existsSync(target) ? join(directory, 'before-authorized-keys') : null
        if (saved) { await copyFile(target, saved); await chmod(saved, 0o600) }
        journal.files.push({ target, saved, mode: 0o600 })
      }
      journal.stage = 'switching'; await writeJson(join(directory, 'journal.json'), journal)
      const q = quoteIdentifier
      await localDatabaseAdmin(`ALTER DATABASE ${q(database)} WITH ALLOW_CONNECTIONS false; SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${database.replace(/'/g, "''")}' AND pid<>pg_backend_pid(); ALTER DATABASE ${q(database)} RENAME TO ${q(rollback)}; ALTER DATABASE ${q(staging)} RENAME TO ${q(database)};`)
      journal.stage = 'database_switched'; await writeJson(join(directory, 'journal.json'), journal)
      const gid = Number((await exec('/usr/bin/id', ['-g', 'incudal'])).stdout.trim())
      const gatewayBefore = files.has('gateway.conf') ? await readFile('/etc/wireguard/incudal-mgmt.conf', 'utf8') : null
      for (const action of actions) { await atomicFileCopy(action.source, action.target); await chmod(action.target, action.mode); await chown(action.target, 0, action.mode === 0o640 ? gid : 0) }
      journal.stage = 'files_switched'; await writeJson(join(directory, 'journal.json'), journal)
      if (CONTROLLER_BACKUP_FILES.some(name => files.has(name))) await verifyControllerEnrollment()
      // Recreate only trusted gateway authorization/helper code, not arbitrary archived scripts.
      if (files.has('gateway.conf')) {
        const app = process.env.INCUDAL_APP_DIR || `${INSTALL}/current`
        // A new controller may have a different management subnet/identity.
        // Activate the restored configuration before validating its gateway.
        await refreshRestoredGateway(gatewayBefore!)
        await exec('/usr/bin/bash', [join(app, 'scripts/install-onboarding-gateway.sh'), `${INSTALL}/server/certs/onboarding-gateway.key`], { timeout: 30000 })
        // ssh-keygen in the installer tightens the key to 0600. The backend
        // must regain its existing group-read permission before it starts.
        await chmod(`${INSTALL}/server/certs/onboarding-gateway.key`, 0o640)
        await chown(`${INSTALL}/server/certs/onboarding-gateway.key`, 0, gid)
      }
      const savedConfig = { ...request.config, enabled: false, nextRunAt: null, testedRevision: null }
      const accessSecret = openSecret(savedConfig.accessKeySecret), backupPassword = savedConfig.backupPassword ? openSecret(savedConfig.backupPassword) : ''
      process.env.ENCRYPTION_KEY = parseEnv(await readFile(`${INSTALL}/.env`, 'utf8')).ENCRYPTION_KEY
      savedConfig.accessKeySecret = sealSecret(accessSecret); savedConfig.backupPassword = backupPassword ? sealSecret(backupPassword) : ''
      await writeBackupConfig(savedConfig)
      await chown(statePath('inbox', 'config.json'), Number((await exec('/usr/bin/id', ['-u', 'incudal'])).stdout.trim()), gid)
      await update('protected_start'); await service('start'); await protectedHealth()
      journal.stage = 'awaiting_review'; await writeJson(join(directory, 'journal.json'), journal)
      await update('awaiting_review', 'success')
    } else if (request.kind === 'rollback') {
      ensure(recoveryHeld() && request.confirmation === 'ROLLBACK RESTORE', 'OSS_CONFIRMATION_REQUIRED')
      const hold = await readJson<{ taskId: string }>(holdPath())
      ensure(hold && await rollbackJournal(taskDir(hold.taskId)), 'OSS_MANUAL_RECOVERY_REQUIRED', 409)
      await update('rolled_back', 'success')
    } else {
      ensure(recoveryHeld() && request.confirmation === 'RESUME AFTER RECONCILIATION', 'OSS_CONFIRMATION_REQUIRED')
      const hold = await readJson<{ taskId: string }>(holdPath())
      const journal = hold && await readJson<{ stage: string }>(join(taskDir(hold.taskId), 'journal.json'), 4 * 1024 * 1024)
      ensure(journal && ['awaiting_review', 'rolled_back_review'].includes(journal.stage), 'OSS_MANUAL_RECOVERY_REQUIRED', 409)
      // Stop before releasing protection: no live process can accept writes in the gap.
      await service('stop'); const savedHold = await readJson(holdPath()); await unlink(holdPath())
      try { await service('start'); await protectedHealth(false) }
      catch (error) {
        await writeJson(holdPath(), savedHold, 0o640)
        await service('stop'); await service('start'); await protectedHealth()
        throw error
      }
      await update('resumed', 'success')
    }
  } catch (error) {
    result.error = sanitizedOssError(error).code
    let rolledBack = false
    if (request.kind === 'restore' && recoveryHeld()) {
      try {
        rolledBack = await rollbackJournal(directory)
      } catch { /* Preserve all recovery evidence and keep business blocked. */ }
    }
    await update(rolledBack ? 'rolled_back' : recoveryHeld() ? 'manual_recovery_required' : 'failed', 'failed')
  } finally {
    client?.close()
    const retryUploadCleanup = request.kind === 'backup' && result.status === 'failed' && existsSync(join(directory, 'upload-checkpoint.json'))
    if (retryUploadCleanup) {
      // Retry needs only remote identifiers, never the unencrypted database or keys.
      for (const name of await readdir(directory)) if (name !== 'upload-checkpoint.json') await rm(join(directory, name), { recursive: true, force: true })
    }
    if (!preserve && !retryUploadCleanup) await rm(directory, { recursive: true, force: true })
  }
}

export async function readWorkerRequest(id: string) {
  const path = statePath('inbox', `${validateId(id)}.json`)
  const request = await readJson<BackupTaskRequest>(path)
  ensure(request?.id === id, 'OSS_TASK_INVALID')
  await unlink(path)
  return request
}
