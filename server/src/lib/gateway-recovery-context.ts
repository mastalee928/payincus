import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { backupRoot } from '../services/platform-backup-core.js'
import { GatewayTaskError } from './gateway-task-plan.js'

export function currentGatewayRecoveryContext(): string | null {
  const path = join(backupRoot(), 'recovery-hold.json')
  try {
    const info = lstatSync(path)
    const trustedOwner = info.uid === 0 || (process.env.NODE_ENV !== 'production' && info.uid === process.getuid?.())
    if (!info.isFile() || info.isSymbolicLink() || info.size > 8192 || info.nlink !== 1 ||
        (process.platform === 'linux' && (!trustedOwner || (info.mode & 0o022) !== 0))) throw new Error('invalid marker')
    const value = JSON.parse(readFileSync(path, 'utf8')) as { taskId?: string }
    if (typeof value.taskId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.taskId)) throw new Error('invalid marker')
    return value.taskId
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new GatewayTaskError('GATEWAY_RECOVERY_CONTEXT_INVALID')
  }
}

// Executed only against the authenticated staging database during restore.
// Text-status tasks are not covered by the older enum-based queue sweep.
export const QUARANTINE_RESTORED_GATEWAY_TASKS_SQL = `
UPDATE management_gateway_tasks AS t SET
  status = CASE
    WHEN t.status IN ('awaiting_confirmation','queued','running','needs_review') THEN
      CASE WHEN EXISTS (SELECT 1 FROM management_gateway_steps s WHERE s.task_id=t.id AND s.status<>'pending')
        THEN 'needs_review' ELSE 'failed' END
    ELSE t.status END,
  error_code = CASE WHEN t.status IN ('awaiting_confirmation','queued','running','needs_review')
    THEN 'GATEWAY_TASK_RESTORED_REVIEW' ELSE t.error_code END,
  preparation_state = CASE WHEN t.preparation_state IN ('queued','running') THEN 'failed' ELSE t.preparation_state END,
  lease_token=NULL, lease_until=NULL, credentials_encrypted=NULL, credentials_expire_at=NULL,
  bootstrap_encrypted=NULL, bootstrap_expires_at=NULL, approved_credential_hash=NULL, approved_session_id=NULL,
  completed_at = CASE WHEN t.status IN ('awaiting_confirmation','queued','running','needs_review') THEN
    CASE WHEN EXISTS (SELECT 1 FROM management_gateway_steps s WHERE s.task_id=t.id AND s.status<>'pending') THEN NULL ELSE (NOW() AT TIME ZONE 'UTC') END
    ELSE t.completed_at END,
  updated_at=(NOW() AT TIME ZONE 'UTC')`
