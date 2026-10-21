interface HeartbeatState {
  enabled: boolean
  lastSeenAt: Date | null
  lastReport?: unknown
}
// Restored DB status is historical; a managed host needs a recent heartbeat to remain online.
export function hostLiveStatus(status: string, agent: HeartbeatState | null | undefined, now = Date.now()): string {
  if (status !== 'online' || !agent) return status
  if (!agent.enabled || !agent.lastSeenAt) return 'offline'
  const metrics = (agent.lastReport as { metrics?: { heartbeatIntervalSeconds?: unknown } } | null)?.metrics
  const interval = Number(metrics?.heartbeatIntervalSeconds)
  const seconds = Number.isFinite(interval) ? Math.min(3600, Math.max(30, interval)) : 60
  const age = now - agent.lastSeenAt.getTime()
  return age < -60000 || age > Math.max(180, seconds * 3) * 1000 ? 'offline' : status
}
