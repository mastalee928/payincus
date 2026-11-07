import { prisma } from '../db/prisma.js'
import type { Prisma } from '@prisma/client'
import { readHostMaintenanceIntent } from './host-maintenance-plan.js'

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
/** A durable intent never expires into permission, including after recovery. */
export function hostMaintenanceBlocked(value: unknown): boolean {
  const maintenance = object(value).maintenance
  if (maintenance === undefined || maintenance === null) return false
  try {
    const intent = readHostMaintenanceIntent(maintenance)
    return !['verified', 'aborted'].includes(intent.phase)
  } catch { return true }
}
export class HostMaintenanceError extends Error {
  readonly code = 'HOST_SECURITY_MAINTENANCE'
  constructor() { super('宿主正在执行安全维护，相关操作将在维护验收后继续') }
}
export async function assertHostNotMaintaining(hostId: number, database: Pick<Prisma.TransactionClient, 'host'> = prisma) {
  const host = await database.host.findUnique({ where: { id: hostId }, select: { securityHardening: true } })
  if (!host || hostMaintenanceBlocked(host.securityHardening)) throw new HostMaintenanceError()
}
