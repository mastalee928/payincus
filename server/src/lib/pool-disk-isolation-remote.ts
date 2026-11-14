import { IncusApiError, type IncusClient } from './incus/incus-client.js'
import { isolatedPoolConfiguration, isolatedPoolCreate, POOL_DISK_NAME } from './pool-disk-isolation.js'

type Pool = { driver: string; config: Record<string,string>; status?: string; used_by?: string[] }

/** Replace only the old managed loop pool after exact remote emptiness checks.
 * The caller owns the platform host/instance lock or current enrollment lease.
 */
export async function ensureIsolatedPool(client: Pick<IncusClient,'request'>, sizeGiB: number,
  registeredLegacy: boolean, beforeWrite: () => Promise<void>): Promise<Pool> {
  const path = `/1.0/storage-pools/${POOL_DISK_NAME}`
  const requested = isolatedPoolCreate(sizeGiB)
  let pool: Pool | null
  try { pool = await client.request<Pool>('GET', path, null, 5000) }
  catch (error) { if (!(error instanceof IncusApiError) || error.statusCode !== 404 || error.path !== path) throw error; pool = null }
  if (pool && isolatedPoolConfiguration(pool) && pool.status === 'Created') {
    return pool
  }
  const guests = await client.request<unknown>('GET', '/1.0/instances?recursion=1&all-projects=true', null, 5000)
  if (!Array.isArray(guests) || guests.length !== 0) throw Error('POOL_DISK_HAS_INSTANCES')
  const operations = await client.request<Record<string, Array<{ status?: string }>>>('GET', '/1.0/operations?recursion=1', null, 5000)
  if (!operations || typeof operations !== 'object' || Array.isArray(operations) ||
    Object.values(operations).some(rows => !Array.isArray(rows) || rows.some(op => !op || !['Success','Failure','Cancelled'].includes(op.status || '')))) throw Error('POOL_DISK_OPERATIONS_PENDING')
  if (pool) {
    const expectedSource = pool.config?.source === `/var/lib/incus/disks/${POOL_DISK_NAME}.img`
    const oldManaged = registeredLegacy && pool.driver === 'btrfs' && expectedSource
    const incomplete = isolatedPoolConfiguration(pool) && ['Errored','Pending'].includes(pool.status || '') &&
      pool.config?.['user.payincus.disk-isolation'] === 'lvm-btrfs-v1' &&
      (!pool.config.source || expectedSource)
    if ((!oldManaged && !incomplete) ||
      !Array.isArray(pool.used_by) || pool.used_by.some(p => !/^\/1\.0\/images\/[a-f0-9]+(?:\?|$)/.test(p))) throw Error('POOL_DISK_LEGACY_UNVERIFIED')
    const volumes = await client.request<Array<{ type?: string }>>('GET', `${path}/volumes?recursion=1&all-projects=true`, null, 5000)
    if (!Array.isArray(volumes) || volumes.some(v => v.type !== 'image')) throw Error('POOL_DISK_VOLUMES_RETAINED')
    await beforeWrite()
    await client.request('DELETE', path, null, 20000)
  }
  await beforeWrite()
  await client.request('POST', '/1.0/storage-pools', requested, 45000)
  const checked = await client.request<Pool>('GET', path, null, 5000)
  if (!isolatedPoolConfiguration(checked) || checked.status !== 'Created') throw Error('POOL_DISK_PREPARATION_UNCONFIRMED')
  return checked
}

/** Optimized image LVs share the customer's physical thin pool. Retain the
 * immutable image archives, but release only disposable optimized image LVs.
 * The caller serializes enrollment, creation/rebuild, or idle-host maintenance. */
export async function pruneIsolatedPoolImageVolumes(client: Pick<IncusClient, 'request'>, poolName: string,
  beforeWrite: () => Promise<void> = async () => {}): Promise<boolean> {
  if (poolName !== POOL_DISK_NAME) return false
  const path = `/1.0/storage-pools/${poolName}`
  const original = await client.request<Pool>('GET', path, null, 5000)
  if (!isolatedPoolConfiguration(original) || original.status !== 'Created' ||
    original.config['user.payincus.disk-isolation'] !== 'lvm-btrfs-v1') return false
  const idle = async () => {
    const operations = await client.request<unknown>('GET', '/1.0/operations?recursion=1', null, 5000)
    return !!operations && typeof operations === 'object' && !Array.isArray(operations) &&
      Object.values(operations).every(rows => Array.isArray(rows) && rows.every(op =>
        op && ['Success', 'Failure', 'Cancelled'].includes(op.status)))
  }
  if (!await idle()) return false
  const volumes = await client.request<unknown>('GET', `${path}/volumes?recursion=1&all-projects=true`, null, 5000)
  if (!Array.isArray(volumes)) throw Error('POOL_DISK_IMAGE_VOLUMES_UNVERIFIED')
  let processed = 0
  for (const volume of volumes) {
    if (volume?.type !== 'image') continue
    if (typeof volume.name !== 'string' || !/^[a-f0-9]{64}$/.test(volume.name)) throw Error('POOL_DISK_IMAGE_VOLUMES_UNVERIFIED')
    if (!await idle()) return false
    const current = await client.request<Pool>('GET', path, null, 5000)
    if (!isolatedPoolConfiguration(current) || current.status !== 'Created' || current.config.source !== original.config.source ||
      current.config['user.payincus.disk-isolation'] !== 'lvm-btrfs-v1') throw Error('POOL_DISK_IDENTITY_CHANGED')
    const imagePath = `${path}/volumes/image/${volume.name}`
    await beforeWrite()
    try { await client.request('DELETE', imagePath, null, 20000) }
    catch (error) { if (!(error instanceof IncusApiError) || error.statusCode !== 404 || error.path !== imagePath) throw error }
    if (++processed >= 4) return false // Bound one pass; durable maintenance resumes the remaining cache.
  }
  return true
}
