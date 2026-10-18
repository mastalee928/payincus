/**
 * 管理员告警推送（仅管理员使用）
 *
 * 管理端可配置多个 Telegram 告警渠道（NotificationChannel.alertCategory 非空），
 * 每类用途一个 Bot：工单 ticket / 宿主机 host / 财务 payment / 实例 instance。
 * 推送失败只写通知日志与 warn，绝不打断业务主流程；调用方一律 fire-and-forget。
 */

import * as db from '../db/index.js'
import { prisma } from '../db/prisma.js'
import { sanitizeTokensInString } from './log-sanitizer.js'

export const ADMIN_ALERT_CATEGORIES = ['ticket', 'host', 'payment', 'instance'] as const
export type AdminAlertCategory = (typeof ADMIN_ALERT_CATEGORIES)[number]

const ADMIN_ALERT_FETCH_TIMEOUT_MS = 15_000
const ADMIN_ALERT_ERROR_PREVIEW_MAX_CHARS = 500
const ADMIN_ALERT_LOG_MESSAGE_MAX_CHARS = 2_000
const ADMIN_ALERT_EXCERPT_MAX_CHARS = 200
const ADMIN_ALERT_LIST_MAX_LINES = 15

interface SendAdminAlertResult {
  sent: number
  failed: number
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function clip(value: string | null | undefined, max: number): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return text.slice(0, max) + '…'
}

function formatMoney(value: number): string {
  return `¥${Number(value || 0).toFixed(2)}`
}

function formatSize(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
}

function formatTime(date: Date = new Date()): string {
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}

function paymentMethodLabel(method: string | null | undefined): string {
  const raw = (method ?? '').trim()
  const normalized = raw.toLowerCase()
  const labels: Record<string, string> = {
    alipay: '支付宝',
    wxpay: '微信',
    wechat: '微信',
    weixin: '微信',
    qqpay: 'QQ钱包',
    usdt: 'USDT',
    bank: '银行卡'
  }
  if (normalized && labels[normalized]) return labels[normalized]
  return raw
}

async function loadUser(userId: number): Promise<{ username: string; email: string | null } | null> {
  try {
    return await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, email: true }
    })
  } catch {
    return null
  }
}

function userLine(user: { username: string; email: string | null } | null, fallback = '未知用户'): string {
  if (!user) return fallback
  return user.email ? `${user.username}（${user.email}）` : user.username
}

function ownerLabelOf(owner: { username: string; role: string } | null | undefined): string {
  if (!owner) return '未知归属'
  return owner.role === 'admin' ? '官方节点' : `托管主：${owner.username}`
}

/**
 * 发送一条管理员告警到指定类别的所有启用渠道（仅 Telegram）。
 * 内部吞掉全部异常并写通知日志，返回发送统计。
 */
export async function sendAdminAlert(
  category: AdminAlertCategory,
  title: string,
  message: string
): Promise<SendAdminAlertResult> {
  try {
    const channels = await prisma.notificationChannel.findMany({
      where: { alertCategory: category, enabled: true }
    })
    if (channels.length === 0) return { sent: 0, failed: 0 }

    const text = `<b>${escapeHtml(title)}</b>\n${escapeHtml(message)}`
    let sent = 0
    let failed = 0

    for (const channel of channels) {
      const logId = await db.createNotificationLog({
        channelId: channel.id,
        eventType: `admin_alert.${category}`,
        message: `${title}\n${message}`.slice(0, ADMIN_ALERT_LOG_MESSAGE_MAX_CHARS),
        status: 'pending'
      })

      let error: string | null = null
      try {
        if (channel.type !== 'telegram') {
          error = `Unsupported alert channel type: ${channel.type}`
        } else {
          const config = (typeof channel.config === 'string' ? JSON.parse(channel.config) : channel.config) as Record<string, unknown>
          const botToken = typeof config.botToken === 'string' ? config.botToken : ''
          const chatId = typeof config.chatId === 'string' ? config.chatId : ''
          if (!botToken || !chatId) {
            error = 'Missing botToken or chatId'
          } else {
            const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: 'POST',
              redirect: 'manual',
              signal: AbortSignal.timeout(ADMIN_ALERT_FETCH_TIMEOUT_MS),
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
            })
            const json = await response.json() as { ok?: boolean; description?: string }
            error = json.ok ? null : (json.description || `HTTP ${response.status}`)
          }
        }
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err)
        error = sanitizeTokensInString(raw).slice(0, ADMIN_ALERT_ERROR_PREVIEW_MAX_CHARS)
      }

      await db.updateNotificationLogStatus(logId, error ? 'failed' : 'sent', error)
      if (error) failed += 1
      else sent += 1
    }

    return { sent, failed }
  } catch (err) {
    console.warn('[AdminAlerts] sendAdminAlert failed:', err)
    return { sent: 0, failed: 0 }
  }
}

