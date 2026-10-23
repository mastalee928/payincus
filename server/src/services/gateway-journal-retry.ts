import { GatewayTaskError } from '../lib/gateway-task-plan.js'

// Retry only an explicitly unacquired database lock. Never wrap SSH or a
// privileged operation: a lost response can hide a completed side effect.
export async function retryGatewayJournal<T>(work: () => Promise<T>, signal?: AbortSignal,
  delay: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 200))): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw new GatewayTaskError('GATEWAY_TASK_LEASE_LOST')
    try { return await work() }
    catch (error) {
      if (!(error instanceof GatewayTaskError) || error.code !== 'GATEWAY_TASK_JOURNAL_BUSY' || attempt >= 19) throw error
      await delay()
    }
  }
}
