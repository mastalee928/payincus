import { processSecurityHardeningQueue } from '../services/security-hardening-queue.js'

let timer: ReturnType<typeof setTimeout> | undefined
let running: Promise<void> | undefined
let stopped = true
export function startSecurityHardeningWorker() {
  if (!stopped) return
  stopped = false
  const tick = () => {
    running = processSecurityHardeningQueue(undefined, () => stopped).catch(() => {
      console.warn('[SecurityHardening] Queue pass incomplete; persisted targets will be checked again')
    }).finally(() => {
      running = undefined
      if (!stopped) { timer = setTimeout(tick, 10000); timer.unref() }
    })
  }
  timer = setTimeout(tick, 30000); timer.unref()
}
export async function stopSecurityHardeningWorker() { stopped = true; clearTimeout(timer); await running }
