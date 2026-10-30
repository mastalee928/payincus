/**
 * 敏感操作二次验证服务
 * 
 * 账号相关操作：通过邮件验证
 * 资源相关操作：通过用户绑定的通知渠道验证
 */

import { prisma } from '../db/prisma.js'
import { OperationType, VerificationChannel, type Prisma, type NotificationChannel } from '@prisma/client'
import { sendOperationVerificationEmail } from './mailer.js'
import { sendVerificationNotification } from './notifier.js'
import { authorizeUserWrite, type WriteActor } from '../db/user-write-authorization.js'
import { accountOperationVerificationBinding, notificationOperationVerificationBinding } from '../db/operation-verification-binding.js'
import {
    OPERATION_VERIFICATION_REQUEST_LOCK_NAMESPACE,
    advisoryTransactionLockString
} from '../db/advisory-locks.js'
import crypto from 'crypto'

// Destroy-email records have their own session/set binding, lifetime and send
// budget. Generic verification must neither authorize nor remove those records.
const GENERIC_VERIFICATIONS: Prisma.OperationVerificationWhereInput = {
    OR: [{ resourceType: null }, { resourceType: { not: { startsWith: 'destroy-email:v1:' } } }]
}

// 操作类型分类
const ACCOUNT_OPERATIONS: OperationType[] = [
    'change_password',
    'disable_2fa',
    'change_email',
    'delete_account'
]

const RESOURCE_OPERATIONS: OperationType[] = [
    'delete_instance',
    'reinstall_instance',
    'recreate_instance',
    'transfer_instance',
    'delete_snapshot',
    'delete_backup'
]

// 验证码配置
const VERIFICATION_CONFIG = {
    codeLength: 6,
    expiresInMinutes: 10,
    maxAttempts: 5,
    resendAfterSeconds: 60
}

// Delivery markers are not eligible attempt counts. Persist them before sending,
// and keep only active I/O in memory under the single-backend deployment contract.
const DELIVERY_PENDING = VERIFICATION_CONFIG.maxAttempts + 1
const DELIVERY_FAILED = VERIFICATION_CONFIG.maxAttempts + 2
const pendingOperationDeliveries = new Map<string, number>()
const pendingOperationAccountDeliveries = new Map<number, number>()

// 操作类型显示名称（用于通知）
const OPERATION_NAMES: Record<OperationType, { zh: string; en: string }> = {
    change_password: { zh: '修改密码', en: 'Change Password' },
    disable_2fa: { zh: '禁用双因素认证', en: 'Disable 2FA' },
    change_email: { zh: '修改邮箱地址', en: 'Change Email' },
    delete_account: { zh: '删除账户', en: 'Delete Account' },
    delete_instance: { zh: '删除实例', en: 'Delete Instance' },
    reinstall_instance: { zh: '重装实例', en: 'Reinstall Instance' },
    recreate_instance: { zh: '重建实例', en: 'Recreate Instance' },
    transfer_instance: { zh: '转移实例', en: 'Transfer Instance' },
    delete_snapshot: { zh: '删除快照', en: 'Delete Snapshot' },
    delete_backup: { zh: '删除备份', en: 'Delete Backup' }
}

/**
 * 生成6位随机验证码
 */
function generateVerificationCode(): string {
    return crypto.randomInt(100000, 1000000).toString()
}

function hashVerificationCode(code: string): string {
    return `sha256:${crypto.createHash('sha256').update(code).digest('hex')}`
}

function verificationCodeMatches(storedCode: string, inputCode: string): boolean {
    if (storedCode.startsWith('sha256:')) {
        return storedCode === hashVerificationCode(inputCode)
    }

    return storedCode === inputCode
}

/**
 * 判断操作类型是否为账号相关操作
 */
export function isAccountOperation(operationType: OperationType): boolean {
    return ACCOUNT_OPERATIONS.includes(operationType)
}

/**
 * 判断操作类型是否为资源相关操作
 */
export function isResourceOperation(operationType: OperationType): boolean {
    return RESOURCE_OPERATIONS.includes(operationType)
}

/**
 * 获取操作名称
 */
