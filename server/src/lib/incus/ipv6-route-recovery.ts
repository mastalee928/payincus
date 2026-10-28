import type { IncusClient } from './incus-client.js'
import { getInstance, startInstance, updateInstance } from './incus-instances.js'

/** Recover a stale routed eth1 while restoring the exact original device on every exit. */
export async function recoverIpv6RouteAndStart(client: IncusClient, name: string, initialError: unknown): Promise<boolean> {
  if (!(initialError instanceof Error) || !/file exists/i.test(initialError.message)) return false
  const original = (await getInstance(client, name)).devices
  if (original?.eth1?.nictype !== 'routed') return false
  const devices = { ...original, eth1: { ...original.eth1 } }
  const withoutEth1: Record<string, Record<string, unknown>> = { ...devices }
  delete withoutEth1.eth1
  let failure: unknown
  try {
    await updateInstance(client, name, { devices: withoutEth1 })
    await startInstance(client, name)
    await new Promise(resolve => setTimeout(resolve, 3000))
  } catch (error) {
    failure = error
  }
  try {
    await updateInstance(client, name, { devices })
  } catch (restoreError) {
    const detail = restoreError instanceof Error ? restoreError.message : String(restoreError)
    throw new AggregateError(failure ? [failure, restoreError] : [restoreError], `Instance ${name}: failed to restore original IPv6 eth1 after route recovery: ${detail}`)
  }
  if (failure) throw failure
  return true
}
