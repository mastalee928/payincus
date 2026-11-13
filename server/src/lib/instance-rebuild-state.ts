import { Prisma } from '@prisma/client'

/** A failed rootfs replacement must be rebuilt under fresh user consent before
 * boot. Its old password/configuration cannot be claimed to match the disk. */
export async function assertRebuildBootReady(database: Pick<Prisma.TransactionClient, 'instanceTask' | 'restoreTask'>, instanceId: number): Promise<void> {
  const latest = await database.instanceTask.findFirst({ where: { instanceId,
    taskType: { in: ['rebuild', 'recreate', 'replace_host'] },
    replacementState: { not: Prisma.DbNull } }, orderBy: { id: 'desc' }, select: { replacementState: true, finishedAt: true } })
  const receipt = latest?.replacementState as { requiresRebuild?: boolean; rebuildCompleted?: boolean } | null
  if (!receipt?.requiresRebuild || receipt.rebuildCompleted === true) return
  // A later verified restore replaces the failed disk. Its own worker checks
  // the imported UUID/devices immediately before dispatching start.
  if (latest?.finishedAt && await database.restoreTask.findFirst({ where: { instanceId, createdAt: { gt: latest.finishedAt },
    OR: [{ status: 'COMPLETED' }, { status: 'PROCESSING', recoveryState: { path: ['stage'], equals: 'starting' } }],
    recoveryState: { path: ['restored', 'uuid'], not: Prisma.AnyNull } }, select: { id: true } })) return
  throw Error('重装未完成，请先重新选择镜像重装后再启动')
}
