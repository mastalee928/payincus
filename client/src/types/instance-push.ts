export interface AdminInstancePushTarget {
  id: number
  username: string
  status: string
}

export interface AdminInstancePushPreview {
  instance: { id: number; name: string; status: string; dedicatedIpv4: boolean; ip: string | null; billingPrice: number | null; expiresAt: string | null }
  owner: { id: number; username: string; balance: number }
  fee: number
  pending: { id: number; status: string; toUser: { id: number; username: string } } | null
  canCreate: boolean
  reason: string | null
}
