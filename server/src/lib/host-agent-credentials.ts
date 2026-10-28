import { Prisma } from '@prisma/client'
import { createHash, randomBytes } from 'crypto'
import { prisma } from '../db/prisma.js'
import { generateAgentId, generateAgentSecret, hashAgentSecret } from './agent-auth.js'
import { decryptSensitiveData, encryptSensitiveData } from './security.js'
import { authorizeUserWrite, type WriteActor } from '../db/user-write-authorization.js'

export interface HostAgentRecord {
  id: number
  hostId: number
  agentId: string
  secretHash: string
  secretEncrypted: string
  installTokenHash: string | null
  installTokenExpiresAt: Date | null
  installTokenUsedAt: Date | null
  enabled: boolean
  status: string
  version: string | null
  capabilities: unknown
  lastReport: unknown
  lastSeenAt: Date | null
  lastHeartbeatIp: string | null
  createdAt: Date
  updatedAt: Date
}

const agentModel = prisma.hostAgent
const agentInstallTokenPrefix = 'ait_'
const agentInstallTokenTtlMs = 30 * 60 * 1000

async function generateUniqueAgentId(tx: Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const agentId = generateAgentId()
    const existing = await tx.hostAgent.findUnique({
      where: { agentId },
      select: { id: true }
    })
    if (!existing) {
      return agentId
    }
  }
  throw new Error('Unable to generate unique Agent ID')
}

export type AgentCredentialAuthority = { actor: WriteActor; adminOnly?: boolean } | { hostInstallToken: string }