export function getOperationName(operationType: OperationType, lang: 'zh' | 'en' = 'zh'): string {
    return OPERATION_NAMES[operationType]?.[lang] || operationType
}

/**
 * 获取用户的首选通知渠道
 */
async function getUserNotificationChannel(userId: number): Promise<NotificationChannel | null> {
    return prisma.notificationChannel.findFirst({
        where: {
            userId,
            enabled: true,
            isGlobal: false,
            alertCategory: null
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    })
}

function maskNotificationTarget(notificationChannel: NotificationChannel): string {
    const config = typeof notificationChannel.config === 'string'
        ? JSON.parse(notificationChannel.config)
        : notificationChannel.config
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid notification configuration')

    switch (notificationChannel.type) {
        case 'telegram':
            if (typeof config.chatId !== 'string' || !config.chatId) throw new Error('Missing notification target')
            return `Telegram (${config.chatId.substring(0, 6)}***)`
        case 'discord':
            return 'Discord Webhook'
        case 'webhook':
            return 'Webhook'
        case 'email': {
            if (typeof config.email !== 'string' || !config.email.includes('@')) throw new Error('Missing notification target')
            const [local, domain] = config.email.split('@')
            return `${local.substring(0, 2)}***@${domain}`
        }
        default:
            throw new Error('Unsupported notification channel')
    }
}

export interface RequestVerificationResult {
    success: boolean
    channel?: VerificationChannel
    maskedTarget?: string
    expiresIn?: number
    alreadySent?: boolean
    resendAfter?: number
    error?: string
    errorCode?: string
}

type PreparedOperationVerification =
    | { alreadySent: true; expiresIn: number; resendAfter: number }
    | { alreadySent: false; code: string; codeHash: string; recordId: number; createdAt: Date; expiresAt: Date }
    | { error: string; errorCode: string; resendAfter?: number }

function notificationTargetBinding(channel: NotificationChannel): string {
    // Persist only a digest, never notification credentials or recipient data.
    return 'notification-target:v1:' + crypto.createHash('sha256').update(JSON.stringify([
        channel.id, channel.type, channel.config
    ])).digest('hex')
}

async function currentNotificationVerificationBinding(tx: Prisma.TransactionClient, actor: WriteActor): Promise<string | null> {
    const userId = actor.id
    // Hold existing channel rows through the verification/claim, so a concurrent
    // update or deletion cannot change the recipient between lookup and use.
    await tx.$queryRaw`SELECT id FROM notification_channels WHERE user_id = ${userId} ORDER BY id FOR SHARE`
    const channel = await tx.notificationChannel.findFirst({
        where: { userId, enabled: true, isGlobal: false, alertCategory: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    })
    if (!channel) return null
    try { maskNotificationTarget(channel) } catch { return null }
    return notificationOperationVerificationBinding(actor, channel)
}

async function currentDeliveryAuthorized(tx: Prisma.TransactionClient, userId: number, actor: WriteActor | undefined,
    email: string | null, notificationChannel: NotificationChannel | null): Promise<boolean> {
    if (!actor || actor.id !== userId || !await authorizeUserWrite(tx, userId, actor)) return false
    if (!notificationChannel) return (await tx.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email === email
    const current = await tx.notificationChannel.findUnique({ where: { id: notificationChannel.id } })
    return Boolean(current && current.userId === userId && current.enabled && !current.isGlobal && current.alertCategory === null &&
        notificationTargetBinding(current) === notificationTargetBinding(notificationChannel))
}

function getOperationVerificationRequestLockKey(
    userId: number,
    operationType: OperationType,
    resourceId?: number
): string {
    return `${userId}:${operationType}:${resourceId ?? 'account'}`
}

/**
 * 请求二次验证码
 */
export async function requestOperationVerification(
    userId: number,
    operationType: OperationType,
    resourceId?: number,
    resourceType?: string,
    actor?: WriteActor
): Promise<RequestVerificationResult> {
    if (resourceType?.startsWith('destroy-email:v1:')) {
        return { success: false, error: 'Use the instance destroy email verification flow', errorCode: 'INVALID_OPERATION' }
    }
    // 1. 获取用户信息
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, username: true }
    })

    if (!user) {
        return { success: false, error: 'User not found', errorCode: 'USER_NOT_FOUND' }
    }

    // 2. 确定验证渠道
    let channel: VerificationChannel
    let maskedTarget: string
    let notificationChannel: NotificationChannel | null = null

    if (isAccountOperation(operationType)) {
        // 账号操作：强制使用邮件
        if (!user.email) {
            return { success: false, error: 'Email not configured', errorCode: 'EMAIL_NOT_CONFIGURED' }
        }
        channel = 'email'
        // 遮蔽邮箱
        const [localPart, domain] = user.email.split('@')
        maskedTarget = `${localPart.substring(0, 2)}***@${domain}`
    } else {
        // 资源操作：使用用户绑定的通知渠道
        notificationChannel = await getUserNotificationChannel(userId)
        if (!notificationChannel) {
            // 没有绑定通知渠道，不需要二次验证
            return { 
                success: false, 
                error: 'No notification channel configured', 
                errorCode: 'NO_NOTIFICATION_CHANNEL' 
            }
        }
        channel = notificationChannel.type
        try { maskedTarget = maskNotificationTarget(notificationChannel) }
        catch { return { success: false, error: 'Notification channel configuration is invalid', errorCode: 'SEND_FAILED' } }
    }

    let pendingRecordId: number | undefined
    const requestKey = getOperationVerificationRequestLockKey(userId, operationType, resourceId)
    const verificationResourceType = notificationChannel && actor ? notificationOperationVerificationBinding(actor, notificationChannel)
        : actor ? accountOperationVerificationBinding(actor, user.email) : null
    const prepared = await prisma.$transaction(async (tx): Promise<PreparedOperationVerification> => {
        if (!await currentDeliveryAuthorized(tx, userId, actor, user.email, notificationChannel)) {
            return { error: 'Account or session state changed. Please sign in again.', errorCode: 'AUTHENTICATION_STATE_CHANGED' }
        }
        await advisoryTransactionLockString(tx, OPERATION_VERIFICATION_REQUEST_LOCK_NAMESPACE, `generic-account:${userId}`)
        await advisoryTransactionLockString(
            tx,
            OPERATION_VERIFICATION_REQUEST_LOCK_NAMESPACE,
            getOperationVerificationRequestLockKey(userId, operationType, resourceId)
        )

        // Keep the in-flight gate even if an expired row is removed by cleanup.
        if (pendingOperationDeliveries.has(requestKey) || pendingOperationAccountDeliveries.has(userId)) {
            return { error: 'Verification delivery is in progress', errorCode: 'VERIFICATION_PENDING' }
        }

        const now = new Date()
        const normalizedResourceId = resourceId || null
        const accountSend = await tx.operationVerification.findFirst({
            where: { userId, ...GENERIC_VERIFICATIONS }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
        })
        const accountResendAfter = accountSend ? Math.max(0, Math.ceil(VERIFICATION_CONFIG.resendAfterSeconds -
            (now.getTime() - accountSend.createdAt.getTime()) / 1000)) : 0
        if (accountSend && accountResendAfter > 0 && (accountSend.operationType !== operationType ||
            accountSend.resourceId !== normalizedResourceId || accountSend.expiresAt <= now)) {
            return { error: 'Please wait before requesting another verification code', errorCode: 'VERIFICATION_RATE_LIMITED', resendAfter: accountResendAfter }
        }

        // 3. 清理过期的验证码
        await tx.operationVerification.deleteMany({
            where: {
                userId,
                ...GENERIC_VERIFICATIONS,
                expiresAt: { lt: now },
                createdAt: { lte: new Date(now.getTime() - VERIFICATION_CONFIG.resendAfterSeconds * 1000) }
            }
        })

        // 4. 检查是否有未过期的同类型验证码（防止频繁请求）
        const existingVerification = await tx.operationVerification.findFirst({
            where: {
                userId,
                operationType,
                resourceId: normalizedResourceId,
                ...GENERIC_VERIFICATIONS,
                expiresAt: { gt: now }
            },
            orderBy: { createdAt: 'desc' }
        })

        if (existingVerification) {
            if (existingVerification.attempts === DELIVERY_PENDING) {
                // A pending marker without active I/O survives an interrupted
                // process. It cannot prove delivery or authorize an operation.
                await tx.operationVerification.updateMany({
                    where: { id: existingVerification.id, attempts: DELIVERY_PENDING, verified: false },
                    data: { attempts: DELIVERY_FAILED }
                })
                existingVerification.attempts = DELIVERY_FAILED
            }
            // Match the UI resend interval; code lifetime is a separate value.
            const resendAfter = Math.max(0, Math.ceil(VERIFICATION_CONFIG.resendAfterSeconds -
                (now.getTime() - existingVerification.createdAt.getTime()) / 1000))
            if (resendAfter > 0) {
                if (isAccountOperation(operationType) && existingVerification.resourceType !== verificationResourceType) {
                    return { error: 'Please wait before requesting another verification code', errorCode: 'VERIFICATION_RATE_LIMITED', resendAfter }
                }
                if (notificationChannel && (existingVerification.channel !== channel || existingVerification.resourceType !== verificationResourceType)) {
                    // Another session must neither describe nor revoke this
                    // session's delivery. Current target checks reject old targets.
                    return { error: 'Please wait before requesting another verification code', errorCode: 'VERIFICATION_RATE_LIMITED', resendAfter }
                }
                if (existingVerification.verified || existingVerification.attempts >= VERIFICATION_CONFIG.maxAttempts) {
                    return { error: 'Please wait before requesting another verification code', errorCode: 'VERIFICATION_RATE_LIMITED', resendAfter }
                }
                await tx.operationVerification.deleteMany({
                    where: {
                        userId,
                        operationType,
                        resourceId: normalizedResourceId,
                        ...GENERIC_VERIFICATIONS,
                        verified: false,
                        expiresAt: { gt: now },
                        id: { not: existingVerification.id }
                    }
                })

                const remainingSeconds = Math.ceil((existingVerification.expiresAt.getTime() - now.getTime()) / 1000)
                return {
                    alreadySent: true,
                    expiresIn: remainingSeconds,
                    resendAfter
                }
            }

            // Revoke prior codes and grants, retaining their send timestamps.
            await tx.operationVerification.updateMany({
                where: {
                    userId,
                    operationType,
                    resourceId: normalizedResourceId,
                    ...GENERIC_VERIFICATIONS,
                    expiresAt: { gt: now }
                },
                data: { verified: true, verifiedAt: null }
            })
        }

        // 5. 生成新验证码
        const code = generateVerificationCode()
        const codeHash = hashVerificationCode(code)
        const expiresAt = new Date(now.getTime() + VERIFICATION_CONFIG.expiresInMinutes * 60 * 1000)

        // 6. 存储验证码
        const record = await tx.operationVerification.create({
            data: {
                userId,
                operationType,
                code: codeHash,
                channel,
                attempts: DELIVERY_PENDING,
                resourceId: normalizedResourceId,
                resourceType: verificationResourceType,
                expiresAt,
                createdAt: now
            }
        })

        pendingRecordId = record.id
        pendingOperationDeliveries.set(requestKey, record.id)
        pendingOperationAccountDeliveries.set(userId, record.id)
        return { alreadySent: false, code, codeHash, recordId: record.id, createdAt: now, expiresAt }
    }).catch(error => {
        if (pendingRecordId !== undefined && pendingOperationDeliveries.get(requestKey) === pendingRecordId) pendingOperationDeliveries.delete(requestKey)
        if (pendingRecordId !== undefined && pendingOperationAccountDeliveries.get(userId) === pendingRecordId) pendingOperationAccountDeliveries.delete(userId)
        throw error
    })

    if ('errorCode' in prepared) return { success: false, ...prepared }

    if (prepared.alreadySent) {
        return {
            success: true,
            alreadySent: true,
            resendAfter: prepared.resendAfter,
            channel,
            maskedTarget,
            expiresIn: prepared.expiresIn,
            error: 'Verification code already sent, please wait'
        }
    }

    // 7. 发送验证码
    const operationName = getOperationName(operationType, 'zh')

    try {
        let sent = false
        try {
            const data = { operationName, code: prepared.code, expiresInMinutes: VERIFICATION_CONFIG.expiresInMinutes }
            sent = !notificationChannel
                ? (await sendOperationVerificationEmail(user.email!, { username: user.username, ...data })).success
                : (await sendVerificationNotification(notificationChannel, { username: user.username, ...data })).success
        } catch { /* A thrown transport failure cannot leave an eligible code. */ }
        if (!sent) {
            // Retain the timestamp for the resend budget, but never allow this
            // code to verify or let a later request claim it was sent.
            await prisma.operationVerification.updateMany({
                where: { id: prepared.recordId, userId, operationType, code: prepared.codeHash, attempts: DELIVERY_PENDING, verified: false, ...GENERIC_VERIFICATIONS },
                data: { attempts: DELIVERY_FAILED }
            })
            return { success: false, error: 'Verification code could not be sent. Please try again later.', errorCode: 'SEND_FAILED',
                resendAfter: Math.max(0, Math.ceil(VERIFICATION_CONFIG.resendAfterSeconds - (Date.now() - prepared.createdAt.getTime()) / 1000)) }
        }
        const activated = await prisma.$transaction(async tx => {
            if (!await currentDeliveryAuthorized(tx, userId, actor, user.email, notificationChannel)) {
                await tx.operationVerification.updateMany({
                    where: { id: prepared.recordId, attempts: DELIVERY_PENDING, verified: false }, data: { attempts: DELIVERY_FAILED }
                })
                return { count: 0, authenticationChanged: true }
            }
            return tx.operationVerification.updateMany({
                where: { id: prepared.recordId, userId, operationType, code: prepared.codeHash, attempts: DELIVERY_PENDING, verified: false, expiresAt: { gt: new Date() }, ...GENERIC_VERIFICATIONS },
                data: { attempts: 0 }
            })
        })
        if ('authenticationChanged' in activated) return { success: false, error: 'Account or session state changed. Please sign in again.', errorCode: 'AUTHENTICATION_STATE_CHANGED' }
        if (activated.count !== 1) return { success: false, error: 'Verification code is no longer available. Please request a new code.', errorCode: 'INVALID_CODE' }
        const now = Date.now()
        return {
            success: true, channel, maskedTarget, alreadySent: false,
            expiresIn: Math.max(0, Math.ceil((prepared.expiresAt.getTime() - now) / 1000)),
            resendAfter: Math.max(0, Math.ceil(VERIFICATION_CONFIG.resendAfterSeconds - (now - prepared.createdAt.getTime()) / 1000))
        }
    } finally {
        if (pendingOperationDeliveries.get(requestKey) === prepared.recordId) pendingOperationDeliveries.delete(requestKey)
        if (pendingOperationAccountDeliveries.get(userId) === prepared.recordId) pendingOperationAccountDeliveries.delete(userId)
    }
}

