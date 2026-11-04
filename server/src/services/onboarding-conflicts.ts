import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { advisoryTransactionLockString, HOST_PUBLIC_IP_SYNC_LOCK_NAMESPACE } from '../db/advisory-locks.js'

type Db = Prisma.TransactionClient | typeof prisma
export async function lockOnboardingAddresses(tx: Prisma.TransactionClient, addresses: string[]) {
  for (const address of [...new Set(addresses)].sort()) await advisoryTransactionLockString(tx, HOST_PUBLIC_IP_SYNC_LOCK_NAMESPACE, 'address:' + address)
}
export async function onboardingAddressConflict(publicIp: string, db: Db = prisma, excludeNodeId?: string) {
  const host = await db.host.findFirst({ where: currentHostAddressWhere(publicIp), select: { id: true, name: true, status: true, isInstalled: true } })
  if (host) return { code: 'HOST_IP_ALREADY_REGISTERED', publicIp, host }
  const node = await db.hostOnboardingNode.findUnique({ where: { activePublicIp: publicIp }, select: { id: true, batchId: true, status: true, deletedAt: true, hostId: true } })
  if (node && node.id !== excludeNodeId && !node.deletedAt) return {
    code: ['queued', 'running'].includes(node.status) ? 'HOST_IP_ONBOARDING' : 'HOST_IP_HAS_TASK', publicIp,
    node: { id: node.id, batchId: node.batchId, status: node.status }
  }
  return null
}

export function currentHostAddressWhere(publicIp: string): Prisma.HostWhereInput {
  return { OR: [
    { publicIpSync: { path: ['observedIp'], equals: publicIp } },
    { onboardingNode: { is: { activePublicIp: publicIp } } },
    { onboardingNode: { is: null }, OR: [{ natPublicIp: publicIp }, { ipAddress: publicIp }] }
  ] }
}
