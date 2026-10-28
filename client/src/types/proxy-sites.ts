export interface ProxySiteOperationRequest {
  requestId: string
  expectedRevision: number
}

export interface ProxySiteView {
  id: number
  siteKey: string
  revision: number
  appliedRevision: number
  domain: string
  targetPort: number
  httpsEnabled: boolean
  remark: string | null
  status: 'pending' | 'active' | 'error'
  enabled: boolean
  error: string | null
  createdAt: string
  syncPending: boolean
  operationId: string | null
  operationAction: 'upsert' | 'disable' | 'delete' | null
  operationState: 'pending' | 'applying' | 'retry' | 'blocked' | 'succeeded' | 'superseded' | null
  nextRetryAt: string | null
}

export interface ProxySiteMutationResult {
  pending?: boolean
  message?: string
  error?: string
  operationId?: string
  operationState?: ProxySiteView['operationState']
  site?: ProxySiteView
  enabled?: boolean
  status?: string
}

export interface ProxySiteDnsResult extends ProxySiteMutationResult {
  dnsResolved: boolean
  ipMatches?: boolean
  expectedIp: string
  resolvedIps: string[]
  activated?: boolean
}
