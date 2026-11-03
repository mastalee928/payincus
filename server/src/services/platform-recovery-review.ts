import { compareRecoveryIdentities, verifyRecoveryResources, assertRecoveryGuestResources, type LiveRecoveryGuest } from './platform-recovery-inventory.js'
import { inspectPoolRecovery, recoveryScope } from './host-pool-recovery.js'
import { recoveryHostErrorCode } from './platform-recovery-policy.js'
import { Prisma } from '@prisma/client'
import { isIPv4 } from 'node:net'
import { prisma } from '../db/prisma.js'
import { backupRoot, ensure, readJson, recoveryHeld, validateId } from './platform-backup-core.js'
import { probeGatewayHost } from './onboarding-ssh.js'
import { IncusClient } from '../lib/incus/incus-client.js'
import { join } from 'node:path'
import { readOriginalDedicatedNetwork, recoveryNetworkHash } from './platform-recovery-network.js'
import { RECOVERY_LEGACY_SOURCE_SQL } from './platform-recovery-state.js'

export const RECOVERY_REVIEW_SECTIONS = ['balances', 'instances', 'recharges', 'balanceLogs', 'poolOrders', 'checkoutOrders', 'checkoutReceipts', 'checkoutRefunds'] as const
export type RecoveryReviewSection = typeof RECOVERY_REVIEW_SECTIONS[number]
export interface RecoveryHold {
  taskId: string; batchId?: string; createdAt: string; mode?: 'restore' | 'rollback'
  restorePolicy?: 'snapshot-v1'
  snapshot?: { createdAt: string; version: string } | null
}
export async function readRecoveryHold(): Promise<RecoveryHold> {
  ensure(recoveryHeld(), 'OSS_RECOVERY_NOT_HELD', 409)
  const value = await readJson<RecoveryHold>(join(backupRoot(), 'recovery-hold.json'), 4096)
  ensure(value && Number.isFinite(Date.parse(value.createdAt)), 'OSS_RECOVERY_STATE_INVALID', 409)
  validateId(value.taskId)
  if (value.batchId) validateId(value.batchId)
  return { taskId: value.taskId, batchId: value.batchId, createdAt: value.createdAt, mode: value.mode === 'rollback' ? 'rollback' : 'restore',
    ...(value.restorePolicy==='snapshot-v1'?{restorePolicy:value.restorePolicy}:{}),
    snapshot: value.snapshot && Number.isFinite(Date.parse(value.snapshot.createdAt)) && typeof value.snapshot.version === 'string'
      ? { createdAt: value.snapshot.createdAt, version: value.snapshot.version.slice(0, 80) } : null }
}

