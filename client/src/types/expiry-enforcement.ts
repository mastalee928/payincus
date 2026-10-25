export interface ExpiryEnforcementStatus {
  enabled: boolean; running: boolean; intervalMinutes: number; retentionDays: number
  lastStartedAt: string | null; lastFinishedAt: string | null; nextRunAt: string | null
  failureCount: number; lastError: string | null; recoveryHeld: boolean
  logRetentionDays?: number; historyError?: string | null
}
export interface ExpiryHistoryQuery {
  page?: number; pageSize?: number; startDate?: string; endDate?: string
  username?: string; email?: string; search?: string
}
export interface ExpiryHistoryItem {
  id: number; createdAt: string; action: string; content: string; result: string
  username: string | null; email: string | null
  run: { schemaVersion: 1; runId: string; startedAt: string; finishedAt: string | null; failureCount: number; lastError: string | null } | null
}
export interface ExpiryHistoryResponse {
  items: ExpiryHistoryItem[]; total: number; page: number; pageSize: number; totalPages: number; retentionDays: number
}
