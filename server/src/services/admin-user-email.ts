import { createHash } from 'node:crypto'
import { prisma } from '../db/prisma.js'
import { lockAdministrativeUserMutation, revokeUserSessionsInTransaction, type WriteActor } from '../db/user-write-authorization.js'
import { advisoryTransactionLockString, EMAIL_VERIFICATION_LOCK_NAMESPACE, USER_EMAIL_REGISTRATION_LOCK_NAMESPACE } from '../db/advisory-locks.js'
import { validateEmailDomain } from '../lib/email-domain.js'
import { containsDangerousChars } from '../lib/security.js'
import { recoveryHeld } from './platform-backup-core.js'

export class AdminEmailError extends Error {
  constructor(readonly code: string, readonly statusCode = 409) { super(code) }
}
const reject = (code: string, status = 409): never => { throw new AdminEmailError(code, status) }
export function parseAdminEmail(value: unknown): string {
  if (typeof value !== 'string') return reject('ADMIN_EMAIL_INVALID', 400)
  const email = value.trim().toLowerCase()
  const [local, domain, extra] = email.split('@')
  // Match the characters accepted by personal email changes and password recovery.
  if (containsDangerousChars(email.replace(/[@.]/g, '')) || email.length > 254 || !local || local.length > 64 || extra !== undefined ||
    !/^[a-z0-9_%+\-]+(?:\.[a-z0-9_%+\-]+)*$/.test(local) || !domain || !domain.includes('.') ||
    domain.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return reject('ADMIN_EMAIL_INVALID', 400)
  return email
}
function snapshot(user: { id: number; username: string; email: string | null; role: string; status: string; updatedAt: Date }) {
  return { userId: user.id, username: user.username, email: user.email,
    revision: createHash('sha256').update(JSON.stringify([user.id, user.email, user.role, user.status, user.updatedAt])).digest('hex') }
}
const masked = (email: string | null) => email ? `${email[0]}***@${email.split('@')[1]}` : '(none)'

/** Email allocation, current authority, stale-form check and credential invalidation commit together. */
export async function adminUserEmail(userId: number, actor: WriteActor, change?: { revision: string; email: string }) {
  if (recoveryHeld()) return reject('ADMIN_EMAIL_FORBIDDEN', 403)
  if (actor.id === userId) return reject('ADMIN_EMAIL_SELF', 403)
  const email = change ? parseAdminEmail(change.email) : undefined
  if (email && !(await validateEmailDomain(email)).valid) return reject('ADMIN_EMAIL_DOMAIN', 400)
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`
    // All email/verification locks precede user rows, as in registration, profile and password reset.
    const initial = change ? await tx.user.findUnique({ where: { id: userId }, select: { email: true } }) : null
    const addresses = [...new Set([initial?.email?.trim().toLowerCase(), email].filter((v): v is string => !!v))].sort()
    if (change) {
      for (const address of addresses) await advisoryTransactionLockString(tx, USER_EMAIL_REGISTRATION_LOCK_NAMESPACE, address)
      for (const address of addresses) await advisoryTransactionLockString(tx, EMAIL_VERIFICATION_LOCK_NAMESPACE, address)
    }
    const user = await lockAdministrativeUserMutation(tx, userId, actor)
    if (recoveryHeld()) return reject('ADMIN_EMAIL_FORBIDDEN', 403)
    const before = snapshot(user)
    if (!change) return before
    if (!initial || initial.email !== user.email || before.revision !== change.revision) return reject('ADMIN_EMAIL_CHANGED')
    if (email === user.email?.trim().toLowerCase()) return reject('ADMIN_EMAIL_UNCHANGED', 400)
    if (await tx.user.findFirst({ where: { id: { not: userId }, email: { equals: email, mode: 'insensitive' } }, select: { id: true } })) return reject('ADMIN_EMAIL_TAKEN', 400)
    const updated = await tx.user.update({ where: { id: userId }, data: { email } })
    const now = new Date()
    // Keep send/attempt history for rate limits. Previously delivered codes cannot authorize the new binding.
    await tx.emailVerificationCode.updateMany({ where: { email: { in: addresses }, consumedAt: null }, data: { expiresAt: now, consumedAt: now } })
    await tx.operationVerification.updateMany({ where: { userId }, data: { expiresAt: now, verifiedAt: null } })
    await revokeUserSessionsInTransaction(tx, userId)
    await tx.log.create({ data: { userId: actor.id, module: 'admin', action: 'user.email.update', result: 'success',
      content: `Admin #${actor.id} changed user #${userId} email: ${masked(user.email)} → ${masked(email!)}; web sessions revoked` } })
    if (recoveryHeld()) return reject('ADMIN_EMAIL_FORBIDDEN', 403)
    return snapshot(updated)
  }, { maxWait: 5000, timeout: 10000 })
}
