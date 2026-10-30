/**
 * 通知相关数据库操作
 * 使用 Prisma ORM
 */

import { prisma } from './prisma.js'
import type { NotificationChannel } from '../types/database.js'
import type { Prisma } from '@prisma/client'
import { authorizeUserWrite, type WriteActor } from './user-write-authorization.js'

export class NotificationChannelMutationError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) {
    super(message)
  }
}

async function authorizeNotificationChannelWrite(tx: Prisma.TransactionClient, actor: WriteActor) {
  // The account lock also serializes insertion with verification channel selection,
  // including the empty-channel case where there are no channel rows to lock.
  if (!await authorizeUserWrite(tx, actor.id, actor)) {
    throw new NotificationChannelMutationError(401, 'AUTHENTICATION_STATE_CHANGED', 'Please sign in again')
  }
}

async function lockPersonalNotificationChannel(tx: Prisma.TransactionClient, id: number, actor: WriteActor) {
  await authorizeNotificationChannelWrite(tx, actor)
  await tx.$queryRaw`SELECT id FROM notification_channels WHERE id = ${id} FOR UPDATE`
  const channel = await tx.notificationChannel.findUnique({ where: { id } })
  if (!channel) throw new NotificationChannelMutationError(404, 'NOTIFICATION_CHANNEL_NOT_FOUND', 'Notification channel not found')
  if (channel.userId !== actor.id || channel.isGlobal || channel.alertCategory !== null) {
    throw new NotificationChannelMutationError(403, 'FORBIDDEN', 'Access denied')
  }
  return channel
}

const notificationLogStatuses = new Set(['pending', 'sent', 'failed'])

function clampNotificationLogPagination(page: number | undefined, pageSize: number | undefined): {
  page: number
  pageSize: number
} {
  const safePageSize = Number.isSafeInteger(pageSize) && pageSize !== undefined
    ? Math.min(Math.max(pageSize, 1), 100) : 20
  return {
    page: Number.isSafeInteger(page) && page !== undefined && page > 0 &&
      (page - 1) * safePageSize <= 2147483647 ? page : 1,
    pageSize: safePageSize
  }
}

function normalizeNotificationLogStatus(status: string | undefined): 'pending' | 'sent' | 'failed' | undefined {
  return status && notificationLogStatuses.has(status)
    ? status as 'pending' | 'sent' | 'failed'
    : undefined
}

/**
 * 获取用户的所有通知渠道
 */
export async function getNotificationChannelsByUserId(userId: number): Promise<NotificationChannel[]> {
  const channels = await prisma.notificationChannel.findMany({
    where: { userId, alertCategory: null },
    orderBy: {
      createdAt: 'desc'
    }
  })

  return channels.map(ch => ({
    id: ch.id,
    user_id: ch.userId,
    type: ch.type,
    name: ch.name,
    config: JSON.stringify(ch.config as any),
    enabled: ch.enabled ? 1 : 0,
    created_at: ch.createdAt.toISOString()
  }))
}

/**
 * 根据 ID 获取通知渠道
 */
export async function getNotificationChannelById(id: number): Promise<NotificationChannel | null> {
  const channel = await prisma.notificationChannel.findUnique({
    where: { id }
  })

  if (!channel) return null

  return {
    id: channel.id,
    user_id: channel.userId,
    type: channel.type,
    name: channel.name,
    config: JSON.stringify(channel.config as any),
    enabled: channel.enabled ? 1 : 0,
    created_at: channel.createdAt.toISOString()
  }
}

/**
 * 创建通知渠道
 */
export async function createNotificationChannel(data: {
  userId: number
  type: 'telegram' | 'discord' | 'email' | 'webhook'
  name: string
  config: Record<string, unknown>
  enabled?: boolean
}, actor: WriteActor): Promise<number> {
  return prisma.$transaction(async tx => {
    await authorizeNotificationChannelWrite(tx, actor)
    if (data.userId !== actor.id) throw new NotificationChannelMutationError(403, 'FORBIDDEN', 'Access denied')
    const channel = await tx.notificationChannel.create({
      data: {
        userId: data.userId,
        type: data.type,
        name: data.name,
        config: data.config as Prisma.InputJsonObject,
        enabled: data.enabled !== false
      }
    })
    return channel.id
  })
}

/**
 * 更新通知渠道
 */
export async function updateNotificationChannel(id: number, data: {
  name?: string
  config?: Record<string, unknown>
  enabled?: boolean
}, actor: WriteActor, expectedType: NotificationChannel['type']): Promise<void> {
  const updateData: {
    name?: string
    config?: Prisma.InputJsonObject
    enabled?: boolean
  } = {}

  if (data.name !== undefined) updateData.name = data.name
  if (data.config !== undefined) updateData.config = data.config as Prisma.InputJsonObject
  if (data.enabled !== undefined) updateData.enabled = data.enabled

  await prisma.$transaction(async tx => {
    const channel = await lockPersonalNotificationChannel(tx, id, actor)
    if (channel.type !== expectedType) throw new NotificationChannelMutationError(409, 'NOTIFICATION_CHANNEL_CHANGED', 'Please refresh and try again')
    if (Object.keys(updateData).length === 0) return
    await tx.notificationChannel.update({ where: { id }, data: updateData })
  })
}

