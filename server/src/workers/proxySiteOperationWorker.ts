import { reconcilePendingProxySiteOperations } from '../db/proxy-site-operations.js'
import { createWorkerDbBackoff } from './db-failure-backoff.js'

let timer: ReturnType<typeof setInterval> | null = null
let running: Promise<void> | null = null
const backoff = createWorkerDbBackoff('ProxySiteOperationWorker')

function tick(): Promise<void> {
  if (running) return running
  if (backoff.shouldSkip()) return Promise.resolve()
  running = reconcilePendingProxySiteOperations().then(() => {}).catch(error => {
    backoff.arm(error)
    console.error('[ProxySiteOperationWorker] Persistent site reconciliation failed:', error instanceof Error ? error.message : String(error))
  }).finally(() => { running = null })
  return running
}

export function startProxySiteOperationWorker(): void {
  if (timer) return
  timer = setInterval(() => { void tick() }, 5000)
  void tick()
}

export async function stopProxySiteOperationWorker(): Promise<void> {
  if (timer) clearInterval(timer)
  timer = null
  await running
}
