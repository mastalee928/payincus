export interface LatePayment {
  id: number; orderNo: string; tradeNo: string; gatewayOrderNo: string; username: string; provider: string
  receivedAmount: string | null; currency: string | null; creditAmount: number; reason: string; status: string
  orderStatus: string; createdAt: string; note: string | null; handledAt: string | null; canCredit: boolean
}
