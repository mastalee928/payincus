import type { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'

export const PENDING_PROXY_SITE_OPERATION_STATES = ['pending', 'applying', 'retry', 'blocked'] as const

export class ProxySiteOperationPendingError extends Error {
  readonly statusCode = 409
  readonly code = 'PROXY_SITE_OPERATION_PENDING'
  constructor() { super('反代站点仍有未完成的同步操作，请完成或恢复后重试') }
}

export async function hasPendingProxySiteOperations(instanceId: number,
  tx: Pick<Prisma.TransactionClient, 'proxySiteOperation'> = prisma): Promise<boolean> {
  return Boolean(await tx.proxySiteOperation.findFirst({ where: {
    instanceId, state: { in: [...PENDING_PROXY_SITE_OPERATION_STATES] }
  }, select: { id: true } }))
}

/** Call while holding INSTANCE_OPERATION_LOCK_NAMESPACE and the instance row. */
export async function assertNoPendingProxySiteOperations(
  tx: Pick<Prisma.TransactionClient, 'proxySiteOperation'>, instanceId: number
): Promise<void> {
  if (await hasPendingProxySiteOperations(instanceId, tx)) throw new ProxySiteOperationPendingError()
}
