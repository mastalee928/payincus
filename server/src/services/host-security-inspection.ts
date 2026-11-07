import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { connectOnboardingSsh, gatewayConfigured, sshExec } from './onboarding-ssh.js'
import type { HardeningCheck } from '../lib/security-hardening.js'

export type HostHardeningPreflight = {
  architecture: string; bootId: string; pageSize: number; memoryAvailableKiB: number; memoryPressure: number | null
  rootAvailableBytes: number; rootAvailableInodes: number; rootReadonly: boolean; packageBusy: boolean
  apparmorKernelSupport: boolean; apparmorBootDisabled: boolean; apparmorActive: boolean
  bootloader: 'grub' | 'extlinux' | 'systemd-boot' | 'unknown'
}
export function hardeningPreflightCheck(value: HostHardeningPreflight): HardeningCheck {
  if (!['x86_64', 'aarch64'].includes(value.architecture)) return { status: 'needs-maintenance', reason: 'HARDENING_ARCH_UNSUPPORTED' }
  if (value.rootReadonly) return { status: 'needs-maintenance', reason: 'HARDENING_FILESYSTEM_READONLY' }
  if (value.packageBusy) return { status: 'retry', reason: 'HARDENING_PACKAGE_BUSY' }
  if (value.memoryAvailableKiB < 128 * 1024) return { status: 'retry', reason: 'HARDENING_MEMORY_LOW' }
  if (value.memoryPressure !== null && value.memoryPressure >= 5) return { status: 'retry', reason: 'HARDENING_MEMORY_PRESSURE' }
  if (value.rootAvailableBytes < 128 * 1024 * 1024 || value.rootAvailableInodes < 512) return { status: 'retry', reason: 'HARDENING_DISK_LOW' }
  return { status: 'verified' }
}

export type HostSecurityTarget = {
  managementSshHost: string | null; managementSshPort: number | null; managementSshUser: string | null
  onboardingNode: { id: string; nodePublicKey: string | null; managementIp: string | null; sshFingerprint: string | null; sshPort: number } | null
}
export type HostSecurityRuntime = {
  apparmor: boolean; alpine: boolean; fixed: boolean; branch: string | null
  preflight: HostHardeningPreflight
  guests: Array<{ instanceId: number; pid: number; uidMap: string | null; gidMap: string | null; seccomp: number | null; apparmor: string | null }>
}
export function validateHostSecurityRuntime(value: unknown, guests: Array<{ instanceId: number; pid: number }>): HostSecurityRuntime {
  const report = value as HostSecurityRuntime
  const preflight = report?.preflight
  if (!report || typeof report.apparmor !== 'boolean' || typeof report.alpine !== 'boolean' || typeof report.fixed !== 'boolean' ||
    !preflight || typeof preflight.architecture !== 'string' || !/^[a-zA-Z0-9_-]{1,32}$/.test(preflight.architecture) ||
    typeof preflight.bootId !== 'string' || !/^[a-f0-9-]{36}$/i.test(preflight.bootId) ||
    ![4096, 16384, 65536].includes(preflight.pageSize) ||
    ![preflight.memoryAvailableKiB, preflight.rootAvailableBytes, preflight.rootAvailableInodes].every(item => Number.isSafeInteger(item) && item >= 0) ||
    !(preflight.memoryPressure === null || typeof preflight.memoryPressure === 'number' && Number.isFinite(preflight.memoryPressure) && preflight.memoryPressure >= 0 && preflight.memoryPressure <= 100) ||
    typeof preflight.rootReadonly !== 'boolean' || typeof preflight.packageBusy !== 'boolean' ||
    ![preflight.apparmorKernelSupport,preflight.apparmorBootDisabled,preflight.apparmorActive].every(item=>typeof item==='boolean') ||
    !['grub','extlinux','systemd-boot','unknown'].includes(preflight.bootloader) ||
    !(report.branch === null || typeof report.branch === 'string' && /^\d+\.\d+$/.test(report.branch)) ||
    !Array.isArray(report.guests) || report.guests.length !== guests.length ||
    report.guests.some((guest, index) => !guest || guest.instanceId !== guests[index].instanceId || guest.pid !== guests[index].pid ||
      ![guest.uidMap, guest.gidMap, guest.apparmor].every(item => item === null || typeof item === 'string' && item.length < 8192) ||
      !(guest.seccomp === null || Number.isInteger(guest.seccomp) && guest.seccomp >= 0 && guest.seccomp <= 2))) {
    throw new Error('HARDENING_PROBE_UNSUPPORTED')
  }
  // Select validated fields; do not persist arbitrary output from a restored
  // or old gateway component in the administrative state.
  return { apparmor: report.apparmor, alpine: report.alpine, fixed: report.fixed, branch: report.branch,
    preflight: { architecture: preflight.architecture, bootId: preflight.bootId, pageSize: preflight.pageSize,
      memoryAvailableKiB: preflight.memoryAvailableKiB, memoryPressure: preflight.memoryPressure,
      rootAvailableBytes: preflight.rootAvailableBytes, rootAvailableInodes: preflight.rootAvailableInodes,
      rootReadonly: preflight.rootReadonly, packageBusy: preflight.packageBusy,
      apparmorKernelSupport: preflight.apparmorKernelSupport, apparmorBootDisabled: preflight.apparmorBootDisabled,
      apparmorActive: preflight.apparmorActive, bootloader: preflight.bootloader },
    guests: report.guests.map(guest => ({ instanceId: guest.instanceId, pid: guest.pid, uidMap: guest.uidMap,
      gidMap: guest.gidMap, seccomp: guest.seccomp, apparmor: guest.apparmor })) }
}
export function safeCustomerRuntime(guest: HostSecurityRuntime['guests'][number]): boolean {
  const safeMap = (text: string | null) => {
    if (!text) return false
    const maps = text.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number))
    return maps.every(map => map.length === 3 && map.every(Number.isSafeInteger) && map[0] >= 0 && map[1] > 0 && map[2] > 0) &&
      maps.some(map => map[0] === 0)
  }
  return safeMap(guest.uidMap) && safeMap(guest.gidMap) && guest.seccomp === 2
}

