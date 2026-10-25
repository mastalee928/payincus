import type { Prisma } from '@prisma/client'

export const EXPIRY_LOG_RETENTION_DAYS = 90
export const EXPIRY_HISTORY_ACTIONS = ['system.expiry_enforcement_started', 'system.expiry_enforcement',
  'instance.auto_renew', 'instance.auto_renew_failed', 'instance.suspended_expired',
  'instance.deleted_expired', 'instance.expiry_stop_reconciled'] as const
const renewalActions = ['instance.auto_renew', 'instance.auto_renew_failed']
const runActions = ['system.expiry_enforcement_started', 'system.expiry_enforcement']
export interface ExpiryHistoryQuery {
  page?: number; pageSize?: number; startDate?: string; endDate?: string
  username?: string; email?: string; search?: string
}
export class ExpiryHistoryFilterError extends Error {}
export function expiryHistoryWhere(input: ExpiryHistoryQuery, now = Date.now()): Prisma.LogWhereInput {
  const date = (value?: string) => {
    if (!value) return undefined
    const parsed = new Date(value)
    if (!Number.isFinite(parsed.getTime())) throw new ExpiryHistoryFilterError('EXPIRY_LOG_FILTER_INVALID')
    return parsed
  }
  const start = date(input.startDate), end = date(input.endDate)
  if (start && end && start > end) throw new ExpiryHistoryFilterError('EXPIRY_LOG_RANGE_INVALID')
  const conditions: Prisma.LogWhereInput[] = [{ OR: [{ module: 'system', action: { in: runActions } },
    { module: 'instance', action: { in: EXPIRY_HISTORY_ACTIONS.filter(action => action.startsWith('instance.')) } }] },
    { createdAt: { gte: new Date(Math.max(now - EXPIRY_LOG_RETENTION_DAYS * 86400000, start?.getTime() || 0)), ...(end ? { lte: end } : {}) } }]
  if (input.username?.trim() || input.email?.trim()) conditions.push({ user: { is: {
    ...(input.username?.trim() ? { username: { contains: input.username.trim(), mode: 'insensitive' as const } } : {}),
    ...(input.email?.trim() ? { email: { contains: input.email.trim(), mode: 'insensitive' as const } } : {})
  } } })
  const terms = (input.search || '').trim().split(/\s+/u).filter(Boolean)
  if (terms.length > 16) throw new ExpiryHistoryFilterError('EXPIRY_LOG_FILTER_INVALID')
  for (const original of terms) {
    const term = original.toLowerCase().replaceAll('續費', '续费').replaceAll('失敗', '失败').replaceAll('巡檢', '巡检')
    const composite = /^(?:自动|自動|补|補)?(续费|巡检)(成功|失败)$/.exec(term)
    if (composite) { conditions.push({ action: { in: composite[1] === '续费' ? renewalActions : runActions } }, { result: composite[2] === '成功' ? 'success' : 'failed' }); continue }
    if (['成功', 'success'].includes(term)) conditions.push({ result: 'success' })
    else if (['失败', 'failed', 'failure'].includes(term)) conditions.push({ OR: [{ result: 'failed' }, { result: 'warning', action: { not: 'system.expiry_enforcement_started' } }] })
    else if (['警告', 'warning', '待核验', '待核驗'].includes(term)) conditions.push({ result: 'warning' })
    else if (['续费', '自动续费', '自動续费', '补续费', '補续费', 'renew', 'renewal'].includes(term)) conditions.push({ action: { in: renewalActions } })
    else if (['巡检', 'patrol', 'inspection'].includes(term)) conditions.push({ action: { in: runActions } })
    else if (['开始', '已开始', '开始巡检'].includes(term)) conditions.push({ action: 'system.expiry_enforcement_started' })
    else if (['余额不足', '餘額不足'].includes(term)) conditions.push({ OR: [{ content: { contains: '余额不足' } }, { content: { contains: 'insufficient balance', mode: 'insensitive' } }] })
    else if (['封停', '到期封停', '停机', '停機'].includes(term)) conditions.push({ action: { in: ['instance.suspended_expired', 'instance.expiry_stop_reconciled'] } })
    else if (['删除', '刪除', '到期删除', '到期刪除'].includes(term)) conditions.push({ action: 'instance.deleted_expired' })
    else conditions.push({ content: { contains: original, mode: 'insensitive' } })
  }
  return { AND: conditions }
}
export interface ExpiryRunRecord {
  schemaVersion: 1; runId: string; startedAt: string; finishedAt: string | null
  failureCount: number; lastError: string | null
}
export function parseExpiryRunRecord(content: string): ExpiryRunRecord | null {
  try {
    const value = JSON.parse(content) as ExpiryRunRecord
    if (!value || Object.keys(value).length !== 6 || value.schemaVersion !== 1 || typeof value.runId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.runId) ||
      typeof value.startedAt !== 'string' || !Number.isFinite(Date.parse(value.startedAt)) ||
      (value.finishedAt !== null && (typeof value.finishedAt !== 'string' || !Number.isFinite(Date.parse(value.finishedAt)))) ||
      !Number.isSafeInteger(value.failureCount) || value.failureCount < 0 || value.failureCount > 1000000 ||
      (value.lastError !== null && (typeof value.lastError !== 'string' || !/^EXPIRY_[A-Z_]{1,80}$/.test(value.lastError)))) return null
    return value
  } catch { return null }
}
