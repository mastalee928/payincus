import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'
import { advisoryTransactionLockString, RENEWAL_REQUEST_LOCK_NAMESPACE } from './advisory-locks.js'
import { authorizeUserWrite, type WriteSession } from './user-write-authorization.js'
import { authorizePublicApiWrite, type PublicApiWriteAuthorization } from './public-api-write-authorization.js'

export type RenewalRequest = { key: string; inputHash: string }
export class RenewalRequestError extends Error {
  constructor(message: string, public statusCode = 409, public code = 'RENEWAL_REQUEST_CONFLICT') { super(message) }
}
export function renewalRequest(raw: unknown, kind: string, targets: number[], months: number): RenewalRequest {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(raw)) {
    throw new RenewalRequestError('续费请求缺少有效的 Idempotency-Key，请刷新后重试', 400, 'RENEWAL_REQUEST_KEY_REQUIRED')
  }
  return { key: raw, inputHash: createHash('sha256').update(JSON.stringify({ kind, targets: [...new Set(targets)].sort((a, b) => a - b), months })).digest('hex') }
}
// Always acquire this before business locks. Receipts survive HTTP failures and restarts.
export async function lockRenewalRequest(tx: Prisma.TransactionClient, userId: number, request: RenewalRequest) {
  await advisoryTransactionLockString(tx, RENEWAL_REQUEST_LOCK_NAMESPACE, `${userId}:${request.key}`)
  const receipt = await tx.renewalRequest.upsert({ where: { userId_requestKey: { userId, requestKey: request.key } },
    create: { userId, requestKey: request.key, inputHash: request.inputHash }, update: {} })
  if (receipt.inputHash !== request.inputHash) throw new RenewalRequestError('续费请求编号已用于其他参数，请重新确认续费')
  return receipt.results as Record<string, Prisma.JsonValue>
}
export async function saveRenewalItem(tx: Prisma.TransactionClient, userId: number, request: RenewalRequest, itemId: number, value: unknown) {
  const items = await lockRenewalRequest(tx, userId, request)
  await tx.renewalRequest.update({ where: { userId_requestKey: { userId, requestKey: request.key } },
    data: { results: { ...items, [itemId]: JSON.parse(JSON.stringify(value)) } as Prisma.InputJsonObject } })
}
export async function readRenewalItems(userId: number, request: RenewalRequest, session?: WriteSession, api?: PublicApiWriteAuthorization) {
  const exists = await prisma.renewalRequest.findUnique({ where: { userId_requestKey: { userId, requestKey: request.key } }, select: { userId: true } })
  if (!exists) return {}
  return prisma.$transaction(async tx => {
    const items = await lockRenewalRequest(tx, userId, request)
    const allowed = api ? await authorizePublicApiWrite(tx, userId, api, 'services:billing') : await authorizeUserWrite(tx, userId, session)
    if (!allowed) throw new RenewalRequestError('用户权限已变更，请重新登录', 403, 'RENEWAL_FORBIDDEN')
    return items
  })
}
export async function recordRenewalFailure(userId: number, request: RenewalRequest, itemId: number, failure: unknown, session: WriteSession) {
  return prisma.$transaction(async tx => {
    const items = await lockRenewalRequest(tx, userId, request)
    if (!await authorizeUserWrite(tx, userId, session)) throw new RenewalRequestError('用户权限已变更，请重新登录', 403, 'RENEWAL_FORBIDDEN')
    if (items[itemId]) return items[itemId]
    await saveRenewalItem(tx, userId, request, itemId, { failure })
    return { failure } as unknown as Prisma.JsonValue
  })
}
