/**
 * SSH 密钥相关数据库操作
 * 使用 Prisma ORM
 */

import { prisma } from './prisma.js'
import type { SshKey } from '../types/database.js'
import { authorizeUserWrite, type WriteSession } from './user-write-authorization.js'

/**
 * 获取用户的所有 SSH 密钥
 */
export async function getSSHKeysByUserId(userId: number): Promise<SshKey[]> {
  const sshKeys = await prisma.sshKey.findMany({
    where: { userId },
    orderBy: {
      createdAt: 'desc'
    }
  })
  
  return sshKeys.map(key => ({
    id: key.id,
    user_id: key.userId,
    name: key.name,
    public_key: key.publicKey,
    fingerprint: key.fingerprint,
    created_at: key.createdAt.toISOString()
  }))
}

/**
 * 根据 ID 获取 SSH 密钥
 */
export async function getSSHKeyById(id: number): Promise<SshKey | null> {
  const sshKey = await prisma.sshKey.findUnique({
    where: { id }
  })
  
  if (!sshKey) return null
  
  return {
    id: sshKey.id,
    user_id: sshKey.userId,
    name: sshKey.name,
    public_key: sshKey.publicKey,
    fingerprint: sshKey.fingerprint,
    created_at: sshKey.createdAt.toISOString()
  }
}

/**
 * 创建 SSH 密钥
 */
export async function createSSHKey(data: {
  userId: number
  name: string
  publicKey: string
  fingerprint: string
  session?: WriteSession
}): Promise<number> {
  return prisma.$transaction(async tx => {
    if (!await authorizeUserWrite(tx, data.userId, data.session, true)) throw new Error('SSH_KEY_USER_INACTIVE')
    if (await tx.sshKey.findFirst({ where: { userId: data.userId, fingerprint: data.fingerprint }, select: { id: true } })) {
      throw new Error('SSH_KEY_EXISTS')
    }
    if (await tx.sshKey.count({ where: { userId: data.userId } }) >= 20) throw new Error('SSH_KEY_LIMIT')
    const { session: _session, ...keyData } = data
    const sshKey = await tx.sshKey.create({ data: keyData })
    return sshKey.id
  })
}

/**
 * 删除 SSH 密钥
 */
export async function deleteSSHKey(id: number): Promise<void> {
  await prisma.sshKey.delete({
    where: { id }
  })
}
