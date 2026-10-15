import { prisma } from '../db/prisma.js'
import { createTransferWithFee, hasActiveTransferWorkflow, type TransferSnapshot } from '../db/transfers.js'
import { getSystemConfigFloat } from '../db/system-config.js'
import { createLog } from '../db/logs.js'
import { sendNotification } from '../lib/notifier.js'
import { claimOperationVerificationRequirement } from '../lib/operation-verification.js'

export class AdminInstancePushError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) { super(message) }
}

async function readInstance(id: number) {
  const instance = await prisma.instance.findUnique({ where: { id }, include: {
    host: true, user: { select: { id: true, username: true, status: true, balance: true } },
    package: { select: { id: true, name: true } }
  } })
  if (!instance || instance.status === 'deleted') throw new AdminInstancePushError('INSTANCE_NOT_FOUND', '实例不存在', 404)
  return instance
}

async function eligibility(instance: Awaited<ReturnType<typeof readInstance>>) {
  const pending = await prisma.instanceTransfer.findFirst({ where: { instanceId: instance.id, status: { in: ['pending', 'processing'] } },
    select: { id: true, status: true, toUser: { select: { id: true, username: true } } } })
  const fee = await getSystemConfigFloat('transfer_fee', 0)
  let reason: string | null = null
  if (!['running', 'stopped'].includes(instance.status) || instance.provisioningCleanupPending || instance.deletionBillingPending) reason = '实例当前状态不允许转移'
  else if (instance.user.status !== 'active') reason = '原用户当前不可用'
  else if (!instance.host.transferEnabled) reason = '此宿主机未开启实例转移'
  else if (instance.dedicatedIpv4 && (!instance.dedicatedNetworkReady || instance.host.publicIpSyncBlocked || instance.host.poolFaulted)) reason = '请先处理实例网络或宿主机故障'
  else if (pending) reason = '此实例已有待处理的转移，请先由原用户取消或接收用户处理'
  else if (await hasActiveTransferWorkflow(instance.id)) reason = '实例有正在执行的任务'
  else if (Number(instance.user.balance) < fee) reason = '原用户余额不足以支付转移手续费'
  return { fee, pending, reason }
}

export async function adminInstancePushPreview(instanceId: number) {
  const instance = await readInstance(instanceId)
  const state = await eligibility(instance)
  return {
    instance: { id: instance.id, name: instance.name, status: instance.status, dedicatedIpv4: instance.dedicatedIpv4,
      ip: instance.dedicatedIpv4 ? instance.host.natPublicIp : instance.ipv4,
      billingPrice: instance.billingPrice === null ? null : Number(instance.billingPrice), expiresAt: instance.expiresAt },
    owner: { id: instance.user.id, username: instance.user.username, balance: Number(instance.user.balance) },
    fee: state.fee, pending: state.pending, canCreate: state.reason === null, reason: state.reason
  }
}

export async function adminInstancePushTarget(instanceId: number, username: string) {
  const instance = await readInstance(instanceId)
  const user = await prisma.user.findUnique({ where: { username: username.trim() }, select: { id: true, username: true, status: true, role: true } })
  if (!user) throw new AdminInstancePushError('USER_NOT_FOUND', '接收用户不存在', 404)
  if (user.id === instance.userId) throw new AdminInstancePushError('TRANSFER_TO_SELF', '接收用户不能是原用户', 400)
  if (user.status !== 'active' || user.role !== 'user') throw new AdminInstancePushError('TRANSFER_TARGET_UNAVAILABLE', '请选择正常使用中的普通用户', 400)
  return { id: user.id, username: user.username, status: user.status }
}

export async function createAdminInstancePush(instanceId: number, actorId: number, input: {
  targetUsername: string; expectedOwnerId: number; expectedFee: number; acknowledge: boolean; remark?: string
}) {
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, status: true } })
  if (actor?.role !== 'admin' || actor.status !== 'active') throw new AdminInstancePushError('FORBIDDEN', '仅管理员可代用户转移', 403)
  if (input.acknowledge !== true) throw new AdminInstancePushError('TRANSFER_CONFIRMATION_REQUIRED', '请确认转移内容与手续费', 400)
  const instance = await readInstance(instanceId)
  if (instance.userId !== input.expectedOwnerId) throw new AdminInstancePushError('TRANSFER_SOURCE_CHANGED', '实例所属用户已变化，请刷新后重试')
  const state = await eligibility(instance)
  if (state.reason) throw new AdminInstancePushError('TRANSFER_UNAVAILABLE', state.reason)
  if (!Number.isFinite(input.expectedFee) || input.expectedFee !== state.fee) throw new AdminInstancePushError('TRANSFER_FEE_CHANGED', '转移手续费已变化，请刷新后确认')
  const target = await adminInstancePushTarget(instanceId, input.targetUsername)
  const verification = await claimOperationVerificationRequirement(actorId, 'transfer_instance', instanceId)
  if (!verification.verified) throw new AdminInstancePushError('VERIFICATION_REQUIRED', '请先完成管理员身份验证', 403)
  const [portMappingsCount, snapshotsCount, backupsCount] = await Promise.all([
    prisma.portMapping.count({ where: { instanceId } }), prisma.snapshot.count({ where: { instanceId } }),
    prisma.backup.count({ where: { instanceId, status: { not: 'deleted' } } })
  ])
  const snapshot: TransferSnapshot = {
    packageId: instance.packageId, packageName: instance.package?.name || null, hostId: instance.hostId,
    hostName: instance.dedicatedIpv4 ? '' : instance.host.name, hostLocation: instance.host.location,
    hostCountryCode: instance.host.countryCode || 'us', originalName: instance.name, cpu: instance.cpu,
    memory: instance.memory, disk: instance.disk, networkMode: instance.networkMode, portMappingsCount, snapshotsCount, backupsCount,
    ipv4: instance.dedicatedIpv4 ? instance.host.natPublicIp : instance.ipv4, ipv6: instance.ipv6,
    dedicatedIpv4: instance.dedicatedIpv4, initiatedByAdminId: actorId
  }
  let transferId: number
  try {
    const result = await createTransferWithFee({ instanceId, fromUserId: instance.userId, toUserId: target.id,
      snapshot, fee: state.fee, instanceName: instance.name, remark: input.remark?.trim() || undefined, adminActorId: actorId })
    transferId = result.transferId
  } catch (error) {
    const code = error instanceof Error ? error.message : 'TRANSFER_UNAVAILABLE'
    throw new AdminInstancePushError(code, '实例、接收用户或余额状态已变化，请刷新后重试')
  }
  await createLog(actorId, 'transfer', 'transfer.admin_create',
    `Administrator created transfer #${transferId} for instance #${instanceId}: user #${instance.userId} -> user #${target.id}`, 'success', { instanceId })
  await sendNotification(target.id, 'transfer_received', { instanceName: instance.name, senderUsername: instance.user.username })
  return { transfer: { id: transferId, status: 'pending' as const, toUser: target }, message: '已发起转移，等待接收用户确认' }
}
