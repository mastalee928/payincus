import { BackupError } from './platform-backup-core.js'
import { pgQuery } from './platform-backup-database.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

type ServiceCommand = (program: string, args: string[], options: {timeout:number}) => Promise<{stdout:string}>
export async function controlRecoveryBackend(action: 'stop' | 'start' | 'restart', execute: ServiceCommand = promisify(execFile)) {
  const command = (args: string[], timeout = 90000) => execute('/usr/bin/systemctl', args, {timeout})
  try { await command([action, 'incudal-backend.service']); return }
  catch { /* Distinguish systemd's rate limit from a real startup failure. */ }
  try {
    if (action === 'stop') throw new Error('stop failed')
    const result = await command(['show', 'incudal-backend.service', '--property=Result', '--value'], 10000)
    if (result.stdout.trim() !== 'start-limit-hit') throw new Error('startup failed')
    // Several authorized restore/rollback stages can consume the normal burst.
    // Reset only this exact refusal, once; a crashing service remains throttled.
    await command(['reset-failed', 'incudal-backend.service'], 10000)
    await command([action, 'incudal-backend.service'])
  } catch { throw new BackupError('OSS_BACKEND_SERVICE_FAILED', 503) }
}

interface HealthRuntime {
  fetch: typeof fetch
  now: () => number
  sleep: (milliseconds: number) => Promise<void>
}

export async function waitForProtectedBackendHealth(expectedHeld = true, runtime: HealthRuntime = {
  fetch: globalThis.fetch,
  now: Date.now,
  sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
}) {
  const deadline = runtime.now() + 90000
  while (runtime.now() < deadline) {
    try {
      const response = await runtime.fetch('http://127.0.0.1:3001/api/health', {
        signal: AbortSignal.timeout(Math.min(2000, deadline - runtime.now())), redirect: 'error'
      })
      const value = await response.json() as { recoveryHeld?: boolean; businessStartupReady?: boolean }
      if (response.ok && value.recoveryHeld === expectedHeld && (expectedHeld || value.businessStartupReady === true)) return
    } catch { /* wait for the same backend and the exact requested protection state */ }
    const remaining = deadline - runtime.now()
    if (remaining > 0) await runtime.sleep(Math.min(1000, remaining))
  }
  throw new BackupError('OSS_PROTECTED_START_FAILED', 503)
}

// Called only after the durable activation and business startup. Heartbeats
// remain paused while importing data; the archived online flag cannot pass this.
export async function waitForRestoredAgentHeartbeats(batchId: string, runtime = {
  query: pgQuery, now: Date.now,
  sleep: (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds))
}) {
  const deadline = runtime.now() + 90000
  while (runtime.now() < deadline) {
    const [row] = await runtime.query<{ pending: string; activated: boolean }>(`SELECT
      b.completed_at IS NOT NULL AS activated,
      (SELECT count(*)::text FROM host_agents a JOIN hosts h ON h.id=a.host_id
        WHERE a.enabled AND a.status<>'disabled' AND
          (a.last_seen_at IS NULL OR a.last_seen_at<b.completed_at OR a.last_seen_at<NOW()-INTERVAL '90 seconds')) AS pending
      FROM platform_recovery_batches b WHERE b.id=$1`, [batchId])
    if (row?.activated && row.pending === '0') return
    await runtime.sleep(Math.min(1000, Math.max(0, deadline-runtime.now())))
  }
  throw new BackupError('OSS_RECOVERY_AGENT_HEARTBEAT_PENDING', 503)
}
