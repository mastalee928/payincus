import { generateRandomIPv6 } from '../lib/ip-calculator.js'
import { DEDICATED_BANDWIDTH } from './dedicated-delivery.js'
import { customerIpv6View } from '../lib/host-public-ipv6.js'
/**
 * 一机一卖的多台订单：购物车结算与「直接付款」共用的唯一下单路径。
 *
 * 规则（已与产品确认）：
 *   - 整单全有或全无：任何一台预占不到，整单回滚、一分钱不扣，逐行回报缺口。
 *   - 先付先得：加购不占库存，占库存的只有这里的事务。
 *   - 事务里只做数据库操作；IP 预留、cloud-init、存储池、Incus 开通全部在提交之后逐台执行。
 *   - 按 poolPriceId 升序预占，所有事务加锁顺序一致，跨商品订单不会互相死锁。
 *   - 账单仍然每台一条 newPurchase（月费 + 初装费），退租、退款、续费、到期全部沿用。
 */
import { Prisma } from '@prisma/client'
import { customAlphabet } from 'nanoid'
import { createHash } from 'node:crypto'
import { advisoryTransactionLock, USER_BALANCE_LOCK_NAMESPACE } from '../db/advisory-locks.js'
import { lockHostGroups } from './host-groups.js'
import * as db from '../db/index.js'
import { prisma } from '../db/prisma.js'
import { createLog } from '../db/logs.js'
import { calculateCreateBilling } from '../db/billing-operations.js'
import { getPlanById } from '../db/package-plans.js'
import { getSystemConfigNumber } from '../db/system-config.js'
import { isImageCompatibleWithMemory } from '../db/images.js'
import { validateCommandsOwnership, mergeCommandContents, getImageDistroFromAlias } from '../db/custom-init-commands.js'
import { ErrorCode, type ErrorCodeType } from '../lib/errors.js'
import { generateIncusConfig, generateRandomPassword } from '../lib/incus-config-generator.js'
import { encryptSensitiveData, decryptSensitiveData, validateName } from '../lib/security.js'
import { createInstanceAsync, compensateFailedInstanceCreation } from '../routes/instances.js'
import { poolInventory, resolvePoolProduct } from './host-pool-prices.js'

const shortId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)

const DEFAULT_MAX_INSTANCES = 100
const NETWORK_MODES = ['nat', 'nat_ipv6', 'nat_ipv6_nat', 'ipv6_only', 'ipv6_nat'] as const
type NetworkMode = typeof NETWORK_MODES[number]

export interface PoolOrderItemInput {
  poolPriceId: number
  quantity: number
  namePrefix: string
  image: string
  customInitCommandIds?: number[]
}

export interface PoolOrderInput {
  requestId: string
  turnstileToken?: string
  items: PoolOrderItemInput[]
  /** SSH 密钥可选：缺省即「仅密码」下单，密码由系统生成并在响应里返回。 */
  sshKeyId?: number | null
  /** 前端按购物车展示价算出的整单总额（分），用于拦住「加购后改价」。 */
  expectedTotal: number
}

export interface PoolOrderResult {
  batchId: string
  /** 实际扣款总额（分） */
  total: number
  instances: Array<{
    id: number
    name: string
    incusId: string
    host: string | null
    status: string
    refunded: boolean
    refundPending: boolean
    sshPort: number | null
    rootPassword: string | null
    publicIpv6Addresses?: string[]
    publicIpv6Status?: string
  }>
}

export class PoolOrderError extends Error {
  constructor(
    public readonly code: ErrorCodeType,
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message)
    this.name = 'PoolOrderError'
  }
}

