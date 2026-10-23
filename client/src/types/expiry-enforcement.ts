export interface ExpiryEnforcementStatus {
  enabled: boolean; running: boolean; intervalMinutes: number; retentionDays: number
  lastStartedAt: string | null; lastFinishedAt: string | null; nextRunAt: string | null
  failureCount: number; lastError: string | null; recoveryHeld: boolean
}
