import type { Prisma } from '@prisma/client'

export const HOST_RESOURCE_INSTANCE_STATUSES = ['creating', 'running', 'stopped', 'suspended'] as const

// Failed cleanup occupies a dedicated host until cleanup and final billing end.
// Keep this condition aligned with the database assignment guard.
export const HOST_OCCUPIED_INSTANCE_WHERE: Prisma.InstanceWhereInput = {
  OR: [{ status: { not: 'deleted' } }, { provisioningCleanupPending: true }, { deletionBillingPending: true }]
}

export function dedicatedHostReadyWhere(): Prisma.HostWhereInput {
  return {
    poolFaulted: false, publicIpSyncBlocked: false, status: 'online', isInstalled: true, instanceType: { in: ['container', 'both'] },
    storagePools: { some: { purpose: 'instance_data' } },
    natPublicIp: { not: null }, natPortStart: { not: null }, natPortEnd: { not: null },
    OR: [
      { onboardingNode: { is: null } },
      { onboardingNode: { is: { status: 'succeeded' } },
        agent: { is: { enabled: true, lastSeenAt: { gte: new Date(Date.now() - 90000) } } } }
    ]
  }
}

export function hostPendingMoveWhere(hostId: number, instanceId?: number): Prisma.InstanceTaskWhereInput {
  return { targetHostId: hostId, taskType: { in: ['change_host', 'replace_host'] }, status: { in: ['PENDING', 'PROCESSING'] },
    ...(instanceId === undefined ? {} : { instanceId: { not: instanceId } }) }
}

export function isHostAllocationError(error: unknown): boolean {
  return error instanceof Error && /\bHOST_(?:PUBLIC_IP_PENDING|POOL_FAULTED|SINGLE_TENANT_OCCUPIED|CUSTOMER_(?:CPU|MEMORY|DISK)_EXCEEDED)\b/.test(error.message)
}

export interface HostResourceAllocation {
  status: string
  cpu: number
  memory: number
  disk?: number
}

export function calculateAllocatedHostResources(instances: HostResourceAllocation[]): {
  cpuUsed: number
  memoryUsed: number
  diskUsed: number
} {
  const allocatedStatuses = new Set<string>(HOST_RESOURCE_INSTANCE_STATUSES)

  return instances.reduce((usage, instance) => {
    if (!allocatedStatuses.has(instance.status)) return usage
    usage.cpuUsed += instance.cpu
    usage.memoryUsed += instance.memory
    usage.diskUsed += instance.disk ?? 0
    return usage
  }, { cpuUsed: 0, memoryUsed: 0, diskUsed: 0 })
}
