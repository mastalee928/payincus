import { arbitrateVipPrice } from '../services/vip-benefits.js'

/** A per-instance final price takes precedence over every recurring discount. */
export function decideRenewalPrice(input: Parameters<typeof arbitrateVipPrice>[0], finalPrice?: unknown) {
  return arbitrateVipPrice(finalPrice !== null && finalPrice !== undefined
    ? { basePrice: input.basePrice }
    : input)
}
