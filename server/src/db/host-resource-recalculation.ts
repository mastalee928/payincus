import { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'
import { authorizeUserWrite, type WriteActor } from './user-write-authorization.js'
import { normalizeLogContentForStorage } from '../lib/log-localization.js'
import { ErrorCode, type ErrorCodeType } from '../lib/errors.js'

export class HostRecalculationError extends Error {
  constructor(readonly statusCode: number, readonly code?: ErrorCodeType) {
    super(code ?? '宿主机资源、归属或登录权限正在变化，本次未校对，请刷新后重试')
  }
}

type ResourceValues = { cpuUsed: number; memoryUsed: number; diskUsed: number; natPortsUsedCount: number; cpuAllowanceMax: number; memoryMax: number }

/** Keep this administrative repair's existing counting/quota contract, with locked inputs and audit. */
export async function recalculateHostResources(hostId: number, actor: WriteActor & { role: string }) {
  const selected = await prisma.host.findUnique({ where: { id: hostId }, select: { userId: true } })
  if (!selected) throw new HostRecalculationError(404, ErrorCode.HOST_NOT_FOUND)
  if (selected.userId !== actor.id && actor.role !== 'admin') throw new HostRecalculationError(403, ErrorCode.FORBIDDEN)
  try {
    return await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`
      // Match instance writers' instance -> host -> account lock order. Lock
      // deleted rows too: their status can change back into the counting set.
      await tx.$queryRaw`SELECT id FROM instances WHERE host_id = ${hostId} ORDER BY id FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${hostId} FOR UPDATE`
      // The host lock now blocks new child FK inserts. Cover any instance
      // committed between the first scan and that lock, then pin mapped ports.
      await tx.$queryRaw`SELECT id FROM instances WHERE host_id = ${hostId} ORDER BY id FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM port_mappings WHERE instance_id IN (SELECT id FROM instances WHERE host_id = ${hostId}) ORDER BY id FOR UPDATE`
      const host = await tx.host.findUnique({ where: { id: hostId } })
      if (!host) throw new HostRecalculationError(404, ErrorCode.HOST_NOT_FOUND)
      if (!await authorizeUserWrite(tx, actor.id, actor)) throw new HostRecalculationError(403, ErrorCode.FORBIDDEN)
      const account = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true } })
      if (!account || account.role !== actor.role || !['user', 'admin'].includes(account.role) ||
        (host.userId !== actor.id && account.role !== 'admin')) throw new HostRecalculationError(403, ErrorCode.FORBIDDEN)
      if (host.userId !== selected.userId) throw new HostRecalculationError(409)

      const before: ResourceValues = {
        cpuUsed: host.cpuUsed, memoryUsed: host.memoryUsed, diskUsed: host.diskUsed,
        natPortsUsedCount: host.natPortsUsedCount, cpuAllowanceMax: host.cpuAllowanceMax, memoryMax: host.memoryMax
      }
      const sum = await tx.instance.aggregate({ where: { hostId, status: { not: 'deleted' } }, _sum: { cpu: true, memory: true, disk: true } })
      const used = { cpuUsed: sum._sum.cpu ?? 0, memoryUsed: sum._sum.memory ?? 0, diskUsed: sum._sum.disk ?? 0 }
      const portCount = await tx.portMapping.count({ where: { instance: { hostId, status: { not: 'deleted' } } } })
      const after: ResourceValues = { ...used, natPortsUsedCount: portCount, cpuAllowanceMax: used.cpuUsed, memoryMax: used.memoryUsed }
      const diff: ResourceValues = {
        cpuUsed: after.cpuUsed - before.cpuUsed, memoryUsed: after.memoryUsed - before.memoryUsed,
        diskUsed: after.diskUsed - before.diskUsed, natPortsUsedCount: after.natPortsUsedCount - before.natPortsUsedCount,
        cpuAllowanceMax: after.cpuAllowanceMax - before.cpuAllowanceMax, memoryMax: after.memoryMax - before.memoryMax
      }
      const hasChanges = Object.values(diff).some(value => value !== 0)
      await tx.host.update({ where: { id: hostId }, data: after })
      await tx.log.create({ data: {
        userId: actor.id, module: 'host', action: 'host.recalculate_resources', result: 'success',
        content: normalizeLogContentForStorage(`Recalculated resources for host "${host.name}": CPU ${before.cpuUsed}→${after.cpuUsed}, Memory ${before.memoryUsed}→${after.memoryUsed}, Disk ${before.diskUsed}→${after.diskUsed}, Ports ${before.natPortsUsedCount}→${after.natPortsUsedCount}, CPUMax ${before.cpuAllowanceMax}→${after.cpuAllowanceMax}, MemMax ${before.memoryMax}→${after.memoryMax}`)
      } })
      return { message: hasChanges ? '资源校对完成，已修正差异' : '资源校对完成，无差异', hasChanges, before, after, diff }
      // READ COMMITTED is required: a revocation can insert its invalidation
      // while holding the unchanged account row, so an older snapshot misses it.
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 15000 })
  } catch (error) {
    // Prisma 7's PG adapter nests SQLSTATE in driverAdapterError.cause;
    // aggregate/update can also throw the adapter error directly.
    const failure = error as { code?: string; cause?: { originalCode?: string }; meta?: {
      code?: string; driverAdapterError?: { cause?: { originalCode?: string } }
    } } | null
    const sqlState = failure?.meta?.code ?? failure?.meta?.driverAdapterError?.cause?.originalCode ?? failure?.cause?.originalCode
    if (failure?.code === 'P2034' || failure?.code === 'P2028' || ['55P03', '40P01', '40001'].includes(String(sqlState))) {
      throw new HostRecalculationError(409)
    }
    throw error
  }
}
