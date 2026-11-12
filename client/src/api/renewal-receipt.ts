export function isRenewalMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 2400000 &&
    Math.abs(value * 100 - Math.round(value * 100)) < 1e-7
}
function instant(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.toISOString() === value
}
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

/** A malformed HTTP 200 is still an unknown financial result. Keep its key. */
export function assertRenewalReceipt(url: string, body: Record<string, unknown>, value: unknown): void {
  const receipt = record(value)
  let valid = true
  if (/\/instances\/[1-9]\d*\/renew$/.test(url)) {
    valid = !!receipt && isRenewalMoney(receipt.amount) && receipt.months === body.months && instant(receipt.newExpiresAt)
  } else if (url.endsWith('/instances/batch/renew')) {
    const targets = body.instanceIds
    const rows = receipt?.results
    valid = Array.isArray(targets) && Array.isArray(rows) && rows.length === targets.length &&
      new Set(rows.map(row => record(row)?.id)).size === rows.length && rows.every(row => {
        const item = record(row)
        return !!item && targets.includes(item.id) && typeof item.success === 'boolean' && typeof item.name === 'string' &&
          (item.success ? isRenewalMoney(item.amount) && instant(item.newExpiresAt) :
            (item.skipped === undefined || typeof item.skipped === 'boolean') && typeof item.reason === 'string')
      }) && receipt?.successCount === rows.filter(row => row.success).length &&
      receipt?.skippedCount === rows.filter(row => !row.success && row.skipped).length &&
      receipt?.failedCount === rows.filter(row => !row.success && !row.skipped).length
  }
  if (!valid) throw new Error('续费结果暂无法确认，请重新打开窗口核对')
}