export interface VerifyOperationResult {
    success: boolean
    verified: boolean
    error?: string
    errorCode?: string
}

async function recordFailedVerificationAttempt(tx: Prisma.TransactionClient, verificationId: number): Promise<boolean> {
    const updated = await tx.operationVerification.updateMany({
        where: { id: verificationId, verified: false, expiresAt: { gt: new Date() },
            attempts: { lt: VERIFICATION_CONFIG.maxAttempts }, ...GENERIC_VERIFICATIONS },
        data: { attempts: { increment: 1 } }
    })
    if (updated.count !== 1) return true
    const verification = await tx.operationVerification.findUnique({
        where: { id: verificationId }, select: { attempts: true }
    })
    // Keep the exhausted row for its resend timestamp. Atomic bounded increments
    // also prevent concurrent wrong guesses from becoming delivery markers.
    return !verification || verification.attempts >= VERIFICATION_CONFIG.maxAttempts
}

/**
 * 验证二次验证码
 */
export async function verifyOperationCode(
    userId: number,
    operationType: OperationType,
    code: string,
    resourceId?: number,
    actor?: WriteActor
): Promise<VerifyOperationResult> {
    return prisma.$transaction(async tx => {
        if (!actor || actor.id !== userId || !await authorizeUserWrite(tx, userId, actor)) {
            return { success: false, verified: false, error: 'Account or session state changed. Please sign in again.', errorCode: 'AUTHENTICATION_STATE_CHANGED' }
        }
        const now = new Date()
        const accountBinding = isAccountOperation(operationType) ? accountOperationVerificationBinding(actor,
            (await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } })).email) : null
        const resourceBinding = isResourceOperation(operationType) ? await currentNotificationVerificationBinding(tx, actor) : null
        if (isResourceOperation(operationType) && !resourceBinding) {
            return { success: false, verified: false, error: 'Invalid or expired verification code', errorCode: 'INVALID_CODE' }
        }
        const codeHash = hashVerificationCode(code)
        const candidates = await tx.operationVerification.findMany({
            where: {
                userId,
                operationType,
                resourceId: resourceId || null,
                ...GENERIC_VERIFICATIONS,
                ...(accountBinding ? { resourceType: accountBinding } : {}),
                ...(resourceBinding ? { resourceType: resourceBinding } : {}),
                verified: false,
                expiresAt: { gt: now },
                attempts: { lt: VERIFICATION_CONFIG.maxAttempts }
            },
            orderBy: { createdAt: 'desc' }
        })
        const verification = candidates.find(candidate => (
            candidate.code === codeHash || verificationCodeMatches(candidate.code, code)
        ))

        if (!verification) {
            const activeVerification = candidates[0]
            if (activeVerification) {
                const exhausted = await recordFailedVerificationAttempt(tx, activeVerification.id)
                if (exhausted) {
                    return {
                        success: false,
                        verified: false,
                        error: 'Too many verification attempts, please request a new code',
                        errorCode: 'TOO_MANY_ATTEMPTS'
                    }
                }
            }

            return {
                success: false,
                verified: false,
                error: 'Invalid or expired verification code',
                errorCode: 'INVALID_CODE'
            }
        }

        // 标记为已验证。使用条件 updateMany 避免候选记录被并发清理/耗尽时抛出 500。
        const verifiedAt = new Date()
        const claimed = await tx.operationVerification.updateMany({
            where: {
                id: verification.id,
                userId,
                operationType,
                resourceId: resourceId || null,
                ...GENERIC_VERIFICATIONS,
                ...(resourceBinding ? { resourceType: resourceBinding } : {}),
                verified: false,
                expiresAt: { gt: verifiedAt },
                attempts: { lt: VERIFICATION_CONFIG.maxAttempts }
            },
            data: {
                verified: true,
                verifiedAt
            }
        })

        if (claimed.count !== 1) {
            return {
                success: false,
                verified: false,
                error: 'Invalid or expired verification code',
                errorCode: 'INVALID_CODE'
            }
        }

        return { success: true, verified: true }
    })
}

