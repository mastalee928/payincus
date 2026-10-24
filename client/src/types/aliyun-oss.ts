export interface OssConfig {
  revision: string; installationId: string; enabled: boolean; region: string; bucket: string; prefix: string
  accessKeyId: string; hasAccessKeySecret: boolean; hasBackupPassword: boolean; intervalHours: number; retention: number
  nextRunAt: string | null; testedRevision: string | null
}
export interface OssTask {
  id: string; kind: 'backup' | 'preview' | 'restore' | 'resume' | 'rollback'; status: 'pending' | 'running' | 'success' | 'failed' | 'warning'
  createdAt: string; updatedAt: string; stage: string; error?: string; bytes?: number; objectPrefix?: string
  preview?: { version: string; createdAt: string; files: number; expiresAt: string }
}
export interface OssBackup { id: string; installationId: string; prefix: string; createdAt: string; version: string; bytes: number; sha256: string }
export interface OssDirectory {
  directories: string[]; objects: Array<{ name: string; size: number; lastModified: string }>; nextCursor: string | null
}
export type RecoveryReviewSection = 'balances' | 'instances' | 'recharges' | 'balanceLogs' | 'poolOrders'
export interface RecoveryReviewRow {
  id: number | string; userId?: number; username?: string; balance?: string; name?: string; hostId?: number
  expiresAt?: string | null; billingPrice?: string | null; autoRenew?: boolean; version?: number; status?: string
  deletionBillingPending?: boolean; amount?: string; orderNo?: string; type?: string; balanceBefore?: string
  balanceAfter?: string; instanceId?: number | null; orderId?: number | null; createdAt?: string
  latestBalanceLogId?: number | null
}
export interface RecoveryReviewReport {
  hold: { taskId: string; createdAt: string; mode: 'restore' | 'rollback'; snapshot: { createdAt: string; version: string } | null }
  checkedAt: string; snapshotOnly: boolean; reconciliationCount: number
  summary: { users: number; instances: number; recharges: number; balanceLogs: number; poolOrders: number; balance: string }
  hosts: Array<{ id: number; name: string; status: string; poolFaulted: boolean; managementSshHost: string | null; managementSshPort: number | null }>
  hostsTruncated: boolean; section: RecoveryReviewSection; page: number; pageSize: number; total: number; rows: RecoveryReviewRow[]
}
export interface RecoveryHostProbe {
  hostId: number; checkedAt: string; managementVerified: boolean; code: string | null
  inventory?: { expectedCount: number; actualCount: number; missing: string[]; unexpected: string[]; inventoryMatched: boolean }
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