async function lockCredentialHost(tx: Prisma.TransactionClient, hostId: number, authority: AgentCredentialAuthority) {
  await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${hostId} FOR UPDATE`
  const host = await tx.host.findUnique({ where: { id: hostId }, select: {
    id: true, name: true, userId: true, isInstalled: true, installToken: true, installTokenExpire: true
  } })
  if (!host) throw new Error('HOST_NOT_FOUND')
  if ('actor' in authority) {
    const actor = authority.actor
    if (!await authorizeUserWrite(tx, actor.id, actor)) throw new Error('AGENT_ACTOR_FORBIDDEN')
    const current = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true } })
    if (current?.role !== 'admin' && (authority.adminOnly || host.userId !== actor.id)) throw new Error('AGENT_ACTOR_FORBIDDEN')
  } else if (host.isInstalled || host.installToken !== authority.hostInstallToken ||
    !host.installTokenExpire || host.installTokenExpire <= new Date()) {
    throw new Error('AGENT_INSTALL_TOKEN_INVALID')
  }
  return { id: host.id, name: host.name }
}

async function rotateCredentialsInTransaction(tx: Prisma.TransactionClient, hostId: number, enabled: boolean, authority: AgentCredentialAuthority) {
  const host = await lockCredentialHost(tx, hostId, authority)
  const existingAgent = await tx.hostAgent.findUnique({ where: { hostId }, select: { agentId: true } })
  if (existingAgent) {
    // Nonce deletion and the identity rotation must commit together.
    await tx.hostAgentNonce.deleteMany({ where: { agentId: existingAgent.agentId } })
  }
  const agentId = await generateUniqueAgentId(tx)
  const agentSecret = generateAgentSecret()
  const agent = await tx.hostAgent.upsert({
    where: { hostId },
    create: { hostId, agentId, secretHash: hashAgentSecret(agentSecret), secretEncrypted: encryptSensitiveData(agentSecret), enabled, status: 'offline' },
    update: {
      agentId, secretHash: hashAgentSecret(agentSecret), secretEncrypted: encryptSensitiveData(agentSecret),
      installTokenHash: null, installTokenExpiresAt: null, installTokenUsedAt: null,
      enabled, status: 'offline', version: null, capabilities: [] as Prisma.InputJsonValue,
      lastReport: {} as Prisma.InputJsonObject, lastSeenAt: null, lastHeartbeatIp: null, adminOfflineAlertedAt: null
    }
  })
  return { host, agent, agentId, agentSecret }
}

export async function rotateHostAgentCredentials(hostId: number, enabled: boolean, authority: AgentCredentialAuthority): Promise<{
  host: { id: number; name: string }
  agent: HostAgentRecord
  agentId: string
  agentSecret: string
}> {
  return prisma.$transaction(tx => rotateCredentialsInTransaction(tx, hostId, enabled, authority))
}

function generateAgentInstallToken(): string {
  return `${agentInstallTokenPrefix}${randomBytes(32).toString('base64url')}`
}

function hashAgentInstallToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function isAgentInstallToken(value: string): boolean {
  return value.startsWith(agentInstallTokenPrefix) && value.length >= agentInstallTokenPrefix.length + 32
}

export async function issueHostAgentInstallToken(hostId: number, enabled: boolean, authority: AgentCredentialAuthority): Promise<{
  host: { id: number; name: string }
  agent: HostAgentRecord
  installToken: string
  installTokenExpiresAt: Date
}> {
  return prisma.$transaction(async tx => {
    const rotated = await rotateCredentialsInTransaction(tx, hostId, enabled, authority)
    const installToken = generateAgentInstallToken()
    const installTokenExpiresAt = new Date(Date.now() + agentInstallTokenTtlMs)

    const agent = await tx.hostAgent.update({
      where: { id: rotated.agent.id },
      data: {
        installTokenHash: hashAgentInstallToken(installToken),
        installTokenExpiresAt,
        installTokenUsedAt: null
      }
    })

    return {
      host: rotated.host,
      agent,
      installToken,
      installTokenExpiresAt
    }
  })
}

export async function consumeHostAgentInstallToken(token: string): Promise<{
  host: { id: number; name: string }
  agent: HostAgentRecord
  agentSecret: string
}> {
  if (!isAgentInstallToken(token)) {
    throw new Error('AGENT_INSTALL_TOKEN_INVALID')
  }

  const tokenHash = hashAgentInstallToken(token)
  const initialAgent = await agentModel.findUnique({
    where: { installTokenHash: tokenHash }, select: { hostId: true }
  })
  if (!initialAgent) throw new Error('AGENT_INSTALL_TOKEN_INVALID')
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${initialAgent.hostId} FOR UPDATE`
    const agent = await tx.hostAgent.findUnique({
      where: { installTokenHash: tokenHash },
      include: {
        host: {
          select: { id: true, name: true }
        }
      }
    })

    if (!agent || !agent.installTokenExpiresAt || agent.installTokenUsedAt) {
      throw new Error('AGENT_INSTALL_TOKEN_INVALID')
    }
    if (agent.installTokenExpiresAt < new Date()) {
      throw new Error('AGENT_INSTALL_TOKEN_EXPIRED')
    }

    let agentSecret: string | null
    try { agentSecret = decryptSensitiveData(agent.secretEncrypted) } catch { throw new Error('AGENT_SECRET_INVALID') }
    if (!agentSecret || hashAgentSecret(agentSecret) !== agent.secretHash) throw new Error('AGENT_SECRET_INVALID')

    const updated = await tx.hostAgent.updateMany({
      where: {
        id: agent.id,
        installTokenHash: tokenHash,
        agentId: agent.agentId,
        secretEncrypted: agent.secretEncrypted,
        installTokenUsedAt: null,
        installTokenExpiresAt: { gte: new Date() }
      },
      data: {
        installTokenHash: null,
        installTokenExpiresAt: null,
        installTokenUsedAt: new Date()
      }
    })
    if (updated.count !== 1) {
      throw new Error('AGENT_INSTALL_TOKEN_INVALID')
    }

    const { host, ...agentRecord } = agent
    return {
      host,
      agent: agentRecord,
      agentSecret
    }
  })
}