/** 池子的系统架构由机型决定：E2 是 x86，ARM 各核心是 aarch64。与前端的推导保持一致。 */
function architectureOfPreset(preset: string): 'x86_64' | 'aarch64' {
  return preset.startsWith('ARM') ? 'aarch64' : 'x86_64'
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

interface PlannedInstance {
  name: string
  incusId: string
  rootPassword: string
  sshPort: number | null
  configPayload: Record<string, string>
  extraShellCommands?: string
}

interface ResolvedItem {
  imageId: number
  input: PoolOrderItemInput
  product: NonNullable<Awaited<ReturnType<typeof resolvePoolProduct>>>
  pkg: NonNullable<Awaited<ReturnType<typeof db.getPackageById>>>
  plan: NonNullable<Awaited<ReturnType<typeof getPlanById>>>
  billing: ReturnType<typeof calculateCreateBilling>
  networkMode: NetworkMode
  planned: PlannedInstance[]
}

/** 名字：一台时就是客户填的名字，多台时「前缀-01」起编号。 */
function buildInstanceNames(prefix: string, quantity: number): string[] {
  if (quantity === 1) return [prefix]
  const width = Math.max(2, String(quantity).length)
  return Array.from({ length: quantity }, (_, index) => `${prefix}-${String(index + 1).padStart(width, '0')}`)
}

/**
 * 事务之前的全部校验与定价。失败即抛错，此时还没有锁任何机器。
 */
async function prepareOrder(userId: number, input: PoolOrderInput, sshKey: string): Promise<{ items: ResolvedItem[]; totalYuan: number; totalCount: number }> {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new PoolOrderError(ErrorCode.POOL_ORDER_INVALID, '订单为空')
  }

  const maxInstances = Math.max(1, Math.min(100, Math.floor(await getSystemConfigNumber('pool_order_max_instances', DEFAULT_MAX_INSTANCES))))
  const totalCount = input.items.reduce((sum, item) => sum + item.quantity, 0)
  if (input.items.some(item => !Number.isInteger(item.quantity) || item.quantity < 1)) {
    throw new PoolOrderError(ErrorCode.POOL_ORDER_INVALID, '数量必须是正整数')
  }
  if (totalCount > maxInstances) {
    throw new PoolOrderError(ErrorCode.POOL_ORDER_TOO_LARGE, `一次最多购买 ${maxInstances} 台`, { max: maxInstances, requested: totalCount })
  }

  const seenNames = new Set<string>()
  const items: ResolvedItem[] = []
  let totalYuan = 0

  // 同一商品多行按 poolPriceId 排序，预占时加锁顺序才一致。
  const sortedInputs = [...input.items].sort((left, right) => left.poolPriceId - right.poolPriceId)

  for (const item of sortedInputs) {
    const product = await resolvePoolProduct(item.poolPriceId)
    if (!product) throw new PoolOrderError(ErrorCode.PACKAGE_UNAVAILABLE, `商品 #${item.poolPriceId} 不存在或已下架`, { poolPriceId: item.poolPriceId })

    const [pkg, plan] = await Promise.all([db.getPackageById(product.packageId), getPlanById(product.planId)])
    if (!pkg || !pkg.active || !plan || !plan.isActive) {
      throw new PoolOrderError(ErrorCode.PACKAGE_UNAVAILABLE, `商品 #${item.poolPriceId} 不可购买`, { poolPriceId: item.poolPriceId })
    }

    // 名字：格式校验沿用单台路径，同一单内不得重名。
    const names = buildInstanceNames(item.namePrefix.trim(), item.quantity)
    for (const name of names) {
      const validation = validateName(name, 'Instance name', 2, 64)
      if (!validation.valid) throw new PoolOrderError(ErrorCode.INVALID_NAME, validation.message || '实例名称不合法', { name })
      if (seenNames.has(name)) throw new PoolOrderError(ErrorCode.POOL_ORDER_INVALID, `实例名称重复：${name}`, { name })
      seenNames.add(name)
    }

    // 镜像：必须存在、可见、容器镜像、架构与机型一致、与配额内存兼容。
    const image = await prisma.systemImage.findUnique({ where: { remoteAlias: item.image } })
    if (!image || image.hidden) throw new PoolOrderError(ErrorCode.IMAGE_NOT_FOUND, `镜像不可用：${item.image}`, { poolPriceId: item.poolPriceId })
    if (image.instanceType === 'vm') throw new PoolOrderError(ErrorCode.IMAGE_TYPE_MISMATCH, `镜像 ${item.image} 只支持虚拟机`, { poolPriceId: item.poolPriceId })
    const architecture = architectureOfPreset(product.price.resourcePreset)
    if (image.architecture !== architecture) {
      throw new PoolOrderError(ErrorCode.IMAGE_TYPE_MISMATCH, `镜像 ${item.image} 的架构 ${image.architecture} 与机型 ${product.price.resourcePreset} 不匹配`, { poolPriceId: item.poolPriceId })
    }
    if (!await isImageCompatibleWithMemory(item.image, plan.memory)) {
      throw new PoolOrderError(ErrorCode.IMAGE_MEMORY_INCOMPATIBLE, `镜像 ${item.image} 不适用于该内存配额`, { poolPriceId: item.poolPriceId })
    }

    // 自定义初始化命令：归属与发行版兼容性沿用现有校验。
    let extraShellCommands: string | undefined
    if (item.customInitCommandIds && item.customInitCommandIds.length > 0) {
      const validation = await validateCommandsOwnership(item.customInitCommandIds, userId)
      if (!validation.valid) throw new PoolOrderError(ErrorCode.INVALID_PARAMS, '自定义初始化命令不可用', { poolPriceId: item.poolPriceId })
      const distro = getImageDistroFromAlias(item.image)
      const compatible = validation.commands.filter(cmd => cmd.distros.includes('all') || cmd.distros.includes(distro))
      if (compatible.length > 0) extraShellCommands = mergeCommandContents(compatible)
    }

    const networkMode = (NETWORK_MODES as readonly string[]).includes(pkg.network_mode || '')
      ? (pkg.network_mode as NetworkMode)
      : 'nat'

    // Pool products charge the configured setup fee once; renewals use only the monthly price.
    const monthlyPrice = Number(product.price.monthlyPrice) / 100
    const setupFee = Number(product.price.setupFee) / 100
    const billing = {
      ...calculateCreateBilling(plan),
      price: monthlyPrice,
      setupFee,
      totalPrice: roundMoney(monthlyPrice + setupFee)
    }
    totalYuan = roundMoney(totalYuan + billing.totalPrice * item.quantity)

    const planned: PlannedInstance[] = names.map(name => {
      const rootPassword = generateRandomPassword(16)
      const { configPayload, metaData } = generateIncusConfig({
        instanceName: name,
        imageAlias: item.image,
        rootPassword,
        sshKey,
        networkMode,
        type: 'container',
        extraShellCommands
      })
      return { name, incusId: `u${userId}-${shortId()}`, rootPassword, sshPort: metaData.sshPort, configPayload, extraShellCommands }
    })

    items.push({ imageId: image.id, input: item, product, pkg, plan, billing, networkMode, planned })
  }

  const totalCents = Math.round(totalYuan * 100)
  if (totalCents !== input.expectedTotal) {
    throw new PoolOrderError(ErrorCode.POOL_PRICE_CHANGED, '价格已变动，请确认新的合计', { expectedTotal: input.expectedTotal, total: totalCents })
  }

  return { items, totalYuan, totalCount }
}