/**
 * 检查操作是否已经通过二次验证
 * 验证在10分钟内有效
 */
export async function isOperationVerified(
    userId: number,
    operationType: OperationType,
    resourceId?: number,
    actor?: WriteActor
): Promise<boolean> {
    if (isAccountOperation(operationType)) {
        return prisma.$transaction(async tx => {
            if (!actor || actor.id !== userId || !await authorizeUserWrite(tx, userId, actor)) return false
            const current = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } })
            return Boolean(await tx.operationVerification.findFirst({ where: {
                userId, operationType, resourceId: resourceId || null, resourceType: accountOperationVerificationBinding(actor, current.email),
                verified: true, expiresAt: { gt: new Date() }, verifiedAt: { gt: new Date(Date.now() - 10 * 60000) }
            } }))
        })
    }
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)
    
    const verification = await prisma.$transaction(async tx => {
        if (!actor || actor.id !== userId || !await authorizeUserWrite(tx, userId, actor)) return null
        const resourceBinding = await currentNotificationVerificationBinding(tx, actor)
        if (!resourceBinding) return null
        return tx.operationVerification.findFirst({
            where: {
                userId,
                operationType,
                resourceId: resourceId || null,
                ...GENERIC_VERIFICATIONS,
                resourceType: resourceBinding,
                verified: true,
                expiresAt: { gt: new Date() },
                verifiedAt: { gt: tenMinutesAgo }
            }
        })
    })

    return !!verification
}