/** The existing restricted gateway holds the root management key. The private
 * backend never reads that key or gains an arbitrary remote shell. */
export async function inspectHostSecurity(target: HostSecurityTarget, guests: Array<{ instanceId: number; pid: number }>,
  allowUpdate: boolean, allowed: () => Promise<void>, deadline = Date.now() + 170000, requestId: string = randomUUID()): Promise<HostSecurityRuntime & { hostSshUpdated: boolean }> {
  const node = target.onboardingNode
  if (!/^[a-f0-9-]{36}$/.test(requestId) || !node?.managementIp || !node.sshFingerprint || !node.nodePublicKey || !/^[a-f0-9-]{36}$/.test(node.id) || target.managementSshHost !== node.managementIp ||
    target.managementSshPort !== node.sshPort || target.managementSshUser !== 'root' ||
    guests.some(guest => !Number.isSafeInteger(guest.pid) || guest.pid <= 0 || !Number.isSafeInteger(guest.instanceId) || guest.instanceId <= 0)) {
    throw new Error('HARDENING_IDENTITY_MISSING')
  }
  if (!gatewayConfigured()) throw new Error('HARDENING_PROBE_UNSUPPORTED')
  const key = await readFile(process.env.ONBOARDING_GATEWAY_KEY_PATH!)
  const client = await connectOnboardingSsh({ host: process.env.ONBOARDING_GATEWAY_HOST!,
    port: Number(process.env.ONBOARDING_GATEWAY_PORT || 22), privateKey: key },
    async fingerprint => fingerprint === process.env.ONBOARDING_GATEWAY_FINGERPRINT)
  try {
    await allowed()
    const remaining = deadline - Date.now()
    if (remaining < 35000 || allowUpdate && remaining < 125000) throw new Error('HARDENING_BUSY')
    const input = { managementIp: node.managementIp, sshPort: node.sshPort, sshFingerprint: node.sshFingerprint,
      nodePublicKey: node.nodePublicKey, guests, allowUpdate, requestId, expiresAt: Math.min(deadline - 15000, Date.now() + 140000) }
    const value = JSON.parse(await sshExec(client, `security-hardening ${node.id}`, JSON.stringify(input), Math.min(remaining, 150000), 24576))
    if (!value || value.nodeId !== node.id || typeof value.hostSshUpdated !== 'boolean') throw new Error('HARDENING_PROBE_UNSUPPORTED')
    if (!value.runtime?.preflight) throw new Error('HARDENING_GATEWAY_PROTOCOL_REQUIRED')
    return { ...validateHostSecurityRuntime(value.runtime, guests), hostSshUpdated: value.hostSshUpdated }
  } finally { client.destroy() }
}