/**
 * 删除通知渠道
 */
export async function deleteNotificationChannel(id: number, actor: WriteActor): Promise<void> {
  await prisma.$transaction(async tx => {
    await lockPersonalNotificationChannel(tx, id, actor)
    await tx.notificationChannel.delete({ where: { id } })
  })
}

export async function toggleNotificationChannel(id: number, actor: WriteActor): Promise<boolean> {
  return prisma.$transaction(async tx => {
    const channel = await lockPersonalNotificationChannel(tx, id, actor)
    const enabled = !channel.enabled
    await tx.notificationChannel.update({ where: { id }, data: { enabled } })
    return enabled
  })
}

/**
 * 获取用户启用的通知渠道
 */
export async function getEnabledChannelsByUserId(userId: number): Promise<NotificationChannel[]> {
  const channels = await prisma.notificationChannel.findMany({
    where: {
      userId,
      enabled: true,
      isGlobal: false,
      alertCategory: null
    }
  })

  return channels.map(ch => ({
    id: ch.id,
    user_id: ch.userId,
    type: ch.type,
    name: ch.name,
    config: JSON.stringify(ch.config as any),
    enabled: ch.enabled ? 1 : 0,
    created_at: ch.createdAt.toISOString()
  }))
}

/**
 * 创建通知日志
 */
export async function createNotificationLog(data: {
  channelId: number
  eventType: string
  message: string
  status: 'pending' | 'sent' | 'failed'
  error?: string | null
}): Promise<number> {
  const log = await prisma.notificationLog.create({
    data: {
      channelId: data.channelId,
      eventType: data.eventType,
      message: data.message,
      status: data.status,
      error: data.error ?? null
    }
  })

  return log.id
}

/**
 * 更新通知日志状态
 */
export async function updateNotificationLogStatus(
  id: number,
  status: 'pending' | 'sent' | 'failed',
  error: string | null = null
): Promise<void> {
  await prisma.notificationLog.update({
    where: { id },
    data: {
      status,
      error: error ?? null
    }
  })
}


/**
 * 获取用户的通知日志（分页）
 */
export async function getNotificationLogsByUserId(
  userId: number,
  options: {
    page?: number
    pageSize?: number
    status?: string
  } = {}
): Promise<{
  logs: Array<{
    id: number
    channelId: number
    channelName: string
    channelType: string
    eventType: string
    message: string
    status: string
    error: string | null
    createdAt: string
  }>
  total: number
  page: number
  pageSize: number
}> {
  const { page, pageSize } = clampNotificationLogPagination(options.page, options.pageSize)
  const skip = (page - 1) * pageSize
  const status = normalizeNotificationLogStatus(options.status)

  const where: {
    channel: { userId: number }
    status?: 'pending' | 'sent' | 'failed'
  } = {
    channel: { userId }
  }

  if (status) {
    where.status = status
  }

  const [logs, total] = await Promise.all([
    prisma.notificationLog.findMany({
      where,
      include: {
        channel: {
          select: {
            name: true,
            type: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize
    }),
    prisma.notificationLog.count({ where })
  ])

  return {
    logs: logs.map(log => ({
      id: log.id,
      channelId: log.channelId,
      channelName: log.channel.name,
      channelType: log.channel.type,
      eventType: log.eventType,
      message: log.message,
      status: log.status,
      error: log.error,
      createdAt: log.createdAt.toISOString()
    })),
    total,
    page,
    pageSize
  }
}

/**
 * 获取通知统计
 */
export async function getNotificationStats(userId: number): Promise<{
  total: number
  sent: number
  failed: number
  pending: number
}> {
  const [total, sent, failed, pending] = await Promise.all([
    prisma.notificationLog.count({
      where: { channel: { userId } }
    }),
    prisma.notificationLog.count({
      where: { channel: { userId }, status: 'sent' }
    }),
    prisma.notificationLog.count({
      where: { channel: { userId }, status: 'failed' }
    }),
    prisma.notificationLog.count({
      where: { channel: { userId }, status: 'pending' }
    })
  ])

  return { total, sent, failed, pending }
}

/**
 * 清理旧的通知日志（保留最近 N 天）
 */
export async function cleanOldNotificationLogs(days: number = 30): Promise<number> {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - days)

  const result = await prisma.notificationLog.deleteMany({
    where: {
      createdAt: { lt: cutoffDate }
    }
  })

  return result.count
}
