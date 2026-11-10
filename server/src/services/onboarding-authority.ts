import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { OnboardingError } from '../lib/host-onboarding.js'
import { recoveryHeld } from './platform-backup-core.js'

type Db = Pick<Prisma.TransactionClient, 'hostOnboardingNode' | 'user'>
export type OnboardingLease = { id: string; leaseToken: string | null }

export async function assertOnboardingAuthority(actorId: number, db: Db = prisma): Promise<void> {
  if (recoveryHeld()) throw new OnboardingError('WORKER_INTERRUPTED')
  const actor = await db.user.findUnique({ where: { id: actorId }, select: { role: true, status: true } })
  if (actor?.role !== 'admin' || actor.status !== 'active') throw new OnboardingError('ADMIN_REQUIRED')
}

/** Recheck before each remote step and after slow reads. A matching token
 * alone is insufficient once its lease expires or its administrator changes. */
export async function assertOnboardingLease(lease: OnboardingLease, db: Db = prisma) {
  const node = await db.hostOnboardingNode.findUnique({ where: { id: lease.id }, include: { batch: true } })
  if (!node || node.deletedAt || node.status !== 'running' || !lease.leaseToken || node.leaseToken !== lease.leaseToken ||
      !node.leaseUntil || node.leaseUntil <= new Date()) throw new OnboardingError('WORKER_INTERRUPTED')
  await assertOnboardingAuthority(node.batch.createdById, db)
  if (node.leaseUntil <= new Date()) throw new OnboardingError('WORKER_INTERRUPTED')
  return node
}
