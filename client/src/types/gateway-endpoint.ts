export interface StableGatewayEndpoint { hostname: string; port: number }
export interface GatewayEndpointStatus {
  endpoint: StableGatewayEndpoint | null
  effectiveEndpoint: string | null
  existingHostsNeedUpdate: boolean
}
export interface GatewayDnsHost {
  id: string; name: string; managementIp: string | null; eligible: boolean; running: boolean
  installed: boolean; endpoint: string | null; error: string | null; updatedAt: string | null
}
