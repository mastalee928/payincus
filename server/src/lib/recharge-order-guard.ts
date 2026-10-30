export function normalizeRechargeGatewayOrderNo(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function isRechargeGatewayOrderNoMatch(expectedOrderNo: string, gatewayOrderNo: unknown): boolean {
  return normalizeRechargeGatewayOrderNo(gatewayOrderNo) === expectedOrderNo
}

export function resolveRechargeOrderNoFromGatewayOrderNo(gatewayOrderNo: string): string {
  return gatewayOrderNo.match(/^(.*)--PA-([A-F0-9]{12})$/)?.[1] || gatewayOrderNo
}

export function getCurrentRechargeGatewayOrderNo(paymentDetails: unknown, orderNo: string): string {
  if (!paymentDetails || typeof paymentDetails !== 'object' || Array.isArray(paymentDetails)) return orderNo
  const state = (paymentDetails as Record<string, unknown>).paymentAttempt
  if (!state || typeof state !== 'object' || Array.isArray(state)) return orderNo
  const current = (state as Record<string, unknown>).current
  if (!current || typeof current !== 'object' || Array.isArray(current)) return orderNo
  const attempt = current as Record<string, unknown>
  if (typeof attempt.id !== 'string' || typeof attempt.gatewayOrderNo !== 'string' || typeof attempt.createdAt !== 'string') return orderNo
  return attempt.gatewayOrderNo && resolveRechargeOrderNoFromGatewayOrderNo(attempt.gatewayOrderNo) === orderNo
    ? attempt.gatewayOrderNo : orderNo
}
