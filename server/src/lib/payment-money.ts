/** Gateway amounts may be decimal strings; never accept parseFloat prefixes. */
export function parsePositivePaymentMoney(value: unknown): number | undefined {
  if (typeof value === 'string') {
    const text = value.trim()
    if (text.length > 128 || !/^\d+(?:\.\d+)?$/.test(text)) return undefined
    value = Number(text)
  }
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}
