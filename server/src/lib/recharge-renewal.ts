// Post-commit wakeup only. The five-minute database scan is the durable fallback
// if the backend stops between credit settlement and this in-process signal.
let consumer: ((userId: number) => Promise<void>) | undefined
export function registerRechargeRenewalConsumer(next: (userId: number) => Promise<void>): void {
  consumer = next
}
export function notifyRechargeCredited(userId: number): void {
  if (!Number.isSafeInteger(userId) || userId < 1 || !consumer) return
  try {
    void consumer(userId).catch(() => console.error('[Billing] Recharge renewal wakeup failed; next patrol will retry'))
  } catch {
    console.error('[Billing] Recharge renewal wakeup failed; next patrol will retry')
  }
}
