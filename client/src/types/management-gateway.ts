export interface GatewayInspection {
  machineId: string; osId: string; architecture: string; memoryMiB: number; diskAvailableMiB: number
  blockers: string[]; inspectedAt: number; observedStateHash: string
  facts: { interface: { exists: boolean; owned: boolean; addressMatches: boolean };
    routeConflicts: Array<{ network: string; interface: string }>; portConflicts: Array<{ protocol: string; port: number }> }
}
export interface GatewayInspectionConfiguration { slot: 'a' | 'b'; network: string; address: string; listenPort: number; consolePort: number }
export interface GatewayInspectionInput {
  requestId: string; gatewayId: string; name: string; mode: 'local' | 'remote' | 'existing'
  target: null | { address: string; port: number; fingerprint: string }
  configuration: GatewayInspectionConfiguration
  credentials?: { password?: string; privateKey?: string }
}
export interface GatewayManagementTask {
  id: string; gatewayId: string; kind: string; status: string; errorCode: string | null; createdAt: string
  inspection: null | { request: GatewayInspectionConfiguration; report: GatewayInspection }
  steps: Array<{ key: string; ordinal: number; status: string }>
}
export interface ManagementGateway {
  id: string; name: string; mode: 'local' | 'remote' | 'existing'; revision: string; retiredAt: string | null
  target: { machineId: string; ssh: null | { address: string; port: number; fingerprint: string } }
  tasks: GatewayManagementTask[]
}
export interface GatewayManagementList { configured: true; platformId: string; gateways: ManagementGateway[] }
export interface GatewayInspectionResult { task: GatewayManagementTask; report: GatewayInspection | null; canWrite: false; duplicate: boolean }
