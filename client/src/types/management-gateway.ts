export interface GatewayInspection {
  machineId: string; osId: string; architecture: string; memoryMiB: number; diskAvailableMiB: number
  blockers: string[]; inspectedAt: number; observedStateHash: string
  facts: { interface: { exists: boolean; owned: boolean; addressMatches: boolean };
    routeConflicts: Array<{ network: string; interface: string }>; portConflicts: Array<{ protocol: string; port: number }> }
}
export interface GatewayInspectionConfiguration { slot: 'a' | 'b'; network: string; address: string; listenPort: number; consolePort: number }
export interface GatewayInspectionInput {
  requestId: string; gatewayId: string; name: string; mode: 'local' | 'remote' | 'existing'
  target: null | { address: string; port: number; fingerprint?: string }
  configuration: GatewayInspectionConfiguration
  credentials?: { password?: string; privateKey?: string }
}
export interface GatewayManagementTask {
  id: string; gatewayId: string; kind: string; status: string; errorCode: string | null; createdAt: string
  inspection: null | { request: GatewayInspectionConfiguration; report: GatewayInspection }
  steps: Array<{ key: string; ordinal: number; status: string }>
  planHash: string; preparationState: 'queued' | 'running' | 'ready' | 'failed' | null
  installationPreview: GatewayInstallationPreview | null; installationReceipt: GatewayInstallationReceipt | null
  bootstrapExpiresAt: string | null; approvedAt: string | null; approvalExpiresAt: string | null
  updatedAt: string; startedAt: string | null; completedAt: string | null
}
export interface ManagementGateway {
  id: string; name: string; mode: 'local' | 'remote' | 'existing'; revision: string; retiredAt: string | null
  target: { machineId: string; ssh: null | { address: string; port: number; fingerprint: string } }
  tasks: GatewayManagementTask[]
}
export interface RemoteGatewayPreparation {
  retryable?: boolean
  requestId: string; gatewayId: string; actorId: number; name: string; purpose: 'independent' | 'backup'; address: string; hostname: string
  state: 'running' | 'failed' | 'succeeded'; step: string; code: string | null; updatedAt: string
}
export interface GatewayManagementList { configured: true; platformId: string; gateways: ManagementGateway[]; preparations?: RemoteGatewayPreparation[] }
export interface GatewayInspectionResult { task: GatewayManagementTask; report: GatewayInspection | null; canWrite: false; duplicate: boolean }
export interface GatewayInstallationConfiguration extends GatewayInspectionConfiguration { consoleOrigin: string }
export interface GatewayInstallationInput {
  requestId: string; gatewayId: string; configuration: GatewayInstallationConfiguration
  credentials?: { password?: string; privateKey?: string }
}
export interface GatewayInstallationPreview {
  schemaVersion: 1; planHash: string; expiresAt: number
  package: { verified: true; architecture: 'amd64' | 'arm64'; version: string; sourceCommit: string; files: number; manifestHash: string; canWrite: false }
  target: { machineId: string; osId: string; architecture: 'amd64' | 'arm64' }
  configuration: GatewayInstallationConfiguration
  transport: { epoch: string; sequence: string; mtu: number; peerCount: number }
  changes: { packageDirectory: string; stateDirectory: string; services: string[]; interface: string; newIndependentIdentity: true
    consoleCertificate: 'independently-pinned'; businessBackendRestart: false; consoleListenAddress: '0.0.0.0'; existingFilesOverwritten: false; customerRoutesChanged: false }
  blockers: string[]; installable: boolean; canWrite: false
}
export interface GatewayInstallationReceipt {
  schemaVersion: 1; taskId: string; planHash: string; gatewayId: string; publicKey: string; consoleCertificateSha256: string
  installed: true; transportReady: true; canWrite: false; bootstrapAvailable: true; blockers: string[]
}
export interface GatewayInstallationConfirmation { planHash: string; confirmation: string; password: string; totpCode?: string }
export interface GatewayBootstrapAuthorization { password: string; totpCode?: string }
export interface GatewayBootstrapMaterial { username: string; password: string; role: 'operator'; totpSeed: string; recoveryCodes: string[] }
export interface RemoteGatewaySetupInput {
  requestId: string; gatewayId: string; name: string; purpose: 'independent' | 'backup'; address: string; hostname: string; credentials: { password: string }
}
