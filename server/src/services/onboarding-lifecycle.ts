import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { OnboardingError, type OnboardingCredentials } from '../lib/host-onboarding.js'
import { connectOnboardingSsh, sshExec, gatewayCommand, gatewayRegistrationOperation } from './onboarding-ssh.js'
import { preflightScript } from './onboarding-scripts.js'
import { randomUUID } from 'node:crypto'
import { isIPv4 } from 'node:net'
import { currentHostAddressWhere, lockOnboardingAddresses } from './onboarding-conflicts.js'

export type GatewayRegistration = { nodePublicKey: string; managementIp: string }
export type PeerRetirement = { version: 1; requestId: string; status: 'pending' | 'blocked' | 'done'; registration?: GatewayRegistration | null; enrollmentKey?: string; attempts: number; nextAttemptAt: string; error: string | null }

export function pendingPeerRetirement(registration?: GatewayRegistration): PeerRetirement {
  return { version: 1, requestId: randomUUID(), status: 'pending', ...(registration ? { registration } : {}), attempts: 0, nextAttemptAt: new Date().toISOString(), error: null }
}
export function deletedPeerRetirement(node: { peerRetirement: unknown }): PeerRetirement {
  const previous = readPeerRetirement(node.peerRetirement)
  if (previous?.status === 'pending') return previous
  return { ...pendingPeerRetirement(), ...(previous?.enrollmentKey ? { enrollmentKey: previous.enrollmentKey } : {}) }
}
export async function lockOnboardingLifecycle(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(734822, 1)`
}
export function readPeerRetirement(value: unknown): PeerRetirement | null {
  if (!value) return null
  const state = value as PeerRetirement
  if (state.version !== 1 || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(state.requestId) || !['pending', 'blocked', 'done'].includes(state.status) || !Number.isSafeInteger(state.attempts) || state.attempts < 0 ||
    !Number.isFinite(Date.parse(state.nextAttemptAt)) || state.enrollmentKey !== undefined && !/^[A-Za-z0-9+/]{43}=$/.test(state.enrollmentKey) ||
    state.registration != null && (!isIPv4(state.registration.managementIp) || !/^[A-Za-z0-9+/]{43}=$/.test(state.registration.nodePublicKey))) throw new OnboardingError('GATEWAY_RETIREMENT_CHANGED')
  return state
}

export async function inspectCurrentOnboardingSystem(node: {
  id: string; publicIp: string; sshPort: number; leaseToken: string | null; identityReset: unknown; name: string
}, actorId: number, credentials: OnboardingCredentials) {
  const current = await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { id: node.id } })
  const intent = current.identityReset as { version?: number; reason?: string; requestId?: string } | null
  if (current.hostId !== null || current.deletedAt || current.leaseToken !== node.leaseToken || current.status !== 'running' || intent?.version !== 1 ||
    !['retry', 'new'].includes(intent.reason || '') || intent.requestId !== (node.identityReset as { requestId?: string } | null)?.requestId) throw new OnboardingError('WORKER_INTERRUPTED')
  if (await prisma.host.count({ where: currentHostAddressWhere(node.publicIp) })) throw new OnboardingError('HOST_IP_ALREADY_REGISTERED')
  let fingerprint: string | null = null
  const client = await connectOnboardingSsh({ host: node.publicIp, port: node.sshPort, ...credentials }, async current => { fingerprint = current; return true })
  try {
    // Authentication and the remote no-customer preflight must both complete
    // before a candidate SSH identity is persisted.
    await sshExec(client, 'sh -s', preflightScript(node.id))
    if (!fingerprint) throw new OnboardingError('SSH_IDENTITY_CHECK_FAILED')
    await prisma.$transaction(async tx => {
      await lockOnboardingLifecycle(tx)
      const current = await tx.hostOnboardingNode.findUniqueOrThrow({ where: { id: node.id } })
      const reset = current.identityReset as { version?: number; reason?: string; requestId?: string } | null
      if (current.hostId !== null || current.deletedAt || current.leaseToken !== node.leaseToken || current.status !== 'running' || reset?.version !== 1 ||
        reset.requestId !== (node.identityReset as { requestId?: string } | null)?.requestId) throw new OnboardingError('WORKER_INTERRUPTED')
      if (await tx.host.count({ where: currentHostAddressWhere(node.publicIp) })) throw new OnboardingError('HOST_IP_ALREADY_REGISTERED')
      const changed = current.sshFingerprint !== fingerprint || reset.reason === 'new'
      const retirement = readPeerRetirement(current.peerRetirement)
      await tx.hostOnboardingNode.update({ where: { id: node.id }, data: {
        sshFingerprint: fingerprint,
        ...(changed ? { resolvedResources: Prisma.DbNull,
          peerRetirement: retirement?.status === 'done' ? current.peerRetirement as Prisma.InputJsonValue : (retirement || pendingPeerRetirement(current.nodePublicKey && current.managementIp ? { nodePublicKey: current.nodePublicKey, managementIp: current.managementIp } : undefined)) as unknown as Prisma.InputJsonValue } : {})
      } })
      if (changed) await tx.log.create({ data: { userId: actorId, module: 'host', action: 'host.onboarding.ssh_identity_refreshed', result: 'success',
        content: `Authenticated and inspected current system for host "${node.name}"; previous SSH identity retained in history: ${current.sshFingerprint || 'none'}` } })
    }, { timeout: 15000 })
    return client
  } catch (error) { client.destroy(); throw error }
}

// Read-only SSH calls happen before the database lock. Persist the observed
// target before any remote mutation, so an interrupted operation uses the same
// receipt and cannot retire a subsequent enrollment.
export async function prepareOnboardingRetirement(nodeId: string) {
  const initial = await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { id: nodeId } })
  const state = readPeerRetirement(initial.peerRetirement)
  if (!state || state.status === 'done') return
  if (state.status === 'blocked') throw new OnboardingError(state.error || 'GATEWAY_RETIREMENT_CHANGED')
  const gateway = await gatewayCommand()
  if (gateway.retirementProtocolVersion !== 1) throw new OnboardingError('GATEWAY_RETIREMENT_HELPER_REQUIRED')
  const observed = state.registration === undefined ? await gatewayRegistrationOperation(nodeId) : state.registration
  await prisma.$transaction(async tx => {
    await lockOnboardingLifecycle(tx)
    const current = await tx.hostOnboardingNode.findUniqueOrThrow({ where: { id: nodeId } })
    const pending = readPeerRetirement(current.peerRetirement)
    if (current.hostId !== null || pending?.requestId !== state.requestId || pending.status !== 'pending') throw new OnboardingError('WORKER_INTERRUPTED')
    if (observed && observed.nodePublicKey !== current.nodePublicKey && observed.nodePublicKey !== pending.enrollmentKey &&
      !(current.identityReset && !current.deletedAt && current.status === 'running')) throw new OnboardingError('GATEWAY_RETIREMENT_CHANGED')
    if (pending.registration === undefined) await tx.hostOnboardingNode.update({ where: { id: nodeId }, data: {
      peerRetirement: { ...pending, registration: observed } as unknown as Prisma.InputJsonValue
    } })
  })
}

// Only one bounded mutation occurs while holding the lifecycle lock. Node
// writes happen at the end, allowing the worker heartbeat to keep its lease.
export async function retireOnboardingPeer(tx: Prisma.TransactionClient, node: {
  id: string; hostId: number | null; publicIp: string; peerRetirement: unknown
}) {
  const state = readPeerRetirement(node.peerRetirement)
  if (!state) throw new OnboardingError('GATEWAY_RETIREMENT_CHANGED')
  if (state.status === 'blocked') throw new OnboardingError(state.error || 'GATEWAY_RETIREMENT_CHANGED')
  if (state.status === 'done') return
  if (node.hostId !== null || await tx.host.count({ where: currentHostAddressWhere(node.publicIp) })) throw new OnboardingError('HOST_ALREADY_REGISTERED')
  if (state.registration === undefined) throw new OnboardingError('GATEWAY_RETIREMENT_CHANGED')
  const registration = state.registration
  if (registration) {
    const conflict = await tx.hostOnboardingNode.count({ where: { id: { not: node.id }, hostId: { not: null },
      OR: [{ nodePublicKey: registration.nodePublicKey }, { managementIp: registration.managementIp }] } })
    if (conflict) throw new OnboardingError('GATEWAY_RETIREMENT_CHANGED')
    await gatewayRegistrationOperation(node.id, { ...registration, requestId: state.requestId })
  }
  await tx.hostOnboardingNode.update({ where: { id: node.id }, data: {
    peerRetirement: { ...state, ...(registration ? { registration } : {}), status: 'done', error: null } as unknown as Prisma.InputJsonValue
  } })
}

export async function enrollOnboardingGateway(node: { id: string; publicIp: string; leaseToken: string | null }, publicKey: string, inspectCurrentSystem: boolean) {
  const initial = await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { id: node.id } })
  const pending = readPeerRetirement(initial.peerRetirement)
  let saved: GatewayRegistration | null = null
  if (initial.hostId === null && (inspectCurrentSystem || pending?.status === 'pending' || pending?.enrollmentKey)) {
    const gateway = await gatewayCommand()
    if (gateway.retirementProtocolVersion !== 1) throw new OnboardingError('GATEWAY_RETIREMENT_HELPER_REQUIRED')
    saved = await gatewayRegistrationOperation(node.id)
  }
  await prisma.$transaction(async tx => {
    await lockOnboardingLifecycle(tx)
    const current = await tx.hostOnboardingNode.findUniqueOrThrow({ where: { id: node.id } })
    if (current.leaseToken !== node.leaseToken || current.status !== 'running' || current.deletedAt) throw new OnboardingError('WORKER_INTERRUPTED')
    if (saved && saved.nodePublicKey !== publicKey) {
      if (!inspectCurrentSystem || current.hostId !== null) throw new OnboardingError('MANAGEMENT_NETWORK_CONFLICT')
      const retirement = readPeerRetirement(current.peerRetirement)
      if (retirement?.enrollmentKey && retirement.enrollmentKey !== saved.nodePublicKey && retirement.status === 'done') throw new OnboardingError('GATEWAY_RETIREMENT_CHANGED')
      if (!retirement || retirement.status === 'done') {
        await tx.hostOnboardingNode.update({ where: { id: node.id }, data: {
          peerRetirement: pendingPeerRetirement(saved) as unknown as Prisma.InputJsonValue
        } })
      } else if (retirement.registration && (retirement.registration.nodePublicKey !== saved.nodePublicKey || retirement.registration.managementIp !== saved.managementIp)) {
        throw new OnboardingError('GATEWAY_RETIREMENT_CHANGED')
      }
    }
  })
  await prepareOnboardingRetirement(node.id)
  // Commit the retirement receipt before registration. A later add failure
  // therefore resumes at registration, without repeating the old retirement.
  await prisma.$transaction(async tx => {
    await lockOnboardingLifecycle(tx)
    const current = await tx.hostOnboardingNode.findUniqueOrThrow({ where: { id: node.id } })
    if (current.leaseToken !== node.leaseToken || current.status !== 'running' || current.deletedAt) throw new OnboardingError('WORKER_INTERRUPTED')
    const state = readPeerRetirement(current.peerRetirement)
    if (state && state.status !== 'done') await retireOnboardingPeer(tx, current)
  }, { timeout: 50000 })
  // Persist the intended new key before add, independently of its response.
  // A timeout after remote success can then resume or delete that exact peer.
  await prisma.$transaction(async tx => {
    await lockOnboardingLifecycle(tx)
    const current = await tx.hostOnboardingNode.findUniqueOrThrow({ where: { id: node.id } })
    if (current.leaseToken !== node.leaseToken || current.status !== 'running' || current.deletedAt) throw new OnboardingError('WORKER_INTERRUPTED')
    const state = readPeerRetirement(current.peerRetirement)
    if (state && state.status !== 'done') throw new OnboardingError('GATEWAY_RETIREMENT_PENDING')
    if (current.hostId !== null) return
    await tx.hostOnboardingNode.update({ where: { id: node.id }, data: {
      peerRetirement: { ...(state || { ...pendingPeerRetirement(), registration: null, status: 'done' }), enrollmentKey: publicKey } as unknown as Prisma.InputJsonValue
    } })
  })
  return prisma.$transaction(async tx => {
    await lockOnboardingAddresses(tx, [node.publicIp])
    await lockOnboardingLifecycle(tx)
    const current = await tx.hostOnboardingNode.findUniqueOrThrow({ where: { id: node.id } })
    if (current.leaseToken !== node.leaseToken || current.status !== 'running' || current.deletedAt) throw new OnboardingError('WORKER_INTERRUPTED')
    if (current.hostId === null && await tx.host.count({ where: currentHostAddressWhere(node.publicIp) })) throw new OnboardingError('HOST_IP_ALREADY_REGISTERED')
    const gateway = await gatewayCommand(`add ${node.id} ${publicKey}`)
    if (!gateway.managementIp) throw new OnboardingError('GATEWAY_RESPONSE_INVALID')
    await tx.hostOnboardingNode.update({ where: { id: node.id }, data: {
      identityReset: Prisma.DbNull, managementIp: gateway.managementIp, nodePublicKey: publicKey
    } })
    return gateway
  }, { timeout: 50000 })
}

export async function processOnboardingRetirements() {
  const candidates = await prisma.hostOnboardingNode.findMany({ where: { deletedAt: { not: null }, hostId: null,
    AND: [{ peerRetirement: { path: ['status'], equals: 'pending' } }, { peerRetirement: { path: ['nextAttemptAt'], lte: new Date().toISOString() } }] },
    orderBy: { updatedAt: 'asc' }, take: 2 })
  for (const candidate of candidates) {
    const state = readPeerRetirement(candidate.peerRetirement)
    if (!state || Date.parse(state.nextAttemptAt) > Date.now()) continue
    try {
      await prepareOnboardingRetirement(candidate.id)
      await prisma.$transaction(async tx => {
        await lockOnboardingLifecycle(tx)
        const node = await tx.hostOnboardingNode.findUnique({ where: { id: candidate.id } })
        if (!node?.deletedAt || node.hostId !== null || readPeerRetirement(node.peerRetirement)?.status !== 'pending') return
        await retireOnboardingPeer(tx, node)
        const batch = await tx.hostOnboardingBatch.findUniqueOrThrow({ where: { id: node.batchId }, select: { createdById: true } })
        await tx.log.create({ data: { userId: batch.createdById, module: 'host', action: 'host.onboarding.peer_retired', result: 'success',
          content: `已移除机器「${node.name}」（${node.publicIp}）的旧管理连接，其他宿主管理连接保持。` } })
      }, { timeout: 50000 })
    } catch (error) {
      const attempts = state.attempts + 1
      const code = error instanceof OnboardingError ? error.code : 'GATEWAY_RETIREMENT_FAILED'
      const blocked = ['HOST_ALREADY_REGISTERED', 'GATEWAY_RETIREMENT_CHANGED', 'SSH_HOST_KEY_CHANGED'].includes(code)
      await prisma.$transaction(async tx => {
        await lockOnboardingLifecycle(tx)
        const current = await tx.hostOnboardingNode.findUnique({ where: { id: candidate.id } })
        const saved = readPeerRetirement(current?.peerRetirement)
        if (!current?.deletedAt || current.hostId !== null || saved?.requestId !== state.requestId || saved.status !== 'pending') return
        await tx.hostOnboardingNode.update({ where: { id: candidate.id }, data: {
          peerRetirement: { ...saved, attempts, status: blocked ? 'blocked' : 'pending', error: code,
            nextAttemptAt: new Date(Date.now() + Math.min(1800000, 15000 * 2 ** Math.min(attempts, 7))).toISOString() } as unknown as Prisma.InputJsonValue
        } })
        if (blocked || state.error !== code) {
          const batch = await tx.hostOnboardingBatch.findUniqueOrThrow({ where: { id: current.batchId }, select: { createdById: true } })
          await tx.log.create({ data: { userId: batch.createdById, module: 'host', action: 'host.onboarding.peer_retirement_waiting', result: 'warning',
            content: `机器「${current.name}」（${current.publicIp}）旧管理连接清理：${code}；${blocked ? '当前身份不一致，保留原连接，未清理其他宿主。' : '进度已保留，后台将自动重试。'}` } })
        }
      })
    }
  }
}
