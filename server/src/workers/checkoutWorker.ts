import { processCheckoutQueue } from '../services/checkout-orders.js'
import { reconcileCheckoutPayments } from '../services/checkout-payments.js'
let timer: ReturnType<typeof setTimeout> | undefined
let running: Promise<void> | undefined
let reconciling: Promise<void> | undefined
let stopped = true
export function startCheckoutWorker() {
  if (!stopped) return
  stopped = false
  const tick = () => {
    if (!reconciling) reconciling = reconcileCheckoutPayments().catch(() => console.warn('[Checkout] Payment query will retry')).finally(() => { reconciling = undefined })
    running = processCheckoutQueue().catch(() => console.warn('[Checkout] Queue will retry')).finally(() => {
      running = undefined
      if (!stopped) { timer = setTimeout(tick, 3000); timer.unref() }
    })
  }
  timer = setTimeout(tick, 1000); timer.unref()
}
export async function stopCheckoutWorker() { stopped = true; clearTimeout(timer); await Promise.all([running, reconciling]) }
