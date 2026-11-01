export interface HostAbusePolicy { revision: number; blockBt: boolean; blockMining: boolean }
export type HostAbuseState = 'applied' | 'pending' | 'retrying' | 'offline' | 'unsupported' | 'unconfigured' | 'conflict'
export interface HostAbuseRow {
  id: number; name: string; state: HostAbuseState; lastSeenAt: string | null
  errorCode: string | null; attempts: number; nextRetryAt: string | null; checkedAt: string | null
  queueErrorCode: string | null; queueErrorAt: string | null
}
export interface HostAbuseOverview {
  policy: HostAbusePolicy; summary: Record<HostAbuseState | 'total', number>
  hosts: HostAbuseRow[]; total: number; page: number; pages: number
}
