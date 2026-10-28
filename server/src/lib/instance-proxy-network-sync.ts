import type { Host, InstanceStatus, Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from '../db/advisory-locks.js'
import { hasActiveTransferWorkflow } from '../db/transfers.js'
import { authorizeUserWrite, type WriteActor } from '../db/user-write-authorization.js'
import { randomUUID } from 'node:crypto'
import { applyProxySiteOperation, prepareProxySiteOperationInTransaction, supersedeProxySiteIpv4Operation, type ProxySiteOperationRequest } from '../db/proxy-site-operations.js'
import { PENDING_PROXY_SITE_OPERATION_STATES } from '../db/proxy-site-operation-guards.js'
import { persistResolvedInstanceNetworkAddressesInTransaction,
  type InstanceNetworkSyncTarget, type ResolvedInstanceNetworkAddresses } from './instance-network-sync.js'

export interface ProxyNetworkSyncObservation extends InstanceNetworkSyncTarget {
  hostId: number
  incusId: string
  userId: number
  hostOwnerId: number
  hostUrl: string
  hostConnectionIdentity: string
  updatedAt: string
}

function hostConnectionIdentity(host: Pick<Host, 'url' | 'certPath' | 'keyPath' | 'serverCertificate' | 'serverFingerprint'>): string {
  return JSON.stringify([host.url, host.certPath, host.keyPath, host.serverCertificate, host.serverFingerprint])
}

export async function readProxyNetworkSyncHostIdentity(hostId: number): Promise<string> {
  const host = await prisma.host.findUniqueOrThrow({ where: { id: hostId }, select: {
    url: true, certPath: true, keyPath: true, serverCertificate: true, serverFingerprint: true
  } })
  return hostConnectionIdentity(host)
}

export class ProxyNetworkSyncError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 409) { super(message) }
}

async function lockCurrentInstance(tx: Prisma.TransactionClient, observed: ProxyNetworkSyncObservation,
  actor: WriteActor, hostOwnerOnly: boolean) {
  await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`
  if (!await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, observed.id)) {
    throw new ProxyNetworkSyncError('INSTANCE_SYNC_BUSY', '实例正在执行其他操作，请稍后重试同步')
  }
  await tx.$queryRaw`SELECT id FROM instances WHERE id = ${observed.id} FOR UPDATE`
  const instance = await tx.instance.findUnique({ where: { id: observed.id } })
  if (!instance || instance.status === 'deleted' || instance.hostId !== observed.hostId ||
    instance.incusId !== observed.incusId || instance.userId !== observed.userId ||
    instance.updatedAt.toISOString() !== observed.updatedAt ||
    instance.networkMode !== observed.networkMode || instance.ipv4 !== (observed.ipv4 ?? null) ||
    instance.ipv6 !== (observed.ipv6 ?? null)) {
    throw new ProxyNetworkSyncError('INSTANCE_SYNC_SOURCE_CHANGED', '实例身份或网络配置已变化，请重新同步')
  }
  await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${instance.hostId} FOR SHARE`
  const host = await tx.host.findUnique({ where: { id: instance.hostId } })
  if (!host || host.url !== observed.hostUrl || host.userId !== observed.hostOwnerId ||
    hostConnectionIdentity(host) !== observed.hostConnectionIdentity) {
    throw new ProxyNetworkSyncError('INSTANCE_SYNC_HOST_CHANGED', '宿主机连接或归属已变化，请重新同步')
  }
  if (!await authorizeUserWrite(tx, actor.id, actor)) {
    throw new ProxyNetworkSyncError('INSTANCE_SYNC_FORBIDDEN', '当前会话无权同步实例', 403)
  }
  const currentActor = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { role: true } })
  if (currentActor.role !== 'admin' && host.userId !== actor.id && (hostOwnerOnly || instance.userId !== actor.id)) {
    throw new ProxyNetworkSyncError('INSTANCE_SYNC_FORBIDDEN', '无权同步此实例', 403)
  }
  if (instance.provisioningCleanupPending || instance.deletionBillingPending ||
    await hasActiveTransferWorkflow(instance.id, tx) ||
    await tx.instanceTransfer.count({ where: { instanceId: instance.id, status: { in: ['pending', 'processing'] } } })) {
    throw new ProxyNetworkSyncError('INSTANCE_SYNC_BUSY', '实例正在交付、清理或转移，请稍后重试同步')
  }
  return { instance, host }
}

function publicError(error: unknown, host?: Host): string {
  let message = error instanceof Error ? error.message : String(error)
  for (const secret of [host?.caddyPassword, host?.caddyUsername && host.caddyPassword &&
    Buffer.from(`${host.caddyUsername}:${host.caddyPassword}`).toString('base64')]) {
    if (secret) message = message.split(secret).join('[redacted]')
  }
  return message.slice(0, 2000)
}

/** Apply a sampled state/address snapshot only while its original identity and
 * generation are current. Observation-only host tools do not write Caddy.
 */
