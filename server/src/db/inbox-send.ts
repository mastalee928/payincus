import { Prisma, type AnnouncementType } from '@prisma/client'
import { prisma } from './prisma.js'
import { authorizeUserWrite, lockAdministrativeUserMutation, type WriteActor } from './user-write-authorization.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from './advisory-locks.js'
import { enqueueHostNotificationEmailTasks } from './host-notification-email-tasks.js'

export class InboxSendError extends Error {
  constructor(readonly statusCode: number, readonly code: string) { super(code) }
}

async function createMessagesAndHistory(tx: Prisma.TransactionClient, actor: WriteActor, input: {
  type: AnnouncementType; title: string; content: string; targetUserId?: number
}, userIds: number[]) {
  if (!userIds.length) return 0
  const messages = await tx.inboxMessage.createMany({ data: userIds.map(userId => ({ userId,
    eventType: input.type === 'admin_message' ? 'admin_message' : 'system_announcement',
    title: input.title, content: input.content, data: { senderId: actor.id }
  })) })
  await tx.announcement.create({ data: { type: input.type, senderId: actor.id, title: input.title,
    content: input.content, recipientCount: messages.count, targetUserId: input.targetUserId } })
  return messages.count
}

/** Admin authorization, current recipient selection and history commit together. */
export async function sendAdministrativeInbox(actor: WriteActor, input: { title: string; content: string; targetUserId?: number }) {
  return prisma.$transaction(async tx => {
    if (input.targetUserId !== undefined) {
      if (input.targetUserId === actor.id) throw new InboxSendError(400, 'CANNOT_MESSAGE_SELF')
      try { await lockAdministrativeUserMutation(tx, input.targetUserId, actor) } catch (error) {
        if (error instanceof Error && error.message === 'USER_NOT_FOUND') throw new InboxSendError(404, 'USER_NOT_FOUND')
        throw error
      }
      return createMessagesAndHistory(tx, actor, { ...input, type: 'admin_message' }, [input.targetUserId])
    }
    // Lock sender and current recipients in one deterministic order. Locking
    // only the sender first lets two administrators' broadcasts deadlock when
    // inbox foreign keys try to acquire a key-share lock on each other's row.
    const lockedUsers = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT id FROM users WHERE status = 'active' OR id = ${actor.id} ORDER BY id FOR UPDATE
    `)
    if (!await authorizeUserWrite(tx, actor.id, actor) ||
      (await tx.user.findUnique({ where: { id: actor.id }, select: { role: true } }))?.role !== 'admin') {
      throw new Error('ADMIN_ACTOR_FORBIDDEN')
    }
    const users = await tx.user.findMany({ where: { id: { in: lockedUsers.map(row => row.id) }, status: 'active' }, select: { id: true } })
    return createMessagesAndHistory(tx, actor, { ...input, type: 'system_broadcast' }, users.map(user => user.id))
  })
}

/** Capture and lock the addressed instances before selecting their current owners.
 * Mail dispatch after commit uses this authorized delivery snapshot, not a later
 * re-query that could address a different owner.
 */
export async function sendHostInbox(actor: WriteActor, input: {
  hostId?: number; instanceId?: number; instanceIds?: number[]
  title: string; content: string; sendEmail?: boolean; smtpEnabled?: boolean
}) {
  if (input.hostId === undefined && input.instanceId === undefined) throw new InboxSendError(400, 'INVALID_ID')
  return prisma.$transaction(async tx => {
    const candidates = await tx.instance.findMany({ where: input.instanceId !== undefined ? { id: input.instanceId } : {
      hostId: input.hostId, status: { not: 'deleted' }, ...(input.instanceIds ? { id: { in: input.instanceIds } } : {})
    }, select: { id: true }, orderBy: { id: 'asc' } })
    for (const candidate of candidates) {
      if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, candidate.id)) throw new InboxSendError(409, 'INSTANCE_BUSY')
    }
    const ids = candidates.map(row => row.id)
    if (ids.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM instances WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`)
    const instances = await tx.instance.findMany({ where: { id: { in: ids },
      ...(input.hostId === undefined ? {} : { hostId: input.hostId }) }, orderBy: { id: 'asc' } })
    if (input.instanceId !== undefined && !instances.length) throw new InboxSendError(404, 'INSTANCE_NOT_FOUND')
    if (input.instanceId !== undefined && instances[0].status === 'deleted') throw new InboxSendError(400, 'INSTANCE_DELETED')
    const hostId = input.hostId ?? instances[0]?.hostId
    if (hostId === undefined) throw new InboxSendError(404, 'HOST_NOT_FOUND')
    await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${hostId} FOR SHARE`
    const host = await tx.host.findUnique({ where: { id: hostId } })
    if (!host) throw new InboxSendError(404, 'HOST_NOT_FOUND')
    const userIds = [...new Set(instances.filter(row => row.status !== 'deleted').map(row => row.userId))].sort((a, b) => a - b)
    const accountIds = [...new Set([...userIds, actor.id])].sort((a, b) => a - b)
    await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(accountIds)}) ORDER BY id FOR UPDATE`)
    if (!await authorizeUserWrite(tx, actor.id, actor) || (host.userId !== actor.id &&
      (await tx.user.findUnique({ where: { id: actor.id }, select: { role: true } }))?.role !== 'admin')) {
      throw new InboxSendError(403, 'FORBIDDEN')
    }
    if (input.instanceId !== undefined && userIds[0] === actor.id) throw new InboxSendError(400, 'CANNOT_MESSAGE_SELF')
    const recipients = (await tx.user.findMany({ where: { id: { in: userIds } }, orderBy: { id: 'asc' },
      select: { id: true, username: true, email: true } })).map(user => ({ userId: user.id, username: user.username, email: user.email }))
    const emailRecipients = input.sendEmail ? recipients.filter(row => row.email?.trim()) : []
    if (emailRecipients.length && !input.smtpEnabled) throw new InboxSendError(400, 'SMTP_NOT_CONFIGURED')
    const instance = input.instanceId === undefined ? undefined : instances[0]
    const messageData = { hostId, hostName: host.name, senderId: actor.id,
      ...(instance ? { instanceId: instance.id, instanceName: instance.name } : {}) }
    const result = await tx.inboxMessage.createMany({ data: userIds.map(userId => ({ userId,
      eventType: instance ? 'host_message' : 'host_announcement', title: input.title,
      content: `${input.content}\n\n来自节点：${host.name}`, data: messageData })) })
    if (result.count) await tx.announcement.create({ data: { type: instance ? 'host_message' : 'host_broadcast',
      senderId: actor.id, hostId, instanceId: instance?.id, targetUserId: instance?.userId,
      title: input.title, content: input.content, recipientCount: result.count } })
    let queuedCount = 0
    if (recipients.length !== 1 && emailRecipients.length) queuedCount = await enqueueHostNotificationEmailTasks(emailRecipients.map(recipient => ({
      userId: recipient.userId, hostId, email: recipient.email!.trim(), username: recipient.username,
      hostName: host.name, title: input.title, content: input.content
    })), tx)
    return { count: result.count, recipients, emailRecipients, queuedCount, hostName: host.name }
  }, { maxWait: 5000, timeout: 20000 })
}
