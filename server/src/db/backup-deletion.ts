import { withSnapshotMutation, SnapshotMutationError } from './snapshot-operation-guards.js'
import type { WriteActor } from './user-write-authorization.js'
import { IncusApiError, IncusClient } from '../lib/incus/incus-client.js'
import { recoveryHeld } from '../services/platform-backup-core.js'
import { transferHostIdentity } from '../lib/transfer-host-identity.js'

/** Keep the shared instance fence through remote absence confirmation and DB commit. */
export async function deleteAuthorizedBackup(
  expected: { id: number; user_id: number; host_id: number; incus_id: string },
  backup: { id: number; incus_name: string }, actor: WriteActor, expectedHostIdentity: string, terminalOnly = false
) {
  return withSnapshotMutation(expected, actor, false, async (tx, instance) => {
    if (recoveryHeld()) throw new SnapshotMutationError('平台恢复保护中，暂不能删除备份')
    if (transferHostIdentity(instance.host) !== expectedHostIdentity) throw new SnapshotMutationError('宿主身份已变化，请刷新后重试')
    await tx.$queryRaw`SELECT id FROM backups WHERE id = ${backup.id} FOR UPDATE`
    const current = await tx.backup.findUnique({ where: { id: backup.id } })
    if (!current || current.instanceId !== instance.id || current.incusName !== backup.incus_name) {
      throw new SnapshotMutationError('备份归属或身份已变化，请刷新后重试')
    }
    if (current.status === 'deleted') return { instanceName: instance.name, hostName: instance.host.name, backupName: current.name, deletedNow: false }
    // A route that observed a completed deletion may only replay its receipt.
    // Reverting the backup while it waited must never dispatch a new deletion.
    if (terminalOnly) throw new SnapshotMutationError('备份状态已变化，请刷新后重试')
    if (current.status === 'creating') throw new SnapshotMutationError('备份仍在创建中，请等待完成后重试')
    if ([instance.incusId, current.incusName].some(name => !name || name === '.' || name === '..')) {
      throw new SnapshotMutationError('备份远端名称无效，请检查实例记录')
    }
    const path = `/1.0/instances/${encodeURIComponent(instance.incusId)}/backups/${encodeURIComponent(current.incusName)}`
    const client = new IncusClient(instance.host)
    const absent = (error: unknown) => error instanceof IncusApiError && error.statusCode === 404 && error.path === path
    try {
      await client.connect()
      try { await client.request('DELETE', path, null, 60000) } catch (error) { if (!absent(error)) throw error }
      // A success response alone is insufficient: retain the DB backup until
      // this exact resource is confirmed absent over the authenticated channel.
      let missing = false
      try { await client.request('GET', path, null, 60000) } catch (error) {
        if (!absent(error)) throw error
        missing = true
      }
      if (!missing) throw new SnapshotMutationError('宿主仍报告该备份存在，删除未确认，请稍后重试')
      await tx.backup.update({ where: { id: current.id }, data: { status: 'deleted' } })
      return { instanceName: instance.name, hostName: instance.host.name, backupName: current.name, deletedNow: true }
    } finally { await client.agent?.destroy().catch(() => {}) }
  })
}
