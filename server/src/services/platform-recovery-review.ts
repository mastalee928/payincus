import { Prisma } from '@prisma/client'
import { isIPv4 } from 'node:net'
import { prisma } from '../db/prisma.js'
import { backupRoot, ensure, readJson, recoveryHeld, validateId } from './platform-backup-core.js'
import { probeGatewayHost } from './onboarding-ssh.js'
import { IncusClient } from '../lib/incus/incus-client.js'
import { join } from 'node:path'

export const RECOVERY_REVIEW_SECTIONS = ['balances', 'instances', 'recharges', 'balanceLogs', 'poolOrders'] as const
export type RecoveryReviewSection = typeof RECOVERY_REVIEW_SECTIONS[number]
export interface RecoveryHold {
  taskId: string; createdAt: string; mode?: 'restore' | 'rollback'
  snapshot?: { createdAt: string; version: string } | null
}
export async function readRecoveryHold(): Promise<RecoveryHold> {
  ensure(recoveryHeld(), 'OSS_RECOVERY_NOT_HELD', 409)
  const value = await readJson<RecoveryHold>(join(backupRoot(), 'recovery-hold.json'), 4096)
  ensure(value && Number.isFinite(Date.parse(value.createdAt)), 'OSS_RECOVERY_STATE_INVALID', 409)
  validateId(value.taskId)
  return { taskId: value.taskId, createdAt: value.createdAt, mode: value.mode === 'rollback' ? 'rollback' : 'restore',
    snapshot: value.snapshot && Number.isFinite(Date.parse(value.snapshot.createdAt)) && typeof value.snapshot.version === 'string'
      ? { createdAt: value.snapshot.createdAt, version: value.snapshot.version.slice(0, 80) } : null }
}

