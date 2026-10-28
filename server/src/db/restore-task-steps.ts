import type { Prisma, RestoreTask } from '@prisma/client'
import { prisma } from './prisma.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from './advisory-locks.js'
import { assertRestoreBinding, loadAuthorizedRestore, restoreAttempt, restoreWorkflowBusy, RestoreAuthorizationError } from './restore-task-authorization.js'
import { recoveryHeld } from '../services/platform-backup-core.js'
import type { RestoreInstanceIdentity } from '../lib/incus/restore-identity.js'

export type RestoreRecoveryState = { version: 1; stage: string; original: RestoreInstanceIdentity;
  restored?: RestoreInstanceIdentity; operation?: string;
  backups: Array<{ id: number; incusName: string }>; snapshots: Array<{ id: number; incusName: string }> }

/** Commit each remote intent before I/O; revalidate the original request at every boundary. */
export async function restoreStep<T>(task: RestoreTask, work: (tx: Prisma.TransactionClient) => Promise<T>, timeout = 20000) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`
    if (recoveryHeld()) throw new RestoreAuthorizationError('平台恢复保护中，恢复任务已保留')
    if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, task.instanceId)) throw new RestoreAuthorizationError('实例正在执行其他操作')
    const current = await loadAuthorizedRestore(tx, task, { sid: task.actorSid ?? undefined, iat: task.actorIat ?? undefined })
    assertRestoreBinding(task, current)
    if (!await tx.restoreTask.findFirst({ where: restoreAttempt(task) }) || await restoreWorkflowBusy(tx, current.instance, task.id)) {
      throw new RestoreAuthorizationError('恢复批次已变化或实例存在未决操作')
    }
    return work(tx)
  }, { maxWait: 5000, timeout })
}

export async function assertRestoreManifest(tx: Prisma.TransactionClient, task: RestoreTask, state: RestoreRecoveryState) {
  const backups = await tx.backup.findMany({ where: { instanceId: task.instanceId, status: { not: 'deleted' } }, select: { id: true, incusName: true } })
  const snapshots = await tx.snapshot.findMany({ where: { instanceId: task.instanceId }, select: { id: true, incusName: true } })
  for (const [current, saved] of [[backups, state.backups], [snapshots, state.snapshots]]) {
    if (current.length !== saved.length || current.some(row => !saved.some(old => old.id === row.id && old.incusName === row.incusName))) {
      throw new RestoreAuthorizationError('恢复开始后的备份或快照清单已变化，已保留副本及门禁')
    }
  }
}

export async function saveRestoreState(task: RestoreTask, state: RestoreRecoveryState) {
  await restoreStep(task, async tx => {
    const result = await tx.restoreTask.updateMany({ where: restoreAttempt(task), data: {
      recoveryState: state as Prisma.InputJsonValue, progress: state.stage } })
    if (result.count !== 1) throw new RestoreAuthorizationError('恢复批次已变化')
  })
}
