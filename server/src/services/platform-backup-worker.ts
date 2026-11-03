import { recoveryActivationPath, restoreActivation, durableUnlink, recoverInterruptedActivation, type RecoveryActivation } from './platform-recovery-activation.js'
import { assertRecoveryReady } from './platform-recovery-state.js'
import { assertCurrentRecoveryGateway, recoveryGatewayIdentity } from './platform-recovery-gateway-check.js'
import { pgRecoveryTransaction } from './platform-backup-database.js'
import { resumeReviewedRecovery } from './platform-recovery-resume.js'
import { captureRecoveryOperator, installRecoveryOperator } from './platform-recovery-operator.js'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { chmod, chown, copyFile, lstat, mkdir, readdir, readFile, rm, stat, statfs, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parse as parseEnv } from 'dotenv'
import { AliyunOssClient, sanitizedOssError } from './aliyun-oss-client.js'
import { atomicFileCopy, decryptBackup, encryptBackup, hashFile, validAssetName, type BackupManifest, type BackupSource } from './platform-backup-archive.js'
import { BACKUP_INTERVALS, BACKUP_RETENTIONS, backupRoot, BackupError, ensure, openSecret, readJson, recoveryHeld, sealSecret, statePath, validateBucket, validateId, validatePrefix, validateObjectPrefix, validateRegion, writeBackupConfig, writeJson, type BackupConfig, type BackupTaskRequest, type BackupTaskResult } from './platform-backup-core.js'
import { appliedBackupMigrations, captureDatabaseBackup, createBackupRestoreDatabase, databaseMetadata, localDatabaseAdmin, migrateBackupDatabase, normalizedDumpHash, pgQuery, postgresConnection, quoteIdentifier, restoreDatabase, schemaFingerprint, verifyDatabaseBackup, verifyRestoredDatabase, type DatabaseIntegrity } from './platform-backup-database.js'
import { assertBackupVersion, assertMigrationHistory, normalizedReleaseSchema, releaseMigrationHash, releaseMigrations } from './platform-backup-compatibility.js'
import { exportReadableDatabase } from './platform-backup-database.js'
import { createReadableZip, readableZipName, validReadableZipName } from './platform-backup-readable.js'
import { refreshRestoredGateway, checkRestoredGatewayNetwork, reconcileArchivedGatewayPeers, type ArchivedGatewayNode } from './platform-backup-gateway.js'
import { QUARANTINE_RESTORED_GATEWAY_TASKS_SQL } from '../lib/gateway-recovery-context.js'
import { mergeBackupEnvironment } from './platform-backup-environment.js'
import { discoverLocalRecoveryGateway } from './platform-recovery-local-gateway.js'
import { stableGatewayEndpointText } from '../lib/onboarding-gateway-endpoint.js'
import { readGatewayEndpointPlan } from './onboarding-gateway-endpoint.js'
import { CONTROLLER_BACKUP_FILES, restoreControllerIdentity } from './platform-backup-controller.js'
import { waitForProtectedBackendHealth as protectedHealth, waitForRestoredAgentHeartbeats } from './platform-backup-health.js'
import { inspectRecoveryMapping } from './platform-recovery-mapping.js'
import { recoveryMappingPath, recoverInterruptedMapping, type RecoveryMappingJournal } from './platform-recovery-mapping-journal.js'
import { activeRecoveryBatch } from './platform-recovery-state.js'
import { verifyCurrentRecoveryHosts, assertFinalRecoveryHosts } from './platform-recovery-final-check.js'
import { validateRestoreJournal, rollbackDatabasePlan, assertRestoreStartIdentity, type RestoreJournal } from './platform-recovery-restore-journal.js'
import { gatewayBaseline, assertGatewayBaseline, backupGatewayBaseline } from './platform-recovery-gateway-baseline.js'
import { gatewayCommand, gatewayConfigured } from './onboarding-ssh.js'
import { recoveryHelperErrorCode } from './platform-recovery-helper-policy.js'
import { saveRestoredSnapshot, restoredSnapshot } from './platform-recovery-snapshot.js'
import { reconcileRestoredDeliveries } from './platform-recovery-delivery.js'

