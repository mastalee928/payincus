import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { ensure, nextScheduledTime, readBackupConfig, readJson, recoveryHeld, serializeBackupMutation, statePath, validateId, writeBackupConfig, writeJson, type BackupTaskKind, type BackupTaskRequest, type BackupTaskResult } from './platform-backup-core.js'

const exec = promisify(execFile)
export function backupRuntimeReady(): boolean {
  return process.platform === 'linux' && existsSync('/etc/systemd/system/incudal-platform-backup@.service') && existsSync('/usr/local/libexec/incudal/incudal-online-task')
}
export async function activeBackupTask(): Promise<BackupTaskResult | null> {
  const pending = await readJson<BackupTaskResult>(statePath('inbox', 'active.json'))
  if (!pending) return null
  validateId(pending.id)
  const result = await readJson<BackupTaskResult>(statePath('results', `${pending.id}.json`))
  if (result && ['success', 'warning', 'failed'].includes(result.status)) { await unlink(statePath('inbox', 'active.json')).catch(() => {}); return null }
  if (Date.now() - Date.parse(pending.createdAt) > 90000 && process.platform === 'linux') {
    const unit = `incudal-platform-backup@${pending.id}.service`
    const status = await exec('/usr/bin/systemctl', ['show', unit, '--property=ActiveState', '--value'], { timeout: 10000 }).catch(() => null)
    if (status && ['inactive', 'failed'].includes(status.stdout.trim())) {
      await unlink(statePath('inbox', `${pending.id}.json`)).catch(() => {})
      await writeJson(statePath('inbox', 'last-failure.json'), { ...pending, status: 'failed', stage: 'failed', error: 'OSS_WORKER_STOPPED', updatedAt: new Date().toISOString() })
      await unlink(statePath('inbox', 'active.json')); return null
    }
  }
  return result || pending
}
// Caller holds the single-backend mutation queue. Root workers also use a shared OS flock with OTA.
export async function enqueueBackupTask(kind: BackupTaskKind, createdBy: number, extras: Partial<Pick<BackupTaskRequest, 'sourcePrefix' | 'password' | 'previewId' | 'confirmation'>> = {}) {
  ensure(backupRuntimeReady(), 'OSS_RUNTIME_NOT_INSTALLED', 503)
  ensure(!await activeBackupTask(), 'OSS_TASK_BUSY', 409)
  ensure(kind === 'resume' || kind === 'rollback' || !recoveryHeld(), 'OSS_RECOVERY_HELD', 409)
  const config = await readBackupConfig(); ensure(config, 'OSS_CONFIG_REQUIRED', 409)
  if (kind === 'backup') ensure(config.testedRevision === config.revision, 'OSS_TEST_REQUIRED', 409)
  const id = randomUUID(), createdAt = new Date().toISOString()
  const request: BackupTaskRequest = { id, kind, createdBy, createdAt, config, ...extras }
  const pending: BackupTaskResult = { id, kind, createdAt, updatedAt: createdAt, status: 'pending', stage: 'queued' }
  await writeJson(statePath('inbox', `${id}.json`), request)
  await writeJson(statePath('inbox', 'active.json'), pending)
  try { await exec('sudo', ['-n', '/usr/local/libexec/incudal/systemctl', 'start', '--no-block', `incudal-platform-backup@${id}.service`], { timeout: 15000 }) }
  catch {
    // A dispatch timeout is ambiguous: systemd may already have started the job.
    // The reaper checks the unit before clearing the pending marker.
    ensure(false, 'OSS_WORKER_START_FAILED', 503)
  }
  return pending
}
let timer: ReturnType<typeof setInterval> | undefined
let ticking = false
export function startPlatformBackupScheduler() {
  if (timer) return
  const tick = async () => {
    if (ticking || !backupRuntimeReady() || recoveryHeld()) return
    ticking = true
    try {
      await serializeBackupMutation(async () => {
        const config = await readBackupConfig()
        if (!config?.enabled || !config.nextRunAt || Date.parse(config.nextRunAt) > Date.now() || await activeBackupTask()) return
        await enqueueBackupTask('backup', 0)
        config.nextRunAt = nextScheduledTime(config.nextRunAt, config.intervalHours)
        await writeBackupConfig(config)
      })
    } catch { console.warn('[PlatformBackup] Scheduler attempt failed; inspect backup configuration and runtime readiness.') }
    finally { ticking = false }
  }
  timer = setInterval(() => { void tick() }, 60000); timer.unref(); void tick()
}
export function stopPlatformBackupScheduler() { if (timer) clearInterval(timer); timer = undefined }
