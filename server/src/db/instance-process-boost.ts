import { withBatchInstanceMutation } from './batch-config-mutations.js'
import { assertNoPendingSnapshotOperations, SnapshotOperationPendingError } from './snapshot-operation-guards.js'
import { assertNoPendingProxySiteOperations, ProxySiteOperationPendingError } from './proxy-site-operation-guards.js'
import { updateInstance } from '../lib/incus/index.js'
import { IncusClient } from '../lib/incus/incus-client.js'
import type { WriteActor } from './user-write-authorization.js'
import type { Host, Instance } from '../types/database.js'
import { prisma } from './prisma.js'

export class ProcessBoostError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string,
    readonly details?: Record<string, unknown>, cause?: unknown) { super(message, { cause }) }
}

/** Share the instance operation fence with batch configuration and lifecycle work. */
export async function boostInstanceProcessesAuthorized(expected: Instance, originalHost: Host, actor: WriteActor): Promise<number> {
  let remoteWriteStarted = false
  let previousProcesses: number | null = null
  let targetLimit: number | undefined
  // Include connection acquisition and lock waits in the remote-operation budget.
  const operationDeadline = Date.now() + 90000
  try {
    return await withBatchInstanceMutation({ id: expected.id, hostId: expected.host_id,
      userId: expected.user_id, incusId: expected.incus_id }, actor, true, async ({ tx, instance, host, deadline }) => {
      if (instance.createdAt.toISOString() !== expected.created_at ||
        host.createdAt.toISOString() !== originalHost.created_at || host.userId !== originalHost.user_id ||
        host.url !== originalHost.url || host.certPath !== originalHost.cert_path || host.keyPath !== originalHost.key_path) {
        throw new ProcessBoostError(409, 'PROCESS_LIMIT_TARGET_CHANGED', '实例或宿主机信息已变化，请刷新后重试')
      }
      await assertNoPendingSnapshotOperations(tx, instance.id)
      await assertNoPendingProxySiteOperations(tx, instance.id)
      if (instance.packageId) await tx.$queryRaw`SELECT id FROM packages WHERE id = ${instance.packageId} FOR SHARE`
      const pkg = instance.packageId ? await tx.package.findUnique({ where: { id: instance.packageId }, select: { instanceType: true } }) : null
      targetLimit = pkg?.instanceType === 'vm' ? 2000 : 1000
      previousProcesses = instance.limitsProcesses
      if ((previousProcesses ?? 500) >= targetLimit) {
        throw new ProcessBoostError(400, 'PROCESS_LIMIT_ALREADY_MAX', `Process limit already at maximum (${targetLimit})`)
      }

      const remoteDeadline = Math.min(deadline, operationDeadline)
      const remaining = remoteDeadline - Date.now()
      if (remaining <= 0) throw new Error('Process limit operation deadline exceeded')
      const signal = AbortSignal.timeout(remaining)
      // The operation owns its transport. Bound the cold mTLS handshake as well
      // as GET/PUT without changing or cancelling another pooled caller.
      const client = new IncusClient(host)
      const request = client.request.bind(client)
      client.request = ((method, path, body = null, timeout = 120000, callerSignal, conditions) => {
        signal.throwIfAborted()
        const remaining = remoteDeadline - Date.now()
        if (remaining <= 0) throw new Error('Process limit operation deadline exceeded')
        if (!['GET', 'HEAD'].includes(method.toUpperCase())) remoteWriteStarted = true
        return request(method, path, body, Math.min(timeout, remaining),
          callerSignal ? AbortSignal.any([signal, callerSignal]) : signal, conditions)
      }) as typeof client.request
      try {
        await client.connect()
        await updateInstance(client, instance.incusId, { config: { 'limits.processes': String(targetLimit) } })
        signal.throwIfAborted()
        await tx.instance.update({ where: { id: instance.id }, data: { limitsProcesses: targetLimit } })
        return targetLimit
      } finally { await client.close() }
    })
  } catch (error) {
    if (error instanceof ProcessBoostError) throw error
    const message = error instanceof Error ? error.message : String(error)
    if (remoteWriteStarted) {
      // A failed/late PUT or COMMIT does not prove either side's current value.
      const current = await prisma.instance.findUnique({ where: { id: expected.id }, select: { limitsProcesses: true } }).catch(() => null)
      throw new ProcessBoostError(500, 'PROCESS_LIMIT_BOOST_PARTIAL_FAILURE', '进程数设置未能完整确认，请检查当前配置后重试', {
        requestedLimit: targetLimit, previousDatabaseLimit: previousProcesses,
        databaseLimit: current ? current.limitsProcesses : 'unknown', incusLimitApplied: 'unknown'
      }, error)
    }
    if (error instanceof SnapshotOperationPendingError || error instanceof ProxySiteOperationPendingError) {
      throw new ProcessBoostError(error.statusCode, error.code, error.message)
    }
    if (message.startsWith('FORBIDDEN:')) throw new ProcessBoostError(403, 'FORBIDDEN', '账号或登录权限已变化，请重新登录')
    if (/BATCH_CONFIG_BUSY|BATCH_CONFIG_TARGET_CHANGED|INSTANCE_NOT_READY|INSTANCE_BUSY|pending|lock timeout/i.test(message)) {
      throw new ProcessBoostError(409, 'PROCESS_LIMIT_CONFLICT', '实例正在执行其他操作或状态已变化，请刷新后重试')
    }
    throw error
  }
}