const exec = promisify(execFile)
const INSTALL = '/opt/incudal'
const CONTROLLER_ROOT = '/var/lib/incudal-gateway-controller'
async function verifyControllerEnrollment() {
  const app = process.env.INCUDAL_APP_DIR || (existsSync(`${INSTALL}/current`) ? `${INSTALL}/current` : INSTALL)
  try { await exec('/usr/bin/python3', ['-I', '-B', join(app, 'scripts/enroll-gateway-controller.py'), '--verify'], { timeout: 30000 }) }
  catch { throw new BackupError('OSS_CONTROLLER_IDENTITY_INVALID', 409) }
}
interface RestorePlan { id: string; createdBy: number; expiresAt: string; manifest: BackupManifest; prefix: string; files: Array<[string, string]>; gatewayEndpoint?:string; compatibility?: { targetVersion: string; postgresMajor: number; migrationHash: string; releaseHash: string; schemaHash: string } }
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
async function archivedGatewayForSnapshot(files:Map<string,string>,database:string) {
  if(!files.has('gateway.conf'))return null
  const reservations=new Map<string,unknown>()
  for(const [name,path] of files)if(name.startsWith('peers/'))reservations.set(name.slice(6,-5),await readJson(path,4096))
  const nodes=await pgQuery<ArchivedGatewayNode>('SELECT id,host_id AS "hostId",node_public_key AS "nodePublicKey",management_ip AS "managementIp",deleted_at AS "deletedAt" FROM host_onboarding_nodes',[],database)
  return reconcileArchivedGatewayPeers(safeGatewayConfig(await readFile(files.get('gateway.conf')!,'utf8')),reservations,nodes)
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
  const currentEnv=await readFile(`${INSTALL}/.env`, 'utf8'),archivedEnv=await readFile(files.get('runtime.env')!, 'utf8')
  const localGateway=restoredGateway===undefined?undefined:await discoverLocalRecoveryGateway(currentEnv,archivedEnv,plan.gatewayEndpoint)
  await writeFile(preparedEnv, mergeBackupEnvironment(currentEnv,archivedEnv,restoredGateway,controllerPlatformId,localGateway), { flag: 'wx', mode: 0o600 })
  actions.push({ source: preparedEnv, target: `${INSTALL}/.env`, mode: 0o640 })
  const gatewayPresent = files.has('gateway.conf')
  if (gatewayPresent) {
    ensure(['management.key', 'management.pub', 'certs/onboarding-gateway.key'].every(name => files.has(name)), 'OSS_REQUIRED_ASSET_MISSING')
    safeGatewayConfig(await readFile(files.get('gateway.conf')!, 'utf8'))
    // Prepare only fixed local directories, never generate replacement keys.
    for(const path of ['/etc/wireguard','/root/.ssh','/var/lib/incudal-onboarding']){
      await mkdir(path,{recursive:true,mode:0o700})
      const info=await lstat(path);ensure(info.isDirectory() && !info.isSymbolicLink() && info.uid===0 && (info.mode&0o022)===0,'OSS_ASSET_SYMLINK',409)
    }
    if(!existsSync('/etc/wireguard/incudal-mgmt.conf')){
      const links=JSON.parse((await exec('/usr/sbin/ip',['-j','link','show'],{timeout:10000})).stdout)
      ensure(Array.isArray(links) && !links.some((link:{ifname?:string})=>link.ifname==='incudal-mgmt'),'OSS_RECOVERY_UNMANAGED_GATEWAY',409)
    }
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

async function rollbackJournal(directory: string, manageService = true): Promise<boolean> {
  const journal = await readJson<RestoreJournal>(join(directory, 'journal.json'), 4 * 1024 * 1024)
  if (!journal) return false
  validateRestoreJournal(journal, directory)
  const heldBefore = await readJson<{taskId:string;batchId:string}>(holdPath())
  ensure(heldBefore?.taskId === journal.taskId, 'OSS_RECOVERY_CONTEXT_CHANGED', 503)
  if (manageService) await service('stop')
  const q = quoteIdentifier, literal = (value: string) => `'${value.replace(/'/g, "''")}'`
  const catalog = JSON.parse(await localDatabaseAdmin(`SELECT COALESCE(json_agg(json_build_object('name',datname,'oid',oid)), '[]') FROM pg_database;`)) as Array<{name:string;oid:number}>
  const renames = rollbackDatabasePlan(journal, catalog)
  // Verify every saved file before changing any database or destination file.
  for (const file of journal.files) {
    if (file.saved) {
      const info=await lstat(file.saved).catch(()=>null)
      ensure(info?.isFile() && !info.isSymbolicLink(), 'OSS_RECOVERY_RESTORE_FILE_MISSING', 503)
      if(file.savedHash)ensure(await hashFile(file.saved)===file.savedHash,'OSS_RECOVERY_RESTORE_FILE_CHANGED',503)
    }
    if (existsSync(file.target)) ensure((await lstat(file.target)).isFile() && !(await lstat(file.target)).isSymbolicLink(), 'OSS_ASSET_SYMLINK', 503)
  }
  journal.stage = 'rolling_back'; await writeJson(join(directory, 'journal.json'), journal)
  for (const rename of renames) {
    await localDatabaseAdmin(`ALTER DATABASE ${q(rename.from)} WITH ALLOW_CONNECTIONS false;`)
    await localDatabaseAdmin(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=${literal(rename.from)} AND pid<>pg_backend_pid();`)
    await localDatabaseAdmin(`ALTER DATABASE ${q(rename.from)} RENAME TO ${q(rename.to)};`)
  }
  await localDatabaseAdmin(`ALTER DATABASE ${q(journal.database)} WITH ALLOW_CONNECTIONS true;`)
  const gid = Number((await exec('/usr/bin/id', ['-g', 'incudal'])).stdout.trim())
  const gatewayFile=journal.files.find(f=>f.target==='/etc/wireguard/incudal-mgmt.conf')
  const gatewayBefore = gatewayFile ? await readFile('/etc/wireguard/incudal-mgmt.conf', 'utf8').catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return '';throw error}) : null
  if(gatewayFile && !gatewayFile.saved){
    // B had no gateway before recovery. Stop it while its configuration still
    // exists so wg-quick can remove only the interface this restore created.
    await exec('/usr/bin/systemctl',['stop','wg-quick@incudal-mgmt'],{timeout:30000})
    const links=JSON.parse((await exec('/usr/sbin/ip',['-j','link','show'],{timeout:10000})).stdout)
    ensure(Array.isArray(links) && !links.some((link:{ifname?:string})=>link.ifname==='incudal-mgmt'),'OSS_GATEWAY_ROLLBACK_PENDING',503)
  }
  for (const file of journal.files) {
    if (file.saved) { await atomicFileCopy(file.saved, file.target); await chmod(file.target, file.mode); await chown(file.target, 0, file.mode === 0o640 ? gid : 0) }
    else await unlink(file.target).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err })
  }
  // A previous rollback (including an older worker) may have replaced files
  // before failing to synchronize the interface. File equality is not proof
  // that the live address, MTU, identity or peers have been restored.
  if (gatewayBefore !== null && gatewayFile?.saved) await refreshRestoredGateway(gatewayBefore, true)
  if (journal.files.some(file => file.target.startsWith(CONTROLLER_ROOT + '/'))) await verifyControllerEnrollment()
  // These ciphertexts belong to the original environment key restored above.
  // This also makes an explicit rollback in a later process restore credentials.
  await writeBackupConfig({ ...journal.config, enabled: false, nextRunAt: null, testedRevision: null })
  await chown(statePath('inbox', 'config.json'), Number((await exec('/usr/bin/id', ['-u', 'incudal'])).stdout.trim()), gid)
  process.env.ENCRYPTION_KEY = parseEnv(await readFile(`${INSTALL}/.env`, 'utf8')).ENCRYPTION_KEY
  const held = await readJson<Record<string, unknown>>(holdPath())
  if (held) {
    const batchId = held.mode === 'rollback' && typeof held.batchId === 'string' ? held.batchId : journal.rollbackBatchId || randomUUID()
    if (batchId !== held.batchId) await installRecoveryOperator(batchId, journal.taskId, 'rollback')
    await chown(join(backupRoot(), 'recovery-operator.json'), 0, gid)
    await writeJson(holdPath(), { ...held, batchId, mode: 'rollback', snapshot: null }, 0o640)
  }
  journal.readyEnvironmentHash = await hashFile(`${INSTALL}/.env`)
  journal.stage = 'rollback_prepared'; await writeJson(join(directory, 'journal.json'), journal)
  if (manageService) {
    await service('start')
    await protectedHealth()
    journal.stage = 'rolled_back_review'; await writeJson(join(directory, 'journal.json'), journal)
  }
  return true
}

export async function runPlatformBackupTask(request: BackupTaskRequest): Promise<void> {
  ensure(process.platform === 'linux' && process.getuid?.() === 0, 'OSS_ROOT_HELPER_REQUIRED', 503)
  ensure(!existsSync(recoveryMappingPath()), 'OSS_RECOVERY_MAPPING_PENDING', 409)
  await recoverInterruptedActivation()
  const id = validateId(request.id); ensure(['backup', 'preview', 'restore', 'resume', 'rollback', 'gateway-map', 'gateway-helper'].includes(request.kind), 'OSS_TASK_INVALID')
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
  let resumeRestored = false
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
      const originalGateway=gatewayConfigured()?gatewayBaseline(await gatewayCommand()):null
      const dump = join(directory, 'database.dump'); await update('exporting')
      const database = await captureDatabaseBackup(dump, directory); const snapshotAt = database.snapshotAt
      await update('checking_database'); await verifyDatabaseBackup(dump, database.report, directory, id)
      const integrity = join(directory, 'database-integrity.json'); await writeJson(integrity, database.report)
      await verifyAssetSnapshot(sources, snapshot)
      const gatewayAssets: BackupSource[]=[]
      if(originalGateway) {
        assertGatewayBaseline(originalGateway,await gatewayCommand())
        const path=join(directory,'gateway-baseline.json');await writeJson(path,originalGateway)
        gatewayAssets.push({name:'gateway-baseline.json',path})
      }
      await update('encrypting'); const encrypted = join(directory, 'payload.enc')
      const archivedConfig = join(directory, 'backup-config.json'); await writeJson(archivedConfig, request.config)
      const backupSources = [{ name: 'database.dump', path: dump }, { name: 'database-globals.sql', path: database.globals }, { name: 'database-integrity.json', path: integrity }, { name: 'backup.config', path: archivedConfig }, ...snapshot, ...gatewayAssets]
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
      const source = await client.index(validateObjectPrefix(request.sourcePrefix))
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
      let gatewayEndpoint:string|undefined
      try {
        await update('checking_database'); await restoreDatabase(archive.files.get('database.dump')!, staging)
        if (archive.files.has('database-integrity.json')) {
          const expected = await readJson<DatabaseIntegrity>(archive.files.get('database-integrity.json')!); ensure(expected, 'OSS_DATABASE_INTEGRITY_INVALID')
          await verifyRestoredDatabase(staging, expected, directory, 'preview', archive.files.get('database.dump')!)
        }
        await update('checking_compatibility')
        compatibility = await verifyBackupCompatibility(archive.manifest, staging, directory)
        await archivedGatewayForSnapshot(archive.files,staging)
        const [endpoint]=await pgQuery<{value:string}>("SELECT value FROM system_configs WHERE key='onboarding_gateway_dns_endpoint'",[],staging)
        if(endpoint)gatewayEndpoint=stableGatewayEndpointText(readGatewayEndpointPlan(endpoint.value))
      } finally { await localDatabaseAdmin(`DROP DATABASE IF EXISTS ${quoteIdentifier(staging)} WITH (FORCE);`) }
      const plan: RestorePlan = { id, createdBy: request.createdBy, expiresAt: new Date(Date.now() + 15 * 60000).toISOString(), manifest: archive.manifest, prefix: source.prefix, files: [...archive.files], compatibility,gatewayEndpoint }
      await prepareFiles(plan, directory)
      await writeJson(join(directory, 'plan.json'), plan)
      result.preview = { version: plan.manifest.version, createdAt: plan.manifest.createdAt, files: plan.files.length, expiresAt: plan.expiresAt }
      result.objectPrefix = source.prefix; preserve = true; await update('preview_ready', 'success')
    } else if (request.kind === 'gateway-helper') {
      const batch=await activeRecoveryBatch()
      ensure(batch.id===request.recoveryBatchId && batch.operator_id===request.createdBy,'OSS_RECOVERY_CONTEXT_CHANGED',409)
      const {executeRecoveryHelper}=await import('./platform-recovery-helper.js')
      await update('updating_gateway_helper')
      await executeRecoveryHelper(batch.id,validateId(request.recoveryHelperId),id)
      await update('gateway_helper_updated','success')
    } else if (request.kind === 'gateway-map') {
      const batch = await activeRecoveryBatch()
      ensure(batch.mode === 'restore' && batch.id === request.recoveryBatchId && batch.operator_id === request.createdBy,
        'OSS_RECOVERY_CONTEXT_CHANGED',409)
      const source = await readFile(`${INSTALL}/.env`,'utf8')
      const {assertRecoveryMappingIntent}=await import('./platform-recovery-mapping-intent.js')
      await assertRecoveryMappingIntent(batch.id,validateId(request.recoveryMappingId),id,request.gatewayAddress || '',source)
      const checked = await inspectRecoveryMapping(source,request.gatewayAddress || '')
      const nodes = await pgQuery<{id:string;node_public_key:string;management_ip:string;deleted_at:Date|null}>(
        'SELECT id,node_public_key,management_ip,deleted_at FROM host_onboarding_nodes WHERE host_id IS NOT NULL')
      ensure(!checked.state.recovery || checked.state.recovery.peers.every(peer => nodes.some(node => node.id===peer.nodeId && node.node_public_key===peer.nodePublicKey &&
        node.management_ip===peer.managementIp && (!node.deleted_at || !peer.enabled))), 'OSS_RECOVERY_GATEWAY_IDENTITY_CHANGED',409)
      preserve = true
      // Mapping only changes B's destination address. It neither authorizes a
      // spare writer nor changes the remote gateway, host peers, DNS or keys.
      await writeFile(join(directory,'mapping-before.env'),source,{flag:'wx',mode:0o600})
      await writeFile(join(directory,'mapping-next.env'),checked.environment,{flag:'wx',mode:0o600})
      const mappingJournal: RecoveryMappingJournal = {version:1,batchId:batch.id,taskId:id,workerPid:process.pid,phase:'prepared',
        previousHash:await hashFile(join(directory,'mapping-before.env')),nextHash:await hashFile(join(directory,'mapping-next.env'))}
      await writeJson(recoveryMappingPath(),mappingJournal)
      await update('mapping_gateway')
      try {
        await service('stop')
        ensure((await activeRecoveryBatch()).id===batch.id && await readFile(`${INSTALL}/.env`,'utf8')===source,'OSS_RECOVERY_CONTEXT_CHANGED',409)
        await assertRecoveryMappingIntent(batch.id,validateId(request.recoveryMappingId),id,request.gatewayAddress || '',source)
        const repeated = await inspectRecoveryMapping(source,request.gatewayAddress || '')
        const mappingIdentity=(value:typeof checked.state)=>value.recovery ? recoveryGatewayIdentity(value) : gatewayBaseline(value)
        ensure(JSON.stringify(mappingIdentity(repeated.state)) === JSON.stringify(mappingIdentity(checked.state)),
          'OSS_RECOVERY_GATEWAY_CHANGED',409)
        await atomicFileCopy(join(directory,'mapping-next.env'),`${INSTALL}/.env`)
        await chmod(`${INSTALL}/.env`,0o640)
        const gid=Number((await exec('/usr/bin/id',['-g','incudal'])).stdout.trim())
        await chown(`${INSTALL}/.env`,0,gid)
        await pgQuery("UPDATE platform_recovery_hosts SET status='pending',attempts=0,next_attempt_at=NOW(),lease_token=NULL,lease_until=NULL WHERE batch_id=$1",[batch.id])
        await writeJson(recoveryMappingPath(),{...mappingJournal,phase:'committed'})
      } finally { await service('start'); await protectedHealth(true) }
      await update('gateway_mapped','success')
      await durableUnlink(recoveryMappingPath())
    } else if (request.kind === 'restore') {
      ensure(!recoveryHeld(), 'OSS_RECOVERY_HELD', 409)
      ensure(request.restorePolicy===undefined || request.restorePolicy==='snapshot-v1','OSS_TASK_INVALID')
      const previewId = validateId(request.previewId)
      ensure(request.confirmation === `RESTORE ${previewId}`, 'OSS_CONFIRMATION_REQUIRED')
      const plan = await readJson<RestorePlan>(join(taskDir(previewId), 'plan.json'), 4 * 1024 * 1024)
      ensure(plan && plan.createdBy === request.createdBy && Date.parse(plan.expiresAt) > Date.now(), 'OSS_PREVIEW_EXPIRED', 409)
      ensure(plan.compatibility, 'OSS_PREVIEW_EXPIRED', 409)
      // Consume before side effects. The authenticated package is root-private and immutable to the API user.
      await unlink(join(taskDir(previewId), 'plan.json'))
      const actions = await prepareFiles(plan, directory)
      const preparedGateway = actions.find(action => action.target === '/etc/wireguard/incudal-mgmt.conf')
      if (preparedGateway) await checkRestoredGatewayNetwork(await readFile(preparedGateway.source, 'utf8'))
      const files = new Map(plan.files), { database } = postgresConnection()
      const staging = `incudal_restore_${id.replace(/-/g, '')}`, rollback = `incudal_before_${id.replace(/-/g, '')}`
      await freeSpace((await databaseMetadata()).bytes + plan.manifest.databaseBytes * 2)
      await captureRecoveryOperator(request.createdBy, id)
      const operatorGid = Number((await exec('/usr/bin/id', ['-g', 'incudal'])).stdout.trim())
      await chown(join(backupRoot(), 'recovery-operator.json'), 0, operatorGid)
      const [original] = await pgQuery<{oid:number}>('SELECT oid::int FROM pg_database WHERE datname=current_database()')
      ensure(original?.oid, 'OSS_RECOVERY_DATABASE_IDENTITY_MISSING', 503)
      const journal: RestoreJournal = { version: 2, taskId: id, workerPid: process.pid, rollbackBatchId: randomUUID(),
        originalOid: original.oid, database, staging, rollback, stage: 'prepared', config: request.config, files: [],
        ...(request.restorePolicy==='snapshot-v1'?{snapshotAt:plan.manifest.createdAt}:{}) }
      // Persistent across application and database restarts; gate is created before stopping any writer.
      // Its rollback journal must be durable before the hold can become visible.
      preserve = true
      await writeJson(join(directory, 'journal.json'), journal)
      const savedGateway=await backupGatewayBaseline(files)
      await writeJson(holdPath(), { taskId: id, batchId: id, createdAt: new Date().toISOString(), reason: 'restore', mode: 'restore', autoResume:true,
        ...(request.restorePolicy?{restorePolicy:request.restorePolicy}:{}),
        ...(savedGateway?{gatewayBaseline:savedGateway}:{}),
        snapshot: { createdAt: plan.manifest.createdAt, version: plan.manifest.version } }, 0o640)
      await update('stopping'); await service('stop')
      if(journal.snapshotAt){journal.emptyTarget=await emptyRecoveryTarget();await writeJson(join(directory,'journal.json'),journal)}
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
      if(request.restorePolicy==='snapshot-v1' && preparedGateway){
        const gateway=await archivedGatewayForSnapshot(files,staging)
        ensure(gateway,'OSS_REQUIRED_ASSET_MISSING')
        const path=join(directory,'prepared-gateway.conf')
        await writeFile(path,gateway.config,{flag:'wx',mode:0o600});preparedGateway.source=path
        await writeJson(join(directory,'gateway-tombstones.json'),{version:1,removedNodeIds:gateway.removedNodeIds},0o600)
      }
      await installRecoveryOperator(id, id, 'restore', staging)
      await chown(join(backupRoot(), 'recovery-operator.json'), 0, operatorGid)
      // Expire every restored session and API credential. They may have been revoked since the snapshot.
      await pgQuery('DELETE FROM refresh_tokens', [], staging)
      await pgQuery('UPDATE public_api_tokens SET revoked_at=NOW() WHERE revoked_at IS NULL', [], staging)
      await pgQuery('UPDATE oauth_access_tokens SET revoked_at=NOW() WHERE revoked_at IS NULL', [], staging)
      await pgQuery('UPDATE oauth_refresh_tokens SET revoked_at=NOW() WHERE revoked_at IS NULL', [], staging)
      await pgQuery(`INSERT INTO token_invalidations (user_id, session_id, invalidated_at, created_at) SELECT id, '__USER_LEVEL__', EXTRACT(EPOCH FROM NOW())::integer, NOW() FROM users ON CONFLICT (user_id, session_id) DO UPDATE SET invalidated_at=EXCLUDED.invalidated_at`, [], staging)
      if(request.restorePolicy!=='snapshot-v1')await pgQuery("UPDATE checkout_orders SET status='recovery_review' WHERE status IN ('pending','paid','fulfilling','partial','refund_pending')", [], staging)
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
      await pgQuery("UPDATE hosts SET pool_cleanup=jsonb_set(pool_cleanup,'{recoverySupersededBy}',to_jsonb($1::text)) WHERE pool_cleanup->>'version'='1'", [id], staging)
      for (const [i, action] of actions.entries()) {
        const saved = existsSync(action.target) ? join(directory, `before-${i}`) : null
        if (saved) { await atomicFileCopy(action.target, saved); await chmod(saved, 0o600) }
        journal.files.push({ target: action.target, saved, mode: action.mode, ...(saved ? {savedHash:await hashFile(saved)} : {}) })
      }
      // Gateway setup changes local SSH authorization as a derived side effect.
      // Save it locally for rollback; never trust authorized_keys from an archive.
      if (files.has('gateway.conf')) {
        const target = '/root/.ssh/authorized_keys'
        if (existsSync(target)) ensure((await lstat(target)).isFile() && !(await lstat(target)).isSymbolicLink(), 'OSS_ASSET_SYMLINK')
        const saved = existsSync(target) ? join(directory, 'before-authorized-keys') : null
        if (saved) { await atomicFileCopy(target, saved); await chmod(saved, 0o600) }
        journal.files.push({ target, saved, mode: 0o600, ...(saved ? {savedHash:await hashFile(saved)} : {}) })
      }
      if (preparedGateway) await checkRestoredGatewayNetwork(await readFile(preparedGateway.source, 'utf8'))
      const [restored] = await pgQuery<{oid:number}>('SELECT oid::int FROM pg_database WHERE datname=current_database()', [], staging)
      ensure(restored?.oid, 'OSS_RECOVERY_DATABASE_IDENTITY_MISSING', 503)
      journal.restoredOid = restored.oid
      journal.stage = 'switching'; await writeJson(join(directory, 'journal.json'), journal)
      const q = quoteIdentifier
      // Keep each rename explicit; after a lost response the saved OIDs identify
      // which step committed without dropping either database.
      await localDatabaseAdmin(`ALTER DATABASE ${q(database)} WITH ALLOW_CONNECTIONS false;`)
      await localDatabaseAdmin(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${database.replace(/'/g, "''")}' AND pid<>pg_backend_pid();`)
      await localDatabaseAdmin(`ALTER DATABASE ${q(database)} RENAME TO ${q(rollback)};`)
      await localDatabaseAdmin(`ALTER DATABASE ${q(staging)} RENAME TO ${q(database)};`)
      journal.stage = 'database_switched'; await writeJson(join(directory, 'journal.json'), journal)
      const gid = Number((await exec('/usr/bin/id', ['-g', 'incudal'])).stdout.trim())
      const gatewayBefore = files.has('gateway.conf') ? await readFile('/etc/wireguard/incudal-mgmt.conf', 'utf8').catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return '';throw error}) : null
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
      journal.readyEnvironmentHash = await hashFile(`${INSTALL}/.env`)
      journal.stage = 'protected_start'; await writeJson(join(directory, 'journal.json'), journal)
      await update('protected_start'); await service('start'); await protectedHealth()
      await completeRestoredSnapshot(journal)
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
      const savedHold = await readJson<RecoveryActivation['hold']>(holdPath())
      ensure(savedHold && savedHold.batchId === request.recoveryBatchId, 'OSS_RECOVERY_CONTEXT_CHANGED', 409)
      const operator = await readJson<{ actorId: number; synthetic: boolean }>(join(backupRoot(), 'recovery-operator.json'))
      let activation: RecoveryActivation | undefined
      preserve = true
      await resumeReviewedRecovery({
        check: async phase => {
          await assertRecoveryReady(request.recoveryBatchId); await assertCurrentRecoveryGateway()
          if (phase === 'protected') await verifyCurrentRecoveryHosts(request.recoveryBatchId!)
          else await assertFinalRecoveryHosts(request.recoveryBatchId!)
          await assertRecoveryReady(request.recoveryBatchId)
        },
        stop: () => service('stop'), start: () => service('start'), health: protectedHealth,
        restoreHold: () => writeJson(holdPath(), savedHold, 0o640), removeHold: () => durableUnlink(holdPath()),
        commit: async () => {
          ensure(activation, 'OSS_RECOVERY_STATE_INVALID')
          await assertCurrentRecoveryGateway()
          await pgQuery('UPDATE platform_recovery_batches SET completed_at=NOW() WHERE id=$1', [request.recoveryBatchId])
          const committed = { ...activation, phase: 'committed' as const }
          await writeJson(recoveryActivationPath(), committed, 0o640)
          activation = committed
        },
        committed: async () => (await readJson<RecoveryActivation>(recoveryActivationPath()))?.phase === 'committed',
        finish: async () => {
          if (savedHold.restorePolicy === 'snapshot-v1') {
            await update('waiting_agent_heartbeats')
            await waitForRestoredAgentHeartbeats(request.recoveryBatchId!)
          }
          await update('resumed', 'success'); await durableUnlink(recoveryActivationPath())
        },
        release: async () => pgRecoveryTransaction(async query => {
          await assertRecoveryReady(request.recoveryBatchId, query)
          const before: RecoveryActivation['before'] = {
            hosts: await query('SELECT id,pool_faulted,cpu_used,memory_used,disk_used,nat_ports_used_count FROM hosts ORDER BY id FOR UPDATE'),
            operator: operator?.synthetic ? await query('SELECT id,role,status FROM users WHERE id=$1 FOR UPDATE', [operator.actorId]) : [] }
          activation = { version: 1, taskId: request.id, batchId: request.recoveryBatchId!, workerPid: process.pid, phase: 'prepared', hold: savedHold, before }
          await writeJson(recoveryActivationPath(), activation, 0o640)
          await writeJson(join(directory, 'resume-before.json'), before)
          await query(`UPDATE hosts h SET pool_faulted=false,
            cpu_used=CASE WHEN r.result->'pool'->>'mode'='empty' THEN 0 ELSE h.cpu_used END,
            memory_used=CASE WHEN r.result->'pool'->>'mode'='empty' THEN 0 ELSE h.memory_used END,
            disk_used=CASE WHEN r.result->'pool'->>'mode'='empty' THEN 0 ELSE h.disk_used END,
            nat_ports_used_count=CASE WHEN r.result->'pool'->>'mode'='empty' THEN 0 ELSE h.nat_ports_used_count END
            FROM platform_recovery_hosts r WHERE r.batch_id=$1 AND r.host_id=h.id AND r.status='success'
            AND (h.pool_cleanup IS NULL OR h.pool_cleanup->>'version'='1')
            AND r.result->'pool'->>'canRecover'='true' AND r.result->'pool'->>'needsCleanup'='false'`, [request.recoveryBatchId])
          if (operator?.synthetic) await query("UPDATE users SET role='user',status='banned' WHERE id=$1", [operator.actorId])
        }),
        restore: async () => { if (activation) { await restoreActivation(activation); resumeRestored = true } }
      })
    }
  } catch (error) {
    if (request.kind === 'gateway-map') {
      const mapping = await readJson<RecoveryMappingJournal>(recoveryMappingPath())
      if (mapping?.taskId === id) {
        try {
          if (mapping.phase === 'prepared') {
            await service('stop')
            await recoverInterruptedMapping(false,id)
          }
          await service('start'); await protectedHealth(true)
          if (mapping.phase === 'committed') { await recoverInterruptedMapping(true,id); return }
        } catch { /* Keep WAL and hold for the startup recovery hook. */ }
      }
    }
    const helperError = ['gateway-helper','gateway-map'].includes(request.kind) ? recoveryHelperErrorCode(error) : null
    result.error = helperError && helperError !== 'OSS_RECOVERY_HELPER_FAILED' && !(error instanceof BackupError)
      ? helperError : sanitizedOssError(error).code
    if (request.kind === 'restore' && !preserve && !recoveryHeld() && !existsSync(join(directory, 'journal.json'))) result.restoreNotStarted = true
    let rolledBack = false
    if (request.kind === 'restore' && recoveryHeld()) {
      try {
        const currentJournal = await readJson<RestoreJournal>(join(directory, 'journal.json'), 4 * 1024 * 1024)
        // Once files, identity and OSS config are ready, service failure only
        // needs a protected restart; do not discard the recovered database.
        if (currentJournal && !['protected_start','awaiting_review'].includes(currentJournal.stage)) rolledBack = await rollbackJournal(directory)
      } catch { /* Preserve all recovery evidence and keep business blocked. */ }
    }
    await update(request.kind === 'gateway-helper' ? 'gateway_helper_failed' : rolledBack ? 'rolled_back' : recoveryHeld() ? 'manual_recovery_required' : 'failed', 'failed')
    if(rolledBack)await finishEmptyRecoveryRollback(directory)
    // The prepared WAL remains recoverable until the failure receipt is durable.
    // A failed receipt write must not strand a restored hold without its journal.
    if (resumeRestored) await durableUnlink(recoveryActivationPath())
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

export async function prepareInterruptedRestoreRollback(directory: string) {
  ensure(await rollbackJournal(directory, false), 'OSS_RECOVERY_RESTORE_JOURNAL_MISSING', 503)
}

export async function completeRestoredSnapshot(journal:RestoreJournal) {
  if(!journal.snapshotAt)return
  const hold=await readJson<{taskId:string;mode:string;restorePolicy:string}>(holdPath())
  ensure(hold?.taskId===journal.taskId && hold.mode==='restore' && hold.restorePolicy==='snapshot-v1', 'OSS_RECOVERY_CONTEXT_CHANGED',409)
  if(existsSync(statePath('results',`snapshot-${journal.taskId}.json`))){
    await restoredSnapshot(journal.taskId,journal.snapshotAt)
    return
  }
  // This root process predates the .env replacement; use the same restored
  // management settings the restarted backend will load.
  const restoredEnv=parseEnv(await readFile(`${INSTALL}/.env`,'utf8'))
  for(const key of Object.keys({...process.env,...restoredEnv}))if(/^(ONBOARDING_|GATEWAY_|ENCRYPTION_KEY$)/.test(key)) {
    if(restoredEnv[key]===undefined)delete process.env[key];else process.env[key]=restoredEnv[key]
  }
  await reconcileRestoredDeliveries(journal.taskId)
  await saveRestoredSnapshot(journal.taskId,journal.snapshotAt,journal.database)
}

async function emptyRecoveryTarget() {
  const [row]=await pgQuery<{empty:boolean}>(`SELECT NOT EXISTS(SELECT 1 FROM hosts) AND NOT EXISTS(SELECT 1 FROM instances)
    AND NOT EXISTS(SELECT 1 FROM pool_orders) AND NOT EXISTS(SELECT 1 FROM checkout_orders)
    AND NOT EXISTS(SELECT 1 FROM recharge_records) AND NOT EXISTS(SELECT 1 FROM balance_logs)
    AND NOT EXISTS(SELECT 1 FROM instance_billing_records) AS empty`)
  return row?.empty===true
}

// A failed import on a verified empty B has no restored customers to reconcile.
// Only root can issue this proof; an API timeout or a reused DB name cannot.
export async function finishEmptyRecoveryRollback(directory:string) {
  const journal=await readJson<RestoreJournal>(join(directory,'journal.json'),4*1024*1024)
  if(!journal?.snapshotAt || !journal.emptyTarget || journal.stage!=='rolled_back_review')return
  validateRestoreJournal(journal,directory)
  const hold=await readJson<{taskId:string;batchId:string;mode:string}>(holdPath())
  ensure(hold?.taskId===journal.taskId && hold.mode==='rollback' && hold.batchId===journal.rollbackBatchId,'OSS_RECOVERY_CONTEXT_CHANGED',503)
  await assertRestoreStartIdentity(journal,'rollback')
  ensure(await emptyRecoveryTarget(),'OSS_RECOVERY_CONTEXT_CHANGED',503)
  await protectedHealth(true)
  const result=await readJson<BackupTaskResult>(statePath('results',`${journal.taskId}.json`))
  ensure(result?.id===journal.taskId && result.kind==='restore','OSS_RECOVERY_STATE_INVALID',503)
  const completed=await pgQuery<{id:string}>('UPDATE platform_recovery_batches SET completed_at=COALESCE(completed_at,NOW()) WHERE id=$1 AND hold_task_id=$2 AND mode=\'rollback\' RETURNING id',[hold.batchId,journal.taskId])
  ensure(completed.length===1 && completed[0].id===hold.batchId,'OSS_RECOVERY_CONTEXT_CHANGED',503)
  await writeJson(statePath('results',`${journal.taskId}.json`),{...result,status:'failed',stage:'rolled_back',rollbackVerified:true,
    error:result.error||'OSS_RESTORE_INTERRUPTED_ROLLED_BACK',updatedAt:new Date().toISOString()},0o640)
  await durableUnlink(holdPath())
}

export async function readWorkerRequest(id: string) {
  const path = statePath('inbox', `${validateId(id)}.json`)
  const request = await readJson<BackupTaskRequest>(path)
  ensure(request?.id === id, 'OSS_TASK_INVALID')
  ensure(!existsSync(statePath('results',`${id}.json`)), 'OSS_TASK_ID_CONFLICT',409)
  // Receipt precedes consumption. A crash here is observable and never looks
  // like a request that was not dispatched at all.
  const receipt:BackupTaskResult={id,kind:request.kind,createdAt:request.createdAt,updatedAt:new Date().toISOString(),status:'pending',stage:'accepted',
    ...(request.kind==='restore'?{restoreNotStarted:true}:{})}
  await writeJson(statePath('results',`${id}.json`),receipt,0o640)
  await unlink(path)
  return request
}
