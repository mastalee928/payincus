import { randomUUID, createHash } from 'node:crypto'
// @ts-ignore -- bcryptjs 2 follows the existing auth module import.
import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { ensure } from './platform-backup-core.js'
import { activeRecoveryBatch, RECOVERY_CATEGORIES, recoveryDatasetHash, recoveryHostSourceHash, unresolvedLegacyRecoveryOrders, validateRecoveryEvidence, type RecoveryCategory } from './platform-recovery-state.js'
import { reauthenticateRecoveryOperator } from './platform-recovery-operator.js'
import { isIPv4 } from 'node:net'
import { encryptSensitiveData } from '../lib/security.js'
import { buildRechargeProviderConfigSnapshot } from '../lib/recharge-provider-snapshot.js'
import { readRecoveryHold } from './platform-recovery-review.js'
import { assertRecoveryGuestResources } from './platform-recovery-inventory.js'
import { recoveryOrderQuantity, recoveredRegistrationPrincipal } from './platform-recovery-accounting.js'
import { readOriginalDedicatedNetwork } from './platform-recovery-network.js'
import { assertRecoveryOrderOwnership } from './platform-recovery-ownership.js'

export interface RecoveryEvidenceInput { reference: string; evidenceHash: string; observedAt: string; sourceHash: string }
export const recoveryHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export async function recordRecoveryEvidence(category: RecoveryCategory, input: RecoveryEvidenceInput, actorId: number, credentials: { password: string; totpCode?: string }) {
  validateRecoveryEvidence(input); ensure(RECOVERY_CATEGORIES.includes(category) && category !== 'gateway', 'OSS_RECOVERY_EVIDENCE_INVALID')
  const batch = await activeRecoveryBatch()
  await reauthenticateRecoveryOperator(actorId, credentials)
  ensure(Date.parse(input.observedAt) >= Date.parse(batch.hold.createdAt), 'OSS_RECOVERY_EVIDENCE_TIME')
  ensure(input.sourceHash === await recoveryDatasetHash(category), 'OSS_RECOVERY_EVIDENCE_STALE', 409)
  if (category === 'access' && batch.mode === 'restore') {
    const unresolved = await prisma.$queryRaw<Array<{ id: number }>>`SELECT id FROM users u WHERE u.status='active' AND u.id<>${batch.operator_id}
      AND NOT EXISTS (SELECT 1 FROM platform_recovery_evidence e WHERE e.batch_id=${batch.id}::uuid AND e.category='access-user'
      AND (e.payload->>'userId')::integer=u.id AND e.source_hash=md5(jsonb_build_array(u.id,u.role,u.status,u.password_hash,u.two_factor_enabled,u.two_factor_secret)::text)) LIMIT 1`
    ensure(!unresolved.length, 'OSS_RECOVERY_ACCESS_UNREVIEWED', 409)
  }
  if (category === 'tasks') {
    ensure(!await prisma.checkoutOrder.count({ where: { status: 'recovery_review' } }), 'OSS_RECOVERY_ORDERS_UNREVIEWED', 409)
    ensure(!await unresolvedLegacyRecoveryOrders(batch.id), 'OSS_RECOVERY_LEGACY_ORDERS_UNREVIEWED',409)
  }
  const key = { batchId: batch.id, category, reference: input.reference }
  const existing = await prisma.platformRecoveryEvidence.findUnique({ where: { batchId_category_reference: key } })
  if (existing) { ensure(existing.sourceHash === input.sourceHash && existing.evidenceHash === input.evidenceHash, 'OSS_RECOVERY_EVIDENCE_CONFLICT', 409); return { id: existing.id, replayed: true } }
  const evidence = await prisma.platformRecoveryEvidence.create({ data: { ...key, ...input, observedAt: new Date(input.observedAt), actorId, payload: { conclusion: 'reconciled', revision: batch.revision } } })
  return { id: evidence.id, replayed: false }
}
export async function recoveryAccessAccounts(page = 1) {
  ensure(Number.isSafeInteger(page) && page > 0 && page <= 1000000, 'OSS_REVIEW_QUERY_INVALID')
  const batch = await activeRecoveryBatch()
  const rows = await prisma.$queryRaw<Array<{ id: number; username: string; role: string; status: string; sourceHash: string; reviewed: boolean }>>`
    SELECT u.id,u.username,u.role,u.status,
      md5(jsonb_build_array(u.id,u.role,u.status,u.password_hash,u.two_factor_enabled,u.two_factor_secret)::text) AS "sourceHash",
      EXISTS(SELECT 1 FROM platform_recovery_evidence e WHERE e.batch_id=${batch.id}::uuid AND e.category='access-user'
        AND (e.payload->>'userId')::integer=u.id AND e.source_hash=md5(jsonb_build_array(u.id,u.role,u.status,u.password_hash,u.two_factor_enabled,u.two_factor_secret)::text)) AS reviewed
    FROM users u WHERE id<>${batch.operator_id} ORDER BY id LIMIT 25 OFFSET ${(page-1)*25}`
  return { batchId: batch.id, page, total: await prisma.user.count({ where: { id: { not: batch.operator_id } } }), rows }
}
export async function reconcileRecoveryAccess(input: { userId: number; expectedHash: string; role: 'admin' | 'user'; status: 'active' | 'banned'; newPassword?: string; reference: string; evidenceHash: string; observedAt: string }, actorId: number, credentials: { password: string; totpCode?: string }) {
  const batch = await activeRecoveryBatch()
  ensure(input && Number.isSafeInteger(input.userId) && input.userId > 0 && input.userId !== batch.operator_id && /^[a-f0-9]{32}$/.test(input.expectedHash) &&
    ['admin','user'].includes(input.role) && ['active','banned'].includes(input.status), 'OSS_RECOVERY_EVIDENCE_INVALID')
  validateRecoveryEvidence({ ...input, sourceHash: '0'.repeat(64) })
  ensure(Date.parse(input.observedAt) >= Date.parse(batch.hold.createdAt), 'OSS_RECOVERY_EVIDENCE_TIME')
  await reauthenticateRecoveryOperator(actorId, credentials)
  return prisma.$transaction(async tx => {
    const replay = await tx.platformRecoveryEvidence.findUnique({ where: { batchId_category_reference: { batchId: batch.id, category: 'access-user', reference: input.reference } } })
    if (replay) {
      const payload = replay.payload as { userId: number; role: string; status: string; expectedHash?: string }
      ensure(replay.evidenceHash === input.evidenceHash && payload.userId === input.userId && payload.role === input.role && payload.status === input.status && payload.expectedHash === input.expectedHash,
        'OSS_RECOVERY_EVIDENCE_CONFLICT', 409)
      if (input.status === 'active') {
        const current = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { passwordHash: true } })
        ensure(typeof input.newPassword === 'string' && await bcrypt.compare(input.newPassword, current.passwordHash), 'OSS_RECOVERY_EVIDENCE_CONFLICT', 409)
      }
      return { id: replay.id, userId: input.userId }
    }
    const rows = await tx.$queryRaw<Array<{ hash: string }>>`SELECT md5(jsonb_build_array(id,role,status,password_hash,two_factor_enabled,two_factor_secret)::text) hash FROM users WHERE id=${input.userId} FOR UPDATE`
    ensure(rows[0]?.hash === input.expectedHash, 'OSS_RECOVERY_EVIDENCE_STALE', 409)
    const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId } })
    // Re-enabling an old login always replaces the potentially revoked password.
    ensure(input.status === 'banned' || typeof input.newPassword === 'string' && input.newPassword.length >= 12 && input.newPassword.length <= 128 &&
      !await bcrypt.compare(input.newPassword, user.passwordHash), 'OSS_RECOVERY_NEW_PASSWORD_REQUIRED')
    const passwordHash = await bcrypt.hash(input.status === 'active' ? input.newPassword! : randomUUID() + randomUUID(), 12)
    await tx.user.update({ where: { id: user.id }, data: { role: input.role, status: input.status, passwordHash, twoFactorEnabled: false, twoFactorSecret: null, twoFactorRecoveryCodes: null } })
    await tx.refreshToken.deleteMany({ where: { userId: user.id } })
    const [changed] = await tx.$queryRaw<Array<{ hash: string }>>`SELECT md5(jsonb_build_array(id,role,status,password_hash,two_factor_enabled,two_factor_secret)::text) hash FROM users WHERE id=${user.id}`
    const evidence = await tx.platformRecoveryEvidence.create({ data: { batchId: batch.id, category: 'access-user', reference: input.reference,
      evidenceHash: input.evidenceHash, sourceHash: changed.hash, observedAt: new Date(input.observedAt), actorId,
      payload: { userId: user.id, previousRole: user.role, previousStatus: user.status, role: input.role, status: input.status, expectedHash: input.expectedHash, credentialsReplaced: true } } })
    return { id: evidence.id, userId: user.id }
  })
}