// These reads deliberately do not reuse business list routes: some of those
// routes reconcile state or enqueue work, which must stay blocked during review.
export async function recoveryReview(section: RecoveryReviewSection = 'balances', page = 1) {
  ensure(RECOVERY_REVIEW_SECTIONS.includes(section) && Number.isSafeInteger(page) && page > 0 && page <= 1000000, 'OSS_REVIEW_QUERY_INVALID')
  const hold = await readRecoveryHold(), pageSize = 20, skip = (page - 1) * pageSize
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`
    const [users, instances, recharges, logs, poolOrders, balance, hosts] = await Promise.all([
      tx.user.count(), tx.instance.count({ where: { OR: [{ status: { not: 'deleted' } }, { deletionBillingPending: true }] } }),
      tx.rechargeRecord.count(), tx.balanceLog.count(), tx.poolOrder.count(), tx.user.aggregate({ _sum: { balance: true } }),
      tx.host.findMany({ orderBy: { id: 'asc' }, take: 200, select: { id: true, name: true, status: true, poolFaulted: true,
        managementSshHost: true, managementSshPort: true } })
    ])
    const totals = { balances: users, instances, recharges, balanceLogs: logs, poolOrders }
    let rows: Array<Record<string, unknown>>
    if (section === 'balances') rows = (await tx.user.findMany({ skip, take: pageSize, orderBy: { id: 'asc' },
      select: { id: true, username: true, balance: true, balanceLogs: { orderBy: { id: 'desc' }, take: 1, select: { id: true } } } }))
      .map(({ balanceLogs, ...row }) => ({ ...row, balance: row.balance.toFixed(2), latestBalanceLogId: balanceLogs[0]?.id || null }))
    else if (section === 'instances') rows = (await tx.instance.findMany({ skip, take: pageSize, orderBy: { id: 'asc' },
      where: { OR: [{ status: { not: 'deleted' } }, { deletionBillingPending: true }] },
      select: { id: true, userId: true, hostId: true, name: true, status: true, expiresAt: true, billingPrice: true,
        autoRenew: true, version: true, deletionBillingPending: true } })).map(row => ({ ...row, expiresAt: row.expiresAt?.toISOString() || null,
      billingPrice: row.billingPrice?.toFixed(2) || null }))
    else if (section === 'recharges') rows = (await tx.rechargeRecord.findMany({ skip, take: pageSize, orderBy: { id: 'desc' },
      select: { id: true, userId: true, orderNo: true, amount: true, status: true, createdAt: true } })).map(row => ({ ...row,
      amount: row.amount.toFixed(2), createdAt: row.createdAt.toISOString() }))
    else if (section === 'balanceLogs') rows = (await tx.balanceLog.findMany({ skip, take: pageSize, orderBy: { id: 'desc' },
      select: { id: true, userId: true, type: true, amount: true, balanceBefore: true, balanceAfter: true, instanceId: true,
        orderId: true, createdAt: true } })).map(row => ({ ...row, amount: row.amount.toFixed(2), balanceBefore: row.balanceBefore.toFixed(2),
      balanceAfter: row.balanceAfter.toFixed(2), createdAt: row.createdAt.toISOString() }))
    else rows = (await tx.poolOrder.findMany({ skip, take: pageSize, orderBy: { createdAt: 'desc' },
      select: { id: true, userId: true, totalCents: true, createdAt: true } })).map(row => ({ id: row.id, userId: row.userId,
      amount: row.totalCents.div(100).toFixed(2), createdAt: row.createdAt.toISOString() }))
    const reconciliationCount = await tx.platformRecoveryReconciliation.count({ where: { holdTaskId: hold.taskId } })
    return { reconciliationCount, summary: { users, instances, recharges, balanceLogs: logs, poolOrders, balance: balance._sum.balance?.toFixed(2) || '0.00' },
      hosts, hostsTruncated: await tx.host.count() > hosts.length, section, page, pageSize, total: totals[section], rows }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  ensure((await readRecoveryHold()).taskId === hold.taskId, 'OSS_RECOVERY_STATE_CHANGED', 409)
  return { hold, checkedAt: new Date().toISOString(), snapshotOnly: result.reconciliationCount === 0, ...result }
}

export function compareRecoveryInventory(expected: string[], actual: string[]) {
  const valid = (name: unknown) => typeof name === 'string' && name.length > 0 && name.length <= 128 &&
    [...name].every(character => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127)
  ensure(expected.every(valid) && actual.every(valid) && actual.length <= 2000 &&
    new Set(expected).size === expected.length && new Set(actual).size === actual.length,
    'OSS_REVIEW_INVENTORY_INVALID')
  const saved = new Set(expected), live = new Set(actual)
  const missing = [...saved].filter(name => !live.has(name)), unexpected = [...live].filter(name => !saved.has(name))
  return { expectedCount: saved.size, actualCount: live.size, missing, unexpected, inventoryMatched: !missing.length && !unexpected.length }
}

// No start/stop/delete, state reconciliation, inventory release or peer changes.
export async function probeRecoveryHost(hostId: number) {
  const hold = await readRecoveryHold()
  ensure(Number.isSafeInteger(hostId) && hostId > 0 && hostId <= 2147483647, 'OSS_REVIEW_QUERY_INVALID')
  const [host, node] = await Promise.all([
    prisma.host.findUnique({ where: { id: hostId }, select: { id: true, url: true, certPath: true, keyPath: true,
      serverCertificate: true, serverFingerprint: true, managementSshHost: true, managementSshPort: true } }),
    prisma.hostOnboardingNode.findFirst({ where: { hostId, deletedAt: null, status: 'succeeded' },
      select: { id: true, managementIp: true, sshPort: true, sshFingerprint: true, nodePublicKey: true } })
  ])
  const checkedAt = new Date().toISOString()
  if (!host || !node || !node.managementIp || !isIPv4(node.managementIp) || !node.managementIp.startsWith('10.') ||
    host.managementSshHost !== node.managementIp || host.managementSshPort !== node.sshPort || !node.sshFingerprint || !node.nodePublicKey ||
    !host.serverCertificate || !host.serverFingerprint) return { hostId, checkedAt, managementVerified: false, code: 'OSS_REVIEW_MANAGEMENT_REQUIRED' }
  let url: URL
  try { url = new URL(host.url) } catch { return { hostId, checkedAt, managementVerified: false, code: 'OSS_REVIEW_MANAGEMENT_REQUIRED' } }
  if (url.protocol !== 'https:' || url.hostname !== node.managementIp || url.username || url.password) {
    return { hostId, checkedAt, managementVerified: false, code: 'OSS_REVIEW_MANAGEMENT_REQUIRED' }
  }
  let client: IncusClient
  try { client = new IncusClient(host) }
  catch { return { hostId, checkedAt, managementVerified: false, code: 'OSS_REVIEW_MANAGEMENT_REQUIRED' } }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await probeGatewayHost(node.id, { sshPort: node.sshPort, sshFingerprint: node.sshFingerprint, nodePublicKey: node.nodePublicKey })
    timer = setTimeout(() => { void client.agent?.destroy() }, 12000)
    await client.connect()
    const live = await client.request<Array<{ name: string }>>('GET', '/1.0/instances?recursion=1')
    ensure(Array.isArray(live), 'OSS_REVIEW_INVENTORY_INVALID')
    const expected = await prisma.instance.findMany({ where: { hostId, OR: [{ status: { not: 'deleted' } }, { deletionBillingPending: true }] },
      select: { incusId: true, name: true } })
    const inventory = compareRecoveryInventory(expected.map(row => row.incusId || row.name), live.map(row => row.name))
    ensure((await readRecoveryHold()).taskId === hold.taskId, 'OSS_RECOVERY_STATE_CHANGED', 409)
    return { hostId, checkedAt, managementVerified: true, inventory, code: inventory.inventoryMatched ? null : 'OSS_REVIEW_INVENTORY_MISMATCH' }
  } catch {
    return { hostId, checkedAt, managementVerified: false, code: 'OSS_REVIEW_HOST_UNREACHABLE' }
  } finally { if (timer) clearTimeout(timer); await client.agent?.destroy().catch(() => {}) }
}
