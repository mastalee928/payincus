import { readFile, unlink, open } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { backupRoot, ensure, readJson, writeJson, statePath, validateId } from './platform-backup-core.js'
import { pgQuery, pgRecoveryTransaction } from './platform-backup-database.js'
import type { RecoveryQuery } from './platform-recovery-state.js'
import { waitForProtectedBackendHealth, waitForRestoredAgentHeartbeats } from './platform-backup-health.js'

export interface RecoveryActivation {
  version: 1; taskId: string; batchId: string; workerPid: number; phase: 'prepared' | 'committed'
  hold: { taskId: string; batchId: string; createdAt: string; mode?: string; restorePolicy?: 'snapshot-v1' }
  before: { hosts: Array<{ id: number; pool_faulted: boolean; cpu_used: number; memory_used: number; disk_used: number; nat_ports_used_count: number }>
    operator: Array<{ id: number; role: string; status: string }> }
}
export const recoveryActivationPath = () => join(backupRoot(), 'recovery-activation.json')
export function validateRecoveryActivation(record: RecoveryActivation) {
  ensure(record?.version === 1 && ['prepared','committed'].includes(record.phase), 'OSS_RECOVERY_STATE_INVALID', 503)
  validateId(record.taskId); validateId(record.batchId); validateId(record.hold?.taskId)
  ensure(record.hold?.batchId === record.batchId && ['restore','rollback'].includes(record.hold.mode || 'restore') &&
    Number.isFinite(Date.parse(record.hold.createdAt)) && Number.isSafeInteger(record.workerPid) && record.workerPid > 1 &&
    Array.isArray(record.before?.hosts) && Array.isArray(record.before?.operator), 'OSS_RECOVERY_STATE_INVALID', 503)
  const ids = new Set<number>()
  for (const row of record.before.hosts) {
    ensure(Number.isSafeInteger(row.id) && row.id > 0 && !ids.has(row.id) && typeof row.pool_faulted === 'boolean' &&
      [row.cpu_used,row.memory_used,row.disk_used,row.nat_ports_used_count].every(n => Number.isSafeInteger(n) && n >= 0), 'OSS_RECOVERY_STATE_INVALID', 503)
    ids.add(row.id)
  }
  ensure(record.before.operator.length <= 1 && record.before.operator.every(row => Number.isSafeInteger(row.id) && row.id > 0 &&
    row.role === 'admin' && row.status === 'active'), 'OSS_RECOVERY_STATE_INVALID', 503)
}
async function assertActivationContext(record: RecoveryActivation, query: RecoveryQuery = pgQuery) {
  validateRecoveryActivation(record)
  const hold = await readJson<RecoveryActivation['hold']>(join(backupRoot(), 'recovery-hold.json'))
  ensure(hold ? hold.taskId === record.hold.taskId && hold.batchId === record.batchId &&
    hold.createdAt === record.hold.createdAt && (hold.mode || 'restore') === (record.hold.mode || 'restore')
    : record.phase === 'committed', 'OSS_RECOVERY_CONTEXT_CHANGED', 503)
  const [batch] = await query<{ hold_task_id: string; mode: string; operator_id: number; completed_at: Date | null }>(
    'SELECT hold_task_id,mode,operator_id,completed_at FROM platform_recovery_batches WHERE id=$1', [record.batchId])
  ensure(batch && batch.hold_task_id === record.hold.taskId && batch.mode === (record.hold.mode || 'restore') &&
    (record.phase !== 'committed' || batch.completed_at) && record.before.operator.every(row => row.id === batch.operator_id), 'OSS_RECOVERY_CONTEXT_CHANGED', 503)
  const newer = await query('SELECT id FROM platform_recovery_batches WHERE created_at>(SELECT created_at FROM platform_recovery_batches WHERE id=$1) LIMIT 1', [record.batchId])
  ensure(!newer.length, 'OSS_RECOVERY_CONTEXT_CHANGED', 503)
}
export async function durableUnlink(path: string) {
  await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error })
  if (process.platform !== 'win32') {
    const directory = await open(dirname(path), 'r')
    try { await directory.sync() } finally { await directory.close() }
  }
}
export async function restoreActivation(record: RecoveryActivation) {
  await assertActivationContext(record)
  await writeJson(join(backupRoot(), 'recovery-hold.json'), record.hold, 0o640)
  await pgRecoveryTransaction(async query => {
    await assertActivationContext(record, query)
    for (const row of record.before.hosts) await query(`UPDATE hosts SET pool_faulted=$2,cpu_used=$3,memory_used=$4,disk_used=$5,nat_ports_used_count=$6 WHERE id=$1`,
      [row.id,row.pool_faulted,row.cpu_used,row.memory_used,row.disk_used,row.nat_ports_used_count])
    for (const row of record.before.operator) await query('UPDATE users SET role=$2,status=$3 WHERE id=$1',[row.id,row.role,row.status])
    await query('UPDATE platform_recovery_batches SET completed_at=NULL WHERE id=$1',[record.batchId])
  })
}
// Root ExecStartPre calls this before a backend can run business workers. A
// surviving resume worker owns its prepared phase; otherwise recover the WAL.
export async function recoverInterruptedActivation(backendReady = false, verifyHeartbeats = false) {
  const record = await readJson<RecoveryActivation>(recoveryActivationPath(), 16 * 1024 * 1024)
  if (!record) return
  await assertActivationContext(record)
  if (process.platform === 'linux') {
    const args = await readFile(`/proc/${record.workerPid}/cmdline`, 'utf8').catch(() => '')
    if (args.split('\0').some(arg => arg.endsWith('/run-platform-backup-task.js')) && args.split('\0').includes(record.taskId)) return
  }
  if (record.phase === 'prepared') await restoreActivation(record)
  else {
    // The commit is the durable authorization point. Reopening is idempotent;
    // never restore pre-release counters after business may have started.
    await durableUnlink(join(backupRoot(), 'recovery-hold.json'))
    // ExecStartPre cannot claim a successful backend start. Keep the committed
    // journal until ExecStartPost observes every business initializer ready.
    if (!backendReady) return
    await waitForProtectedBackendHealth(false)
    if (record.hold.restorePolicy === 'snapshot-v1') {
      // ExecStartPost must let systemd finish starting the backend. The separate
      // root supervisor owns waiting for remote hosts and the final receipt.
      if (!verifyHeartbeats) return
      await waitForRestoredAgentHeartbeats(record.batchId)
    }
  }
  const result = await readJson<Record<string,unknown>>(statePath('results', `${record.taskId}.json`))
  ensure(result, 'OSS_RECOVERY_STATE_INVALID', 503)
  await writeJson(statePath('results', `${record.taskId}.json`), { ...result,
    stage: record.phase === 'committed' ? 'resumed' : 'awaiting_review',
    status: record.phase === 'committed' ? 'success' : 'failed',
    error: record.phase === 'committed' ? undefined : 'OSS_RESUME_INTERRUPTED', updatedAt: new Date().toISOString() }, 0o640)
  // Keep the WAL until both DB recovery and the public receipt are durable.
  await durableUnlink(recoveryActivationPath())
}
