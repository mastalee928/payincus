export interface OssConfig {
  revision: string; installationId: string; enabled: boolean; region: string; bucket: string; prefix: string
  accessKeyId: string; hasAccessKeySecret: boolean; hasBackupPassword: boolean; intervalHours: number; retention: number
  nextRunAt: string | null; testedRevision: string | null
}
export interface AutomaticRestore {
  id:string;phase:'preview'|'restore'|'verification'|'complete'|'blocked';taskId:string
  attempts:number;nextAt:string;updatedAt:string;code:string|null
}
export interface OssTask {
  id: string; kind: 'backup' | 'preview' | 'restore' | 'resume' | 'rollback' | 'gateway-map' | 'gateway-helper'; status: 'pending' | 'running' | 'success' | 'failed' | 'warning'
  createdAt: string; updatedAt: string; stage: string; error?: string; bytes?: number; objectPrefix?: string
  preview?: { version: string; createdAt: string; files: number; expiresAt: string }
  continuation?: {status:'retry'|'blocked'|'complete';attempts:number;nextAt:string|null}
}
export interface OssBackup { id: string; installationId: string; prefix: string; createdAt: string; version: string; bytes: number; sha256: string }
export interface OssDirectory {
  directories: string[]; objects: Array<{ name: string; size: number; lastModified: string }>; nextCursor: string | null
}
export type RecoveryReviewSection = 'balances' | 'instances' | 'recharges' | 'balanceLogs' | 'poolOrders' | 'checkoutOrders' | 'checkoutReceipts' | 'checkoutRefunds'
export interface RecoveryReviewRow {
  recovery?:{status:string|null;code:string|null;nextAt:string|null}|null
  id: number | string; userId?: number; username?: string; balance?: string; name?: string; hostId?: number
  expiresAt?: string | null; billingPrice?: string | null; autoRenew?: boolean; version?: number; status?: string
  deletionBillingPending?: boolean; amount?: string; orderNo?: string; type?: string; balanceBefore?: string
  balanceAfter?: string; instanceId?: number | null; orderId?: number | null; createdAt?: string
  latestBalanceLogId?: number | null
}
export interface RecoveryReviewReport {
  hold: { taskId: string; batchId?: string; createdAt: string; mode: 'restore' | 'rollback'; snapshot: { createdAt: string; version: string } | null }
  checkedAt: string; snapshotOnly: boolean; reconciliationCount: number
  summary: { users: number; instances: number; recharges: number; balanceLogs: number; poolOrders: number; balance: string }
  hosts: Array<{ id: number; name: string; status: string; poolFaulted: boolean; managementSshHost: string | null; managementSshPort: number | null }>
  hostPage: number; hostPageSize: number; hostTotal: number; hostResults: Array<{ hostId: number; status: string; attempts: number; nextAttemptAt: string; result: RecoveryHostProbe | null }>;
  hostsTruncated: boolean; section: RecoveryReviewSection; page: number; pageSize: number; total: number; rows: RecoveryReviewRow[]
}
export interface RecoveryHostProbe {
  networkPreservation?: {instanceId:number;configurationVerified:true;connectivityVerified:false}
  hostId: number; checkedAt: string; managementVerified: boolean; code: string | null
  inventory?: { expectedCount: number; actualCount: number; missing: string[]; unexpected: string[]; conflicts?: Array<{name:string;reason:string}>; inventoryMatched: boolean }
  automation?: {mode:string;nextAction:string;attempt:number}
}
export interface RecoveryCorrectionAccount {
  hold: RecoveryReviewReport['hold']; checkedAt: string; requiresMfa: boolean
  account: { id: number; username: string; balance: string; latestBalanceLogId: number | null }
  instances: Array<{ id: number; name: string; status: string; expiresAt: string | null; version: number; billingPrice: string | null; eligible: boolean; latestBillingRecordId: number | null }>
  recharges: Array<{ id: number; orderNo: string; amount: string; status: 'pending' | 'paid' | 'cancelled' }>
  instancesTruncated: boolean; rechargesTruncated: boolean
}
export interface RecoveryRenewalEvidence { reference: string; amount: string; months: number; periodStart: string; periodEnd: string; completedAt: string }
export interface RecoveryCorrection {
  id: string; holdTaskId: string; userId: number; reference: string; observedAt: string
  expectedBalance: string; targetBalance: string; expectedLatestLogId: number | null
  instances: Array<{ id: number; expectedVersion: number; expectedExpiresAt: string; targetExpiresAt: string; expectedLatestBillingRecordId?: number | null; renewals?: RecoveryRenewalEvidence[] }>
  recharges: Array<{ id: number; orderNo: string; expectedStatus: 'pending' | 'paid' | 'cancelled'; expectedAmount: string; settlement?: { creditedAmount: string; completedAt: string; tradeNo?: string } }>
}
export interface RecoveryCorrectionResponse {
  id: string; createdAt: string; replayed: boolean
  result: { userId: number; balanceBefore: string; balanceAfter: string; balanceLogIds: number[];
    instances: Array<{ id: number; expiresAt: string; version: number }>; completedRecharges: number[]; recoveryHeld: true;
    restoredRenewals?: Array<{ reference: string; instanceId: number; billingRecordId: number; balanceLogId: number }> }
}
export interface RecoveryReconciliationHistory {
  holdTaskId: string; total: number; page: number; pageSize: number
  rows: Array<{ id: string; actorId: number; userId: number; reference: string; observedAt: string; createdAt: string; result: RecoveryCorrectionResponse['result'] }>
}

export interface RecoveryReadiness {
  checkoutPending?:number
  checkoutOrders?:Array<{id:string;code:string|null;status:string|null;nextAt:string|null;checkedAt:string|null}>
  legacyPending?:number
  legacyOrders?:Array<{id:string;code:string|null;nextAt:string|null}>
  batchId: string; revision: number; mode: string; ready: boolean
  hosts: { total: string; passed: string; pending: string }
  categories: Array<{ category: 'finance' | 'access' | 'tasks' | 'gateway'; sourceHash: string; verified: boolean;code?:string|null;basis?:'snapshot' }>
  automation?:Array<{category:string;status:string;code:string|null;attempt:number;nextAt:string;checkedAt:string;reference?:string;hostId?:number;nextAction?:string}>
  deliveryPending?:number
  deliveryOrders?:Array<{instanceId:number;hostId:number;name:string;step:string|null;status:string|null;code:string|null;nextAt:string|null}>
}
export interface RecoveryAccessPage {
  batchId: string; page: number; total: number
  rows: Array<{ id: number; username: string; role: 'admin' | 'user'; status: 'active' | 'banned'; sourceHash: string; reviewed: boolean }>
}
export interface RecoveryOrderReview {
  missingBillingLinks?:Array<{id:number;instanceId:number;userId:number;type:string;amount:string}>
  quantity: number | null
  id: string; userId: number; status: string; amountCents: number; sourceHash: string
  paymentKind: 'balance' | 'external'; balance: string | null
  walletAccounts: Array<{userId:number;balance:string}>
  receipts: Array<{ id: string; tradeNo: string; amountCents: number }>
  refunds: Array<{ id: string; receiptId: string; amountCents: number; status: string }>
  partialAvailable: boolean
  deliveryComplete?: boolean
  partialUnavailableCode: string | null
  partialRefunds: Array<{ id: string; receiptId: string; amountCents: number; status: string }>
  instances: Array<{ id: number; name: string; hostId: number; status: string }>
}
