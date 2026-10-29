import crypto from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { authorizeUserWrite, type WriteActor } from '../db/user-write-authorization.js'
import { advisoryTransactionLockString, OPERATION_VERIFICATION_REQUEST_LOCK_NAMESPACE } from '../db/advisory-locks.js'
import { sendOperationVerificationEmail } from './mailer.js'

const PREFIX = 'destroy-email:v1:'
const TTL = 10 * 60_000
const RESEND = 60
const MAX_ATTEMPTS = 5

export function normalizeDestroyVerificationIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100 ||
    !value.every(id => typeof id === 'number' && Number.isSafeInteger(id) && id > 0 && id <= 2147483647) ||
    new Set(value).size !== value.length) return null
  return [...value].sort((a, b) => a - b)
}

function binding(actor: WriteActor, email: string, ids: number[]) {
  return PREFIX + crypto.createHash('sha256').update(JSON.stringify([actor.id, actor.sid, email.toLowerCase().trim(), ids])).digest('hex')
}
function hash(code: string) { return 'sha256:' + crypto.createHash('sha256').update(code).digest('hex') }
function failure(code: string, error: string) { return { success: false as const, code, error } }

async function lockAccount(tx: Prisma.TransactionClient, actor: WriteActor) {
  if (!await authorizeUserWrite(tx, actor.id, actor)) return null
  await advisoryTransactionLockString(tx, OPERATION_VERIFICATION_REQUEST_LOCK_NAMESPACE, `destroy-email:${actor.id}`)
  return tx.user.findUnique({ where: { id: actor.id }, select: { email: true, username: true } })
}

export async function requestDestroyEmailVerification(actor: WriteActor, rawIds: unknown) {
  const ids = normalizeDestroyVerificationIds(rawIds)
  if (!ids) return failure('INVALID_ID', '请选择有效且不重复的实例，最多100台')
  const prepared = await prisma.$transaction(async tx => {
    const user = await lockAccount(tx, actor)
    if (!user) return failure('AUTHENTICATION_STATE_CHANGED', '账户或登录状态已变化，请重新登录')
    if (!user.email) return failure('EMAIL_NOT_CONFIGURED', '请先在个人设置绑定账户邮箱，再销毁实例')
    const owned = await tx.instance.count({ where: { id: { in: ids }, userId: actor.id, status: { not: 'deleted' } } })
    if (owned !== ids.length) return failure('FORBIDDEN', '实例不存在或无权销毁，请刷新实例列表')
    const now = new Date(), resourceType = binding(actor, user.email, ids)
    const existing = await tx.operationVerification.findFirst({ where: {
      userId: actor.id, operationType: 'delete_instance', resourceType: { startsWith: PREFIX },
      createdAt: { gt: new Date(now.getTime() - RESEND * 1000) }
    }, orderBy: { createdAt: 'desc' } })
    const resendAfter = existing ? Math.max(0, RESEND - Math.floor((now.getTime() - existing.createdAt.getTime()) / 1000)) : 0
    const [local, domain] = user.email.split('@')
    const maskedTarget = `${local.slice(0, 2)}***@${domain}`
    if (existing && resendAfter > 0) {
      if (existing.resourceType !== resourceType || existing.verified) return failure('VERIFICATION_RATE_LIMITED', `每60秒只能发送一次销毁验证码，请${resendAfter}秒后重试`)
      if (existing.attempts > MAX_ATTEMPTS) return failure('VERIFICATION_PENDING', '验证码邮件正在发送，请稍后重试')
      if (existing.attempts === MAX_ATTEMPTS) return failure('VERIFICATION_RATE_LIMITED', `验证码尝试次数已达上限，请${resendAfter}秒后重新发送`)
      return { success: true as const, alreadySent: true as const, channel: 'email' as const, maskedTarget, resendAfter }
    }
    const recent = await tx.operationVerification.count({ where: {
      userId: actor.id, operationType: 'delete_instance', resourceType: { startsWith: PREFIX },
      createdAt: { gt: new Date(now.getTime() - 60 * 60_000) }
    } })
    if (recent >= 5) return failure('VERIFICATION_RATE_LIMITED', '销毁验证码发送次数已达上限，请一小时后再试')
    await tx.operationVerification.updateMany({ where: {
      userId: actor.id, operationType: 'delete_instance', resourceType, verified: false
    }, data: { verified: true, verifiedAt: null } })
    // Serialize allocation across accounts, so concurrent requests cannot issue
    // the same six digits while another destroy-email code is still valid.
    await advisoryTransactionLockString(tx, OPERATION_VERIFICATION_REQUEST_LOCK_NAMESPACE, 'destroy-email:code-allocation')
    let code = ''
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = crypto.randomInt(100000, 1000000).toString()
      const collision = await tx.operationVerification.count({ where: {
        operationType: 'delete_instance', resourceType: { startsWith: PREFIX }, code: hash(candidate),
        createdAt: { gt: new Date(Date.now() - TTL) }
      } })
      if (!collision) { code = candidate; break }
    }
    if (!code) return failure('VERIFICATION_UNAVAILABLE', '暂时无法生成安全验证码，请稍后重试')
    const record = await tx.operationVerification.create({ data: {
      userId: actor.id, operationType: 'delete_instance', channel: 'email', resourceType,
      resourceId: ids.length === 1 ? ids[0] : null, code: hash(code), attempts: MAX_ATTEMPTS + 1,
      expiresAt: new Date(now.getTime() + 60 * 60_000)
    } })
    return { success: true as const, alreadySent: false as const, maskedTarget, resendAfter: RESEND,
      recordId: record.id, email: user.email, username: user.username, code }
  })
  if (!prepared.success || prepared.alreadySent) return prepared
  let sent: { success: boolean; error?: string }
  try {
    sent = await sendOperationVerificationEmail(prepared.email, {
      username: prepared.username, operationName: `销毁 ${ids.length} 台实例（${ids.map(id => '#' + id).join('、')}）`,
      code: prepared.code, expiresInMinutes: TTL / 60_000
    })
  } catch { sent = { success: false } }
  if (!sent.success) {
    await prisma.operationVerification.updateMany({ where: { id: prepared.recordId, verified: false }, data: { verified: true, verifiedAt: null } })
    return failure('SEND_FAILED', '销毁验证码邮件发送失败，请稍后重试或发工单')
  }
  await prisma.operationVerification.updateMany({ where: { id: prepared.recordId, verified: false }, data: { attempts: 0 } })
  // Never return the raw code, stored hash, full email or internal binding.
  return { success: true as const, channel: 'email' as const, maskedTarget: prepared.maskedTarget, resendAfter: prepared.resendAfter }
}