export async function checkOperationVerificationRequirement(
    userId: number,
    operationType: OperationType,
    resourceId?: number,
    actor?: WriteActor
): Promise<{ required: boolean; verified: boolean }> {
    const required = isAccountOperation(operationType) || await isResourceVerificationRequired(userId)
    if (!required) {
        return { required: false, verified: true }
    }

    return {
        required: true,
        verified: await isOperationVerified(userId, operationType, resourceId, actor)
    }
}

/**
 * 原子领取一次已通过的二次验证记录。
 * 用于真正执行敏感操作前，避免同一条 verified 记录被并发请求重复复用。
 */
export async function claimOperationVerificationRequirement(
    userId: number,
    operationType: OperationType,
    resourceId?: number,
    actor?: WriteActor
): Promise<{ required: boolean; verified: boolean }> {
    if (isAccountOperation(operationType)) {
        return prisma.$transaction(async tx => {
            if (!actor || actor.id !== userId || !await authorizeUserWrite(tx, userId, actor)) return { required: true, verified: false }
            const current = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } })
            const result = await tx.operationVerification.updateMany({ where: {
                userId, operationType, resourceId: resourceId || null, resourceType: accountOperationVerificationBinding(actor, current.email),
                verified: true, expiresAt: { gt: new Date() }, verifiedAt: { gt: new Date(Date.now() - 10 * 60000) }
            }, data: { verifiedAt: null } })
            return { required: true, verified: result.count > 0 }
        })
    }

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)
    return prisma.$transaction(async tx => {
        if (!actor || actor.id !== userId || !await authorizeUserWrite(tx, userId, actor)) return { required: true, verified: false }
        const resourceBinding = await currentNotificationVerificationBinding(tx, actor)
        if (!resourceBinding) {
            const configured = await tx.notificationChannel.findFirst({
                where: { userId, enabled: true, isGlobal: false, alertCategory: null }, select: { id: true }
            })
            return { required: Boolean(configured), verified: !configured }
        }
        const result = await tx.operationVerification.updateMany({
            where: {
                userId,
                operationType,
                resourceId: resourceId || null,
                ...GENERIC_VERIFICATIONS,
                resourceType: resourceBinding,
                verified: true,
                expiresAt: { gt: new Date() },
                verifiedAt: { gt: tenMinutesAgo }
            },
            data: { verifiedAt: null }
        })
        return { required: true, verified: result.count > 0 }
    })
}