async function dispatch(category: AdminAlertCategory, title: string, lines: Array<string | null | undefined>): Promise<void> {
  try {
    await sendAdminAlert(category, title, lines.filter((line): line is string => Boolean(line)).join('\n'))
  } catch (err) {
    console.warn('[AdminAlerts] dispatch failed:', err)
  }
}

// ==================== 工单 ====================

const TICKET_CATEGORY_LABELS: Record<string, string> = {
  general: '常规',
  technical: '技术',
  billing: '账单',
  refund: '退款',
  abuse: '举报',
  account: '账号',
  other: '其他'
}

const TICKET_PRIORITY_LABELS: Record<string, string> = {
  low: '低',
  normal: '普通',
  high: '高',
  urgent: '紧急'
}

function ticketCategoryLabel(value: string | null | undefined): string {
  const raw = (value ?? '').trim()
  if (!raw) return ''
  return TICKET_CATEGORY_LABELS[raw.toLowerCase()] || raw
}

function ticketPriorityLabel(value: string | null | undefined): string {
  const raw = (value ?? '').trim()
  if (!raw) return ''
  return TICKET_PRIORITY_LABELS[raw.toLowerCase()] || raw
}

export async function notifyAdminTicketCreated(input: {
  ticketId: number
  username: string
  subject: string
  content?: string | null
  category?: string | null
  priority?: string | null
  attachmentCount?: number
  hostName?: string | null
  instanceName?: string | null
}): Promise<void> {
  const metaParts: string[] = []
  const categoryLabel = ticketCategoryLabel(input.category)
  if (categoryLabel) metaParts.push(`分类：${categoryLabel}`)
  const priorityLabel = ticketPriorityLabel(input.priority)
  if (priorityLabel) metaParts.push(`优先级：${priorityLabel}`)
  const excerpt = clip(input.content, ADMIN_ALERT_EXCERPT_MAX_CHARS)
  const attachmentCount = input.attachmentCount || 0
  await dispatch('ticket', `🎫 新工单 #${input.ticketId}`, [
    `用户：${clip(input.username, 80)}`,
    `主题：${clip(input.subject, 120)}`,
    metaParts.length > 0 ? metaParts.join(' ｜ ') : null,
    `节点：${clip(input.hostName || '系统', 80)} ｜ 实例：${clip(input.instanceName || '无', 80)}`,
    excerpt ? `内容：${excerpt}` : (attachmentCount > 0 ? '内容：未填写文字，见附件' : null),
    attachmentCount > 0 ? `附件：${attachmentCount} 张图片` : null,
    `时间：${formatTime()}`
  ])
}

export async function notifyAdminTicketReplied(input: {
  ticketId: number
  subject: string
  replyFrom: string
  excerpt?: string | null
  hostName?: string | null
}): Promise<void> {
  await dispatch('ticket', `💬 工单收到用户回复 #${input.ticketId}`, [
    `主题：${clip(input.subject, 120)}`,
    `回复人：${clip(input.replyFrom, 80)}`,
    input.excerpt ? `内容：${clip(input.excerpt, ADMIN_ALERT_EXCERPT_MAX_CHARS)}` : null,
    `时间：${formatTime()}`
  ])
}

