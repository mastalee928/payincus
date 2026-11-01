import { IncusApiError, type IncusClient } from './incus-client.js'

/** A successful DELETE response alone is not proof that disk or networking is free. */
export async function verifyInstanceAbsent(client: Pick<IncusClient, 'request'>, name: string): Promise<void> {
  const path = `/1.0/instances/${encodeURIComponent(name)}`
  let absent = false
  try { await client.request('GET', path) }
  catch (error) {
    if (error instanceof IncusApiError && error.statusCode === 404 && error.path === path) absent = true
    else throw error
  }
  if (!absent) throw new Error('INCUS_DELETE_NOT_VERIFIED')
}
export async function verifyInstanceDeleted(original: Pick<IncusClient, 'request'>, name: string): Promise<void> {
  const signal = AbortSignal.timeout(30000)
  const client: Pick<IncusClient, 'request'> = { request<T>(method: string, path: string): Promise<T> {
    signal.throwIfAborted()
    return original.request<T>(method, path, null, 8000, signal)
  } }
  await verifyInstanceAbsent(client, name)
  const pools = await client.request<Array<{ name: string }>>('GET', '/1.0/storage-pools?recursion=1')
  if (!Array.isArray(pools)) throw new Error('INCUS_STORAGE_STATE_UNKNOWN')
  for (const pool of pools) {
    const volumes = await client.request<Array<{ name: string; type: string; project?: string }>>('GET',
      `/1.0/storage-pools/${encodeURIComponent(pool.name)}/volumes?recursion=1&all-projects=true`)
    if (!Array.isArray(volumes)) throw new Error('INCUS_STORAGE_STATE_UNKNOWN')
    if (volumes.some(volume => (volume.project || 'default') === 'default' &&
        ['container', 'virtual-machine'].includes(volume.type) && (volume.name === name || volume.name.startsWith(name + '/')))) {
      throw new Error('INCUS_DISK_DELETE_NOT_VERIFIED')
    }
  }
  const networks = await client.request<Array<{ name: string; managed: boolean; type: string }>>('GET', '/1.0/networks?recursion=1')
  if (!Array.isArray(networks)) throw new Error('INCUS_NETWORK_STATE_UNKNOWN')
  for (const network of networks.filter(row => row.managed && row.type === 'bridge')) {
    const forwards = await client.request<Array<{ description?: string }>>('GET', `/1.0/networks/${encodeURIComponent(network.name)}/forwards?recursion=1`)
    if (!Array.isArray(forwards) || forwards.some(row => row.description === `payincus-dedicated:${name}`)) throw new Error('INCUS_FORWARD_DELETE_NOT_VERIFIED')
  }
}