export async function syncObservedInstanceNetwork(observed: ProxyNetworkSyncObservation,
  resolved: ResolvedInstanceNetworkAddresses, incusStatus: InstanceStatus, actor: WriteActor,
  hostOwnerOnly = false, markProxySitesPending = false) {
  return prisma.$transaction(async tx => {
    const { instance } = await lockCurrentInstance(tx, observed, actor, hostOwnerOnly)
    const currentStatus = instance.status
    const statusChanged = currentStatus !== 'suspended' && currentStatus !== incusStatus
    if (statusChanged) await tx.instance.update({ where: { id: instance.id }, data: { status: incusStatus } })
    const network = await persistResolvedInstanceNetworkAddressesInTransaction(tx, {
      ...observed, ipv4: instance.ipv4, ipv6: instance.ipv6
    }, resolved, { updateLastSyncedAt: true })
    if (markProxySitesPending && network.ipv4Changed) {
      await tx.proxySite.updateMany({ where: { instanceId: instance.id, hostId: instance.hostId, status: 'active', enabled: true },
        data: { ipv4SyncPending: true, error: 'IPv4 地址已同步，反代站点配置等待同步' } })
    }
    // Every accepted observation consumes a generation, even if neither status
    // nor IP changed. Force monotonic advancement within millisecond precision.
    const applied = await tx.instance.update({ where: { id: instance.id }, data: {
      updatedAt: new Date(Math.max(Date.now(), instance.updatedAt.getTime() + 1))
    }, select: { updatedAt: true } })
    return { ...network, statusChanged, previousStatus: currentStatus,
      currentStatus: statusChanged ? incusStatus : currentStatus, updatedAt: applied.updatedAt.toISOString() }
  }, { maxWait: 5000, timeout: 15000 })
}

/** Durable intent precedes remote writes. A later sync retries pending sites even
 * when the IPv4 no longer changes. This is not an independent background worker.
 */
export async function syncInstanceNetworkAndProxySites(observed: ProxyNetworkSyncObservation,
  resolved: ResolvedInstanceNetworkAddresses, incusStatus: InstanceStatus, actor: WriteActor, hostOwnerOnly = false) {
  const saved = await syncObservedInstanceNetwork(observed, resolved, incusStatus, actor, hostOwnerOnly, true)

  const currentObservation = { ...observed, ipv4: saved.newIpv4, ipv6: saved.newIpv6, updatedAt: saved.updatedAt }
  const pending = await prisma.proxySite.findMany({ where: { instanceId: observed.id, ipv4SyncPending: true },
    select: { id: true, domain: true }, orderBy: { id: 'asc' } })
  let proxySitesUpdated = 0
  const proxySiteErrors: Array<{ siteId: number; domain: string; error: string }> = []
  for (const candidate of pending) {
    let currentHost: Host | undefined
    try {
      const outcome = await prisma.$transaction(async tx => {
        const { instance, host } = await lockCurrentInstance(tx, currentObservation, actor, hostOwnerOnly)
        currentHost = host
        await tx.$queryRaw`SELECT id FROM proxy_sites WHERE id = ${candidate.id} FOR UPDATE`
        const site = await tx.proxySite.findUnique({ where: { id: candidate.id } })
        if (!site || site.instanceId !== instance.id || site.hostId !== host.id || !site.ipv4SyncPending) return { applied: false }
        if (!site.enabled || site.status !== 'active') {
          await tx.proxySite.update({ where: { id: site.id }, data: { ipv4SyncPending: false } })
          return { applied: false }
        }
        try {
          if (!['running', 'stopped'].includes(instance.status) || (instance.expiresAt && instance.expiresAt <= new Date())) {
            throw new Error('实例未就绪、已封停或已到期，反代配置保留待同步')
          }
          if (!instance.ipv4) throw new Error('实例缺少 IPv4 地址，反代配置保留待同步')
          const latest = await tx.proxySiteOperation.findFirst({ where: { siteKey: site.siteKey,
            state: { in: [...PENDING_PROXY_SITE_OPERATION_STATES] } }, orderBy: { revision: 'desc' } })
          if (latest) {
            const desired = latest.desiredConfig as { targetIp?: string }
            if (latest.action !== 'upsert') {
              throw new Error('站点已有不同目标的未决操作；已同步的新 IPv4 保留待处理，禁止旧操作清除标记')
            }
            if (desired.targetIp !== instance.ipv4) {
              const replacement = await supersedeProxySiteIpv4Operation(tx, { instance, host, site, actor }, latest)
              return { applied: false, operationId: replacement.id }
            }
            return { applied: false, operationId: latest.id }
          }
          const request: ProxySiteOperationRequest = { requestId: randomUUID(), expectedRevision: site.revision, action: 'upsert', requireEnabled: true }
          const operation = await prepareProxySiteOperationInTransaction(tx, { instance, host, site, actor,
            authority: 'network' }, request)
          return { applied: false, operationId: operation.id }
        } catch (error) {
          const message = publicError(error, host)
          await tx.proxySite.update({ where: { id: site.id }, data: { error: message } })
          return { applied: false, error: message }
        }
      }, { maxWait: 5000, timeout: 120000 })
      if (outcome.operationId) {
        const result = await applyProxySiteOperation(outcome.operationId)
        if (result.state === 'succeeded') proxySitesUpdated++
        else proxySiteErrors.push({ siteId: candidate.id, domain: candidate.domain,
          error: result.error || `反代站点仍待同步 (${result.state})` })
      }
      if (outcome.error) proxySiteErrors.push({ siteId: candidate.id, domain: candidate.domain, error: outcome.error })
    } catch (error) {
      // A rollback after remote success leaves the previously committed flag.
      // Never bubble Caddy failures into the host route's missing-Incus cleanup.
      proxySiteErrors.push({ siteId: candidate.id, domain: candidate.domain, error: publicError(error, currentHost) })
    }
  }
  const proxySitesPending = await prisma.proxySite.count({ where: { instanceId: observed.id, ipv4SyncPending: true } })
  return { ...saved, proxySitesUpdated, proxySitesPending, proxySiteErrors }
}
