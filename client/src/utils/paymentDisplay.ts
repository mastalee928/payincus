/** Customer labels describe how to pay; merchant channel names stay in admin. */
export function paymentDisplayName(method: string | null | undefined, providerName: string | null | undefined, translate: (key: string) => string): string {
  if (method === 'balance') return translate('cart.balance')
  if (method && ['alipay','wxpay','qqpay','bank','jdpay'].includes(method)) return translate(`wallet.paymentMethods.${method}`)
  return providerName || method || '—'
}