export interface RecoveryRegistration {
  id: string; reference: string; evidenceHash: string; observedAt: string
  user: { id?: number; username?: string; email?: string }
  order: { id: string; providerId: number; method: string; tradeNo: string; amountCents: number; paidAt: string; refundedCents?: number; refundReference?: string;
    feeCents?: number; receivedCurrency?: string; receivedAmount?: string; expectedHash?: string; quantity?: number }
  instance?: { originalId: number; principalCents?: number; hostId: number; name: string; uuid: string; createdAt: string; image: string; cpu: number; memory: number; disk: number;
    storagePoolName: string; ipv4: string; expiresAt: string; packageId: number; packagePlanId: number; billingPrice: string; billingCycle: number }
}
export function normalizeRecoveryRegistration(value: RecoveryRegistration): RecoveryRegistration {
  const only = (row: unknown, fields: string[]) => ensure(row && typeof row === 'object' && !Array.isArray(row) &&
    Object.keys(row).every(key => fields.includes(key)), 'OSS_RECOVERY_EVIDENCE_INVALID')
  only(value, ['id','reference','evidenceHash','observedAt','user','order','instance'])
  only(value.user, ['id','username','email']); only(value.order, ['id','providerId','method','tradeNo','amountCents','paidAt','refundedCents','refundReference','feeCents','receivedCurrency','receivedAmount','expectedHash','quantity'])
  ensure(value.order.quantity===undefined || Number.isSafeInteger(value.order.quantity) && value.order.quantity>0 && value.order.quantity<=100,'OSS_RECOVERY_ORDER_QUANTITY_REQUIRED')
  ensure(value.order.expectedHash===undefined || /^[a-f0-9]{64}$/.test(value.order.expectedHash),'OSS_RECOVERY_EVIDENCE_INVALID')
  ensure(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.id) && Number.isSafeInteger(value.order.providerId) && value.order.providerId > 0 &&
    typeof value.order.method === 'string' && /^[A-Za-z0-9_-]{0,64}$/.test(value.order.method), 'OSS_RECOVERY_EVIDENCE_INVALID')
  ensure(value.user.id === undefined ? typeof value.user.username === 'string' : Number.isSafeInteger(value.user.id) && value.user.id > 0 && !value.user.username && !value.user.email, 'OSS_RECOVERY_USER_INVALID')
  if (value.instance) {
    only(value.instance,['originalId','principalCents','hostId','name','uuid','createdAt','image','cpu','memory','disk','storagePoolName','ipv4','expiresAt','packageId','packagePlanId','billingPrice','billingCycle'])
    ensure(value.instance.principalCents===undefined || Number.isSafeInteger(value.instance.principalCents) && value.instance.principalCents>0,
      'OSS_RECOVERY_ORDER_PRINCIPAL_MISMATCH')
    ensure(Number.isSafeInteger(value.instance.originalId) && value.instance.originalId > 0 && value.instance.originalId <= 2147483647,
      'OSS_RECOVERY_ORIGINAL_INSTANCE_ID_REQUIRED')
    ensure(typeof value.instance.image === 'string' && value.instance.image.length <= 250 && typeof value.instance.storagePoolName === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(value.instance.storagePoolName) && isIPv4(value.instance.ipv4) && value.instance.billingCycle <= 24,
      'OSS_RECOVERY_EVIDENCE_INVALID')
  }
  return structuredClone(value)
}
export async function registerRecoveryBusiness(input: RecoveryRegistration, actorId: number, credentials: { password: string; totpCode?: string }) {
  input = normalizeRecoveryRegistration(input)
  const batch = await activeRecoveryBatch(); ensure(batch.mode === 'restore', 'OSS_RECOVERY_CONTEXT_CHANGED')
  validateRecoveryEvidence({ ...input, sourceHash: '0'.repeat(64) }); await reauthenticateRecoveryOperator(actorId, credentials)
  ensure(Date.parse(input.observedAt) >= Date.parse(batch.hold.createdAt), 'OSS_RECOVERY_EVIDENCE_TIME')
  const hold=await readRecoveryHold()
  ensure(hold.snapshot && Date.parse(input.order.paidAt)>Date.parse(hold.snapshot.createdAt),'OSS_RECOVERY_EVIDENCE_TIME')
  ensure(input.user && input.order && /^[a-f0-9-]{36}$/.test(input.id) && /^[A-Za-z0-9_-]{1,100}$/.test(input.order.id) && /^[A-Za-z0-9_-]{1,100}$/.test(input.order.tradeNo) &&
    Number.isSafeInteger(input.order.amountCents) && input.order.amountCents > 0 && input.order.amountCents <= 999999999 &&
    Number.isFinite(Date.parse(input.order.paidAt)) && Date.parse(input.order.paidAt) <= Date.parse(input.observedAt), 'OSS_RECOVERY_EVIDENCE_INVALID')
  const refunded = input.order.refundedCents || 0
  const fee=input.order.feeCents??0,payable=input.order.amountCents+fee
  ensure(typeof input.order.receivedCurrency === 'string' && typeof input.order.receivedAmount === 'string',
    'OSS_RECOVERY_RECEIVED_AMOUNT_REQUIRED')
  ensure(Number.isSafeInteger(fee)&&fee>=0&&payable<=999999999 && (!input.order.receivedCurrency || /^[A-Z0-9]{3,12}$/.test(input.order.receivedCurrency)) &&
    (input.order.receivedAmount===undefined || /^(0|[1-9][0-9]{0,15})(\.[0-9]{1,18})?$/.test(input.order.receivedAmount) && new Prisma.Decimal(input.order.receivedAmount).greaterThan(0)), 'OSS_RECOVERY_EVIDENCE_INVALID')
  ensure((input.order.receivedAmount===undefined)===(input.order.receivedCurrency===undefined),'OSS_RECOVERY_EVIDENCE_INVALID')
  ensure(Number.isSafeInteger(refunded) && refunded >= 0 && refunded <= payable && (!refunded || /^[A-Za-z0-9_.:/-]{6,120}$/.test(input.order.refundReference || '')), 'OSS_RECOVERY_EVIDENCE_INVALID')
  const refundedPrincipal=Math.min(refunded,input.order.amountCents)
  const payloadHash = recoveryHash(input)
  const replay = await prisma.platformRecoveryEvidence.findUnique({ where: { id: input.id } })
  if (replay) { ensure(replay.batchId === batch.id && replay.sourceHash === payloadHash, 'OSS_RECOVERY_EVIDENCE_CONFLICT', 409); return { id: replay.id, replayed: true } }
  // Remote identity is read under the pinned host certificate; registration never creates a guest.
  let live: import('./platform-recovery-inventory.js').LiveRecoveryGuest | undefined
  let hostSourceHash:string|undefined
  let dedicatedIpv6: Awaited<ReturnType<typeof readOriginalDedicatedNetwork>> | undefined
  if (input.instance) {
    const item = input.instance
    // New customers must first be registered with their original account ID;
    // a guessed sequence ID must never be matched to a remote owner marker.
    ensure(input.user.id, 'OSS_RECOVERY_USER_MISSING')
    const { recoveryOriginalUserId } = await import('./platform-recovery-registration.js')
    const originalOwnerId = await recoveryOriginalUserId(input.user.id)
    ensure(Number.isSafeInteger(item.hostId) && item.hostId > 0 && /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/.test(item.name) && /^[a-f0-9-]{36}$/.test(item.uuid) &&
      Number.isFinite(Date.parse(item.createdAt)) && Date.parse(item.createdAt)>Date.parse(hold.snapshot.createdAt) && Date.parse(item.createdAt)<=Date.parse(input.observedAt) &&
      Number.isFinite(Date.parse(item.expiresAt)) && Date.parse(item.expiresAt) > Date.parse(item.createdAt) &&
      [item.cpu,item.memory,item.disk,item.packageId,item.packagePlanId,item.billingCycle].every(v => Number.isSafeInteger(v) && v > 0) &&
      /^(0|[1-9][0-9]{0,7})\.[0-9]{2}$/.test(item.billingPrice), 'OSS_RECOVERY_EVIDENCE_INVALID')
    const host = await prisma.host.findUniqueOrThrow({ where: { id: item.hostId } })
    hostSourceHash=await recoveryHostSourceHash(host.id)
    ensure(host.serverCertificate && host.serverFingerprint && host.certPath && host.keyPath, 'OSS_REVIEW_MANAGEMENT_REQUIRED', 409)
    ensure(host.singleTenant && host.poolFaulted,'OSS_RECOVERY_DEDICATED_HOST_REQUIRED',409)
    const node = await prisma.hostOnboardingNode.findFirst({where:{hostId:item.hostId,deletedAt:null,status:'succeeded'}})
    ensure(node?.managementIp && node.sshFingerprint && node.nodePublicKey && host.managementSshHost===node.managementIp &&
      new URL(host.url).hostname===node.managementIp,'OSS_REVIEW_MANAGEMENT_REQUIRED',409)
    const {probeGatewayHost}=await import('./onboarding-ssh.js')
    await probeGatewayHost(node.id,{sshPort:node.sshPort,sshFingerprint:node.sshFingerprint,nodePublicKey:node.nodePublicKey})
    const { IncusClient } = await import('../lib/incus/incus-client.js'), client = new IncusClient(host)
    const deadline=setTimeout(()=>{void client.agent?.destroy()},30000)
    try {
      await client.connect()
      live = await client.request('GET', `/1.0/instances/${encodeURIComponent(item.name)}?project=default`, null, 12000)
      dedicatedIpv6=await readOriginalDedicatedNetwork(client,{...item,natBindIp:host.natBindIp},live!.status==='Running')
    } finally {clearTimeout(deadline);await client.agent?.destroy()}
    ensure(live && live.name === item.name && live.config?.['volatile.uuid'] === item.uuid && Date.parse(live.created_at || '') === Date.parse(item.createdAt) &&
      (!live.project || live.project === 'default') && ['Running','Stopped'].includes(live.status) &&
      (!live.config?.['user.payincus.user-id'] || live.config['user.payincus.user-id']===String(originalOwnerId)) &&
      Object.values(live.expanded_devices || live.devices || {}).some(device => device.type === 'disk' && device.path === '/' && device.pool === item.storagePoolName), 'OSS_REVIEW_IDENTITY_CHANGED', 409)
    assertRecoveryGuestResources(item,live)
  }
  return prisma.$transaction(async tx => {
    // Also serialize first registrations, before an order row exists. Hash
    // collisions only serialize unrelated recovery registrations.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'recovery-order:'+input.order.id},0))`
    const previous = await tx.platformRecoveryEvidence.findUnique({ where: { id: input.id } })
    if (previous) { ensure(previous.batchId === batch.id && previous.sourceHash === payloadHash, 'OSS_RECOVERY_EVIDENCE_CONFLICT', 409); return { id: previous.id, replayed: true } }
    ensure((await activeRecoveryBatch(async(sql,args=[])=>tx.$queryRawUnsafe(sql,...args))).id===batch.id,'OSS_RECOVERY_CONTEXT_CHANGED',409)
    let userId = input.user.id
    if (userId) ensure(await tx.user.count({ where: { id: userId } }), 'OSS_RECOVERY_USER_MISSING')
    else {
      ensure(typeof input.user.username === 'string' && /^[A-Za-z0-9_-]{3,64}$/.test(input.user.username) && (!input.user.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.user.email)), 'OSS_RECOVERY_USER_INVALID')
      userId = (await tx.user.create({ data: { username: input.user.username, email: input.user.email, status: 'banned', passwordHash: await bcrypt.hash(randomUUID()+randomUUID(),12) } })).id
    }
    const provider = await tx.paymentProvider.findUniqueOrThrow({ where: { id: input.order.providerId } })
    ensure(['yipay','upaypro','heleket','antom'].includes(provider.type), 'OSS_RECOVERY_PROVIDER_UNSUPPORTED')
    const existingReceipt=await tx.checkoutReceipt.findUnique({where:{providerId_tradeNo:{providerId:provider.id,tradeNo:input.order.tradeNo}},include:{payment:true}})
    ensure(!await tx.rechargeRecord.count({ where: { providerId: provider.id, tradeNo: input.order.tradeNo } }) &&
      (!existingReceipt || input.instance && input.order.expectedHash && existingReceipt.payment.orderId===input.order.id) &&
      !await tx.rechargeLatePayment.count({where:{providerId:provider.id,tradeNo:input.order.tradeNo}}), 'OSS_RECOVERY_RECEIPT_EXISTS', 409)
    const receiptId = existingReceipt?.id || randomUUID(), paidAt = new Date(input.order.paidAt)
    await tx.$queryRaw`SELECT id FROM checkout_orders WHERE id=${input.order.id} FOR UPDATE`
    const existingOrder=await tx.checkoutOrder.findUnique({where:{id:input.order.id},include:{payments:{include:{receipts:true}}}})
    const poolOrder=await tx.poolOrder.findUnique({where:{id:input.order.id}})
    // Current checkout delivery also records a pool order with the same ID.
    // That companion is not a duplicate purchase; a legacy wallet-only order
    // cannot be converted into an external payment by this registration.
    ensure(!poolOrder || existingOrder && poolOrder.userId===existingOrder.userId &&
      poolOrder.requestHash===existingOrder.requestHash && poolOrder.totalCents.equals(existingOrder.totalCents),'OSS_RECOVERY_ORDER_EXISTS',409)
    if(existingOrder) {
      const {recoveryOrderSourceHash}=await import('./platform-recovery-orders.js')
      ensure(input.order.expectedHash===await recoveryOrderSourceHash(tx,existingOrder.id),'OSS_RECOVERY_EVIDENCE_STALE',409)
      ensure(input.user.id===existingOrder.userId && existingOrder.userId===userId && existingOrder.totalCents===input.order.amountCents &&
        existingOrder.paymentId!=='balance' && (!existingOrder.paidAt || existingOrder.paidAt.getTime()===paidAt.getTime()) &&
        ['recovery_review','completed','cancelled','expired'].includes(existingOrder.status) &&
        existingOrder.payments.every(payment=>payment.receipts.every(receipt=>receipt.id===existingReceipt?.id)),'OSS_RECOVERY_ORDER_MISMATCH',409)
    } else ensure(!input.order.expectedHash,'OSS_RECOVERY_ORDER_MISSING',409)
    const existingPayment=existingReceipt ? existingOrder?.payments.find(p=>p.id===existingReceipt.paymentId) :
      existingOrder?.payments.find(p=>p.providerId===provider.id && p.method===input.order.method)
    ensure(!existingPayment || existingPayment.providerType===provider.type && existingPayment.payableCents===payable && existingPayment.feeCents===fee,
      'OSS_RECOVERY_ORDER_MISMATCH',409)
    const paymentId=existingPayment?.id || randomUUID()
    if(existingReceipt) {
      ensure(existingPayment && existingPayment.method===input.order.method && existingReceipt.amountCents===payable &&
        existingReceipt.createdAt.getTime()===paidAt.getTime() && refunded===0,'OSS_RECOVERY_ORDER_MISMATCH',409)
      const refunds=await tx.checkoutRefund.findMany({where:{orderId:input.order.id}})
      const provisional=refunds.filter(r=>r.reason==='recovery-undelivered')
      ensure(provisional.every(r=>r.receiptId===existingReceipt.id && r.status==='pending' &&
        !r.handledAt && !r.resolution && !r.instanceId && !r.billingRecordId),'OSS_RECOVERY_REFUND_BILLING_CONFLICT',409)
      ensure(refunds.filter(r=>r.reason!=='recovery-undelivered').every(r=>r.principalCents===0 || r.instanceId),
        'OSS_RECOVERY_REFUND_ALLOCATION_REQUIRED',409)
      // A provisional recovery obligation can be replaced only by evidenced
      // original delivery. Actual refunds and normal refund requests are never erased.
      await tx.checkoutRefund.deleteMany({where:{id:{in:provisional.map(r=>r.id)}}})
    }
    const priorInstances=await tx.instance.findMany({where:{purchaseBatchId:input.order.id},
      select:{id:true,userId:true,status:true,hostId:true,incusId:true,snapshottedSpecs:true}})
    let instancePrincipal: number | undefined
    let quantity = input.order.quantity
    if(existingOrder && Array.isArray(existingOrder.display) && existingOrder.display.length) {
      quantity=recoveryOrderQuantity(existingOrder.display)
      ensure(input.order.quantity===undefined || input.order.quantity===quantity,'OSS_RECOVERY_ORDER_QUANTITY_MISMATCH',409)
    }
    if(input.instance) {
      ensure(quantity,'OSS_RECOVERY_ORDER_QUANTITY_REQUIRED',409)
      const bills=await tx.instanceBillingRecord.findMany({where:{purchaseBatchId:input.order.id}})
      instancePrincipal=recoveredRegistrationPrincipal(input.order.amountCents,quantity,priorInstances,bills,input.instance.principalCents)
      // A whole-order refund cannot be assigned to an arbitrary guest in a
      // multi-guest order. Its original per-guest refund evidence is separate.
      ensure(!refunded || quantity===1,'OSS_RECOVERY_REFUND_BILLING_CONFLICT',409)
    }
    const transfers=await tx.instanceTransfer.findMany({where:{instanceId:{in:priorInstances.map(row=>row.id)}}})
    const tasks=await tx.instanceTask.findMany({where:{instanceId:{in:priorInstances.map(row=>row.id)},taskType:{in:['replace_host','change_host','rebuild','recreate']}},orderBy:{id:'asc'}})
    for(const instance of priorInstances)assertRecoveryOrderOwnership(userId!,paidAt,instance,transfers,tasks)
    ensure(!priorInstances.length || refunded===0,'OSS_RECOVERY_REFUND_BILLING_CONFLICT',409)
    const recoveredDisplay = input.instance ? [{namePrefix:input.instance.name,quantity:quantity!,monthlyPrice:Math.round(Number(input.instance.billingPrice)*100),
      setupFee:0,cpu:input.instance.cpu,memoryMiB:input.instance.memory,diskGiB:input.instance.disk/1024,image:input.instance.image,regionName:'',countryCode:''}] :
      input.order.quantity ? [{quantity:input.order.quantity}] : []
    if(existingOrder) await tx.checkoutOrder.update({where:{id:existingOrder.id},data:{status:'recovery_review',paidAt,paymentId,
      ...(existingOrder.source==='recovery' && (!Array.isArray(existingOrder.display)||!existingOrder.display.length) ? {display:recoveredDisplay} : {})}})
    else await tx.checkoutOrder.create({ data: { id: input.order.id, userId, requestHash: payloadHash, source: 'recovery', status: 'recovery_review',
      totalCents: input.order.amountCents, snapshot: encryptSensitiveData(JSON.stringify({ recovery: true, evidenceId: input.id })),
      display: recoveredDisplay,
      expiresAt: paidAt, paidAt, paymentId, createdAt: paidAt } })
    if(existingPayment && !existingReceipt) await tx.checkoutPayment.update({where:{id:paymentId},data:{status:'paid',details:{recovery:true,evidenceId:input.id,
      receivedCurrency:input.order.receivedCurrency,receivedAmount:input.order.receivedAmount}}})
    else if(!existingPayment) await tx.checkoutPayment.create({ data: { id: paymentId, orderId: input.order.id, providerId: provider.id, providerType: provider.type, providerName: provider.name,
      method: input.order.method, payableCents: payable, feeCents: fee,
      configSnapshot: buildRechargeProviderConfigSnapshot(provider.type, { recoveryEvidenceOnly: true }),
      details: { recovery: true, evidenceId: input.id,receivedCurrency:input.order.receivedCurrency,receivedAmount:input.order.receivedAmount }, status: 'paid', createdAt: paidAt } })
    if(!existingReceipt) await tx.checkoutReceipt.create({ data: { id: receiptId, paymentId, providerId: provider.id, tradeNo: input.order.tradeNo, amountCents: payable,
      currency: 'CNY', proof: { recovery: true, reference: input.reference, evidenceHash: input.evidenceHash,
        receivedCurrency:input.order.receivedCurrency,receivedAmount:input.order.receivedAmount }, createdAt: paidAt } })
    let instanceId: number | undefined
    if (input.instance) {
      const item = input.instance
      ensure(!await tx.instance.count({where:{id:item.originalId}}),'OSS_RECOVERY_INSTANCE_ID_OCCUPIED',409)
      await tx.$queryRaw`SELECT id FROM hosts WHERE id=${item.hostId} FOR UPDATE`
      ensure(hostSourceHash===await recoveryHostSourceHash(item.hostId,async(sql,args=[])=>tx.$queryRawUnsafe(sql,...args)),'OSS_RECOVERY_EVIDENCE_STALE',409)
      ensure(!await tx.instance.count({where:{hostId:item.hostId,incusId:item.name}}),'OSS_RECOVERY_HOST_OCCUPIED',409)
      ensure(!await tx.instance.count({ where: { hostId: item.hostId, OR: [{ status: { not: 'deleted' } }, { deletionBillingPending: true }] } }) &&
        !await tx.checkoutReservation.count({ where: { hostId: item.hostId } }), 'OSS_RECOVERY_HOST_OCCUPIED', 409)
      const plan = await tx.packagePlan.findFirst({ where: { id: item.packagePlanId, packageId: item.packageId }, select: { package: { select: { instanceType: true } } } })
      ensure(plan, 'OSS_RECOVERY_PLAN_MISSING')
      assertRecoveryGuestResources({ ...item, instanceType: plan.package.instanceType }, live!)
      const permitId=randomUUID(),[transaction]=await tx.$queryRaw<Array<{id:string}>>`SELECT txid_current()::text id`
      await tx.platformRecoveryEvidence.create({data:{id:permitId,batchId:batch.id,category:'instance-registration-authorization',reference:input.id,
        sourceHash:payloadHash,evidenceHash:input.evidenceHash,observedAt:new Date(input.observedAt),actorId,payload:{transactionId:transaction.id,
          userId,hostId:item.hostId,name:item.name,uuid:item.uuid,cpu:item.cpu,memory:item.memory,disk:item.disk,orderId:input.order.id}}})
      await tx.$queryRaw`SELECT set_config('incudal.recovery_evidence_id',${permitId},true)`
      instanceId = (await tx.instance.create({ data: { id:item.originalId, userId, hostId: item.hostId, name: item.name, incusId: item.name, image: item.image,
        cpu: item.cpu, memory: item.memory, disk: item.disk, storagePoolName: item.storagePoolName, ipv4: item.ipv4,
        status: live!.status === 'Running' ? 'running' : 'stopped', dedicatedIpv4: true, dedicatedNetworkReady: true,
        dedicatedIpv6:dedicatedIpv6 as unknown as Prisma.InputJsonValue,
        packageId: item.packageId, packagePlanId: item.packagePlanId, expiresAt: new Date(item.expiresAt), billingPrice: new Prisma.Decimal(item.billingPrice), billingCycle: item.billingCycle,
        purchaseBatchId: input.order.id, snapshottedSpecs: { recoveryIdentity: { uuid: item.uuid, createdAt: item.createdAt, project: 'default' } }, createdAt: new Date(item.createdAt) } })).id
      // Keep later ordinary inserts clear of explicitly restored original IDs.
      await tx.$queryRaw`SELECT setval(pg_get_serial_sequence('instances','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM instances),
        (SELECT last_value FROM instances_id_seq)), true)`
      await tx.host.update({ where: { id: item.hostId }, data: { poolFaulted: true } })
      await tx.platformRecoveryHost.updateMany({ where: { batchId: batch.id, hostId: item.hostId }, data: { status: 'pending', nextAttemptAt: new Date(), leaseToken: null, leaseUntil: null } })
    }
    if (instanceId && input.instance) {
      await tx.instanceBillingRecord.create({ data: { userId, instanceId, type: 'newPurchase', amount: new Prisma.Decimal(instancePrincipal!).div(100),
        months: input.instance.billingCycle, periodStart: paidAt, periodEnd: new Date(input.instance.expiresAt), purchaseBatchId: input.order.id, createdAt: paidAt,
        remark: `Recovered purchase; evidence ${input.reference}` } })
    }
    const refundBill = refunded && instanceId && input.instance ? await tx.instanceBillingRecord.create({ data: { userId, instanceId, type: 'refund',
      amount: new Prisma.Decimal(refundedPrincipal).div(-100), months: 0, periodStart: paidAt, periodEnd: new Date(input.instance.expiresAt),
      purchaseBatchId: input.order.id, createdAt: new Date(input.observedAt), remark: `Recovered original-channel refund; evidence ${input.reference}` } }) : null
    if (refunded) await tx.checkoutRefund.create({ data: { id: randomUUID(), orderId: input.order.id, paymentId, receiptId, instanceId, billingRecordId: refundBill?.id,
      amountCents: refunded, principalCents: refundedPrincipal, reason: 'recovery-evidenced', status: 'refunded', resolution: input.order.refundReference,
      handledAt: new Date(input.observedAt), handledById: actorId } })
    // An evidenced payment without delivered resources retains a payable refund
    // obligation. It never falls into the ordinary provisioning queue.
    if (!instanceId && !priorInstances.length && refunded < payable) await tx.checkoutRefund.create({ data: { id: randomUUID(), orderId: input.order.id,
      paymentId, receiptId, amountCents: payable-refunded, principalCents: input.order.amountCents-refundedPrincipal,
      reason: 'recovery-undelivered', status: 'pending' } })
    if (!instanceId && !priorInstances.length && refunded === payable) await tx.checkoutOrder.update({ where: { id: input.order.id }, data: {
      status: instanceId ? 'completed' : 'refunded'
    } })
    // One original invoice can evidence several guests. The idempotency key
    // identifies the operation; retain the human reference separately.
    await tx.platformRecoveryEvidence.create({ data: { id: input.id, batchId: batch.id, category: 'registration', reference: input.id,
      sourceHash: payloadHash, evidenceHash: input.evidenceHash, observedAt: new Date(input.observedAt), actorId,
      payload: { reference:input.reference, userId, instanceId: instanceId || null, orderId: input.order.id, receiptId, refundedCents: refunded } } })
    return { id: input.id, userId, instanceId, orderId: input.order.id, replayed: false }
  }, { timeout: 30000 })
}
