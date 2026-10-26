export interface OnboardingCredentials {
  password?: string
  privateKey?: string
}
export type ResourcePreset = 'E2' | 'ARM1C' | 'ARM2C' | 'ARM3C' | 'ARM4C'
export interface OnboardingResourceInput {
  resourcePreset?: ResourcePreset | null
  customerDiskGiB?: number
  machineGroupId?: number | null
  regionGroupId?: number | null
}
export interface ResolvedHostResources {
  version: 1
  detectedAt: string
  probe: { architecture: 'x86_64' | 'aarch64'; cpuCount: number; memoryMiB: number; diskTotalBytes: string; diskAvailableBytes: string; diskSwapMiB: number }
  resourcePreset: ResourcePreset | null
  cpuAllowanceMax: number
  memoryMax: number
  customerDiskGiB: number | null
  storageSize: number
  memoryReserveMiB: number
  diskReserveGiB: number
}
export interface OnboardingInputNode extends OnboardingCredentials, OnboardingResourceInput {
  name: string
  publicIp: string
  sshPort?: number
  sshFingerprint?: string
  machineGroup?: string
  regionGroup?: string
  countryCode?: string
}
export interface OnboardingDefaults extends OnboardingResourceInput {
  countryCode: string
  portProtocol?: 'tcp' | 'tcp_udp'
  machineGroup?: string
  regionGroup?: string
  storageSize?: number
  cpuAllowanceMax?: number
  memoryMax?: number
}
export interface CreateOnboardingRequest {
  requestId: string
  name: string
  accountLabel: string
  defaults: OnboardingDefaults
  credentials: OnboardingCredentials
  nodes: OnboardingTargetInput[]
}
export type OnboardingTargetInput = Omit<OnboardingInputNode, 'publicIp'> & (
  { publicIp: string; address?: never } | { address: string; publicIp?: never }
)
export type OnboardingStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export interface OnboardingNode {
  id: string
  name: string
  publicIp: string
  machineGroup: string | null
  regionGroup: string | null
  countryCode: string | null
  sshPort: number
  sshFingerprint: string | null
  managementIp: string | null
  machineGroupId: number | null
  regionGroupId: number | null
  resourcePreset: ResourcePreset | null
  customerDiskGiB: number | null
  resolvedResources: ResolvedHostResources | null
  hostId: number | null
  status: OnboardingStatus
  step: string
  errorCode: string | null
  attempt: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
  host: { status: string; isInstalled: boolean; architecture: string; agent: { lastSeenAt: string | null } | null } | null
}
export interface OnboardingBatch {
  id: string
  name: string
  accountLabel: string
  defaults: OnboardingDefaults
  createdAt: string
  nodes: OnboardingNode[]
}
export interface OnboardingListResponse {
  batches: OnboardingBatch[]
  total: number
  page: number
  pageSize: number
  gatewaySshHost: string | null
}
export interface OnboardingGatewayStatus {
  local?: boolean
  ready: boolean
  code?: string
  gateway?: { controlIp: string; network: string; sshHost: string }
}