export async function notifyAdminTicketClosed(input: {
  ticketId: number
  subject: string
  closedBy: string
  hostName?: string | null
}): Promise<void> {
  await dispatch('ticket', `✅ 工单已关闭 #${input.ticketId}`, [
    `主题：${clip(input.subject, 120)}`,
    `关闭人：${clip(input.closedBy, 80)}`,
    `时间：${formatTime()}`
  ])
}

// ==================== 财务 ====================

export async function notifyAdminRecharge(input: {
  userId: number
  amount: number
  orderNo: string
  tradeNo?: string | null
  providerName?: string | null
  providerType?: string | null
  paymentMethod?: string | null
  paymentMethodCode?: string | null
}): Promise<void> {
  const user = await loadUser(input.userId)
  let balance: number | null = null
  try {
    balance = Number(await db.getUserBalance(input.userId))
  } catch {
    balance = null
  }
  const method = paymentMethodLabel(input.paymentMethod) || clip(input.paymentMethodCode || '', 60)
  const channelParts = [clip(input.providerName || input.providerType || '在线支付', 60), method].filter(Boolean)
  await dispatch('payment', '💰 充值到账', [
    `用户：${userLine(user, `用户 #${input.userId}`)}`,
    `金额：${formatMoney(input.amount)}`,
    `通道：${channelParts.join(' / ')}`,
    `订单号：${clip(input.orderNo, 80)}`,
    input.tradeNo ? `交易号：${clip(input.tradeNo, 80)}` : null,
    balance !== null ? `到账后余额：${formatMoney(balance)}` : null,
    `时间：${formatTime()}`
  ])
}

export async function notifyAdminInstancePurchase(input: {
  userId: number
  instanceId: number
  amount: number
}): Promise<void> {
  if (!(input.amount > 0)) return
  const user = await loadUser(input.userId)
  const instance = await prisma.instance.findUnique({
    where: { id: input.instanceId },
    select: {
      name: true,
      billingCycle: true,
      host: { select: { name: true } },
      packagePlan: { select: { name: true } }
    }
  }).catch(() => null)
  await dispatch('payment', '🛒 实例购买扣款（余额支付）', [
    `用户：${userLine(user, `用户 #${input.userId}`)}`,
    `实例：${clip(instance?.name || `#${input.instanceId}`, 80)}`,
    instance?.host?.name ? `节点：${clip(instance.host.name, 80)}` : null,
    instance?.packagePlan?.name ? `套餐：${clip(instance.packagePlan.name, 80)} ｜ ${instance.billingCycle || 1} 个月` : null,
    `金额：${formatMoney(input.amount)}`,
    `时间：${formatTime()}`
  ])
}

export async function notifyAdminPoolOrderPurchase(input: {
  userId: number
  batchId: string
  totalCount: number
  totalYuan: number
  namePrefix?: string | null
  image?: string | null
}): Promise<void> {
  if (!(input.totalYuan > 0)) return
  const user = await loadUser(input.userId)
  await dispatch('payment', '🛒 池订单扣款（余额支付）', [
    `用户：${userLine(user, `用户 #${input.userId}`)}`,
    `数量：${input.totalCount} 台${input.namePrefix ? `（名称前缀 ${clip(input.namePrefix, 40)}）` : ''}`,
    input.image ? `镜像：${clip(input.image, 80)}` : null,
    `订单号：${clip(input.batchId, 80)}`,
    `金额：${formatMoney(input.totalYuan)}`,
    `时间：${formatTime()}`
  ])
}

export async function notifyAdminRenew(input: {
  userId: number
  instanceName: string
  months: number
  amount: number
}): Promise<void> {
  const user = await loadUser(input.userId)
  await dispatch('payment', '🔄 手动续费（余额支付）', [
    `用户：${userLine(user, `用户 #${input.userId}`)}`,
    `实例：${clip(input.instanceName, 80)}`,
    `时长：${input.months} 个月 ｜ 金额：${formatMoney(input.amount)}`,
    `时间：${formatTime()}`
  ])
}

