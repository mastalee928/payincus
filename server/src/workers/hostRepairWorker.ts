import { repairHostManagementQueue } from '../services/host-management-repair.js'
import { recoverFailedReplacementSources } from '../services/host-replacement-recovery.js'
import { recoveryHeld } from '../services/platform-backup-core.js'
import { processInstanceDeletionQueue } from '../services/instance-deletion.js'

let timer: ReturnType<typeof setTimeout> | undefined
let running: Promise<void> | undefined
let stopped = true
export function startHostRepairWorker() {
  if (!stopped) return
  stopped = false
  const tick = () => {
    running = (async () => {
      if (recoveryHeld()) return
      // Each scan is bounded. A broken management channel cannot starve an
      // already accepted deletion, and one scan failure cannot skip the rest.
      for (const scan of [processInstanceDeletionQueue, repairHostManagementQueue, recoverFailedReplacementSources]) {
        if (recoveryHeld() || stopped) return
        try { await scan() } catch { console.warn('[HostRepair] Scan failed; other queues continue and this scan will retry') }
      }
    })().catch(() => console.warn('[HostRepair] Repair scan will retry')).finally(() => {
      running = undefined
      if (!stopped) { timer = setTimeout(tick, 30000); timer.unref() }
    })
  }
  timer = setTimeout(tick, 10000); timer.unref()
}
export async function stopHostRepairWorker() { stopped = true; clearTimeout(timer); await running }
