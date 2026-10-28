/**
 * 用户自定义初始化命令相关数据库操作
 * 使用 Prisma ORM
 */

import { prisma } from './prisma.js'
import { authorizeUserWrite, type WriteSession } from './user-write-authorization.js'

// 最大命令模板数量
const MAX_COMMANDS_PER_USER = 50
// 命令内容最大大小 (64KB)
const MAX_COMMAND_SIZE = 64 * 1024

export interface CustomInitCommandData {
  id: number
  userId: number
  name: string
  command: string
  distros: string[] // 解析后的数组
  description: string | null
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/**
 * 获取用户的所有自定义初始化命令
 */
export async function getCustomInitCommandsByUserId(userId: number): Promise<CustomInitCommandData[]> {
  const commands = await prisma.customInitCommand.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' }
  })

  return commands.map(cmd => ({
    id: cmd.id,
    userId: cmd.userId,
    name: cmd.name,
    command: cmd.command,
    distros: JSON.parse(cmd.distros) as string[],
    description: cmd.description,
    enabled: cmd.enabled,
    createdAt: cmd.createdAt.toISOString(),
    updatedAt: cmd.updatedAt.toISOString()
  }))
}

/**
 * 获取用户的启用状态的自定义初始化命令（按发行版筛选）
 */
export async function getEnabledCommandsByDistro(userId: number, distro: string): Promise<CustomInitCommandData[]> {
  const commands = await prisma.customInitCommand.findMany({
    where: {
      userId,
      enabled: true
    },
    orderBy: { createdAt: 'desc' }
  })

  // 筛选适配当前发行版的命令（包括 "all" 通用命令）
  const filtered = commands.filter(cmd => {
    const distros = JSON.parse(cmd.distros) as string[]
    return distros.includes('all') || distros.includes(distro)
  })

  return filtered.map(cmd => ({
    id: cmd.id,
    userId: cmd.userId,
    name: cmd.name,
    command: cmd.command,
    distros: JSON.parse(cmd.distros) as string[],
    description: cmd.description,
    enabled: cmd.enabled,
    createdAt: cmd.createdAt.toISOString(),
    updatedAt: cmd.updatedAt.toISOString()
  }))
}

/**
 * 根据 ID 获取自定义初始化命令
 */
export async function getCustomInitCommandById(id: number): Promise<CustomInitCommandData | null> {
  const cmd = await prisma.customInitCommand.findUnique({
    where: { id }
  })

  if (!cmd) return null

  return {
    id: cmd.id,
    userId: cmd.userId,
    name: cmd.name,
    command: cmd.command,
    distros: JSON.parse(cmd.distros) as string[],
    description: cmd.description,
    enabled: cmd.enabled,
    createdAt: cmd.createdAt.toISOString(),
    updatedAt: cmd.updatedAt.toISOString()
  }
}

/**
 * 根据 ID 列表批量获取自定义初始化命令
 */
export async function getCustomInitCommandsByIds(ids: number[]): Promise<CustomInitCommandData[]> {
  if (ids.length === 0) return []

  const commands = await prisma.customInitCommand.findMany({
    where: {
      id: { in: ids }
    }
  })

  return commands.map(cmd => ({
    id: cmd.id,
    userId: cmd.userId,
    name: cmd.name,
    command: cmd.command,
    distros: JSON.parse(cmd.distros) as string[],
    description: cmd.description,
    enabled: cmd.enabled,
    createdAt: cmd.createdAt.toISOString(),
    updatedAt: cmd.updatedAt.toISOString()
  }))
}

/**
 * 获取用户命令数量
 */
export async function getCustomInitCommandCount(userId: number): Promise<number> {
  return prisma.customInitCommand.count({
    where: { userId }
  })
}

/**
 * 创建自定义初始化命令
 */
export async function createCustomInitCommand(data: {
  userId: number
  name: string
  command: string
  distros: string[]
  description?: string
  session?: WriteSession
}): Promise<{ success: true; id: number } | { success: false; error: string }> {
  // 验证命令内容大小
  if (Buffer.byteLength(data.command, 'utf-8') > MAX_COMMAND_SIZE) {
    return { success: false, error: 'COMMAND_TOO_LARGE' }
  }

  if (!data.name.trim()) return { success: false, error: 'INVALID_NAME' }
  if (!data.command.trim()) return { success: false, error: 'INVALID_COMMAND' }

  // 验证发行版列表
  const validDistros = ['ubuntu', 'debian', 'rhel', 'alpine', 'arch', 'suse', 'all']
  const invalidDistros = data.distros.filter(d => !validDistros.includes(d))
  if (!data.distros.length || invalidDistros.length > 0) {
    return { success: false, error: 'INVALID_DISTROS' }
  }

  return prisma.$transaction(async tx => {
    if (!await authorizeUserWrite(tx, data.userId, data.session, true)) return { success: false as const, error: 'WRITE_FORBIDDEN' }
    if (await tx.customInitCommand.count({ where: { userId: data.userId } }) >= MAX_COMMANDS_PER_USER) {
      return { success: false as const, error: 'MAX_COMMANDS_REACHED' }
    }
  const cmd = await tx.customInitCommand.create({
    data: {
      userId: data.userId,
      name: data.name.trim(),
      command: data.command,
      distros: JSON.stringify(data.distros),
      description: data.description?.trim() || null
    }
  })

  return { success: true as const, id: cmd.id }
  })
}

