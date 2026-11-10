import type { IncusClient } from './incus/incus-client.js'
import type { Prisma } from '@prisma/client'

export const GUEST_NETWORK_CAPABILITY = 'guest-network-protection-v1'
// A 60s heartbeat can carry a status from the previous 30s reconciliation.
// Include its bounded execution/network delay instead of flapping inventory.
export const GUEST_REPORT_MAX_AGE_MS = 180000

/** Use the same receipt for catalog, locked allocation and onboarding. */
export function guestProtectionReadyWhere(now = new Date()): Prisma.HostAgentWhereInput {
  return {
    enabled: true,
    lastSeenAt: { gt: new Date(now.getTime() - GUEST_REPORT_MAX_AGE_MS), lte: new Date(now.getTime() + 5000) },
    capabilities: { array_contains: [GUEST_NETWORK_CAPABILITY] },
    AND: [
      { lastReport: { path: ['guestProtectionStatus', 'applied'], equals: true } },
      { lastReport: { path: ['guestProtectionStatus', 'checkedAt'], gt: new Date(now.getTime() - GUEST_REPORT_MAX_AGE_MS).toISOString() } },
      { lastReport: { path: ['guestProtectionStatus', 'checkedAt'], lte: new Date(now.getTime() + 5000).toISOString() } }
    ]
  }
}
export function guestProtectionReady(agent: { enabled: boolean; lastSeenAt: Date | null; capabilities: unknown; lastReport: unknown } | null | undefined, now=Date.now()) {
  const report=normalizeGuestProtectionStatus((agent?.lastReport as Record<string,unknown>|null)?.guestProtectionStatus)
  return Boolean(agent?.enabled && agent.lastSeenAt && now-agent.lastSeenAt.getTime()<GUEST_REPORT_MAX_AGE_MS && agent.lastSeenAt.getTime()<=now+5000 &&
    Array.isArray(agent.capabilities)&&agent.capabilities.includes(GUEST_NETWORK_CAPABILITY)&&report?.applied&&
    Date.parse(report.checkedAt)<=now+5000&&now-Date.parse(report.checkedAt)<GUEST_REPORT_MAX_AGE_MS)
}
export function normalizeGuestProtectionStatus(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const status = value as Record<string, unknown>
  if (typeof status.applied !== 'boolean' || typeof status.checkedAt !== 'string' ||
      !Number.isFinite(Date.parse(status.checkedAt))) return null
  return { applied: status.applied, checkedAt: new Date(status.checkedAt).toISOString(),
    error: status.applied ? null : 'GUEST_NETWORK_PROTECTION_PENDING' }
}

/** Read via the pinned host API. Guest config/cloud-init cannot mint a host
 * network receipt. Old agents have no receipt and cannot silently bypass this. */
export async function assertGuestNetworkProtection(client: Pick<IncusClient, 'request'>): Promise<void> {
  const network = await client.request<{ config?: Record<string, string> }>('GET', '/1.0/networks/incusbr0', null, 8000)
  const marker = network?.config?.['user.payincus.guest-guard']
  // Receipt expiry prevents stale success after an Agent crash or failed repair.
  const parts = marker?.split(':')
  const checkedAt = parts?.length === 3 ? Number(parts[2]) : NaN
  if (parts?.[0] !== 'v1' || !/^[a-f0-9]{64}$/.test(parts?.[1] || '') || !Number.isSafeInteger(checkedAt) ||
      checkedAt > Date.now() + 5000 || Date.now() - checkedAt > 90000) {
    throw new Error('GUEST_NETWORK_PROTECTION_PENDING')
  }
}