export async function notifyAdminRenewBatch(input: {
  username: string
  months: number
  items: Array<{ name: string; amount: number }>
}): Promise<void> {
  if (input.items.length === 0) return
  const totalAmount = input.items.reduce((sum, item) => sum + item.amount, 0)
  const shown = input.items.slice(0, ADMIN_ALERT_LIST_MAX_LINES)
  const lines = [
    `用户：${clip(input.username, 80)}`,
    `成功：${input.items.length} 台 ｜ 合计 ${formatMoney(totalAmount)} ｜ 时长 ${input.months} 个月`,
    `明细：`,
    ...shown.map(item => `· ${clip(item.name, 60)} ${formatMoney(item.amount)}`),
    input.items.length > shown.length ? `…共 ${input.items.length} 台` : null,
    `时间：${formatTime()}`
  ]
  await dispatch('payment', '🔄 批量续费（余额支付）', lines)
}

export async function notifyAdminAutoRenewSummary(input: {
  successes: Array<{ username: string; instanceName: string; amount: number }>
  failures: Array<{ username: string; instanceName: string; reason: string }>
}): Promise<void> {
  if (input.successes.length === 0 && input.failures.length === 0) return
  const totalAmount = input.successes.reduce((sum, item) => sum + item.amount, 0)
  const shownSuccess = input.successes.slice(0, ADMIN_ALERT_LIST_MAX_LINES)
  const shownFailure = input.failures.slice(0, 10)
  const lines = [
    `成功 ${input.successes.length} 台 ｜ 合计 ${formatMoney(totalAmount)}`,
    ...shownSuccess.map(item => `· ${clip(item.username, 40)} ${clip(item.instanceName, 60)} ${formatMoney(item.amount)}`),
    input.successes.length > shownSuccess.length ? `…共 ${input.successes.length} 台成功` : null,
    `失败 ${input.failures.length} 台`,
    ...shownFailure.map(item => `· ${clip(item.username, 40)} ${clip(item.instanceName, 60)}：${clip(item.reason, 80)}`),
    input.failures.length > shownFailure.length ? `…共 ${input.failures.length} 台失败` : null,
    `时间：${formatTime()}（整点自动续费任务）`
  ]
  await dispatch('payment', '🔁 自动续费汇总', lines)
}

// ==================== 宿主机 ====================

export async function notifyAdminHostOffline(input: {
  hostName: string
  ownerLabel: string
  lastSeenAt: Date | null
  instanceCount: number
}): Promise<void> {
  const minutesAgo = input.lastSeenAt
    ? Math.max(1, Math.round((Date.now() - input.lastSeenAt.getTime()) / 60000))
    : null
  await dispatch('host', '🔴 节点离线告警', [
    `节点：${clip(input.hostName, 80)}（${input.ownerLabel}）`,
    input.lastSeenAt ? `最后心跳：${formatTime(input.lastSeenAt)}（约 ${minutesAgo} 分钟前）` : '最后心跳：从未上报',
    `节点实例：${input.instanceCount} 台`,
    `时间：${formatTime()}`
  ])
}

export async function notifyAdminHostRecovered(input: {
  hostName: string
  ownerLabel: string
  downSince: Date | null
  instanceCount: number
}): Promise<void> {
  const downMinutes = input.downSince
    ? Math.max(1, Math.round((Date.now() - input.downSince.getTime()) / 60000))
    : null
  await dispatch('host', '🟢 节点已恢复', [
    `节点：${clip(input.hostName, 80)}（${input.ownerLabel}）`,
    downMinutes !== null ? `掉线时长：约 ${downMinutes} 分钟` : null,
    `节点实例：${input.instanceCount} 台`,
    `时间：${formatTime()}`
  ])
}

// ==================== 实例创建 ====================

