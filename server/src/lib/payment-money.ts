import { Prisma } from '@prisma/client'

/** Gateway amounts may be decimal strings; never accept parseFloat prefixes. */
export function parsePositivePaymentMoney(value: unknown): number | undefined {
  if (typeof value === 'string') {
    const text = value.trim()
    if (text.length > 128 || !/^\d+(?:\.\d+)?$/.test(text)) return undefined
    value = Number(text)
  }
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}
/** Preserve the existing one-cent tolerance without binary floating-point edges. */
export function isPaymentAmountWithinTolerance(paid: number, expected: number, allowOverpayment = false): boolean {
  if (!Number.isFinite(paid) || paid <= 0 || !Number.isFinite(expected) || expected <= 0) return false
  const difference = new Prisma.Decimal(paid).minus(expected)
  return allowOverpayment ? difference.gte('-0.01') : difference.abs().lte('0.01')
}
