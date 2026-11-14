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
