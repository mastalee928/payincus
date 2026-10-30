import { createHash } from 'node:crypto'
import type { WriteActor } from './user-write-authorization.js'

/** A digest binds the account grant without persisting a session or recipient. */
export function accountOperationVerificationBinding(actor: WriteActor, email: string | null): string {
  return 'account-session:v1:' + createHash('sha256').update(JSON.stringify([
    actor.id, actor.sid, email?.trim().toLowerCase() ?? null
  ])).digest('hex')
}