/**
 * 缺货回包：事务已回滚之后，按分配器同一套就绪判据算出每个商品的可售台数，
 * 让购物车能把数量上限改成真实余量，而不只是知道「有一行不够」。
 */
async function buildShortages(items: ResolvedItem[]): Promise<Array<{ poolPriceId: number; requested: number; available: number }>> {
  const pools = await poolInventory({ readyOnly: true })
  const requested = new Map<number, { item: ResolvedItem; quantity: number }>()
  for (const item of items) {
    const existing = requested.get(item.product.price.id)
    requested.set(item.product.price.id, { item, quantity: (existing?.quantity ?? 0) + item.input.quantity })
  }
  return [...requested.values()].map(({ item, quantity }) => {
    const price = item.product.price
    const pool = pools.find(row => row.machineGroupId === price.machineGroupId && row.resourcePreset === price.resourcePreset && row.regionGroupId === price.regionGroupId && row.diskGiB === price.diskGiB)
    return { poolPriceId: price.id, requested: quantity, available: pool?.idle ?? 0 }
  }).filter(row => row.requested > row.available)
}

interface CreatedInstance {
  instanceId: number
  host: NonNullable<Awaited<ReturnType<typeof db.selectAndReserveHostWithLock>>>
  item: ResolvedItem
  planned: PlannedInstance
}

