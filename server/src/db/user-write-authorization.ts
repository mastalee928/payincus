import { Prisma } from '@prisma/client'

export type WriteSession = { sid?: string; iat?: number }
export type WriteActor = WriteSession & { id: number }

/** Lock the account so revocation/status changes serialize with this write. */
export async function authorizeUserWrite(
  tx: Prisma.TransactionClient,
  userId: number,
  session: WriteSession | undefined,
  regularUserOnly = false
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ status: string; role: string }>>(Prisma.sql`SELECT status, role FROM users WHERE id = ${userId} FOR UPDATE`)
  if (rows[0]?.status !== 'active' || (regularUserOnly && rows[0].role !== 'user')) return false
  if (!session?.sid || !session.iat) return false
  const invalidations = await tx.tokenInvalidation.findMany({ where: {
    userId, sessionId: { in: [session.sid, '__USER_LEVEL__'] }
  } })
  return !invalidations.some(row => session.iat! <= row.invalidatedAt)
}

/** Serialize actor/target checks with bans, role updates, logout and account removal. */
export async function lockAdministrativeUserMutation(tx: Prisma.TransactionClient, userId: number, actor: WriteActor) {
  const ids = [...new Set([actor.id, userId])].sort((a, b) => a - b)
  await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`)
  if (!await authorizeUserWrite(tx, actor.id, actor) ||
    (await tx.user.findUnique({ where: { id: actor.id }, select: { role: true } }))?.role !== 'admin') {
    throw new Error('ADMIN_ACTOR_FORBIDDEN')
  }
  const target = await tx.user.findUnique({ where: { id: userId } })
  if (!target) throw new Error('USER_NOT_FOUND')
  return target
}

export async function revokeUserSessionsInTransaction(tx: Prisma.TransactionClient, userId: number): Promise<number> {
  const revoked = await tx.refreshToken.deleteMany({ where: { userId } })
  const invalidatedAt = Math.floor(Date.now() / 1000)
  await tx.tokenInvalidation.upsert({
    where: { userId_sessionId: { userId, sessionId: '__USER_LEVEL__' } },
    create: { userId, sessionId: '__USER_LEVEL__', invalidatedAt }, update: { invalidatedAt }
  })
  return revoked.count
}
