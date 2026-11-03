import { readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { backupRoot, ensure, readJson, statePath, validateId, type BackupConfig } from './platform-backup-core.js'

export interface RestoreJournal {
  version?: 2; taskId: string; workerPid?: number; rollbackBatchId?: string
  database: string; staging: string; rollback: string; originalOid?: number; restoredOid?: number
  readyEnvironmentHash?: string
  snapshotAt?: string
  emptyTarget?: boolean
  stage: string; config: BackupConfig
  files: Array<{ target: string; saved: string | null; mode: number; savedHash?: string }>
}
const stableStages = ['awaiting_review', 'rolled_back_review']
const startupStages = [...stableStages, 'protected_start', 'rollback_prepared']
const stages = ['prepared', 'switching', 'database_switched', 'files_switched', 'rolling_back', ...startupStages]
export function validateRestoreJournal(record: RestoreJournal, directory: string) {
  validateId(record?.taskId)
  ensure(resolve(directory) === resolve(statePath('private', record.taskId)), 'OSS_RECOVERY_CONTEXT_CHANGED', 503)
  ensure(stages.includes(record.stage) && typeof record.database === 'string' && record.database.length > 0 &&
    record.database.length <= 63 && !/[\x00-\x1f]/.test(record.database) &&
    record.staging === `incudal_restore_${record.taskId.replace(/-/g, '')}` &&
    record.rollback === `incudal_before_${record.taskId.replace(/-/g, '')}` &&
    ![record.staging, record.rollback, `incudal_failed_${record.taskId.replace(/-/g, '')}`].includes(record.database), 'OSS_RECOVERY_STATE_INVALID', 503)
  if (record.version !== undefined) {
    ensure(record.version === 2 && Number.isSafeInteger(record.workerPid) && record.workerPid! > 1 &&
      Number.isSafeInteger(record.originalOid) && record.originalOid! > 0 &&
      (record.restoredOid === undefined || Number.isSafeInteger(record.restoredOid) && record.restoredOid > 0), 'OSS_RECOVERY_STATE_INVALID', 503)
    validateId(record.rollbackBatchId)
    if (startupStages.includes(record.stage)) ensure(/^[a-f0-9]{64}$/.test(record.readyEnvironmentHash || ''), 'OSS_RECOVERY_STATE_INVALID', 503)
  }
  ensure(record.snapshotAt===undefined || Number.isFinite(Date.parse(record.snapshotAt)), 'OSS_RECOVERY_STATE_INVALID',503)
  ensure(record.emptyTarget===undefined || typeof record.emptyTarget==='boolean', 'OSS_RECOVERY_STATE_INVALID',503)
  ensure(Array.isArray(record.files) && record.files.length <= 20000, 'OSS_RECOVERY_STATE_INVALID', 503)
  const targets = new Set<string>()
  for (const file of record.files) {
    const allowed = ['/opt/incudal/.env', '/etc/wireguard/incudal-mgmt.conf', '/root/.ssh/incudal-host-management',
      '/root/.ssh/incudal-host-management.pub', '/root/.ssh/authorized_keys'].includes(file.target) ||
      /^\/opt\/incudal\/server\/certs\/[A-Za-z0-9_.-]+$/.test(file.target) ||
      /^\/var\/lib\/incudal-onboarding\/[A-Za-z0-9_.-]+$/.test(file.target) ||
      /^\/var\/lib\/incudal-gateway-controller\/(signing.pem|identity.json|enrollment.json)$/.test(file.target)
    ensure(allowed && !targets.has(file.target) && [0o600, 0o640].includes(file.mode) &&
      (file.saved === null || typeof file.saved === 'string' && resolve(dirname(file.saved)) === resolve(directory) &&
        /^before-(\d+|authorized-keys)$/.test(file.saved.split(/[\\/]/).at(-1)!)), 'OSS_RECOVERY_STATE_INVALID', 503)
    targets.add(file.target)
    ensure(file.savedHash===undefined || file.saved!==null && /^[a-f0-9]{64}$/.test(file.savedHash), 'OSS_RECOVERY_STATE_INVALID',503)
  }
}
export function interruptedRestoreAction(record: RestoreJournal) {
  if (stableStages.includes(record.stage)) return 'none'
  // Older journals have no database OID evidence. Do not infer which database
  // can be renamed solely from a reused name after a crash.
  ensure(record.version === 2, 'OSS_RECOVERY_DATABASE_IDENTITY_MISSING', 503)
  return startupStages.includes(record.stage) ? 'start' : 'rollback'
}
export async function readHeldRestoreJournal() {
  const hold = await readJson<{taskId: string; batchId: string; mode?: string}>(join(backupRoot(), 'recovery-hold.json'))
  if (!hold) return null
  validateId(hold.taskId); validateId(hold.batchId)
  const directory = statePath('private', hold.taskId)
  const journal = await readJson<RestoreJournal>(join(directory, 'journal.json'), 4 * 1024 * 1024)
  ensure(journal && journal.taskId === hold.taskId, 'OSS_RECOVERY_RESTORE_JOURNAL_MISSING', 503)
  validateRestoreJournal(journal, directory)
  ensure(!journal.version || [journal.taskId, journal.rollbackBatchId].includes(hold.batchId), 'OSS_RECOVERY_CONTEXT_CHANGED', 503)
  return { hold, journal, directory }
}
export async function assertRestoreStartupSafe() {
  const record = await readHeldRestoreJournal()
  if (!record) return
  if (stableStages.includes(record.journal.stage)) return
  if (startupStages.includes(record.journal.stage)) {
    await assertRestoreStartIdentity(record.journal, record.hold.mode)
    // The held backend serves recovery progress while original hosts reconnect.
    // Receipt completion gates business activation, not this protected startup.
    return
  }
  // Never call systemctl recursively from ExecStartPre. The independent root
  // supervisor owns database/file repair; this hook merely blocks mixed state.
  ensure(false, 'OSS_RECOVERY_RESTORE_INCOMPLETE', 503)
}
export async function assertRestoreStartIdentity(record: RestoreJournal, mode?: string) {
  if (record.version !== 2) return // Legacy completed restores predate the OID journal.
  const { hashFile } = await import('./platform-backup-archive.js')
  ensure(await hashFile('/opt/incudal/.env') === record.readyEnvironmentHash, 'OSS_RECOVERY_MAPPING_FILES_CHANGED', 503)
  const {pgQuery,postgresConnection} = await import('./platform-backup-database.js')
  ensure(postgresConnection().database === record.database, 'OSS_RECOVERY_DATABASE_IDENTITY_CHANGED', 503)
  const [current] = await pgQuery<{oid:number}>('SELECT oid::int FROM pg_database WHERE datname=current_database()')
  ensure(current?.oid === (mode === 'rollback' ? record.originalOid : record.restoredOid), 'OSS_RECOVERY_DATABASE_IDENTITY_CHANGED', 503)
}
export async function restoreWorkerAlive(record: RestoreJournal) {
  if (!record.workerPid || process.platform !== 'linux') return false
  const args = (await readFile(`/proc/${record.workerPid}/cmdline`, 'utf8').catch(() => '')).split('\0')
  return args.some(arg => arg.endsWith('/run-platform-backup-task.js')) && args.includes(record.taskId)
}

// Plan from immutable PG OIDs, then execute one rename at a time. A crash after
// either rename is recognizable on the next pass without dropping any database.
export function rollbackDatabasePlan(record: RestoreJournal, databases: Array<{name: string; oid: number}>) {
  const catalog = new Map(databases.map(row => [row.name, row.oid]))
  const failed = `incudal_failed_${record.taskId.replace(/-/g, '')}`
  const current = catalog.get(record.database), original = catalog.get(record.rollback)
  const plan: Array<{from: string; to: string}> = []
  if (record.version === 2) {
    ensure(original === undefined || original === record.originalOid, 'OSS_RECOVERY_DATABASE_IDENTITY_CHANGED', 503)
    ensure(catalog.get(failed) === undefined || catalog.get(failed) === record.restoredOid, 'OSS_RECOVERY_DATABASE_IDENTITY_CHANGED', 503)
    if (original !== undefined) {
      ensure(current === undefined || current === record.restoredOid, 'OSS_RECOVERY_DATABASE_IDENTITY_CHANGED', 503)
    } else ensure(current === record.originalOid, 'OSS_RECOVERY_DATABASE_IDENTITY_CHANGED', 503)
  }
  if (original !== undefined) {
    if (current !== undefined) {
      ensure(!catalog.has(failed), 'OSS_RECOVERY_DATABASE_IDENTITY_CHANGED', 503)
      plan.push({ from: record.database, to: failed })
    }
    plan.push({ from: record.rollback, to: record.database })
  }
  return plan
}
