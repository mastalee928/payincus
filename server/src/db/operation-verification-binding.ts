import { createHash } from 'node:crypto'
import type { WriteActor } from './user-write-authorization.js'
import type { NotificationChannel } from '@prisma/client'

/** A digest binds the account grant without persisting a session or recipient. */
export function accountOperationVerificationBinding(actor: WriteActor, email: string | null): string {
  return 'account-session:v1:' + createHash('sha256').update(JSON.stringify([
    actor.id, actor.sid, email?.trim().toLowerCase() ?? null
  ])).digest('hex')
}

export function notificationOperationVerificationBinding(actor: WriteActor, channel: NotificationChannel): string {
  return 'notification-session:v1:' + createHash('sha256').update(JSON.stringify([
    actor.id, actor.sid, channel.id, channel.type, channel.config
  ])).digest('hex')
}
