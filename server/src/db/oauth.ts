/**
 * OAuth 相关数据库操作
 * 使用 Prisma ORM
 */

import { prisma } from './prisma.js'
import { authorizeUserWrite, lockAdministrativeUserMutation, revokeUserSessionsInTransaction, type WriteActor, type WriteSession } from './user-write-authorization.js'
import type { OAuthConfig, UserOAuthBinding } from '../types/database.js'
import { decryptSensitiveData, encryptSensitiveData, generateRefreshToken, isEncrypted, type OAuthLoginCodeData } from '../lib/security.js'
import { Prisma } from '@prisma/client'

function decryptOAuthSecret(value: string): string {
  if (!value) return value
  return isEncrypted(value) ? (decryptSensitiveData(value) || value) : value
}

function encryptOAuthSecret(value: string): string {
  return isEncrypted(value) ? value : encryptSensitiveData(value)
}

/**
 * 获取所有 OAuth 配置
 */
export async function getOAuthConfigs(): Promise<OAuthConfig[]> {
  const configs = await prisma.oAuthConfig.findMany({
    orderBy: {
      provider: 'asc'
    }
  })
  
  return configs.map(c => ({
    id: c.id,
    provider: c.provider,
    client_id: c.clientId,
    client_secret: decryptOAuthSecret(c.clientSecret),
    enabled: c.enabled ? 1 : 0,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString()
  }))
}

/**
 * 获取指定提供商的 OAuth 配置
 */
export async function getOAuthConfig(provider: 'github' | 'google'): Promise<OAuthConfig | null> {
  const config = await prisma.oAuthConfig.findUnique({
    where: { provider }
  })
  
  if (!config) return null
  
  return {
    id: config.id,
    provider: config.provider,
    client_id: config.clientId,
    client_secret: decryptOAuthSecret(config.clientSecret),
    enabled: config.enabled ? 1 : 0,
    created_at: config.createdAt.toISOString(),
    updated_at: config.updatedAt.toISOString()
  }
}

/**
 * 获取启用的 OAuth 配置（用于登录页面显示）
 */
export async function getEnabledOAuthConfigs(): Promise<Array<Pick<OAuthConfig, 'provider' | 'enabled'>>> {
  const configs = await prisma.oAuthConfig.findMany({
    where: { enabled: true },
    select: {
      provider: true,
      enabled: true
    }
  })
  
  return configs.map(c => ({
    provider: c.provider,
    enabled: c.enabled ? 1 : 0
  }))
}

/**
 * 创建或更新 OAuth 配置
 */
export async function upsertOAuthConfig(
  provider: 'github' | 'google',
  data: {
    clientId: string
    clientSecret: string
    enabled: boolean
  }
): Promise<number> {
  const clientSecret = encryptOAuthSecret(data.clientSecret)
  const config = await prisma.oAuthConfig.upsert({
    where: { provider },
    create: {
      provider,
      clientId: data.clientId,
      clientSecret,
      enabled: data.enabled
    },
    update: {
      clientId: data.clientId,
      clientSecret,
      enabled: data.enabled
    }
  })
  
  return config.id
}

/**
 * 删除 OAuth 配置
 */
export async function deleteOAuthConfig(provider: 'github' | 'google'): Promise<void> {
  await prisma.oAuthConfig.delete({
    where: { provider }
  })
}

/**
 * 获取用户的所有 OAuth 绑定
 */
export async function getUserOAuthBindings(userId: number): Promise<UserOAuthBinding[]> {
  const bindings = await prisma.userOAuthBinding.findMany({
    where: { userId },
    orderBy: {
      provider: 'asc'
    }
  })
  
  return bindings.map(b => ({
    id: b.id,
    user_id: b.userId,
    provider: b.provider,
    provider_user_id: b.providerUserId,
    provider_username: b.providerUsername,
    provider_email: b.providerEmail,
    provider_avatar: b.providerAvatar,
    access_token: b.accessToken,
    refresh_token: b.refreshToken,
    created_at: b.createdAt.toISOString(),
    updated_at: b.updatedAt.toISOString()
  }))
}