export function poolOrderHash(input: PoolOrderInput): string {
  return createHash('sha256').update(JSON.stringify({
    items: input.items.map(item => ({ poolPriceId: item.poolPriceId, quantity: item.quantity, namePrefix: item.namePrefix.trim(), image: item.image,
      customInitCommandIds: item.customInitCommandIds ?? [] })), sshKeyId: input.sshKeyId ?? null, expectedTotal: input.expectedTotal
  })).digest('hex')
}

export async function getPoolOrderResult(userId: number, batchId: string): Promise<PoolOrderResult | null> {
  const order = await prisma.poolOrder.findFirst({ where: { id: batchId, userId } })
  if (!order) return null
  const instances = await prisma.instance.findMany({ where: { purchaseBatchId: batchId, userId }, orderBy: { id: 'asc' }, include: {
    host: { select: { natPublicIp: true, publicIpSyncBlocked: true } },
    portMappings: { where: { protocol: 'tcp' }, select: { privatePort: true, publicPort: true } }
  } })
  const refunds = await prisma.instanceBillingRecord.findMany({ where: { userId, instanceId: { in: instances.map(instance => instance.id) }, type: 'refund', remark: { contains: '实例创建失败自动退款' } }, select: { instanceId: true } })
  const refunded = new Set(refunds.map(refund => refund.instanceId))
  const purchases = await prisma.instanceBillingRecord.findMany({ where: { userId, instanceId: { in: instances.map(instance => instance.id) }, type: 'newPurchase' }, select: { instanceId: true, amount: true } })
  const paid = new Set(purchases.filter(purchase => Number(purchase.amount) > 0).map(purchase => purchase.instanceId))
  return { batchId, total: Number(order.totalCents), instances: instances.map(instance => {
    const ready = instance.dedicatedNetworkReady && !instance.host.publicIpSyncBlocked && ['running', 'stopped'].includes(instance.status)
    const ipv6 = customerIpv6View(instance.dedicatedIpv6, { hostId: instance.hostId, instanceName: instance.incusId, networkReady: instance.dedicatedNetworkReady })
    return { id: instance.id, name: instance.name, incusId: instance.incusId, status: instance.status, refunded: refunded.has(instance.id),
      refundPending: instance.status === 'error' && paid.has(instance.id) && !refunded.has(instance.id),
      host: ready ? instance.host.natPublicIp : null, sshPort: ready ? 22 : null, publicIpUpdating: instance.host.publicIpSyncBlocked,
      publicIpv6Addresses: ['running', 'stopped'].includes(instance.status) ? ipv6?.addresses ?? [] : [], publicIpv6Status: ipv6?.status ?? 'none',
      rootPassword: ready && instance.rootPassword ? decryptSensitiveData(instance.rootPassword) : null }
  }) }
}

