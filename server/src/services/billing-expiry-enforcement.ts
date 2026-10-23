export interface ExpirySuspension {
  id: number; hostId: number; incusId: string; status: string; suspendReason: string | null
  packagePlanId: number | null; expiresAt: Date | null; version: number; suspendedBy: number | null
}
export function isCurrentExpirySuspension(instance: ExpirySuspension | null, now = Date.now()): instance is ExpirySuspension {
  return !!instance && instance.packagePlanId !== null && instance.status === 'suspended' && instance.suspendReason === 'expired' && instance.suspendedBy === null &&
    !!instance.expiresAt && instance.expiresAt.getTime() < now
}
// Called while the shared renewal/expiry mutation lane is held. Re-read both
// billing and identity immediately before touching the remote instance.
export async function enforceExpiredStop(operations: {
  load: () => Promise<ExpirySuspension | null>
  state: (instance: ExpirySuspension) => Promise<{ status?: string }>
  stop: (instance: ExpirySuspension) => Promise<void>
}): Promise<'skipped' | 'stopped' | 'already-stopped'> {
  const instance = await operations.load()
  if (!isCurrentExpirySuspension(instance)) return 'skipped'
  const state = await operations.state(instance)
  if (state.status?.toLowerCase() === 'stopped') return 'already-stopped'
  if (!['running', 'frozen'].includes(state.status?.toLowerCase() || '')) throw new Error('EXPIRY_REMOTE_STATE_UNKNOWN')
  const current = await operations.load()
  if (!isCurrentExpirySuspension(current) || current.version !== instance.version || current.hostId !== instance.hostId || current.incusId !== instance.incusId) return 'skipped'
  await operations.stop(current)
  const verified = await operations.state(current)
  if (verified.status?.toLowerCase() !== 'stopped') throw new Error('EXPIRY_STOP_NOT_VERIFIED')
  return 'stopped'
}
