import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { authorizeUserWrite, type WriteSession } from '../db/user-write-authorization.js'
import { createRechargeOrder, type CreateRechargeOrderInput } from '../db/recharge-records.js'

export class RechargeCreationError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
export type RechargeCreationIntent = { id: string; hash: string }
export function rechargeCreationIntent(id: unknown, provider: number, amount: number, target: number | null, method: unknown): RechargeCreationIntent | undefined {
  if (id === undefined) return undefined
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new RechargeCreationError(400, '充值请求编号无效')
  return { id: id.toLowerCase(), hash: createHash('sha256').update(JSON.stringify([provider, amount, target, method ?? null])).digest('hex') }
}
export async function findRechargeCreation(userId: number, intent: RechargeCreationIntent, session: WriteSession, tx: Prisma.TransactionClient) {
  if (!await authorizeUserWrite(tx, userId, session)) throw new RechargeCreationError(403, '登录状态已变化，请重新登录')
  const record = await tx.rechargeRecord.findUnique({ where: { userId_creationRequestId: { userId, creationRequestId: intent.id } } })
  if (record && record.creationRequestHash !== intent.hash) throw new RechargeCreationError(409, '充值请求内容已变化，请先核对原订单')
  return record
}
export async function createRechargeOnce(input: CreateRechargeOrderInput, intent: RechargeCreationIntent | undefined, session: WriteSession) {
  if (!intent) return { order: await createRechargeOrder(input), created: true }
  return prisma.$transaction(async tx => {
    const previous = await findRechargeCreation(input.userId, intent, session, tx)
    if (previous) return { order: previous, created: false }
    // Authorization locks the account until this insert commits. No external
    // payment call runs in the transaction or repeats on a replayed intent.
    const order = await tx.rechargeRecord.create({ data: {
      userId: input.userId, providerId: input.providerId, orderNo: input.orderNo!,
      amount: input.amount, actualAmount: input.actualAmount, fee: input.fee || 0,
      paymentMethod: input.paymentMethod, expiredAt: input.expiredAt,
      providerConfigSnapshot: input.providerConfigSnapshot, paymentDetails: input.paymentDetails as Prisma.InputJsonValue,
      ip: input.ip, userAgent: input.userAgent, creationRequestId: intent.id, creationRequestHash: intent.hash
    } })
    return { order, created: true }
  })
}