export async function placePoolOrder(userId: number, username: string, input: PoolOrderInput): Promise<PoolOrderResult> {
  const requestHash = poolOrderHash(input)
  const existingOrder = await prisma.poolOrder.findUnique({ where: { id: input.requestId } })
  if (existingOrder) {
    if (existingOrder.userId !== userId || existingOrder.requestHash !== requestHash) throw new PoolOrderError(ErrorCode.POOL_ORDER_INVALID, '结算请求已用于另一张订单')
    return (await getPoolOrderResult(userId, input.requestId))!
  }

  // SSH 密钥可选：不传则只按系统生成的密码开通（客户从响应里拿到 rootPassword）。
  let sshKey = ''
  if (input.sshKeyId !== undefined && input.sshKeyId !== null) {
    const keyRecord = await db.getSSHKeyById(input.sshKeyId)
    if (!keyRecord || keyRecord.user_id !== userId) {
      throw new PoolOrderError(ErrorCode.SSH_KEY_NOT_OWNED, 'SSH 密钥不存在或不属于当前用户')
    }
    sshKey = keyRecord.public_key
  }

  const { items, totalYuan, totalCount } = await prepareOrder(userId, input, sshKey)
  const batchId = input.requestId
  const now = new Date()

  let created: CreatedInstance[] | null
  try {
    created = await prisma.$transaction(async tx => {
      await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, userId)
      const previous = await tx.poolOrder.findUnique({ where: { id: batchId } })
      if (previous) {
        if (previous.userId !== userId || previous.requestHash !== requestHash) throw new PoolOrderError(ErrorCode.POOL_ORDER_INVALID, '结算请求冲突')
        return null
      }
      // Price changes, group edits and checkout use the same lock order.
      await lockHostGroups(tx)
      const account = await tx.user.findUnique({ where: { id: userId }, select: { status: true } })
      if (!account || account.status !== 'active') throw new PoolOrderError(ErrorCode.FORBIDDEN, '账号不可用')
      for (const item of items) {
        const price = await tx.hostPoolPrice.findUnique({ where: { id: item.product.price.id } })
        if (!price?.active || price.shadowPlanId !== item.plan.id) throw new PoolOrderError(ErrorCode.PACKAGE_UNAVAILABLE, '商品已下架')
        if (Number(price.monthlyPrice) !== Number(item.product.price.monthlyPrice) || Number(price.setupFee) !== Number(item.product.price.setupFee)) {
          throw new PoolOrderError(ErrorCode.POOL_PRICE_CHANGED, '价格已变动，请刷新购物车')
        }
        const plan = await tx.packagePlan.findUnique({ where: { id: item.plan.id }, include: { package: true } })
        if (!plan?.isActive || !plan.package.active) throw new PoolOrderError(ErrorCode.PACKAGE_UNAVAILABLE, '商品已下架')
        if (plan.updatedAt.getTime() !== item.plan.updatedAt.getTime()) throw new PoolOrderError(ErrorCode.POOL_PRICE_CHANGED, '商品配置已变动，请刷新购物车')
        const image = await tx.systemImage.findFirst({ where: { remoteAlias: item.input.image, hidden: false } })
        if (!image) throw new PoolOrderError(ErrorCode.IMAGE_NOT_FOUND, '镜像已下架')
      }
      await tx.poolOrder.create({ data: { id: batchId, userId, requestHash, totalCents: input.expectedTotal } })
      // 先扣款再预占：预占失败整单回滚时扣款一并撤销；带余额条件的原子更新防止并发下单用旧余额覆盖。
      const walletUpdate = await tx.user.updateMany({
        where: { id: userId, balance: { gte: totalYuan } },
        data: { balance: { decrement: totalYuan } }
      })
      if (walletUpdate.count !== 1) throw new PoolOrderError(ErrorCode.BALANCE_INSUFFICIENT, '余额不足')

      const updatedUser = await tx.user.findUnique({ where: { id: userId }, select: { balance: true } })
      if (!updatedUser) throw new PoolOrderError(ErrorCode.USER_NOT_FOUND, '用户不存在')
      const balanceAfter = Number(updatedUser.balance)
      const balanceLog = await tx.balanceLog.create({
        data: {
          userId,
          type: 'consume',
          amount: -totalYuan,
          balanceBefore: roundMoney(balanceAfter + totalYuan),
          balanceAfter,
          remark: `一机一卖订单 ${batchId}：${totalCount} 台`
        }
      })

      const results: CreatedInstance[] = []
      for (const item of items) {
        const price = item.product.price
        for (let index = 0; index < item.planned.length; index++) {
          const planned = item.planned[index]
          const lockedHost = await db.selectAndReserveHostWithLock(tx, {
            cpu: item.plan.cpu,
            memory: item.plan.memory,
            disk: item.plan.disk,
            portCount: 0,
            packageId: item.pkg.id,
            networkMode: item.networkMode,
            poolImageId: item.imageId,
            poolMachineGroupId: price.machineGroupId,
            poolRegionGroupId: price.regionGroupId,
            poolResourcePreset: price.resourcePreset,
            poolDiskGiB: price.diskGiB
          })
          if (!lockedHost) {
            throw new PoolOrderError(ErrorCode.POOL_STOCK_SHORT, '库存不足', {
              shortages: [{ poolPriceId: price.id, requested: item.input.quantity, available: index }]
            })
          }

          const monthlyTrafficLimit = null
          const bandwidthLimit = DEDICATED_BANDWIDTH

          const instance = await tx.instance.create({
            data: {
              incusId: planned.incusId,
              name: planned.name,
              userId,
              hostId: lockedHost.id,
              packageId: item.pkg.id,
              packagePlanId: item.plan.id,
              image: item.input.image,
              cpu: item.plan.cpu,
              memory: item.plan.memory,
              disk: item.plan.disk,
              networkMode: item.networkMode,
              snapshottedSpecs: {
                packageId: item.pkg.id,
                packageName: item.pkg.name,
                cpuMax: item.pkg.cpu_max,
                memoryMax: item.pkg.memory_max,
                diskMax: item.pkg.disk_max,
                networkMode: item.networkMode,
                portLimit: 0,
                nested: Boolean(item.pkg.nested),
                privileged: Boolean(item.pkg.privileged),
                sshPublicKey: sshKey || null,
                nodeSelectors: [],
                billingMode: 'package',
                packagePlanId: item.plan.id,
                poolPriceId: price.id,
                purchaseBatchId: batchId,
                createdAt: now.toISOString()
              } as Prisma.InputJsonValue,
              sshPort: planned.sshPort,
              rootPassword: encryptSensitiveData(planned.rootPassword),
              status: 'creating',
              dedicatedIpv4: true,
              monthlyTrafficLimit,
              portLimit: 0,
              snapshotLimit: item.plan.snapshotLimit,
              backupLimit: item.plan.backupLimit,
              siteLimit: item.plan.siteLimit,
              swapEnabled: false,
              swapSize: item.plan.swapSize,
              limitsIngress: bandwidthLimit,
              limitsEgress: bandwidthLimit,
              expiresAt: item.billing.expiresAt,
              billingPrice: item.billing.price,
              billingCycle: item.billing.billingCycle,
              poolPriceId: price.id,
              purchaseBatchId: batchId,
              autoRenew: false
            }
          })

          await tx.instanceBillingRecord.create({
            data: {
              instanceId: instance.id,
              userId,
              type: 'newPurchase',
              amount: item.billing.totalPrice,
              months: item.billing.billingCycle,
              periodStart: now,
              periodEnd: item.billing.expiresAt,
              balanceLogId: balanceLog.id,
              purchaseBatchId: batchId,
              remark: item.billing.setupFee > 0
                ? `新开通 ${item.billing.billingCycle} 个月，含初装费 ¥${item.billing.setupFee.toFixed(2)}（订单 ${batchId}）`
                : `新开通 ${item.billing.billingCycle} 个月（订单 ${batchId}）`
            }
          })

          await db.processHostingIncome(lockedHost.id, item.billing.totalPrice, instance.id, 'purchase', tx)
          results.push({ instanceId: instance.id, host: lockedHost, item, planned })
        }
      }
      return results
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 120000
    })
  } catch (error) {
    if (error instanceof PoolOrderError && error.code === ErrorCode.POOL_STOCK_SHORT) {
      const shortages = await buildShortages(items).catch(() => null)
      if (shortages && shortages.length > 0) {
        throw new PoolOrderError(error.code, error.message, { shortages })
      }
    }
    throw error
  }

  if (created === null) return (await getPoolOrderResult(userId, batchId))!

  // 事务之后逐台完成 IP 预留、cloud-init、存储池并入队开通。
  // Preparation failures enter the same immediate, idempotent compensation as ordinary purchases.
  for (const entry of created) {
    try {
      await startProvisioning(userId, sshKey, entry)
    } catch (error) {
      await compensateFailedInstanceCreation({ instanceId: entry.instanceId, host: entry.host, userId,
        resources: { cpu: entry.item.plan.cpu, memory: entry.item.plan.memory, disk: entry.item.plan.disk },
        networkMode: entry.item.networkMode, portLimit: entry.item.plan.portLimit, instanceName: entry.planned.incusId,
        errorMessage: error instanceof Error ? error.message : 'Provisioning preparation failed'
      })
    }
  }

  await createLog(
    userId,
    'instance',
    'instance.pool_order',
    `Pool order ${batchId}: ${totalCount} instance(s), ¥${totalYuan.toFixed(2)} by ${username}`,
    'success'
  ).catch(() => console.error('[PoolOrder] Audit log unavailable'))

  return (await getPoolOrderResult(userId, batchId))!
}