export async function notifyAdminInstanceCreated(input: {
  userId: number
  instanceId: number
  hostId: number
  image: string
  cpu: number
  memory: number
  disk: number
  networkMode: string
  ipv4?: string | null
  ipv6?: string | null
  sshPort?: number | null
  dedicatedReady: boolean
}): Promise<void> {
  const user = await loadUser(input.userId)
  const instance = await prisma.instance.findUnique({
    where: { id: input.instanceId },
    select: {
      name: true,
      billingCycle: true,
      billingPrice: true,
      expiresAt: true,
      packagePlan: { select: { name: true } }
    }
  }).catch(() => null)
  const host = await prisma.host.findUnique({
    where: { id: input.hostId },
    select: {
      name: true,
      location: true,
      natPublicIp: true,
      user: { select: { username: true, role: true } }
    }
  }).catch(() => null)

  const addressParts: string[] = []
  if (input.dedicatedReady) {
    addressParts.push(`${host?.natPublicIp || '独立 IPv4'}(独立 IPv4)`)
  } else if (host?.natPublicIp) {
    addressParts.push(input.sshPort ? `公网 ${host.natPublicIp}，SSH 端口 ${input.sshPort}` : `公网 ${host.natPublicIp}`)
  } else if (input.ipv4) {
    addressParts.push(input.sshPort ? `内网 ${input.ipv4}，SSH 端口 ${input.sshPort}` : `内网 ${input.ipv4}`)
  }
  if (input.ipv6) addressParts.push(`IPv6 ${input.ipv6}`)
  const ipLine = addressParts.length > 0 ? addressParts.join(' ｜ ') : '待分配'

  const billing = instance?.packagePlan?.name
    ? `${clip(instance.packagePlan.name, 80)} ｜ ${formatMoney(Number(instance.billingPrice || 0))}/${instance.billingCycle || 1} 个月${instance.expiresAt ? ` ｜ 到期 ${formatTime(instance.expiresAt)}` : ''}`
    : '免费实例'

  await dispatch('instance', '🖥️ 实例开通成功', [
    `用户：${userLine(user, `用户 #${input.userId}`)}`,
    `实例：${clip(instance?.name || `#${input.instanceId}`, 80)}（#${input.instanceId}）`,
    `节点：${clip(host?.name || `节点 #${input.hostId}`, 80)}（${ownerLabelOf(host?.user)}）${host?.location ? ` ｜ ${clip(host.location, 40)}` : ''}`,
    `镜像：${clip(input.image, 80)}`,
    `配置：${input.cpu}% CPU ｜ ${formatSize(input.memory)} 内存 ｜ ${formatSize(input.disk)} 磁盘`,
    `网络：${input.networkMode} ｜ ${ipLine}`,
    `计费：${billing}`,
    `时间：${formatTime()}`
  ])
}

export async function notifyAdminInstanceCreateFailed(input: {
  userId: number
  instanceId: number
  errorMessage: string
  refundStatus: string
  refundAmount: number
  refundReason?: string | null
  refundError?: string | null
}): Promise<void> {
  const user = await loadUser(input.userId)
  const instance = await prisma.instance.findUnique({
    where: { id: input.instanceId },
    select: { name: true, host: { select: { name: true } } }
  }).catch(() => null)

  let refundLine: string
  switch (input.refundStatus) {
    case 'refunded':
      refundLine = `已自动退款 ${formatMoney(input.refundAmount)}`
      break
    case 'not_required':
      refundLine = '未扣款，无需退款'
      break
    case 'already_refunded':
      refundLine = '此前已退款（重复失败处理）'
      break
    case 'failed':
      refundLine = `退款失败：${clip(input.refundError || '未知错误', 120)}`
      break
    default:
      refundLine = `未完成，需人工核对（${clip(input.refundReason || input.refundStatus, 80)}）`
      break
  }

  await dispatch('instance', '🖥️ 实例开通失败', [
    `用户：${userLine(user, `用户 #${input.userId}`)}`,
    `实例：${clip(instance?.name || `#${input.instanceId}`, 80)}（#${input.instanceId}）`,
    instance?.host?.name ? `节点：${clip(instance.host.name, 80)}` : null,
    `原因：${clip(input.errorMessage, 300)}`,
    `退款：${refundLine}`,
    `时间：${formatTime()}`
  ])
}
