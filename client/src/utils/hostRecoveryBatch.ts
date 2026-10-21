import type { HostRecoveryReport } from '@/types/host-pool'

export interface RecoveryBatchItem {
  id: number
  name: string
  status: 'pending' | 'checking' | 'ready' | 'blocked' | 'recovering' | 'recovered' | 'failed'
  report: HostRecoveryReport | null
  error: string
}
interface RecoveryApi {
  inspectRecovery(id: number): Promise<HostRecoveryReport>
  recover(id: number, data: { confirmation: string; acknowledgeCleanup: boolean }): Promise<unknown>
}
function failed(item: RecoveryBatchItem, error: unknown) {
  const data = (error as { response?: { data?: { code?: string; report?: HostRecoveryReport } }; code?: string; report?: HostRecoveryReport })
  item.error = data?.response?.data?.code || data?.code || 'HOST_RECOVERY_FAILED'
  const report = data?.response?.data?.report || data?.report
  if (report) item.report = report
  item.status = 'failed'
}
export async function inspectRecoveryBatch(items: RecoveryBatchItem[], api: RecoveryApi) {
  for (const item of items) {
    if (item.status === 'recovered') continue
    item.status = 'checking'; item.error = ''; item.report = null
    try {
      item.report = await api.inspectRecovery(item.id)
      item.status = item.report.canRecover ? 'ready' : 'blocked'
    } catch (error) { failed(item, error) }
  }
}
export async function recoverRecoveryBatch(items: RecoveryBatchItem[], api: RecoveryApi, acknowledgeCleanup: boolean) {
  for (const item of items) {
    const report = item.report
    if (item.status !== 'ready' || !report?.canRecover || (report.needsCleanup && !acknowledgeCleanup)) continue
    item.status = 'recovering'; item.error = ''
    try {
      await api.recover(item.id, { confirmation: report.confirmation, acknowledgeCleanup: report.needsCleanup && acknowledgeCleanup })
      item.status = 'recovered'
    } catch (error) { failed(item, error) }
  }
}