/**
 * 更新自定义初始化命令
 */
export async function updateCustomInitCommand(
  id: number,
  userId: number,
  data: {
    name?: string
    command?: string
    distros?: string[]
    description?: string | null
    enabled?: boolean
  },
  session?: WriteSession
): Promise<{ success: true } | { success: false; error: string }> {
  if (data.name !== undefined && !data.name.trim()) return { success: false, error: 'INVALID_NAME' }
  if (data.command !== undefined && !data.command.trim()) return { success: false, error: 'INVALID_COMMAND' }

  // 验证命令内容大小
  if (data.command && Buffer.byteLength(data.command, 'utf-8') > MAX_COMMAND_SIZE) {
    return { success: false, error: 'COMMAND_TOO_LARGE' }
  }

  // 验证发行版列表
  if (data.distros) {
    const validDistros = ['ubuntu', 'debian', 'rhel', 'alpine', 'arch', 'suse', 'all']
    const invalidDistros = data.distros.filter(d => !validDistros.includes(d))
    if (!data.distros.length || invalidDistros.length > 0) {
      return { success: false, error: 'INVALID_DISTROS' }
    }
  }

  const updateData: Record<string, unknown> = {}
  if (data.name !== undefined) updateData.name = data.name.trim()
  if (data.command !== undefined) updateData.command = data.command
  if (data.distros !== undefined) updateData.distros = JSON.stringify(data.distros)
  if (data.description !== undefined) updateData.description = data.description?.trim() || null
  if (data.enabled !== undefined) updateData.enabled = data.enabled

  return prisma.$transaction(async tx => {
    if (!await authorizeUserWrite(tx, userId, session, true)) return { success: false as const, error: 'WRITE_FORBIDDEN' }
  const changed = await tx.customInitCommand.updateMany({
    where: { id, userId },
    data: updateData
  })

  return changed.count === 1 ? { success: true as const } : { success: false as const, error: 'NOT_FOUND' }
  })
}

/**
 * 删除自定义初始化命令
 */
export async function deleteCustomInitCommand(id: number, userId: number, session?: WriteSession): Promise<boolean | 'WRITE_FORBIDDEN'> {
  return prisma.$transaction(async tx => {
    if (!await authorizeUserWrite(tx, userId, session, true)) return 'WRITE_FORBIDDEN' as const
  const result = await tx.customInitCommand.deleteMany({
    where: { id, userId }
  })

  return result.count > 0
  })
}

/**
 * 验证命令列表是否属于用户且处于启用状态
 */
export async function validateCommandsOwnership(
  commandIds: number[],
  userId: number
): Promise<{ valid: true; commands: CustomInitCommandData[] } | { valid: false; error: string }> {
  if (commandIds.length === 0) {
    return { valid: true, commands: [] }
  }

  const commands = await prisma.customInitCommand.findMany({
    where: {
      id: { in: commandIds },
      userId,
      enabled: true
    }
  })

  if (commands.length !== commandIds.length) {
    return { valid: false, error: 'INVALID_COMMAND_IDS' }
  }

  return {
    valid: true,
    commands: commands.map(cmd => ({
      id: cmd.id,
      userId: cmd.userId,
      name: cmd.name,
      command: cmd.command,
      distros: JSON.parse(cmd.distros) as string[],
      description: cmd.description,
      enabled: cmd.enabled,
      createdAt: cmd.createdAt.toISOString(),
      updatedAt: cmd.updatedAt.toISOString()
    }))
  }
}

/**
 * 合并多个命令模板的命令内容
 * 返回用于注入到 cloud-init 的完整命令文本
 */
export function mergeCommandContents(commands: CustomInitCommandData[]): string {
  if (commands.length === 0) return ''

  // 按 ID 顺序（保持用户选择顺序）合并命令内容
  return commands.map(cmd => cmd.command).join('\n')
}

/**
 * 根据 ID 列表获取命令（别名，与 getCustomInitCommandsByIds 等价）
 */
export const getCommandsByIds = getCustomInitCommandsByIds

/**
 * 根据镜像别名解析出发行版标识
 * 返回: ubuntu, debian, rhel, alpine, arch, suse, other
 */
export function getImageDistroFromAlias(imageAlias: string): string {
  const alias = imageAlias.toLowerCase()

  if (alias.includes('ubuntu')) return 'ubuntu'
  if (alias.includes('debian') || alias.includes('kali')) return 'debian'
  if (alias.includes('alpine')) return 'alpine'
  if (alias.includes('arch')) return 'arch'
  if (alias.includes('opensuse') || alias.includes('suse') || alias.includes('tumbleweed') || alias.includes('leap')) return 'suse'
  if (alias.includes('alma') || alias.includes('rocky') || alias.includes('oracle') || alias.includes('centos') || alias.includes('rhel') || alias.includes('fedora')) return 'rhel'

  return 'other'
}