/**
 * 根据提供商用户 ID 查找绑定
 */
export async function findOAuthBinding(
  provider: 'github' | 'google',
  providerUserId: string
): Promise<UserOAuthBinding | null> {
  const binding = await prisma.userOAuthBinding.findUnique({
    where: {
      provider_providerUserId: {
        provider,
        providerUserId
      }
    }
  })
  
  if (!binding) return null
  
  return {
    id: binding.id,
    user_id: binding.userId,
    provider: binding.provider,
    provider_user_id: binding.providerUserId,
    provider_username: binding.providerUsername,
    provider_email: binding.providerEmail,
    provider_avatar: binding.providerAvatar,
    access_token: binding.accessToken,
    refresh_token: binding.refreshToken,
    created_at: binding.createdAt.toISOString(),
    updated_at: binding.updatedAt.toISOString()
  }
}

/**
 * 检查用户是否已绑定某提供商
 */
export async function hasOAuthBinding(userId: number, provider: 'github' | 'google'): Promise<boolean> {
  const binding = await prisma.userOAuthBinding.findUnique({
    where: {
      userId_provider: {
        userId,
        provider
      }
    }
  })
  
  return binding !== null
}

/**
 * 创建 OAuth 绑定
 * 安全改进：加密存储 accessToken 和 refreshToken
 */
export async function createOAuthBinding(userId: number, data: {
  provider: 'github' | 'google'
  providerUserId: string
  providerUsername?: string | null
  providerEmail?: string | null
  providerAvatar?: string | null
  accessToken?: string | null
  refreshToken?: string | null
}): Promise<number> {
  const binding = await prisma.userOAuthBinding.create({
    data: {
      userId,
      provider: data.provider,
      providerUserId: data.providerUserId,
      providerUsername: data.providerUsername ?? null,
      providerEmail: data.providerEmail ?? null,
      providerAvatar: data.providerAvatar ?? null,
      // 加密存储 OAuth Token
      accessToken: data.accessToken ? encryptSensitiveData(data.accessToken) : null,
      refreshToken: data.refreshToken ? encryptSensitiveData(data.refreshToken) : null
    }
  })
  
  return binding.id
}

/**
 * 更新 OAuth 绑定的 Token
 * 安全改进：加密存储 accessToken 和 refreshToken
 */
export async function updateOAuthBindingToken(
  userId: number,
  provider: 'github' | 'google',
  accessToken: string,
  refreshToken: string | null = null
): Promise<void> {
  await prisma.userOAuthBinding.update({
    where: {
      userId_provider: {
        userId,
        provider
      }
    },
    data: {
      // 加密存储
      accessToken: encryptSensitiveData(accessToken),
      refreshToken: refreshToken ? encryptSensitiveData(refreshToken) : undefined
    }
  })
}

/** Never update tokens on a different provider identity or recreate a deleted binding. */
export async function bindOAuthAccountIfCurrent(
  userId: number,
  session: WriteSession,
  expected: UserOAuthBinding | null,
  data: { provider: 'github' | 'google'; providerUserId: string; providerUsername?: string | null;
    providerEmail?: string | null; providerAvatar?: string | null; accessToken: string; refreshToken?: string | null }
): Promise<void> {
  await prisma.$transaction(async tx => {
    if (!await authorizeUserWrite(tx, userId, session)) throw new Error('OAUTH_SESSION_CHANGED')
    const current = await tx.userOAuthBinding.findUnique({ where: { userId_provider: { userId, provider: data.provider } } })
    if (expected) {
      if (current?.id !== expected.id || current.providerUserId !== expected.provider_user_id ||
        current.providerUserId !== data.providerUserId || current.updatedAt.toISOString() !== expected.updated_at) throw new Error('OAUTH_BINDING_CHANGED')
      await tx.userOAuthBinding.update({ where: { id: current.id }, data: {
        accessToken: encryptSensitiveData(data.accessToken), refreshToken: data.refreshToken ? encryptSensitiveData(data.refreshToken) : undefined
      } })
    } else {
      if (current) throw new Error('OAUTH_BINDING_CHANGED')
      await tx.userOAuthBinding.create({ data: {
        userId, provider: data.provider, providerUserId: data.providerUserId,
        providerUsername: data.providerUsername ?? null, providerEmail: data.providerEmail ?? null,
        providerAvatar: data.providerAvatar ?? null, accessToken: encryptSensitiveData(data.accessToken),
        refreshToken: data.refreshToken ? encryptSensitiveData(data.refreshToken) : null
      } })
    }
  })
}