export async function claimDestroyEmailVerification(actor: WriteActor, rawIds: unknown, code: unknown) {
  const ids = normalizeDestroyVerificationIds(rawIds)
  if (!ids || typeof code !== 'string' || !/^\d{6}$/.test(code)) return failure('DESTROY_EMAIL_VERIFICATION_REQUIRED', '销毁实例必须输入账户邮箱收到的6位验证码')
  return prisma.$transaction(async tx => {
    const user = await lockAccount(tx, actor)
    if (!user) return failure('AUTHENTICATION_STATE_CHANGED', '账户或登录状态已变化，请重新登录')
    if (!user.email) return failure('EMAIL_NOT_CONFIGURED', '请先在个人设置绑定账户邮箱，再销毁实例')
    const now = new Date(), resourceType = binding(actor, user.email, ids)
    const record = await tx.operationVerification.findFirst({ where: {
      userId: actor.id, operationType: 'delete_instance', channel: 'email', resourceType,
      verified: false, expiresAt: { gt: now }, attempts: { lt: MAX_ATTEMPTS }, createdAt: { gt: new Date(now.getTime() - TTL) }
    }, orderBy: { createdAt: 'desc' } })
    if (!record) return failure('DESTROY_EMAIL_VERIFICATION_REQUIRED', '验证码已失效或不属于本次销毁，请重新发送')
    if (record.code !== hash(code)) {
      await tx.operationVerification.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } })
      return failure('INVALID_CODE', record.attempts + 1 >= MAX_ATTEMPTS ? '验证码尝试次数已达上限，请重新发送' : '邮箱验证码不正确，请检查后重试')
    }
    const owned = await tx.instance.count({ where: { id: { in: ids }, userId: actor.id, status: { not: 'deleted' } } })
    if (owned !== ids.length) return failure('FORBIDDEN', '实例归属或状态已变化，请刷新后重新确认')
    await tx.operationVerification.update({ where: { id: record.id }, data: { verified: true, verifiedAt: null } })
    return { success: true as const }
  })
}