// These reads deliberately do not reuse business list routes: some of those
// routes reconcile state or enqueue work, which must stay blocked during review.
export async function recoveryReview(section: RecoveryReviewSection = 'balances', page = 1, hostPage = 1) {
  ensure(RECOVERY_REVIEW_SECTIONS.includes(section) && Number.isSafeInteger(page) && page > 0 && page <= 1000000, 'OSS_REVIEW_QUERY_INVALID')
  ensure(Number.isSafeInteger(hostPage) && hostPage > 0 && hostPage <= 1000000, 'OSS_REVIEW_QUERY_INVALID')
  const hold = await readRecoveryHold(), pageSize = 20, skip = (page - 1) * pageSize
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`
    const [users, instances, recharges, logs, poolOrders, balance, hosts] = await Promise.all([
      tx.user.count(), tx.instance.count({ where: { OR: [{ status: { not: 'deleted' } }, { deletionBillingPending: true }] } }),
      tx.rechargeRecord.count(), tx.balanceLog.count(), tx.poolOrder.count(), tx.user.aggregate({ _sum: { balance: true } }),
      tx.host.findMany({ orderBy: { id: 'asc' }, skip: (hostPage - 1) * 25, take: 25, select: { id: true, name: true, status: true, poolFaulted: true,
        managementSshHost: true, managementSshPort: true } })
    ])
    const [checkoutOrders, checkoutReceipts, checkoutRefunds] = await Promise.all([tx.checkoutOrder.count(), tx.checkoutReceipt.count(), tx.checkoutRefund.count()])
    const totals = { balances: users, instances, recharges, balanceLogs: logs, poolOrders, checkoutOrders, checkoutReceipts, checkoutRefunds }
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
    else if (section === 'checkoutOrders') rows = (await tx.checkoutOrder.findMany({ skip, take: pageSize, orderBy: [{createdAt:'desc'},{id:'desc'}], select: {id:true,userId:true,status:true,totalCents:true,createdAt:true} })).map(row=>({id:row.id,userId:row.userId,status:row.status,amount:(row.totalCents/100).toFixed(2),createdAt:row.createdAt.toISOString()}))
    else if (section === 'checkoutReceipts') rows = (await tx.checkoutReceipt.findMany({ skip, take: pageSize, orderBy: [{createdAt:'desc'},{id:'desc'}], select: {id:true,tradeNo:true,amountCents:true,createdAt:true,payment:{select:{providerName:true,order:{select:{userId:true}}}}} })).map(row=>({id:row.id,userId:row.payment.order.userId,orderNo:row.tradeNo,name:row.payment.providerName+' · '+row.tradeNo,amount:(row.amountCents/100).toFixed(2),createdAt:row.createdAt.toISOString()}))
    else if (section === 'checkoutRefunds') rows = (await tx.checkoutRefund.findMany({skip,take:pageSize,orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true,orderId:true,status:true,amountCents:true,createdAt:true,order:{select:{userId:true}}}})).map(row=>({id:row.id,userId:row.order.userId,orderNo:row.orderId,status:row.status,amount:(row.amountCents/100).toFixed(2),createdAt:row.createdAt.toISOString()}))
    else rows = (await tx.poolOrder.findMany({ skip, take: pageSize, orderBy: [{createdAt:'desc'},{id:'desc'}],
      select: { id: true, userId: true, totalCents: true, createdAt: true } })).map(row => ({ id: row.id, userId: row.userId,
      amount: row.totalCents.div(100).toFixed(2), createdAt: row.createdAt.toISOString() }))
    if(section==='poolOrders' && hold.batchId && rows.length){
      const progress=await tx.$queryRawUnsafe<Array<{id:string;status:string|null;code:string|null;nextAt:string|null}>>(`SELECT p.id,
        CASE WHEN done.payload->>'factHash'=${RECOVERY_LEGACY_SOURCE_SQL} THEN done.payload->>'status'
          WHEN a.source_hash=${RECOVERY_LEGACY_SOURCE_SQL} THEN a.payload->>'status' END status,
        CASE WHEN done.payload->>'factHash'=${RECOVERY_LEGACY_SOURCE_SQL} THEN NULL
          WHEN a.source_hash=${RECOVERY_LEGACY_SOURCE_SQL} THEN a.payload->>'code' END code,
        CASE WHEN done.payload->>'factHash'=${RECOVERY_LEGACY_SOURCE_SQL} THEN NULL
          WHEN a.source_hash=${RECOVERY_LEGACY_SOURCE_SQL} THEN a.payload->>'nextAt' END AS "nextAt"
        FROM pool_orders p LEFT JOIN platform_recovery_evidence a ON a.batch_id=$1::uuid AND a.category='legacy-order-auto' AND a.reference=p.id
        LEFT JOIN platform_recovery_evidence done ON done.batch_id=$1::uuid AND done.category='legacy-order-resolution' AND done.reference=p.id
        WHERE p.id=ANY($2::text[])`,hold.batchId,rows.map(row=>row.id))
      rows=rows.map(row=>({...row,recovery:progress.find(item=>item.id===row.id)||null}))
    }
    const reconciliationCount = await tx.platformRecoveryReconciliation.count({ where: { holdTaskId: hold.taskId } })
    return { reconciliationCount, summary: { users, instances, recharges, balanceLogs: logs, poolOrders, balance: balance._sum.balance?.toFixed(2) || '0.00' },
      hosts, hostPage, hostPageSize: 25, hostTotal: await tx.host.count(), hostsTruncated: false,
      hostResults: hold.batchId ? await tx.platformRecoveryHost.findMany({ where: { batchId: hold.batchId, hostId: { in: hosts.map(host => host.id) } }, select: { hostId: true, status: true, attempts: true, nextAttemptAt: true, result: true } }) : [], section, page, pageSize, total: totals[section], rows }
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
      singleTenant: true, serverCertificate: true, serverFingerprint: true, managementSshHost: true, managementSshPort: true,
      natBindIp: true, natPublicIp: true, natBindIpv6: true, natPublicIpv6: true, ipv6ParentInterface:true, portProtocol:true } }),
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
    timer = setTimeout(() => { void client.agent?.destroy() }, 60000)
    await client.connect()
    const live = await client.request<LiveRecoveryGuest[]>('GET', '/1.0/instances?recursion=1&all-projects=true')
    ensure(Array.isArray(live), 'OSS_REVIEW_INVENTORY_INVALID')
    const expected = await prisma.instance.findMany({ where: { hostId, OR: [{ status: { not: 'deleted' } }, { deletionBillingPending: true }] },
      select: { id: true, incusId: true, name: true, userId: true, status: true, dedicatedIpv6:true, cpu:true,memory:true,disk:true,package:{select:{instanceType:true}},storagePoolName: true, ipv4: true, networkMode: true, portMappings: { select: { protocol: true, publicPort: true, privatePort: true } }, snapshottedSpecs: true,
        instanceTasks: { where: { taskType: 'replace_host', status: 'COMPLETED', targetHostId: hostId }, orderBy: { id: 'desc' }, take: 1, select: { replacementState: true } } } })
    const { recoveryOriginalUserId } = await import('./platform-recovery-registration.js')
    const inventory = compareRecoveryIdentities(await Promise.all(expected.map(async row => {
      const saved = row.snapshottedSpecs as { managedCleanup?: { uuid?: string; createdAt?: string }; recoveryIdentity?: { uuid?: string; createdAt?: string; project?: string } } | null
      const replaced = row.instanceTasks[0]?.replacementState as { targetUuid?: string; targetCreatedAt?: string } | null
      return { name: row.incusId || row.name, ownerId: await recoveryOriginalUserId(row.userId), status: row.status, storagePoolName: row.storagePoolName,
        uuid: replaced?.targetUuid || saved?.recoveryIdentity?.uuid || saved?.managedCleanup?.uuid,
        createdAt: replaced?.targetCreatedAt || saved?.recoveryIdentity?.createdAt || saved?.managedCleanup?.createdAt, project: saved?.recoveryIdentity?.project || 'default' }
    })), live,hold.mode==='restore' && hold.restorePolicy==='snapshot-v1')
    if(inventory.inventoryMatched) for(const row of expected) {
      assertRecoveryGuestResources({...row,instanceType:row.package?.instanceType},live.find(item=>item.name===(row.incusId||row.name) && (!item.project||item.project==='default'))!)
    }
    let pool: { mode: string; blockers: string[]; canRecover: boolean; needsCleanup: boolean } | undefined
    let networkPreservation: {instanceId:number;configurationVerified:true;connectivityVerified:false} | undefined
    if (inventory.inventoryMatched && host.singleTenant) {
      let recoveredNetwork: {instanceId:number;hash:string} | undefined
      if(expected.length===1 && (expected[0].dedicatedIpv6 as {error?:string}|null)?.error==='IPV6_RECOVERY_VERIFICATION_PENDING') {
        const original=expected[0]
        ensure(original.ipv4,'OSS_REVIEW_FORWARD_MISMATCH',409)
        const current=await readOriginalDedicatedNetwork(client,{hostId,originalId:original.id,name:original.incusId,ipv4:original.ipv4,natBindIp:host.natBindIp},
          live.find(item=>item.name===original.incusId && (!item.project||item.project==='default'))?.status==='Running')
        const hash=recoveryNetworkHash(original.dedicatedIpv6)
        ensure(hash===recoveryNetworkHash(current),'OSS_REVIEW_FORWARD_MISMATCH',409)
        recoveredNetwork={instanceId:original.id,hash}
        networkPreservation={instanceId:original.id,configurationVerified:true,connectivityVerified:false}
      }
      if (timer) clearTimeout(timer)
      const scope = recoveryScope(60000)
      try {
        const report = (await inspectPoolRecovery(prisma, hostId, async () => client, scope,undefined,undefined,recoveredNetwork,
          hold.mode==='restore' && hold.restorePolicy==='snapshot-v1')).report
        let protocolVerified=false
        if(report.blockers.includes('protocol-pending') && hold.mode==='restore' && hold.restorePolicy==='snapshot-v1') {
          ensure(host.portProtocol==='tcp' || host.portProtocol==='tcp_udp','OSS_RECOVERY_DELIVERY_PROTOCOL_PENDING',409)
          await probeGatewayHost(node.id,{sshPort:node.sshPort,sshFingerprint:node.sshFingerprint,nodePublicKey:node.nodePublicKey,portProtocol:host.portProtocol})
          protocolVerified=true
        }
        // Heartbeat writers are paused by the hold. SSH + pinned Incus above
        // establish current connectivity; archived online flags are not evidence.
        const blockers = report.blockers.filter(code => !['offline', 'agent-offline', ...(protocolVerified ? ['protocol-pending'] : []), ...(hold.mode === 'rollback' ? ['not-quarantined'] : [])].includes(code))
        pool = { mode: report.mode, blockers, canRecover: !blockers.length, needsCleanup: report.needsCleanup }
        if (blockers.length || report.needsCleanup) inventory.inventoryMatched = false
      } finally { scope.close() }
    } else if (!host.singleTenant) {
      if (inventory.inventoryMatched) await verifyRecoveryResources(client, expected, live, host)
    }
    ensure((await readRecoveryHold()).taskId === hold.taskId, 'OSS_RECOVERY_STATE_CHANGED', 409)
    return { hostId, checkedAt, managementVerified: true, inventory, pool, networkPreservation, code: inventory.inventoryMatched ? null : 'OSS_REVIEW_INVENTORY_MISMATCH' }
  } catch (error) {
    const code = recoveryHostErrorCode(error)
    return { hostId, checkedAt, managementVerified: false, code }
  } finally { if (timer) clearTimeout(timer); await client.agent?.destroy().catch(() => {}) }
}