export interface ManagedHost {
  publicIpSync?: HostPublicIpSync
  publicIpv6Sync?: HostPublicIpv6Sync
  poolFaulted?: boolean
  portProtocol?: { requested: "tcp" | "tcp_udp"; applied: "tcp" | "tcp_udp"; status: "pending" | "applied" | "failed" }
  id: number
  name: string
  accountLabel: string | null
  publicIp: string | null
  managementAddress: string
  countryCode: string
  machineGroup: string | null
  regionGroup: string | null
  architecture: string
  status: string
  isInstalled: boolean
  instanceCount: number
  agentLastSeenAt: string | null
  machineGroupId: number | null
  regionGroupId: number | null
  resourcePreset: ResourcePreset | null
  customerDiskGiB: number | null
  cpuAllowanceMax: number
  memoryMax: number
  storageSize: number
  resourceSnapshot: ResolvedHostResources | null
  singleTenant: boolean
  stock: 'available' | 'assigned' | 'unavailable'
  /** 不可售原因（可售时为 null）：assigned/no-spec/not-single-tenant/not-ready/no-price */
  sellReason?: string | null
  instances: Array<{ id: number; name: string; status: string; cpu: number; memory: number; disk: number; user: { id: number; username: string } }>
}
export interface HostPublicIpv6Sync {
  supported?: boolean
  addresses: string[]
  primary: string | null
  status: 'idle' | 'synced' | 'pending' | 'failed'
  checkedAt: string | null
  changedAt: string | null
  error: string | null
}
export interface HostRecoveryReport {
  mode?: 'empty' | 'preserve'
  hostId: number
  quarantined: boolean
  checkedAt: string
  blockers: string[]
  instances: Array<{ name: string; status: string; removable: boolean }>
  forwardCount: number
  needsCleanup: boolean
  canRecover: boolean
  confirmation: string
}
export interface HostStockCounts { total: number; available: number; assigned: number; unavailable: number }
export interface HostRegionGroup { id: number; machineGroupId: number; name: string; countryCode: string | null; counts?: HostStockCounts }
export interface HostMachineGroup { id: number; name: string; regions: HostRegionGroup[]; counts?: HostStockCounts }
export interface HostInventoryResponse {
  hosts: ManagedHost[]
  total: number
  page: number
  pageSize: number
  machineGroups: string[]
  regionGroups: string[]
  groups: HostMachineGroup[]
  summary: HostStockCounts
  ungrouped: HostStockCounts
  /** 真正可售台数（与客户公开目录同一套判据） */
  sellable: number
}
export interface HostInventoryQuery {
  page?: number
  search?: string
  machineGroup?: string
  regionGroup?: string
  machineGroupId?: number
  regionGroupId?: number
  stock?: ManagedHost['stock']
}
export interface UpdateHostGroupsRequest {
  hostIds: number[]
  machineGroup?: string | null
  regionGroup?: string | null
  machineGroupId?: number | null
  regionGroupId?: number | null
}

// ==================== 一机一卖：池子定价 ====================
// 池子 = 机型分组 + 核心数 + 地区 + 磁盘档；一行 = 一个可售商品，没有行 = 不卖。
// 价格单位是「分」，与后端 PackagePlan.price 一致。
export interface HostPoolPrice {
  id: number
  machineGroupId: number
  resourcePreset: ResourcePreset
  regionGroupId: number
  diskGiB: number
  name: string | null
  monthlyPrice: number
  setupFee: number
  active: boolean
  sortOrder: number
  regionGroup?: { id: number; name: string; countryCode: string | null }
  machineGroup?: { id: number; name: string }
}
export interface HostPoolPriceInput {
  machineGroupId: number
  resourcePreset: ResourcePreset
  regionGroupId: number
  diskGiB: number
  name?: string | null
  monthlyPrice: number
  setupFee: number
  active?: boolean
  sortOrder?: number
}
export interface HostPoolInventoryRow {
  machineGroupId: number
  resourcePreset: string | null
  regionGroupId: number | null
  diskGiB: number | null
  total: number
  idle: number
}
/** 没设规格的单租户机器：不属于任何池子，定价页要亮出来并就地补规格 */
export interface HostPoolUnspecifiedHost {
  id: number
  name: string
  architecture: string
  machineGroupId: number | null
  regionGroupId: number | null
  machineGroup: string | null
  regionGroup: string | null
}
export interface UpdateHostSpecRequest {
  hostIds: number[]
  resourcePreset: ResourcePreset
  customerDiskGiB: number
}


export interface HostSshConnection {
  host: string | null
  port: number | null
  username: string | null
  command: string | null
  gatewayCommand: string | null
  viaGateway: boolean
}

export interface PoolCheckoutResult {
  batchId: string
  total: number
  instances: Array<{ id: number; name: string; incusId: string; host: string | null; status: string; refunded: boolean; refundPending: boolean; publicIpUpdating?: boolean; sshPort: number | null; rootPassword: string | null; publicIpv6Addresses?: string[]; publicIpv6Status?: string }>
}

export interface HostPublicIpSettings {
  mode: 'auto' | 'manual'
  publicIp: string | null
  bindIp: string | null
  sshPort: number
}
export interface HostPublicIpSync {
  hostId: number
  supported: boolean
  currentIp: string | null
  currentBindIp: string | null
  blocked: boolean
  settings: HostPublicIpSettings
  status: 'idle' | 'synced' | 'pending' | 'failed'
  candidateIp: string | null
  candidateBindIp: string | null
  bindAddresses: string[]
  checkedAt: string | null
  changedAt: string | null
  previousIp: string | null
  error: string | null
}
