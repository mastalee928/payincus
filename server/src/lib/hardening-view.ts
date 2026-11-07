import { SECURITY_HARDENING_REVISION, hardeningFailure, hardeningDiagnostic, hardeningPhaseLabel, type HardeningPhase } from './security-hardening.js'
import { hostMaintenanceBlocked } from './host-maintenance-gate.js'
import { readHostMaintenanceIntent } from './host-maintenance-plan.js'

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const phases: HardeningPhase[] = ['authority','inventory','runtime','host-inspection','customer-ssh','receipt','finished']
const date = (value: unknown) => typeof value === 'string' && value.length <= 32 && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1000000 ? Number(value) : 0
export function hardeningPublicView(value: unknown) {
  const state = record(value), nextCheckAt = date(state.nextCheckAt)
  const current = state.revision === SECURITY_HARDENING_REVISION
  const status = ['retry','needs-maintenance','verified'].includes(String(state.status)) ? String(state.status) : 'pending'
  const phase = phases.includes(state.phase as HardeningPhase) ? state.phase as HardeningPhase : null
  const fresh = current && nextCheckAt !== null && Date.parse(nextCheckAt) > Date.now()
  const check = (input: unknown) => {
    const row = record(input)
    return { status: ['verified','not-applicable','retry','needs-maintenance'].includes(String(row.status)) ? String(row.status) : 'retry',
      reason: typeof row.reason === 'string' ? hardeningFailure(new Error(row.reason)).reason || null : null }
  }
  const host = record(state.host), diagnostic = record(state.diagnostic), environment = record(state.environment)
  const maintenance=record(state.maintenance)
  let history:Array<{phase:string;at:string;reason:string|null}>=[]
  try{history=(readHostMaintenanceIntent(state.maintenance).history||[]).map(event=>({phase:event.phase,at:event.at,
    reason:event.reason?hardeningFailure(new Error(event.reason)).reason||null:null}))}catch{/* invalid intent remains blocked */}
  const reason = typeof diagnostic.reason === 'string' ? hardeningFailure(new Error(diagnostic.reason)).reason :
    typeof state.error === 'string' ? hardeningFailure(new Error(state.error)).reason : null
  const failurePhase = phases.includes(diagnostic.phase as HardeningPhase) ? diagnostic.phase as HardeningPhase : phase || 'authority'
  const failure = reason ? hardeningDiagnostic(reason,failurePhase) : null
  const safeNumber = (key: string, max = Number.MAX_SAFE_INTEGER) => typeof environment[key] === 'number' &&
    Number.isFinite(environment[key]) && Number(environment[key]) >= 0 && Number(environment[key]) <= max ? environment[key] as number : null
  return {
    revision: current ? SECURITY_HARDENING_REVISION : null, status: status === 'verified' && (!fresh || phase !== 'finished' || hostMaintenanceBlocked(state)) ? 'pending' : status,
    fresh, attempts: count(state.attempts), updateAttempts: count(state.updateAttempts), checkedAt: date(state.checkedAt), nextCheckAt,
    phase, phaseLabel: phase ? hardeningPhaseLabel(phase) : null,
    host: Object.keys(host).length ? { apparmor: check(host.apparmor), ssh: check(host.ssh), preflight: check(host.preflight) } : null,
    instances: (Array.isArray(state.instances) ? state.instances : []).slice(0,1).flatMap(input => {
      const row=record(input)
      return Number.isSafeInteger(row.instanceId) && Number(row.instanceId)>0 && Number(row.instanceId)<=2147483647 ?
        [{ instanceId: Number(row.instanceId),isolation:check(row.isolation),ssh:check(row.ssh) }] : []
    }),
    environment: Object.keys(environment).length ? {
      architecture: ['x86_64','aarch64'].includes(String(environment.architecture)) ? String(environment.architecture) : null,
      pageSize: [4096,16384,65536].includes(Number(environment.pageSize)) ? Number(environment.pageSize) : null,
      memoryAvailableKiB: safeNumber('memoryAvailableKiB'), memoryPressure:safeNumber('memoryPressure',100),
      rootAvailableBytes:safeNumber('rootAvailableBytes'),rootAvailableInodes:safeNumber('rootAvailableInodes'),
      rootReadonly:typeof environment.rootReadonly==='boolean'?environment.rootReadonly:null,
      packageBusy:typeof environment.packageBusy==='boolean'?environment.packageBusy:null,
      apparmorKernelSupport:typeof environment.apparmorKernelSupport==='boolean'?environment.apparmorKernelSupport:null,
      apparmorBootDisabled:typeof environment.apparmorBootDisabled==='boolean'?environment.apparmorBootDisabled:null,
      apparmorActive:typeof environment.apparmorActive==='boolean'?environment.apparmorActive:null,
      bootloader:['grub','extlinux','systemd-boot'].includes(String(environment.bootloader))?String(environment.bootloader):'unknown'
    }:null,
    diagnostic: failure ? { phase:failure.phase, reason:failure.reason, action:failure.action,
      instanceId:Number.isSafeInteger(diagnostic.instanceId)&&Number(diagnostic.instanceId)>0&&Number(diagnostic.instanceId)<=2147483647?Number(diagnostic.instanceId):null }:null,
    maintenance:Object.keys(maintenance).length?{
      phase:['prepared','reboot-intent','waiting-boot','restoring','verified','blocked','aborted'].includes(String(maintenance.phase))?String(maintenance.phase):'blocked',
      startedAt:date(maintenance.startedAt),deadline:date(maintenance.deadline),rebootIssued:maintenance.rebootIssued===true,
      history,
      reason:typeof maintenance.error==='string'?hardeningFailure(new Error(maintenance.error)).reason||null:null
    }:null
  }
}
