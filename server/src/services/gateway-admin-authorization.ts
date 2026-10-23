// @ts-ignore -- bcryptjs 2 uses the same legacy import as the main auth routes.
import bcrypt from 'bcryptjs'
import { authenticator } from 'otplib'
import type { Prisma } from '@prisma/client'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { GatewayTaskError, gatewayTaskHash } from '../lib/gateway-task-plan.js'
import { performance } from 'node:perf_hooks'

// The business backend is deliberately a single instance. This supplements
// route IP limits with a bounded per-administrator failure window.
const failures = new Map<number, { count: number; until: number }>()
function checkAttempt(userId: number) {
  const now = performance.now(), previous = failures.get(userId)
  if (previous && previous.until <= now) failures.delete(userId)
  if (failures.size >= 4096) for (const [id, value] of failures) if (value.until <= now) failures.delete(id)
  if ((failures.get(userId)?.count || 0) >= 8 || (!failures.has(userId) && failures.size >= 4096)) throw new GatewayTaskError('GATEWAY_TASK_REAUTH_LOCKED')
}
function rejectAttempt(userId: number, code: string): never {
  const previous = failures.get(userId), now = performance.now()
  failures.set(userId, { count: (previous?.count || 0) + 1, until: previous?.until || now + 5 * 60000 })
  throw new GatewayTaskError(code)
}

export const gatewayCredentialSelect = { id: true, passwordHash: true, twoFactorEnabled: true, twoFactorSecret: true, role: true, status: true } as const
export function gatewayCredentialHash(value: { id: number; passwordHash: string; twoFactorEnabled: boolean; twoFactorSecret: string | null; role: string; status: string }) {
  return gatewayTaskHash(value)
}
function encryptionKey() {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new GatewayTaskError('GATEWAY_TASK_ENCRYPTION_NOT_CONFIGURED')
  return createHash('sha256').update(key).digest()
}
// Same authenticated ciphertext format as existing sensitive platform data,
// with strict failure instead of the legacy plaintext fallback. Importing the
// Web security module here would also start unrelated session timers.
export function encryptGatewayTaskSecret(value: string): string {
  if (typeof value !== 'string' || !value) throw new GatewayTaskError('GATEWAY_TASK_SECRET_INVALID')
  const iv = randomBytes(16), cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`
}
export function decryptGatewayTaskSecret(ciphertext: string): string {
  if (typeof ciphertext !== 'string' || !/^[a-f0-9]{32}:[a-f0-9]{32}:(?:[a-f0-9]{2})+$/.test(ciphertext)) throw new GatewayTaskError('GATEWAY_TASK_SECRET_INVALID')
  const key = encryptionKey()
  try {
    const [iv, tag, encrypted] = ciphertext.split(':')
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'))
    decipher.setAuthTag(Buffer.from(tag, 'hex'))
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'hex')), decipher.final()]).toString('utf8')
  } catch { throw new GatewayTaskError('GATEWAY_TASK_SECRET_INVALID') }
}
// Called inside the journal transaction while the administrator row is locked.
// This never accepts a caller-provided "recently authenticated" timestamp.
export async function authorizeGatewayAdministration(tx: Prisma.TransactionClient, userId: number, input: { password: string; totpCode?: string }) {
  checkAttempt(userId)
  if (typeof input.password !== 'string' || !input.password || Buffer.byteLength(input.password) > 256 ||
    (input.totpCode !== undefined && !/^[0-9]{6}$/.test(input.totpCode))) throw new GatewayTaskError('GATEWAY_TASK_REAUTH_REQUIRED')
  const user = await tx.user.findUnique({ where: { id: userId }, select: gatewayCredentialSelect })
  if (!user || user.role !== 'admin' || user.status !== 'active' || !await bcrypt.compare(input.password, user.passwordHash)) rejectAttempt(userId, 'GATEWAY_TASK_REAUTH_REQUIRED')
  if (user.twoFactorEnabled) {
    if (!input.totpCode || !user.twoFactorSecret) throw new GatewayTaskError('GATEWAY_TASK_MFA_REQUIRED')
    const now = Date.now(), verifier = authenticator.clone({ digits: 6, step: 30, window: 1, epoch: now })
    const secret = decryptGatewayTaskSecret(user.twoFactorSecret)
    if (!/^[A-Z2-7]{16,128}$/.test(secret)) throw new GatewayTaskError('GATEWAY_TASK_MFA_INVALID')
    const delta = verifier.checkDelta(input.totpCode, secret)
    if (delta === null || !Number.isInteger(delta) || Math.abs(delta) > 1) rejectAttempt(userId, 'GATEWAY_TASK_MFA_INVALID')
    const step = BigInt(Math.floor(now / 30000) + delta)
    const previous = await tx.managementGatewayMfaReplay.aggregate({ where: { userId }, _max: { step: true } })
    if (previous._max.step !== null && previous._max.step >= step) rejectAttempt(userId, 'GATEWAY_TASK_MFA_REPLAYED')
    try { await tx.managementGatewayMfaReplay.create({ data: { userId, step } }) }
    catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new GatewayTaskError('GATEWAY_TASK_MFA_REPLAYED')
      throw error
    }
    await tx.managementGatewayMfaReplay.deleteMany({ where: { userId, step: { lt: step - 4n } } })
  }
  failures.delete(userId)
  return gatewayCredentialHash(user)
}
