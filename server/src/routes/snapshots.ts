/**
 * 快照管理路由
 * 处理实例快照的创建、列表、删除、恢复等操作
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { getIncusClient } from '../lib/incus/index.js'
import { createSnapshot, deleteSnapshot, restoreSnapshot } from '../lib/incus/incus-snapshots.js'
import { sendNotification } from '../lib/notifier.js'
import { checkSnapshotQuota } from '../db/quota-operations.js'
import { acquireLock, releaseLock } from '../lib/distributed-lock.js'
import type { CreateSnapshotRequest } from '../types/api.js'
import { checkInstancePermission } from '../lib/permission.js'
import type { WriteActor } from '../db/user-write-authorization.js'
import type { Prisma } from '@prisma/client'
import { withSnapshotMutation, SnapshotMutationError, SnapshotOperationPendingError } from '../db/snapshot-operation-guards.js'
import { autoSnapshotOperationView, retryAutoSnapshotOperation } from '../services/auto-snapshot-operations.js'
import {
  claimOperationVerificationRequirement
} from '../lib/operation-verification.js'

const POSITIVE_INTEGER_ID_RE = /^[1-9]\d*$/
const SNAPSHOT_CREATE_LOCK_EXPIRE_MS = 30 * 60 * 1000
const SNAPSHOT_CREATE_LOCK_WAIT_MS = 5000

function getSnapshotCreateLockKey(instanceId: number): string {
  return `auto-policy:snapshot:${instanceId}`
}

function parsePositiveId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }

  if (typeof value !== 'string' || !POSITIVE_INTEGER_ID_RE.test(value)) {
    return null
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

// 检查实例是否被转移锁定
async function checkTransferLock(instanceId: number, reply: FastifyReply): Promise<boolean> {
  const hasPending = await db.hasPendingTransfer(instanceId)
  if (hasPending) {
    reply.code(400).send(apiError(ErrorCode.TRANSFER_INSTANCE_LOCKED))
    return true
  }
  return false
}

async function requireVerifiedOperation(
  reply: FastifyReply,
  userId: number,
  resourceId: number,
  actor: WriteActor,
  tx: Prisma.TransactionClient
): Promise<boolean> {
  const verification = await claimOperationVerificationRequirement(userId, 'delete_snapshot', resourceId, actor, tx)
  if (!verification.verified) {
    reply.code(403).send({
      error: 'Sensitive operation requires verification',
      code: 'VERIFICATION_REQUIRED',
      required: verification.required
    })
    return false
  }
  return true
}

export default async function snapshotRoutes(fastify: FastifyInstance) {

  // 获取实例的快照列表
  fastify.get<{ Params: { instanceId: string } }>('/:instanceId/snapshots', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{ Params: { instanceId: string } }>, reply: FastifyReply) => {
    const instanceIdNum = parsePositiveId(request.params.instanceId)

    if (instanceIdNum === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证实例归属
    const instance = await db.getInstanceById(instanceIdNum)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查：管理员、实例所有者、宿主机所有者
    const permResult = await checkInstancePermission(request.user, instance)
    if (!permResult.allowed) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 从数据库获取快照列表
    const snapshots = await db.getSnapshotsByInstanceId(instanceIdNum)

    return snapshots.map(s => ({
      id: s.id,
      name: s.name,
      incusName: s.incus_name,
      description: s.description,
      stateful: Boolean(s.stateful),
      size: s.size,
      created_at: s.created_at
    }))
  })

  // 创建快照
  fastify.post<{
    Params: { instanceId: string }
    Body: CreateSnapshotRequest
  }>('/:instanceId/snapshots', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 50 },
          description: { type: 'string', maxLength: 200 }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { instanceId: string }
    Body: CreateSnapshotRequest
  }>, reply: FastifyReply) => {
    const instanceIdNum = parsePositiveId(request.params.instanceId)

    if (instanceIdNum === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { name, description } = request.body

    // 验证实例归属
    const instance = await db.getInstanceById(instanceIdNum)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查：管理员、实例所有者、宿主机所有者
    const permResult = await checkInstancePermission(request.user, instance)
    if (!permResult.allowed) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 封停状态不允许创建快照
    if (instance.status === 'suspended') {
      if (instance.suspend_reason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    // 实例必须是运行或停止状态
    if (!['running', 'stopped'].includes(instance.status)) {
      return reply.code(400).send(apiError(ErrorCode.INSTANCE_STATUS_INVALID))
    }

    // 检查转移锁定
    if (await checkTransferLock(instanceIdNum, reply)) return

    // 生成 Incus 快照名称
    const timestamp = Date.now()
    const incusName = `snap-${name.replace(/[^a-zA-Z0-9-_]/g, '-')}-${timestamp}`
    const lockKey = getSnapshotCreateLockKey(instanceIdNum)
    const lockResult = await acquireLock(lockKey, {
      expireMs: SNAPSHOT_CREATE_LOCK_EXPIRE_MS,
      waitTimeoutMs: SNAPSHOT_CREATE_LOCK_WAIT_MS,
      retryIntervalMs: 100
    })

    if (!lockResult.success || !lockResult.ownerId) {
      return reply.code(409).send(apiError(ErrorCode.OPERATION_NOT_ALLOWED, 'Snapshot operation is busy, please retry later'))
    }

    try {
      const result = await withSnapshotMutation(instance, request.user, false, async (tx, current) => {
        if (!['running', 'stopped'].includes(current.status) || current.expiresAt && current.expiresAt <= new Date()) throw new SnapshotMutationError('实例状态或到期时间不允许创建快照')
        // 在实例级锁内重新检查配额，避免并发手动快照同时通过读前检查。
        const quotaCheck = await checkSnapshotQuota(instance.user_id, instanceIdNum, tx)
        if (!quotaCheck.allowed) {
          throw new SnapshotMutationError(quotaCheck.message || '快照配额已满', 400)
        }

        // 获取宿主机信息并创建 Incus 客户端
        const host = current.host
        const client = await getIncusClient(host, tx)

        // 在 Incus 中创建快照
        await createSnapshot(client, instance.incus_id, incusName)

        // 保存到数据库
        let snapshotId: number
        try {
          snapshotId = (await tx.snapshot.create({ data: {
            instanceId: instanceIdNum,
            incusName,
            name,
            description,
            stateful: false
          } })).id
        } catch (dbErr) {
          try {
            await deleteSnapshot(client, instance.incus_id, incusName)
          } catch (cleanupErr) {
            fastify.log.error({ err: cleanupErr, instanceId: instanceIdNum, incusName }, 'Failed to clean up Incus snapshot after database create failure')
          }
          throw dbErr
        }
        return { snapshotId, host }
      })
      if (!result) return
      const { snapshotId, host } = result

      // 发送通知
      try {
        await sendNotification(request.user.id, 'snapshot_created', {
          instanceName: instance.name,
          snapshotName: name,
          hostName: host.name
        })
      } catch (notifyErr) {
        fastify.log.warn({ err: notifyErr, instanceId: instanceIdNum, snapshotId }, 'Failed to send snapshot created notification')
      }

      await createLog(request.user.id, 'snapshot', 'snapshot.create', `Created snapshot "${name}" for instance "${instance.name}" [host: ${host.name}]`, 'success', { instanceId: instanceIdNum })

      reply.code(201).send({
        message: 'Snapshot created',
        snapshot: {
          id: snapshotId,
          name,
          incusName,
          description,
          stateful: false
        }
      })
    } catch (err) {
      if (err instanceof SnapshotMutationError || err instanceof SnapshotOperationPendingError) return reply.code(err.statusCode).send({ error: err.message, code: 'SNAPSHOT_OPERATION_PENDING' })
      fastify.log.error(err)
      const errorMessage = err instanceof Error ? err.message : String(err)
      await createLog(request.user.id, 'snapshot', 'snapshot.create', `Failed to create snapshot: ${errorMessage}`, 'failed', { instanceId: instanceIdNum })
      return reply.code(500).send({ error: 'Failed to create snapshot: ' + errorMessage, code: 'OPERATION_FAILED' })
    } finally {
      await releaseLock(lockKey, lockResult.ownerId)
    }
  })

  // 删除快照
  fastify.delete<{ Params: { instanceId: string; snapshotId: string } }>('/:instanceId/snapshots/:snapshotId', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{ Params: { instanceId: string; snapshotId: string } }>, reply: FastifyReply) => {
    const instanceIdNum = parsePositiveId(request.params.instanceId)
    const snapshotIdNum = parsePositiveId(request.params.snapshotId)

    if (instanceIdNum === null || snapshotIdNum === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证实例归属
    const instance = await db.getInstanceById(instanceIdNum)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查：管理员、实例所有者、宿主机所有者
    const permResult = await checkInstancePermission(request.user, instance)
    if (!permResult.allowed) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 获取快照信息
    const snapshot = await db.getSnapshotById(snapshotIdNum)
    if (!snapshot || snapshot.instance_id !== instanceIdNum) {
      return reply.code(404).send(apiError(ErrorCode.SNAPSHOT_NOT_FOUND))
    }

    // 检查转移锁定
    if (await checkTransferLock(instanceIdNum, reply)) return

    try {
      const result = await withSnapshotMutation(instance, request.user, false, async (tx, current) => {
        const currentSnapshot = await tx.snapshot.findUnique({ where: { id: snapshotIdNum } })
        if (!currentSnapshot || currentSnapshot.instanceId !== instanceIdNum || currentSnapshot.incusName !== snapshot.incus_name) throw new SnapshotMutationError('快照记录已变化，请刷新后重试')
        if (!await requireVerifiedOperation(reply, request.user.id, snapshotIdNum, request.user, tx)) return null
        // 获取宿主机信息并创建 Incus 客户端
        const host = current.host
        const client = await getIncusClient(host, tx)

        // 在 Incus 中删除快照
        await deleteSnapshot(client, instance.incus_id, snapshot.incus_name)

        // 从数据库删除
        await tx.snapshot.delete({ where: { id: snapshotIdNum } })
        return { host }
      })
      if (!result) return
      const { host } = result

      // 发送通知
      await sendNotification(request.user.id, 'snapshot_deleted', {
        instanceName: instance.name,
        snapshotName: snapshot.name,
        hostName: host.name
      })

      await createLog(request.user.id, 'snapshot', 'snapshot.delete', `Deleted snapshot "${snapshot.name}" of instance "${instance.name}" [host: ${host.name}]`, 'success', { instanceId: instanceIdNum })

      return { message: 'Snapshot deleted' }
    } catch (err) {
      if (err instanceof SnapshotMutationError || err instanceof SnapshotOperationPendingError) return reply.code(err.statusCode).send({ error: err.message, code: 'SNAPSHOT_OPERATION_PENDING' })
      fastify.log.error(err)
      const errorMessage = err instanceof Error ? err.message : String(err)
      await createLog(request.user.id, 'snapshot', 'snapshot.delete', `Failed to delete snapshot: ${errorMessage}`, 'failed', { instanceId: instanceIdNum })
      return reply.code(500).send({ error: 'Failed to delete snapshot: ' + errorMessage, code: 'OPERATION_FAILED' })
    }
  })

  // 恢复快照
  fastify.post<{
    Params: { instanceId: string; snapshotId: string }
    Body: Record<string, never>
  }>('/:instanceId/snapshots/:snapshotId/restore', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        properties: {
        }
      }
    }
  }, async (request: FastifyRequest<{ Params: { instanceId: string; snapshotId: string }; Body: Record<string, never> }>, reply: FastifyReply) => {
    const instanceIdNum = parsePositiveId(request.params.instanceId)
    const snapshotIdNum = parsePositiveId(request.params.snapshotId)

    if (instanceIdNum === null || snapshotIdNum === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证实例归属
    const instance = await db.getInstanceById(instanceIdNum)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查：管理员、实例所有者、宿主机所有者
    const permResult = await checkInstancePermission(request.user, instance)
    if (!permResult.allowed) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 获取快照信息
    const snapshot = await db.getSnapshotById(snapshotIdNum)
    if (!snapshot || snapshot.instance_id !== instanceIdNum) {
      return reply.code(404).send(apiError(ErrorCode.SNAPSHOT_NOT_FOUND))
    }

    // 封停状态不允许恢复快照
    if (instance.status === 'suspended') {
      if (instance.suspend_reason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    // 实例必须停止才能恢复
    if (instance.status !== 'stopped') {
      return reply.code(400).send(apiError(ErrorCode.SNAPSHOT_RESTORE_REQUIRES_STOP))
    }

    // 检查转移锁定
    if (await checkTransferLock(instanceIdNum, reply)) return

    try {
      const result = await withSnapshotMutation(instance, request.user, false, async (tx, current) => {
        if (current.status !== 'stopped') throw new SnapshotMutationError('实例必须停止才能恢复快照')
        const currentSnapshot = await tx.snapshot.findUnique({ where: { id: snapshotIdNum } })
        if (!currentSnapshot || currentSnapshot.instanceId !== instanceIdNum || currentSnapshot.incusName !== snapshot.incus_name) throw new SnapshotMutationError('快照记录已变化，请刷新后重试')
        // 获取宿主机信息并创建 Incus 客户端
        const host = current.host
        const client = await getIncusClient(host, tx)

        // 在 Incus 中恢复快照
        await restoreSnapshot(client, instance.incus_id, snapshot.incus_name)
        return { host }
      })
      if (!result) return
      const { host } = result

      // 发送通知
      await sendNotification(request.user.id, 'snapshot_restored', {
        instanceName: instance.name,
        snapshotName: snapshot.name,
        hostName: host.name
      })

      await createLog(request.user.id, 'snapshot', 'snapshot.restore', `Restored instance "${instance.name}" to snapshot "${snapshot.name}" [host: ${host.name}]`, 'success', { instanceId: instanceIdNum })

      return { message: 'Snapshot restored' }
    } catch (err) {
      if (err instanceof SnapshotMutationError || err instanceof SnapshotOperationPendingError) return reply.code(err.statusCode).send({ error: err.message, code: 'SNAPSHOT_OPERATION_PENDING' })
      fastify.log.error(err)
      const errorMessage = err instanceof Error ? err.message : String(err)
      await createLog(request.user.id, 'snapshot', 'snapshot.restore', `Failed to restore snapshot: ${errorMessage}`, 'failed', { instanceId: instanceIdNum })
      return reply.code(500).send({ error: 'Failed to restore snapshot: ' + errorMessage, code: 'OPERATION_FAILED' })
    }
  })

  // 获取自动快照策略
  fastify.get<{ Params: { instanceId: string } }>('/:instanceId/snapshot-policy', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{ Params: { instanceId: string } }>, reply: FastifyReply) => {
    const instanceIdNum = parsePositiveId(request.params.instanceId)

    if (instanceIdNum === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 验证实例归属
    const instance = await db.getInstanceById(instanceIdNum)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查：管理员、实例所有者、宿主机所有者
    const permResult = await checkInstancePermission(request.user, instance)
    if (!permResult.allowed) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const policy = await db.getSnapshotPolicy(instanceIdNum)
    const operation = await autoSnapshotOperationView(instanceIdNum)

    return policy ? {
      operation,
      enabled: Boolean((policy as { enabled?: number }).enabled),
      interval_minutes: (policy as { intervalMinutes?: number }).intervalMinutes || 360,
      last_run_at: (policy as { lastRunAt?: string | null }).lastRunAt || null,
      next_run_at: (policy as { nextRunAt?: string | null }).nextRunAt || null
    } : {
      operation,
      enabled: false,
      interval_minutes: 360,
      last_run_at: null,
      next_run_at: null
    }
  })

  // 设置自动快照策略
  fastify.put<{
    Params: { instanceId: string }
    Body: { enabled: boolean; intervalMinutes?: number }
  }>('/:instanceId/snapshot-policy', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        required: ['enabled'],
        properties: {
          enabled: { type: 'boolean' },
          intervalMinutes: { type: 'integer', enum: [10, 60, 360, 1440] } // 10分钟, 1小时, 6小时, 24小时
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { instanceId: string }
    Body: { enabled: boolean; intervalMinutes?: number }
  }>, reply: FastifyReply) => {
    const instanceIdNum = parsePositiveId(request.params.instanceId)

    if (instanceIdNum === null) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { enabled, intervalMinutes = 360 } = request.body

    // 验证实例归属
    const instance = await db.getInstanceById(instanceIdNum)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查：管理员、实例所有者、宿主机所有者
    const permResult = await checkInstancePermission(request.user, instance)
    if (!permResult.allowed) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    if (await checkTransferLock(instanceIdNum, reply)) return

    // 如果启用自动快照，检查配额
    if (enabled) {
      // 检查实例配额
      const instanceLimit = instance.snapshot_limit
      if (instanceLimit === null || instanceLimit <= 0) {
        return reply.code(400).send(apiError(ErrorCode.QUOTA_NOT_ALLOCATED))
      }
    }

    await withSnapshotMutation(instance, request.user, true, async (tx, current) => {
      if (enabled && (!current.snapshotLimit || current.snapshotLimit <= 0)) throw new SnapshotMutationError('实例未分配快照配额', 400)
      const previous = await tx.snapshotPolicy.findUnique({ where: { instanceId: instanceIdNum } })
      const nextRunAt = !enabled ? null : previous?.enabled && previous.intervalMinutes === intervalMinutes && previous.nextRunAt
        ? previous.nextRunAt : new Date(Date.now() + intervalMinutes * 60000)
      await tx.snapshotPolicy.upsert({ where: { instanceId: instanceIdNum },
        create: { instanceId: instanceIdNum, enabled, intervalMinutes, nextRunAt },
        update: { enabled, intervalMinutes, nextRunAt } })
    })

    return { message: 'Auto snapshot policy updated' }
  })

  fastify.post<{ Params: { instanceId: string; operationId: string } }>('/:instanceId/snapshot-policy/operations/:operationId/retry', {
    onRequest: [fastify.authenticateUser]
  }, async (request, reply) => {
    const instanceIdNum = parsePositiveId(request.params.instanceId)
    if (instanceIdNum === null || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.params.operationId)) return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    await retryAutoSnapshotOperation(instanceIdNum, request.params.operationId, request.user)
    return { operation: await autoSnapshotOperationView(instanceIdNum) }
  })
}
