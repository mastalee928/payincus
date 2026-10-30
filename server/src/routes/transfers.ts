import { assertNoPendingSnapshotOperations, SnapshotOperationPendingError } from '../db/snapshot-operation-guards.js'
/**
 * 实例转移路由
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { customAlphabet } from 'nanoid'
import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import type { TransferSnapshot } from '../db/transfers.js'
import { createTransferWithFee, getTransferByIdWithFee, refundTransferFee } from '../db/transfers.js'
import { sendNotification } from '../lib/notifier.js'
import { prisma } from '../db/prisma.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from '../db/advisory-locks.js'
import { assertNoPendingProxySiteOperations, ProxySiteOperationPendingError } from '../db/proxy-site-operation-guards.js'
import { prepareTransferCleanup, runTransferCleanup } from '../services/transfer-cleanup.js'
import type { WriteActor } from '../db/user-write-authorization.js'
import { redactAuditText } from '../lib/risk-audit.js'
import { transferHostIdentity } from '../lib/transfer-host-identity.js'
import {
    checkOperationVerificationRequirement
} from '../lib/operation-verification.js'

// 自定义 nanoid，只使用小写字母和数字（Incus 不允许下划线）
const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)
const TRANSFER_TARGET_USERNAME_MAX_LENGTH = 64
const TRANSFER_REMARK_MAX_LENGTH = 200

type TransferCreateInput = {
    targetUsername: string
    remark?: string
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeTransferCreateInput(input: unknown): TransferCreateInput {
    if (!isPlainRecord(input)) {
        throw { error: 'Invalid request body' }
    }

    if (typeof input.targetUsername !== 'string') {
        throw { error: 'Target username is required' }
    }
    const targetUsername = input.targetUsername.trim()
    if (targetUsername.length < 2 || targetUsername.length > TRANSFER_TARGET_USERNAME_MAX_LENGTH) {
        throw { error: `Target username must be 2-${TRANSFER_TARGET_USERNAME_MAX_LENGTH} characters` }
    }

    let remark: string | undefined
    if (input.remark !== undefined && input.remark !== null) {
        if (typeof input.remark !== 'string') {
            throw { error: 'Remark must be a string' }
        }
        const normalizedRemark = input.remark.trim()
        if (normalizedRemark.length > TRANSFER_REMARK_MAX_LENGTH) {
            throw { error: `Remark must be no longer than ${TRANSFER_REMARK_MAX_LENGTH} characters` }
        }
        remark = normalizedRemark || undefined
    }

    return { targetUsername, remark }
}

async function requireVerifiedOperation(
    reply: FastifyReply,
    userId: number,
    resourceId: number,
    actor: WriteActor
): Promise<boolean> {
    const verification = await checkOperationVerificationRequirement(userId, 'transfer_instance', resourceId, actor)
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

function parsePositiveInteger(value: string | undefined, fallback?: number, max = Number.MAX_SAFE_INTEGER): number | null {
    if (!value) {
        return fallback ?? null
    }

    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
        return fallback ?? null
    }

    return parsed
}

async function claimTransferForProcessing(transferId: number, userId: number, party: 'fromUserId' | 'toUserId') {
    return prisma.$transaction(async tx => {
        const candidate = await tx.instanceTransfer.findFirst({ where: { id: transferId, status: { in: ['pending', 'processing'] }, [party]: userId }, select: { instanceId: true } })
        if (!candidate) return { count: 0 }
        if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, candidate.instanceId)) {
            throw Object.assign(new Error('实例正在执行其他操作，请稍后重试'), { statusCode: 409, code: 'TRANSFER_INSTANCE_BUSY' })
        }
        await tx.$queryRaw`SELECT id FROM instances WHERE id = ${candidate.instanceId} FOR UPDATE`
        const current = await tx.instanceTransfer.findUniqueOrThrow({ where: { id: transferId } })
        if (current[party] !== userId) return { count: 0 }
        // An existing claim resumes its fixed cleanup plan, including pending site deletes.
        if (current.status === 'processing') return { count: 1 }
        await assertNoPendingSnapshotOperations(tx, candidate.instanceId)
        await assertNoPendingProxySiteOperations(tx, candidate.instanceId)
        return tx.instanceTransfer.updateMany({ where: { id: transferId, status: 'pending', [party]: userId }, data: { status: 'processing' } })
    })
}

function transferResultError(error: unknown): { code: string; error: string } {
    const message = redactAuditText(error instanceof Error ? error.message : String(error))
    return { code: 'TRANSFER_CLEANUP_PENDING', error: `实例转移尚未完成，原实例与库存继续保留：${message}` }
}

function transferCleanupError(state: unknown): string | null {
    const error = isPlainRecord(state) && typeof state.error === 'string' ? state.error : null
    return error ? redactAuditText(error).slice(0, 1500) : null
}

async function completeClaimedTransfer(transferId: number, party: 'accept' | 'push',
    actor: WriteActor & { username: string }, transfer: NonNullable<Awaited<ReturnType<typeof db.getTransferById>>>) {
    const instance = await db.getInstanceById(transfer.instanceId)
    if (!instance || instance.status === 'deleted') return { error: apiError(ErrorCode.INSTANCE_NOT_FOUND), status: 400 as const }
    if (!instance.dedicated_ipv4 && instance.status === 'running') {
        return { error: { code: 'INSTANCE_MUST_BE_STOPPED', error: 'Instance must be stopped before transfer' }, status: 400 as const }
    }
    const oldIncusId = instance.incus_id
    const newIncusId = instance.dedicated_ipv4 ? oldIncusId : `u${transfer.toUserId}-${nanoid()}`
    const suffix = `（${party === 'accept' ? transfer.fromUser.username : actor.username}转）`
    let newName = instance.name
    if (!newName.endsWith(suffix)) {
        newName = instance.name + suffix
        if (newName.length > 64) newName = instance.name.substring(0, 64 - suffix.length) + suffix
    }
    try {
        const prepared = await prepareTransferCleanup(transferId, newIncusId, newName, actor)
        newName = prepared.newName
        await runTransferCleanup(transferId, actor)
    } catch (error) {
        await createLog(actor.id, 'transfer', `transfer.${party}`, `Transfer #${transferId} needs cleanup: ${redactAuditText(error instanceof Error ? error.message : String(error))}`,
            'failed', { instanceId: transfer.instanceId })
        return { error: transferResultError(error), status: 409 as const }
    }
    await createLog(actor.id, 'transfer', `transfer.${party}`,
        `${party === 'accept' ? 'Accepted' : 'Pushed'} transfer of instance "${instance.name}" to "${transfer.toUser.username}"`,
        'success', { instanceId: transfer.instanceId })
    if (party === 'accept') await sendNotification(transfer.fromUserId, 'transfer_accepted', {
        instanceName: instance.name, receiverUsername: actor.username
    })
    await sendNotification(transfer.toUserId, 'transfer_ownership_received', { instanceName: newName })
    return { message: party === 'accept' ? 'Transfer accepted' : 'Transfer pushed successfully' }
}

export default async function transferRoutes(fastify: FastifyInstance) {
    // 搜索用户（用于转移时选择接收方）
    fastify.get<{
        Querystring: { username: string }
    }>('/users/search', {
        onRequest: [fastify.authenticateUser]
    }, async (request: FastifyRequest<{
        Querystring: { username: string }
    }>, reply: FastifyReply) => {
        const { username } = request.query

        if (!username || username.length < 2) {
            return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Username must be at least 2 characters'))
        }

        const user = await db.findUserByUsername(username)

        if (!user) {
            return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
        }

        // 不能转移给自己
        if (user.id === request.user.id) {
            return reply.code(400).send(apiError(ErrorCode.TRANSFER_TO_SELF))
        }

        // 不能转移给被封禁的用户
        if (user.status === 'banned') {
            return reply.code(400).send(apiError(ErrorCode.TRANSFER_TO_BANNED))
        }

        // 只返回用户基本信息，不再返回配额信息
        return {
            user: {
                id: user.id,
                username: user.username,
                status: user.status
            }
        }
    })

    // 发起转移请求
    fastify.post<{
        Params: { instanceId: string }
        Body: { targetUsername: string; remark?: string }
    }>('/instances/:instanceId/transfer', {
        onRequest: [fastify.authenticateUser],
        schema: {
            body: {
                type: 'object',
                required: ['targetUsername'],
                properties: {
                    targetUsername: { type: 'string', minLength: 2 },
                    remark: { type: 'string', maxLength: 200 }
                }
            }
        }
    }, async (request: FastifyRequest<{
        Params: { instanceId: string }
        Body: { targetUsername: string; remark?: string }
    }>, reply: FastifyReply) => {
        const instanceId = parsePositiveInteger(request.params.instanceId)
        let transferInput: TransferCreateInput
        try {
            transferInput = normalizeTransferCreateInput(request.body)
        } catch (error) {
            return reply.code(400).send(error)
        }
        const { targetUsername, remark } = transferInput
        const { user } = request

        if (instanceId === null) {
            return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
        }

        // 获取实例
        const instance = await db.getInstanceById(instanceId)
        if (!instance) {
            return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
        }

        // 验证所有权（只能转移自己的实例）
        if (instance.user_id !== user.id) {
            return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
        }

        // 检查实例状态
        if (instance.status === 'creating' || instance.status === 'deleted') {
            return reply.code(400).send(apiError(ErrorCode.TRANSFER_INVALID_STATUS))
        }

        // 封禁状态不允许转移
        // 安全措施：防止用户绕过前端禁用通过API转移封禁实例
        if (instance.status === 'suspended') {
            if (instance.suspend_reason === 'expired') {
                return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
            }
            return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
        }

        // 检查宿主机是否允许转移
        const host = await db.getHostById(instance.host_id)
        if (host && host.transfer_enabled === false) {
            return reply.code(400).send(apiError(ErrorCode.TRANSFER_HOST_DISABLED))
        }
        const transferHost = await prisma.host.findUnique({ where: { id: instance.host_id } })
        if (!transferHost) return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))

        // 检查是否已有待处理的转移
        const hasPending = await db.hasPendingTransfer(instanceId)
        if (hasPending) {
            return reply.code(400).send(apiError(ErrorCode.TRANSFER_ALREADY_PENDING))
        }

        if (!await requireVerifiedOperation(reply, user.id, instanceId, user)) return

        // 查找目标用户
        const targetUser = await db.findUserByUsername(targetUsername)
        if (!targetUser) {
            return reply.code(404).send(apiError(ErrorCode.USER_NOT_FOUND))
        }

        // 不能转移给自己
        if (targetUser.id === instance.user_id) {
            return reply.code(400).send(apiError(ErrorCode.TRANSFER_TO_SELF))
        }

        // 不能转移给被封禁的用户
        if (targetUser.status === 'banned') {
            return reply.code(400).send(apiError(ErrorCode.TRANSFER_TO_BANNED))
        }

        // 获取实例相关数据（host 已在上方获取）
        const pkg = instance.package_id ? await db.getPackageById(instance.package_id) : null
        const portMappings = await db.getPortMappings(instanceId)
        const snapshots = await db.getSnapshotsByInstanceId(instanceId)
        const backups = await db.getBackupsByInstanceId(instanceId)

        // 获取转移手续费配置
        const transferFee = await db.getSystemConfigFloat('transfer_fee', 0)
        
        // 如果有手续费，先检查余额是否足够
        if (transferFee > 0) {
            const userBalance = await db.getUserBalance(user.id)
            if (userBalance < transferFee) {
                return reply.code(400).send(apiError(ErrorCode.TRANSFER_INSUFFICIENT_BALANCE))
            }
        }

        // 构建快照信息
        const snapshot: TransferSnapshot = {
            packageId: instance.package_id,
            packageName: pkg?.name || null,
            hostId: instance.host_id,
            hostName: instance.dedicated_ipv4 ? '' : host?.name || 'unknown',
            hostLocation: host?.location || null,
            hostCountryCode: host?.country_code || 'us',
            originalName: instance.name,
            cpu: instance.cpu,
            memory: instance.memory,
            disk: instance.disk,
            networkMode: instance.network_mode,
            portMappingsCount: portMappings.length,
            snapshotsCount: snapshots.length,
            backupsCount: backups.filter((b: any) => b.status !== 'deleted').length,
            ipv4: instance.dedicated_ipv4 ? host?.nat_public_ip || null : instance.ipv4,
            ipv6: instance.ipv6,
            dedicatedIpv4: instance.dedicated_ipv4 === true
        }

        // 使用事务安全函数创建转移记录（扣费和创建记录在同一事务中）
        // 该函数内部会再次检查是否有 pending 转移，确保并发安全
        let transferId: number
        try {
            const result = await createTransferWithFee({
                instanceId,
                fromUserId: user.id,
                toUserId: targetUser.id,
                snapshot,
                remark,
                fee: transferFee,
                instanceName: instance.name,
                actor: user, expectedIncusId: instance.incus_id, expectedHostIdentity: transferHostIdentity(transferHost)
            })
            transferId = result.transferId
        } catch (error) {
            if ((error instanceof ProxySiteOperationPendingError || error instanceof SnapshotOperationPendingError)) return reply.code(409).send({ code: error.code, error: error.message })
            const errorMsg = error instanceof Error ? error.message : ''
            if (errorMsg === 'VERIFICATION_REQUIRED') return reply.code(403).send({ code: errorMsg, error: 'Sensitive operation requires verification', required: true })
            if (errorMsg === 'AUTHENTICATION_STATE_CHANGED') return reply.code(403).send({ code: errorMsg, error: 'Please sign in again' })
            if (errorMsg === 'INSUFFICIENT_BALANCE') {
                return reply.code(400).send(apiError(ErrorCode.TRANSFER_INSUFFICIENT_BALANCE))
            }
            if (errorMsg === 'BALANCE_CONFLICT') {
                return reply.code(409).send(apiError(ErrorCode.TRANSFER_INSUFFICIENT_BALANCE, '余额正在处理，请稍后重试'))
            }
            if (errorMsg === 'TRANSFER_ALREADY_PENDING') {
                return reply.code(400).send(apiError(ErrorCode.TRANSFER_ALREADY_PENDING))
            }
            if (['TRANSFER_SOURCE_CHANGED', 'TRANSFER_INSTANCE_BUSY', 'TRANSFER_INVALID_STATUS', 'TRANSFER_HOST_DISABLED', 'TRANSFER_TO_BANNED', 'TRANSFER_TO_SELF', 'TRANSFER_FEE_CHANGED'].includes(errorMsg)) {
                return reply.code(409).send({ code: errorMsg, error: '实例或接收用户状态已变化，请刷新后重试' })
            }
            console.error('[Transfer] Failed to create transfer:', error)
            return reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR))
        }

        await createLog(
            user.id,
            'transfer',
            'transfer.create',
            `Created transfer request for instance "${instance.name}" to user "${targetUser.username}"`,
            'success',
            { instanceId }
        )

        // 通知接收方有新的转移请求
        await sendNotification(targetUser.id, 'transfer_received', {
            instanceName: instance.name,
            senderUsername: user.username
        })

        return {
            message: 'Transfer request created',
            transfer: { id: transferId, status: 'pending' }
        }
    })

    // 获取转移列表
    fastify.get<{
        Querystring: {
            type: 'sent' | 'received'
            status?: string
            page?: string
            pageSize?: string
        }
    }>('/', {
        onRequest: [fastify.authenticateUser]
    }, async (request: FastifyRequest<{
        Querystring: {
            type: 'sent' | 'received'
            status?: string
            page?: string
            pageSize?: string
            search?: string
        }
    }>, reply: FastifyReply) => {
        const { type, status, page = '1', pageSize = '20', search } = request.query
        const { user } = request

        if (!type || !['sent', 'received'].includes(type)) {
            return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'type must be "sent" or "received"'))
        }

        const options = {
            page: parsePositiveInteger(page, 1) ?? 1,
            pageSize: parsePositiveInteger(pageSize, 20, 100) ?? 20,
            status,
            search: search as string | undefined
        }

        const result = type === 'sent'
            ? await db.getTransfersSent(user.id, options)
            : await db.getTransfersReceived(user.id, options)

        // 对于 sent 类型的 pending 转移，发起方可以直接推送
        const transfersWithCanPush = result.items.map((t: any) => {
            // 只有 sent tab 且状态为 pending 时，发起方可以直接推送
            const canPush = type === 'sent' && t.status === 'pending' && t.fromUserId === user.id
            return {
                    id: t.id,
                    instanceId: t.instanceId,
                    instanceName: t.instance?.name,
                    instanceStatus: t.instance?.status,
                    instanceImage: t.instance?.image,
                    fromUser: t.fromUser ? { id: t.fromUser.id, username: t.fromUser.username, email: t.fromUser.email, avatarStyle: t.fromUser.avatarStyle, avatarBadgeId: t.fromUser.avatarBadgeId ?? null } : null,
                    toUser: t.toUser ? { id: t.toUser.id, username: t.toUser.username, email: t.toUser.email, avatarStyle: t.toUser.avatarStyle, avatarBadgeId: t.toUser.avatarBadgeId ?? null } : null,
                    status: t.status,
                    cleanupError: transferCleanupError(t.cleanupState),
                    snapshot: t.snapshot,
                    remark: t.remark,
                    rejectReason: t.rejectReason,
                    createdAt: t.createdAt,
                    acceptedAt: t.acceptedAt,
                    rejectedAt: t.rejectedAt,
                    cancelledAt: t.cancelledAt,
                    canPush
                }
            })

        return {
            transfers: transfersWithCanPush,
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            totalPages: result.totalPages
        }
    })

    // 获取待接收数量
    fastify.get('/pending-count', {
        onRequest: [fastify.authenticateUser]
    }, async (request: FastifyRequest) => {
        const count = await db.getPendingReceivedCount(request.user.id)
        return { count }
    })

    // 获取转移详情
    fastify.get<{ Params: { id: string } }>('/:id', {
        onRequest: [fastify.authenticateUser]
    }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const transferId = parsePositiveInteger(request.params.id)
        const { user } = request

        if (transferId === null) {
            return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
        }

        const transfer = await db.getTransferById(transferId)
        if (!transfer) {
            return reply.code(404).send(apiError(ErrorCode.TRANSFER_NOT_FOUND))
        }

        // 管理员只管理系统层面，只有发起方和接收方可以查看
        if (transfer.fromUserId !== user.id && transfer.toUserId !== user.id) {
            return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
        }

        return {
            transfer: {
                id: transfer.id,
                instanceId: transfer.instanceId,
                instanceName: transfer.instance?.name,
                instanceStatus: transfer.instance?.status,
                fromUser: { id: transfer.fromUser.id, username: transfer.fromUser.username, email: transfer.fromUser.email, avatarStyle: transfer.fromUser.avatarStyle, avatarBadgeId: transfer.fromUser.avatarBadgeId ?? null },
                toUser: { id: transfer.toUser.id, username: transfer.toUser.username, email: transfer.toUser.email, avatarStyle: transfer.toUser.avatarStyle, avatarBadgeId: transfer.toUser.avatarBadgeId ?? null },
                status: transfer.status,
                cleanupError: transferCleanupError(transfer.cleanupState),
                snapshot: transfer.snapshot,
                remark: transfer.remark,
                rejectReason: transfer.rejectReason,
                createdAt: transfer.createdAt,
                acceptedAt: transfer.acceptedAt,
                rejectedAt: transfer.rejectedAt,
                cancelledAt: transfer.cancelledAt
            }
        }
    })

    // 接受转移
    fastify.post<{ Params: { id: string } }>('/:id/accept', {
        onRequest: [fastify.authenticateUser]
    }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const transferId = parsePositiveInteger(request.params.id)
        const { user } = request

        if (transferId === null) {
            return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
        }

        // ===== 并发安全：使用乐观锁，原子性地检查并更新状态 =====
        // 使用 updateMany 原子操作，只有 status='pending' 时才更新为 'processing'
        let lockResult: { count: number }
        try { lockResult = await claimTransferForProcessing(transferId, user.id, 'toUserId') }
        catch (error) {
            if ((error instanceof ProxySiteOperationPendingError || error instanceof SnapshotOperationPendingError)) return reply.code(409).send({ code: error.code, error: error.message })
            throw error
        }

        // 如果没有更新任何记录，说明状态已变化或权限不足
        if (lockResult.count === 0) {
            // 需要区分是不存在、权限不足还是状态已变化
            const transfer = await db.getTransferById(transferId)
            if (!transfer) {
                return reply.code(404).send(apiError(ErrorCode.TRANSFER_NOT_FOUND))
            }
            if (transfer.toUserId !== user.id) {
                return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
            }
            // 状态已不是 pending（可能是 processing 或其他）
            return reply.code(400).send(apiError(ErrorCode.TRANSFER_NOT_PENDING))
        }

        // 重新获取完整的转移信息
        const transfer = await db.getTransferById(transferId)
        if (!transfer) {
            return reply.code(404).send(apiError(ErrorCode.TRANSFER_NOT_FOUND))
        }

        const result = await completeClaimedTransfer(transferId, 'accept', user, transfer)
        if ('error' in result) return reply.code(result.status ?? 409).send(result.error)
        return { message: result.message }
    })

    // 拒绝转移
    fastify.post<{
        Params: { id: string }
        Body: { reason?: string }
    }>('/:id/reject', {
        onRequest: [fastify.authenticateUser],
        schema: {
            body: {
                type: 'object',
                properties: {
                    reason: { type: 'string', maxLength: 200 }
                }
            }
        }
    }, async (request: FastifyRequest<{
        Params: { id: string }
        Body: { reason?: string }
    }>, reply: FastifyReply) => {
        const transferId = parsePositiveInteger(request.params.id)
        const { reason } = request.body
        const { user } = request

        if (transferId === null) {
            return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
        }

        // ===== 并发安全：使用乐观锁，原子性地检查并更新状态 =====
        const rejectResult = await prisma.instanceTransfer.updateMany({
            where: {
                id: transferId,
                status: 'pending',
                toUserId: user.id  // 同时验证权限
            },
            data: {
                status: 'rejected',
                rejectReason: reason || null,
                rejectedAt: new Date()
            }
        })

        // 如果没有更新任何记录，需要区分原因
        if (rejectResult.count === 0) {
            const transfer = await db.getTransferById(transferId)
            if (!transfer) {
                return reply.code(404).send(apiError(ErrorCode.TRANSFER_NOT_FOUND))
            }
            if (transfer.toUserId !== user.id) {
                return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
            }
            // 状态已不是 pending
            return reply.code(400).send(apiError(ErrorCode.TRANSFER_NOT_PENDING))
        }

        // 重新获取转移信息用于日志和通知（使用包含fee字段的查询）
        const transfer = await getTransferByIdWithFee(transferId)
        if (!transfer) {
            // 已更新成功但查询失败，直接返回成功
            return { message: 'Transfer rejected' }
        }

        // 退还手续费（如果有）
        if (transfer.fee && Number(transfer.fee) > 0) {
            const refundResult = await refundTransferFee({
                transferId: transfer.id,
                fromUserId: transfer.fromUserId,
                fee: Number(transfer.fee),
                instanceId: transfer.instanceId,
                instanceName: transfer.instance?.name || 'Unknown',
                reason: 'rejected'
            })
            
            if (!refundResult.success) {
                console.error('[Transfer] Failed to refund transfer fee:', refundResult.error)
            }
        }

        await createLog(
            user.id,
            'transfer',
            'transfer.reject',
            `Rejected transfer of instance "${transfer.instance?.name}" from "${transfer.fromUser.username}"${reason ? `: ${reason}` : ''}`,
            'success',
            { instanceId: transfer.instanceId }
        )

        // 通知发起方转移已被拒绝
        await sendNotification(transfer.fromUserId, 'transfer_rejected', {
            instanceName: transfer.instance?.name || 'Unknown',
            receiverUsername: user.username
        })

        return { message: 'Transfer rejected' }
    })

    // 取消转移
    fastify.post<{ Params: { id: string } }>('/:id/cancel', {
        onRequest: [fastify.authenticateUser]
    }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const transferId = parsePositiveInteger(request.params.id)
        const { user } = request

        if (transferId === null) {
            return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
        }

        // ===== 并发安全：使用乐观锁，原子性地检查并更新状态 =====
        const cancelResult = await prisma.instanceTransfer.updateMany({
            where: {
                id: transferId,
                status: 'pending',
                fromUserId: user.id  // 同时验证权限（只有发起方可以取消）
            },
            data: {
                status: 'cancelled',
                cancelledAt: new Date()
            }
        })

        // 如果没有更新任何记录，需要区分原因
        if (cancelResult.count === 0) {
            const transfer = await db.getTransferById(transferId)
            if (!transfer) {
                return reply.code(404).send(apiError(ErrorCode.TRANSFER_NOT_FOUND))
            }
            if (transfer.fromUserId !== user.id) {
                return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
            }
            // 状态已不是 pending
            return reply.code(400).send(apiError(ErrorCode.TRANSFER_NOT_PENDING))
        }

        // 重新获取转移信息用于日志、通知和退款（使用包含fee字段的查询）
        const transfer = await getTransferByIdWithFee(transferId)
        if (!transfer) {
            // 已更新成功但查询失败，直接返回成功
            return { message: 'Transfer cancelled' }
        }

        // 退还手续费（如果有）
        if (transfer.fee && Number(transfer.fee) > 0) {
            const refundResult = await refundTransferFee({
                transferId: transfer.id,
                fromUserId: transfer.fromUserId,
                fee: Number(transfer.fee),
                instanceId: transfer.instanceId,
                instanceName: transfer.instance?.name || 'Unknown',
                reason: 'cancelled'
            })
            
            if (!refundResult.success) {
                console.error('[Transfer] Failed to refund transfer fee on cancel:', refundResult.error)
            }
        }

        await createLog(
            user.id,
            'transfer',
            'transfer.cancel',
            `Cancelled transfer of instance "${transfer.instance?.name}" to "${transfer.toUser.username}"`,
            'success',
            { instanceId: transfer.instanceId }
        )

        // 通知接收方转移已被取消
        await sendNotification(transfer.toUserId, 'transfer_cancelled', {
            instanceName: transfer.instance?.name || 'Unknown',
            senderUsername: user.username
        })

        return { message: 'Transfer cancelled' }
    })

    // 直接推送（宿主机所有者作为转移发起方时可直接将实例推送给接收方）
    fastify.post<{ Params: { id: string } }>('/:id/push', {
        onRequest: [fastify.authenticateUser]
    }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const transferId = parsePositiveInteger(request.params.id)
        const { user } = request

        if (transferId === null) {
            return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
        }

        // ===== 并发安全：使用乐观锁，原子性地检查并更新状态 =====
        // 使用 updateMany 原子操作，只有 status='pending' 且 fromUserId=user.id 时才更新为 'processing'
        let lockResult: { count: number }
        try { lockResult = await claimTransferForProcessing(transferId, user.id, 'fromUserId') }
        catch (error) {
            if ((error instanceof ProxySiteOperationPendingError || error instanceof SnapshotOperationPendingError)) return reply.code(409).send({ code: error.code, error: error.message })
            throw error
        }

        // 如果没有更新任何记录，说明状态已变化或权限不足
        if (lockResult.count === 0) {
            const transfer = await db.getTransferById(transferId)
            if (!transfer) {
                return reply.code(404).send(apiError(ErrorCode.TRANSFER_NOT_FOUND))
            }
            if (transfer.fromUserId !== user.id) {
                return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
            }
            // 状态已不是 pending
            return reply.code(400).send(apiError(ErrorCode.TRANSFER_NOT_PENDING))
        }

        // 重新获取完整的转移信息
        const transfer = await db.getTransferById(transferId)
        if (!transfer) {
            return reply.code(404).send(apiError(ErrorCode.TRANSFER_NOT_FOUND))
        }

        const result = await completeClaimedTransfer(transferId, 'push', user, transfer)
        if ('error' in result) return reply.code(result.status ?? 409).send(result.error)
        return { message: result.message }
    })
}