/** 与单台路径的「阶段六」一致：IP 预留 → 带静态地址重生成 cloud-init → 存储池 → 异步开通。 */
async function startProvisioning(userId: number, sshKey: string, entry: CreatedInstance): Promise<void> {
  const { instanceId, host, item, planned } = entry
  const hostWithIpv6 = host as typeof host & {
    ipv6_subnet?: string | null
    ipv6_gateway?: string | null
    ipv6_parent_interface?: string | null
  }
  // Pool products currently use PayIncus NAT delivery; do not invent an independent IPv6 address.
  const ipv4 = await db.allocateAndReserveNatIpv4(host.id, instanceId)
  if (!ipv4) throw new Error('NAT IPv4 allocation failed')
  const reserved = { ipv4, ipv6: null as string | null }
  if (hostWithIpv6.ipv6_subnet) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = generateRandomIPv6(hostWithIpv6.ipv6_subnet)
      if (await db.isIpAddressExists(candidate)) continue
      await db.createIpAddress({ address: candidate, type: 'inet6', isPrimary: true, device: 'eth1', hostId: host.id, instanceId })
      reserved.ipv6 = candidate
      break
    }
    if (!reserved.ipv6) throw new Error('IPv6 address allocation failed')
  }
  const networkMode = reserved.ipv6 ? 'nat_ipv6' as const : item.networkMode
  await prisma.instance.update({ where: { id: instanceId }, data: { networkMode } })

  // 与单台路径一致：拿到静态地址后重新生成带 network-config 的 cloud-init
  let configPayload = planned.configPayload
  if (reserved.ipv4 || reserved.ipv6) {
    const regenerated = generateIncusConfig({
      instanceName: planned.name,
      imageAlias: item.input.image,
      rootPassword: planned.rootPassword,
      sshKey,
      networkMode,
      type: 'container',
      network: {
        ipAddress: `${reserved.ipv4}/22`,
        gateway: '10.10.0.1',
        dns: reserved.ipv4 ? ['10.10.0.1'] : undefined,
        ipv6Address: reserved.ipv6 ? `${reserved.ipv6}/128` : undefined,
        ipv6Gateway: reserved.ipv6 ? 'fe80::1' : undefined
      },
      extraShellCommands: planned.extraShellCommands
    })
    configPayload = regenerated.configPayload
  }

  const storagePool = await db.resolveStoragePoolForNewInstance(host.id, { packageId: item.pkg.id })
  if (!storagePool) throw new Error('System storage pool is unavailable')
  await prisma.instance.update({ where: { id: instanceId }, data: { storagePoolName: storagePool } })

  void createInstanceAsync(instanceId, host, {
    name: planned.incusId,
    image: item.input.image,
    cpu: item.plan.cpu,
    memory: item.plan.memory,
    disk: item.plan.disk,
    swapEnabled: false,
    swapSize: item.plan.swapSize,
    cloudInitConfig: configPayload,
    networkMode,
    nested: Boolean(item.pkg.nested),
    privileged: Boolean(item.pkg.privileged),
    portLimit: 0,
    instanceType: 'container',
    sshPort: planned.sshPort,
    storagePool,
    ipv4Address: reserved.ipv4,
    ipv6Address: reserved.ipv6,
    ipv6Gateway: hostWithIpv6.ipv6_gateway || null,
    hostInterface: hostWithIpv6.ipv6_parent_interface || 'eth0',
    limitsIngress: DEDICATED_BANDWIDTH,
    limitsEgress: DEDICATED_BANDWIDTH
  }, userId, {
    cpu: item.plan.cpu,
    memory: item.plan.memory,
    disk: item.plan.disk,
  }).catch(error => {
    console.error(`[PoolOrder] 实例 ${instanceId} 开通失败:`, error instanceof Error ? error.message : error)
  })
}
