import type { PoolCheckoutResult } from './host-pool'
export interface CheckoutPayment {
  id: string; providerId: number; providerName: string; method: string; payableCents: number; feeCents: number
  payUrl: string | null; status: string
}
export interface CheckoutOrder {
  id: string; source: 'direct' | 'cart'; status: string; totalCents: number; expiresAt: string; paidAt: string | null
  paymentId: string | null; error: string | null; payments: CheckoutPayment[]
  items: Array<{ namePrefix: string; quantity: number; image: string; resourcePreset: string; memoryMiB: number; diskGiB: number; monthlyPrice: number; setupFee: number; cpu?: number; regionName?: string; countryCode?: string }>
  refunds: Array<{ id: string; amountCents: number; status: string; reason: string; instanceId: number | null }>
  result: PoolCheckoutResult | null
}
