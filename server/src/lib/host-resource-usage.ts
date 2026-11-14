import { Prisma } from '@prisma/client'
import { SECURITY_HARDENING_REVISION } from './security-hardening.js'
import { guestProtectionReadyWhere } from './guest-network-protection.js'
import { hostProvisioningToolsReadyWhere } from './host-provisioning-tools.js'
import { isolatedSystemPoolWhere } from './pool-disk-isolation.js'

/** Uninspected legacy hosts keep their existing readiness rules. Once a host
 * enters hardening, only a current successful receipt can release new stock. */
export function hostHardeningReadyWhere(receiptValidAt = new Date()): Prisma.HostWhereInput {
  return { OR: [
    { securityHardening: { equals: Prisma.DbNull } },
    { AND: [
      { securityHardening: { path: ['revision'], equals: SECURITY_HARDENING_REVISION } },
      { securityHardening: { path: ['status'], equals: 'verified' } },
      { securityHardening: { path: ['phase'], equals: 'finished' } },
      { securityHardening: { path: ['nextCheckAt'], gte: receiptValidAt.toISOString() } },
      { OR: [
        { securityHardening: { path: ['maintenance'], equals: Prisma.AnyNull } },
        { AND: [
          { securityHardening: { path: ['maintenance','revision'], equals: 'host-maintenance-v1' } },
          // A conditional rollback ends maintenance too. Stock still requires
          // the fresh complete hardening receipt above; rollback alone grants
          // no saleability and must not erase its original audit history.
          { OR: [
            { securityHardening: { path: ['maintenance','phase'], equals: 'verified' } },
            { AND: [
              { securityHardening: { path: ['maintenance','phase'], equals: 'aborted' } },
              { securityHardening: { path: ['maintenance','rebootIssued'], equals: false } }
            ] }
          ] }
        ] }
      ] }
    ] }
  ] }
}

export const HOST_RESOURCE_INSTANCE_STATUSES = ['creating', 'running', 'stopped', 'suspended'] as const

// Failed cleanup occupies a dedicated host until cleanup and final billing end.
// Keep this condition aligned with the database assignment guard.
export const HOST_OCCUPIED_INSTANCE_WHERE: Prisma.InstanceWhereInput = {
  OR: [{ status: { not: 'deleted' } }, { provisioningCleanupPending: true }, { deletionBillingPending: true }]
}

export function dedicatedHostReadyWhere(receiptValidAt = new Date()): Prisma.HostWhereInput {
  // In-flight delivery can retain its admission time for the hardening proof.
  // Liveness and network protection must always use one current timestamp.
  const observedAt = new Date()
  return {
    poolFaulted: false, publicIpSyncBlocked: false, status: 'online', isInstalled: true, installPending: false, instanceType: { in: ['container', 'both'] },
    certPath: { not: null }, keyPath: { not: null },
    storagePools: { some: isolatedSystemPoolWhere },
    natPublicIp: { not: null }, natPortStart: { not: null }, natPortEnd: { not: null },
    agent: { is: { AND: [guestProtectionReadyWhere(observedAt),hostProvisioningToolsReadyWhere(observedAt)] } },
    OR: [
      { onboardingNode: { is: null }, ...hostHardeningReadyWhere(receiptValidAt) },
      { onboardingNode: { is: { status: 'succeeded' } },
        ...hostHardeningReadyWhere(receiptValidAt),
        agent: { is: { enabled: true, lastSeenAt: { gte: new Date(observedAt.getTime() - 90000) } } } }
    ]
  }
}

export function hostPendingMoveWhere(hostId: number, instanceId?: number): Prisma.InstanceTaskWhereInput {
  return { targetHostId: hostId, taskType: { in: ['change_host', 'replace_host'] }, status: { in: ['PENDING', 'PROCESSING'] },
    ...(instanceId === undefined ? {} : { instanceId: { not: instanceId } }) }
}

/** Uncommitted creations and old copies must not disappear during counter sync. */
export function hostUnfinishedCreationWhere(hostId?: number): Prisma.InstanceTaskWhereInput {
  return { taskType: { in: ['clone', 'change_host', 'recreate'] },
    ...(hostId === undefined ? {} : { OR: [{ hostId }, { targetHostId: hostId }, { replacementState: { path: ['sourceHostId'], equals: hostId } }] }),
    AND: [{ OR: [
      ...['prepared', 'creating', 'reserved', 'cleanup_pending', 'source_cleanup'].map(phase => ({ replacementState: { path: ['targetPhase'], equals: phase } })),
      { status: { not: 'COMPLETED' }, replacementState: { path: ['targetPhase'], equals: 'verified' } }
    ] }] }
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
