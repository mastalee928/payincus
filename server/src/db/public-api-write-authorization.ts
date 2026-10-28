import type { Prisma } from '@prisma/client'

/** Internal binding captured after bearer verification; never return it to clients. */
export type PublicApiWriteAuthorization = {
  tokenId: number
  source: 'api_token' | 'oauth_access_token'
  userId: number
  tokenHash: string
  appId?: number
  grantId?: number | null
}

function includesScope(scopes: Prisma.JsonValue, requiredScope: string): boolean {
  return Array.isArray(scopes) && scopes.includes(requiredScope)
}

/** Hold account and credential rights through the business commit, including revoke races. */
export async function authorizePublicApiWrite(
  tx: Prisma.TransactionClient,
  userId: number,
  authorization: PublicApiWriteAuthorization,
  requiredScope: string,
): Promise<boolean> {
  if (authorization.userId !== userId) return false
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`
  if ((await tx.user.findUnique({ where: { id: userId }, select: { status: true } }))?.status !== 'active') return false

  if (authorization.source === 'api_token') {
    await tx.$queryRaw`SELECT id FROM public_api_tokens WHERE id = ${authorization.tokenId} FOR SHARE`
    const token = await tx.publicApiToken.findUnique({ where: { id: authorization.tokenId } })
    return Boolean(token && token.userId === userId && token.tokenHash === authorization.tokenHash && !token.revokedAt &&
      (!token.expiresAt || token.expiresAt.getTime() > Date.now()) && includesScope(token.scopes, requiredScope))
  }
  if (authorization.source !== 'oauth_access_token' || !authorization.appId || !authorization.grantId) return false

  // Grant revocation locks grant before tokens; app deletion cascades in the same direction.
  await tx.$queryRaw`SELECT id FROM oauth_client_apps WHERE id = ${authorization.appId} FOR SHARE`
  const app = await tx.oAuthClientApp.findUnique({ where: { id: authorization.appId } })
  if (!app?.enabled || !includesScope(app.scopes, requiredScope)) return false
  await tx.$queryRaw`SELECT id FROM oauth_grants WHERE id = ${authorization.grantId} FOR SHARE`
  const grant = await tx.oAuthGrant.findUnique({ where: { id: authorization.grantId } })
  if (!grant || grant.appId !== app.id || grant.userId !== userId || grant.revokedAt || !includesScope(grant.scopes, requiredScope)) return false
  await tx.$queryRaw`SELECT id FROM oauth_access_tokens WHERE id = ${authorization.tokenId} FOR SHARE`
  const token = await tx.oAuthAccessToken.findUnique({ where: { id: authorization.tokenId } })
  return Boolean(token && token.userId === userId && token.appId === app.id && token.grantId === grant.id &&
    token.tokenHash === authorization.tokenHash && !token.revokedAt && token.expiresAt.getTime() > Date.now() &&
    includesScope(token.scopes, requiredScope))
}
