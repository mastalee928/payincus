/** Only retry an aborted transaction. Never wrap remote effects in this helper. */
export function isTransactionConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: string; meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } }; cause?: unknown }
  return value.code === 'P2034' || value.code === '40001' || value.code === '40P01' ||
    value.meta?.code === '40001' || value.meta?.code === '40P01' ||
    ['40001', '40P01'].includes(value.meta?.driverAdapterError?.cause?.originalCode || '')
}