export async function updateOAuthLoginBindingIfCurrent(expected: UserOAuthBinding, accessToken: string, refreshToken: string | null): Promise<boolean> {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${expected.user_id} FOR UPDATE`)
    const user = await tx.user.findUnique({ where: { id: expected.user_id }, select: { status: true } })
    if (user?.status !== 'active') return false
    const changed = await tx.userOAuthBinding.updateMany({ where: {
      id: expected.id, userId: expected.user_id, provider: expected.provider,
      providerUserId: expected.provider_user_id, updatedAt: new Date(expected.updated_at)
    }, data: { accessToken: encryptSensitiveData(accessToken), refreshToken: refreshToken ? encryptSensitiveData(refreshToken) : undefined } })
    return changed.count === 1
  })
}

/** Create the session under the same account lock used by unbind/ban/revocation. */
export async function createOAuthLoginSession(login: OAuthLoginCodeData, ip?: string, userAgent?: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${login.userId} FOR UPDATE`)
    const user = await tx.user.findUnique({ where: { id: login.userId } })
    if (user?.status !== 'active' || !login.binding) return null
    const binding = await tx.userOAuthBinding.findFirst({ where: {
      id: login.binding.id, userId: user.id, provider: login.binding.provider, providerUserId: login.binding.providerUserId
    } })
    if (!binding) return null
    const invalidation = await tx.tokenInvalidation.findUnique({ where: {
      userId_sessionId: { userId: user.id, sessionId: '__USER_LEVEL__' }
    } })
    if (invalidation && Math.floor((login.authenticatedAt ?? login.timestamp) / 1000) <= invalidation.invalidatedAt) return null
    const refreshToken = await generateRefreshToken(user.id, user.username, user.role, ip, userAgent, tx)
    return { refreshToken, user: { id: user.id, username: user.username, role: user.role } }
  })
}

export async function unbindOwnOAuthAccount(userId: number, provider: 'github' | 'google', session: WriteSession): Promise<void> {
  await prisma.$transaction(async tx => {
    if (!await authorizeUserWrite(tx, userId, session)) throw new Error('OAUTH_SESSION_CHANGED')
    const deleted = await tx.userOAuthBinding.deleteMany({ where: { userId, provider } })
    if (!deleted.count) throw new Error('OAUTH_BINDING_NOT_FOUND')
    await revokeUserSessionsInTransaction(tx, userId)
  })
}

/**
 * 删除 OAuth 绑定
 */
export async function deleteOAuthBinding(userId: number, provider: 'github' | 'google', actor?: WriteActor): Promise<void> {
  if (!actor) {
    await prisma.userOAuthBinding.delete({ where: { userId_provider: { userId, provider } } })
    return
  }
  await prisma.$transaction(async tx => {
    await lockAdministrativeUserMutation(tx, userId, actor)
    if (actor.id === userId) throw new Error('CANNOT_MODIFY_SELF')
    const deleted = await tx.userOAuthBinding.deleteMany({ where: { userId, provider } })
    if (!deleted.count) throw new Error('OAUTH_BINDING_NOT_FOUND')
    await revokeUserSessionsInTransaction(tx, userId)
  })
}