/**
 * 清理已使用的验证记录（操作完成后调用）
 */
export async function consumeOperationVerification(
    userId: number,
    operationType: OperationType,
    resourceId?: number
): Promise<void> {
    await prisma.operationVerification.updateMany({
        where: {
            userId,
            operationType,
            resourceId: resourceId || null,
            ...GENERIC_VERIFICATIONS,
            verified: true
        },
        data: { verifiedAt: null }
    })
}

/**
 * 检查资源操作是否需要二次验证
 * 如果用户没有绑定通知渠道，则不需要二次验证
 */
export async function isResourceVerificationRequired(userId: number): Promise<boolean> {
    const channel = await getUserNotificationChannel(userId)
    return channel !== null
}

/**
 * 清理过期的验证记录（定期调用）
 * 删除所有已过期的验证记录
 */
export async function cleanupExpiredVerifications(): Promise<number> {
    const now = new Date()
    const result = await prisma.operationVerification.deleteMany({
        where: {
            expiresAt: { lt: now },
            OR: [
                { resourceType: { startsWith: 'destroy-email:v1:' } },
                { createdAt: { lte: new Date(now.getTime() - VERIFICATION_CONFIG.resendAfterSeconds * 1000) } }
            ]
        }
    })
    return result.count
}

/**
 * 导出操作类型常量供外部使用
 */
export { OperationType, VerificationChannel }
