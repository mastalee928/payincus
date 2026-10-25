import { BackupError } from './platform-backup-core.js'

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
      const value = await response.json() as { recoveryHeld?: boolean }
      if (response.ok && value.recoveryHeld === expectedHeld) return
    } catch { /* wait for the same backend and the exact requested protection state */ }
    const remaining = deadline - runtime.now()
    if (remaining > 0) await runtime.sleep(Math.min(1000, remaining))
  }
  throw new BackupError('OSS_PROTECTED_START_FAILED', 503)
}
