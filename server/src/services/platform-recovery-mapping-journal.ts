import { readFile, chmod, chown } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { backupRoot, ensure, readJson, writeJson, statePath, validateId } from './platform-backup-core.js'
import { atomicFileCopy, hashFile } from './platform-backup-archive.js'
import { activeRecoveryBatch } from './platform-recovery-state.js'
import { pgQuery } from './platform-backup-database.js'
import { durableUnlink } from './platform-recovery-activation.js'
import { waitForProtectedBackendHealth } from './platform-backup-health.js'

export interface RecoveryMappingJournal {
  version: 1; taskId: string; batchId: string; workerPid: number
  phase: 'prepared' | 'committed'; previousHash: string; nextHash: string
}
export const recoveryMappingPath = () => join(backupRoot(), 'recovery-mapping.json')
export function validateRecoveryMappingJournal(record: RecoveryMappingJournal) {
  ensure(record?.version === 1 && ['prepared','committed'].includes(record.phase) &&
    Number.isSafeInteger(record.workerPid) && record.workerPid > 1 &&
    /^[a-f0-9]{64}$/.test(record.previousHash) && /^[a-f0-9]{64}$/.test(record.nextHash), 'OSS_RECOVERY_STATE_INVALID', 503)
  validateId(record.taskId); validateId(record.batchId)
}
export interface RecoveryMappingRuntime {
  activeBatch: () => Promise<string>; currentHash: () => Promise<string>
  savedHash: (name: 'before' | 'next') => Promise<string>
  restore: () => Promise<void>; invalidate: () => Promise<void>; health: () => Promise<void>
  receipt: (committed: boolean) => Promise<void>; remove: () => Promise<void>
}
// Execute only while the backend is stopped (prepared), or after its protected
// start (committed). Never replace an env modified by another operation.
export async function recoverMappingJournal(record: RecoveryMappingJournal, ready: boolean, runtime: RecoveryMappingRuntime) {
  validateRecoveryMappingJournal(record)
  ensure(await runtime.activeBatch() === record.batchId, 'OSS_RECOVERY_CONTEXT_CHANGED', 503)
  ensure(await runtime.savedHash('before') === record.previousHash && await runtime.savedHash('next') === record.nextHash,
    'OSS_RECOVERY_MAPPING_FILES_CHANGED', 503)
  const current = await runtime.currentHash()
  ensure(record.phase === 'committed' ? current === record.nextHash : [record.previousHash,record.nextHash].includes(current),
    'OSS_RECOVERY_MAPPING_FILES_CHANGED', 503)
  if (record.phase === 'prepared') {
    await runtime.restore()
    await runtime.invalidate()
  } else {
    if (!ready) return
    await runtime.health()
  }
  // A failed receipt leaves the WAL available for the next startup.
  await runtime.receipt(record.phase === 'committed')
  await runtime.remove()
}
export async function recoverInterruptedMapping(ready = false, ownedTaskId?: string) {
  const record = await readJson<RecoveryMappingJournal>(recoveryMappingPath())
  if (!record) return
  validateRecoveryMappingJournal(record)
  if (process.platform === 'linux' && ownedTaskId !== record.taskId) {
    const args = (await readFile(`/proc/${record.workerPid}/cmdline`, 'utf8').catch(() => '')).split('\0')
    if (args.some(arg => arg.endsWith('/run-platform-backup-task.js')) && args.includes(record.taskId)) return
  }
  const directory = statePath('private', record.taskId), target = '/opt/incudal/.env'
  await recoverMappingJournal(record, ready, {
    activeBatch: async () => (await activeRecoveryBatch()).id,
    currentHash: () => hashFile(target), savedHash: name => hashFile(join(directory, `mapping-${name}.env`)),
    restore: async () => {
      await atomicFileCopy(join(directory,'mapping-before.env'),target)
      await chmod(target,0o640)
      const result = await promisify(execFile)('/usr/bin/id',['-g','incudal'],{timeout:10000})
      await chown(target,0,Number(result.stdout.trim()))
    },
    invalidate: async () => { await pgQuery(`UPDATE platform_recovery_hosts SET status='pending',attempts=0,next_attempt_at=NOW(),
      lease_token=NULL,lease_until=NULL WHERE batch_id=$1`,[record.batchId]) },
    health: () => waitForProtectedBackendHealth(true),
    receipt: async committed => {
      const path = statePath('results',`${record.taskId}.json`), result = await readJson<Record<string,unknown>>(path)
      ensure(result, 'OSS_RECOVERY_STATE_INVALID',503)
      await writeJson(path,{...result,stage:committed?'gateway_mapped':'awaiting_review',status:committed?'success':'failed',
        error:committed?undefined:'OSS_RECOVERY_MAPPING_INTERRUPTED',updatedAt:new Date().toISOString()},0o640)
    },
    remove: () => durableUnlink(recoveryMappingPath())
  })
}
