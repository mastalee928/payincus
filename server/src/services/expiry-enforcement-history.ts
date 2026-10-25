import { prisma } from '../db/prisma.js'
import { redactAuditText } from '../lib/risk-audit.js'
import { EXPIRY_LOG_RETENTION_DAYS, expiryHistoryWhere, parseExpiryRunRecord, type ExpiryHistoryQuery, type ExpiryRunRecord } from '../lib/expiry-enforcement-history.js'

export async function writeExpiryRunRecord(record: ExpiryRunRecord) {
  await prisma.log.create({ data: { userId: null, module: 'system',
    action: record.finishedAt ? 'system.expiry_enforcement' : 'system.expiry_enforcement_started',
    content: JSON.stringify(record), result: record.finishedAt ? (record.failureCount ? 'failed' : 'success') : 'warning' } })
}
export async function latestExpiryRunRecord() {
  const rows = await prisma.log.findMany({ where: { module: 'system', action: { in: ['system.expiry_enforcement', 'system.expiry_enforcement_started'] },
    createdAt: { gte: new Date(Date.now() - EXPIRY_LOG_RETENTION_DAYS * 86400000) } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { content: true }, take: 20 })
  for (const row of rows) { const record = parseExpiryRunRecord(row.content); if (record) return record }
  return null
}
export async function getExpiryEnforcementHistory(query: ExpiryHistoryQuery = {}) {
  const where = expiryHistoryWhere(query)
  const pageSize = Math.min(Math.max(query.pageSize || 20, 1), 50)
  const total = await prisma.log.count({ where }), totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(query.page || 1, 1), totalPages)
  const rows = await prisma.log.findMany({ where, skip: (page - 1) * pageSize, take: pageSize,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, action: true, content: true, result: true, createdAt: true,
      user: { select: { username: true, email: true } } } })
  return { items: rows.map(row => ({ id: row.id, action: row.action,
    content: row.action.startsWith('system.expiry_enforcement') ? '' : redactAuditText(row.content), result: row.result,
    createdAt: row.createdAt.toISOString(), username: row.user?.username || null, email: row.user?.email || null,
    run: row.action.startsWith('system.expiry_enforcement') ? parseExpiryRunRecord(row.content) : null })),
    total, page, pageSize, totalPages, retentionDays: EXPIRY_LOG_RETENTION_DAYS }
}
