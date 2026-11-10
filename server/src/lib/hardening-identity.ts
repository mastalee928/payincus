import { createHash } from 'node:crypto'
import { hostMaintenanceBlocked } from './host-maintenance-gate.js'

export type HardeningIdentityTarget = { url: string; serverCertificate: string | null; serverFingerprint: string | null;
  managementSshHost: string | null; managementSshPort: number | null; managementSshUser: string | null;
  onboardingNode: { id: string; managementIp: string | null; sshFingerprint: string | null; nodePublicKey: string | null;
    batch: { createdById: number } } | null }
export function hardeningIdentityHash(host: HardeningIdentityTarget) {
  const node = host.onboardingNode
  return createHash('sha256').update(JSON.stringify([host.url, host.serverCertificate, host.serverFingerprint,
    host.managementSshHost, host.managementSshPort, host.managementSshUser, node?.id, node?.managementIp,
    node?.sshFingerprint, node?.nodePublicKey, node?.batch.createdById])).digest('hex')
}

export const hardeningIdentityInclude = { onboardingNode: { include: { batch: true } } } as const
/** Compact server-only selection for stock checks. Never return pins or
 * certificates in the public inventory response. */
export const hardeningStockSelect = { id:true,securityHardening:true,url:true,serverCertificate:true,serverFingerprint:true,
  managementSshHost:true,managementSshPort:true,managementSshUser:true,
  onboardingNode:{select:{id:true,managementIp:true,sshFingerprint:true,nodePublicKey:true,batch:{select:{createdById:true}}}} } as const
export function hardeningReceiptMatches(host: HardeningIdentityTarget & { securityHardening: unknown }): boolean {
  if (host.securityHardening === null) return true
  const state = host.securityHardening
  return !!state && typeof state === 'object' && !Array.isArray(state) && !hostMaintenanceBlocked(state) &&
    typeof (state as { identityHash?: unknown }).identityHash === 'string' &&
    (state as { identityHash: string }).identityHash === hardeningIdentityHash(host)
}
