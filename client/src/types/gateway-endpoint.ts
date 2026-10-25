export interface StableGatewayEndpoint { hostname: string; port: number }
export interface GatewayEndpointStatus {
  endpoint: StableGatewayEndpoint | null
  effectiveEndpoint: string | null
  existingHostsNeedUpdate: boolean
}
export interface GatewayDnsHost {
  id: string; name: string; managementIp: string | null; eligible: boolean; running: boolean
  installed: boolean; endpoint: string | null; error: string | null; updatedAt: string | null
  state?: string; step?: string; attempt?: number
}
export interface GatewaySetupProgress {
  id: string; actorId: number; state: string; step: string; errorCode: string | null; updatedAt: string; hostCapacity?: number
  plan?: { planHash: string; expiresAt: number; sshAddress: string; hostCapacity: number; existingWireGuard: boolean; identitiesPreserved: true; backendRestart: true }
}
