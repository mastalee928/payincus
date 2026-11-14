/** Each LVM thin volume has its own filesystem; statfs cannot expose the pool. */
export const POOL_DISK_NAME = 'payincus-pool'
export const POOL_DISK_DRIVER = 'lvm'
export const POOL_DISK_FILESYSTEM = 'btrfs'

export function isolatedPoolConfiguration(pool: { driver?: string; config?: Record<string, string> }): boolean {
  return pool.driver === POOL_DISK_DRIVER && pool.config?.['volume.block.filesystem'] === POOL_DISK_FILESYSTEM &&
    pool.config?.['lvm.use_thinpool'] !== 'false'
}

export function isolatedPoolCreate(sizeGiB: number) {
  if (!Number.isSafeInteger(sizeGiB) || sizeGiB < 10 || sizeGiB > 10000) throw Error('POOL_DISK_SIZE_INVALID')
  return { name: POOL_DISK_NAME, driver: POOL_DISK_DRIVER, config: {
    size: `${sizeGiB}GiB`, 'volume.block.filesystem': POOL_DISK_FILESYSTEM, 'lvm.use_thinpool': 'true',
    'user.payincus.disk-isolation': 'lvm-btrfs-v1'
  } }
}

export const isolatedSystemPoolWhere = {
  purpose: 'instance_data' as const, driver: POOL_DISK_DRIVER,
  config: { path: ['volume.block.filesystem'], equals: POOL_DISK_FILESYSTEM }
}
