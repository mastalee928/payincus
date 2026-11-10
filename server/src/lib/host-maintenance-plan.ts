import { createHash } from 'node:crypto'

export const HOST_MAINTENANCE_REVISION = 'host-maintenance-v1'
export type MaintenanceEvent={phase:HostMaintenanceIntent['phase'];at:string;reason?:string}
export type CustomerBootBaseline = { id:number; hostId:number; userId:number; incusId:string; uuid:string; attempt:string;
  state:'running'|'stopped'|'suspended'; identityHash:string;
  boot?: { configurationHash:string; autostart:string|null; guardedHash:string; fingerprints:string[]; networkHash:string } }
export type HostMaintenanceIntent = { revision:typeof HOST_MAINTENANCE_REVISION; requestId:string; identityHash:string;
  bootId:string; prepareHash:string; recipe:string; architecture:'x86_64'|'aarch64'; phase:'prepared'|'reboot-intent'|'waiting-boot'|'restoring'|'verified'|'blocked'|'aborted';
  rebootIssued:boolean; startedAt:string; deadline:string; customers:CustomerBootBaseline[]; error?:string; history?:MaintenanceEvent[]; preparationRetries?:number }
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
const digest=/^[a-f0-9]{64}$/
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
const fail=()=>{throw new Error('HARDENING_JOURNAL_CONFLICT')}
export function readHostMaintenanceIntent(value:unknown):HostMaintenanceIntent {
  const row=object(value)
  if(row.revision!==HOST_MAINTENANCE_REVISION||typeof row.requestId!=='string'||!uuid.test(row.requestId)||
    typeof row.bootId!=='string'||!uuid.test(row.bootId)||!digest.test(String(row.identityHash))||!digest.test(String(row.prepareHash))||
    !['x86_64','aarch64'].includes(String(row.architecture))||!['prepared','reboot-intent','waiting-boot','restoring','verified','blocked','aborted'].includes(String(row.phase))||
    typeof row.rebootIssued!=='boolean'||typeof row.recipe!=='string'||!/^[a-z0-9-]{1,80}$/.test(row.recipe)||
    typeof row.startedAt!=='string'||typeof row.deadline!=='string'||!Number.isFinite(Date.parse(row.startedAt))||
    !Number.isFinite(Date.parse(row.deadline))||Date.parse(row.deadline)<=Date.parse(row.startedAt)||
    Date.parse(row.deadline)-Date.parse(row.startedAt)>20*60000||!Array.isArray(row.customers)||row.customers.length>1)fail()
  if(row.preparationRetries!==undefined&&(!Number.isSafeInteger(row.preparationRetries)||Number(row.preparationRetries)<0||Number(row.preparationRetries)>2))fail()
  const customers=(row.customers as unknown[]).map(value=>{
    const c=object(value)
    if(![c.id,c.hostId,c.userId].every(n=>Number.isSafeInteger(n)&&Number(n)>0&&Number(n)<=2147483647)||
      typeof c.incusId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/.test(c.incusId)||
      !uuid.test(String(c.uuid))||!uuid.test(String(c.attempt))||!digest.test(String(c.identityHash))||
      !['running','stopped','suspended'].includes(String(c.state)))fail()
    let boot:CustomerBootBaseline['boot']
    if(c.boot!==undefined) {
      const b=object(c.boot)
      if(![b.configurationHash,b.guardedHash,b.networkHash].every(value=>typeof value==='string'&&digest.test(value))||
        !(b.autostart===null||typeof b.autostart==='string'&&['true','false','0','1'].includes(b.autostart))||
        !Array.isArray(b.fingerprints)||b.fingerprints.length>3||b.fingerprints.some(value=>typeof value!=='string'||!/^SHA256:[A-Za-z0-9+/]{43}$/.test(value)))fail()
      boot={configurationHash:b.configurationHash,guardedHash:b.guardedHash,networkHash:b.networkHash,autostart:b.autostart,fingerprints:b.fingerprints} as NonNullable<CustomerBootBaseline['boot']>
    }
    return {id:c.id,hostId:c.hostId,userId:c.userId,incusId:c.incusId,uuid:c.uuid,attempt:c.attempt,state:c.state,identityHash:c.identityHash,...(boot?{boot}:{})} as CustomerBootBaseline
  })
  if((row.phase==='verified'&&(!row.rebootIssued||row.prepareHash==='0'.repeat(64)))||
    (row.phase==='aborted'&&row.rebootIssued)||
    (row.phase==='prepared'&&row.rebootIssued))fail()
  const history=Array.isArray(row.history)?row.history.slice(-16).flatMap(value=>{
    const event=object(value)
    return typeof event.at==='string'&&Number.isFinite(Date.parse(event.at))&&
      ['prepared','reboot-intent','waiting-boot','restoring','verified','blocked','aborted'].includes(String(event.phase))?
      [{phase:event.phase,at:new Date(event.at).toISOString(),...(typeof event.reason==='string'&&/^HARDENING_[A-Z_]{1,90}$/.test(event.reason)?{reason:event.reason}:{})} as MaintenanceEvent]:[]
  }):[]
  return {revision:HOST_MAINTENANCE_REVISION,requestId:row.requestId,identityHash:row.identityHash,bootId:row.bootId,
    prepareHash:row.prepareHash,recipe:row.recipe,architecture:row.architecture,phase:row.phase,rebootIssued:row.rebootIssued,
    startedAt:row.startedAt,deadline:row.deadline,customers,history,preparationRetries:Number(row.preparationRetries||0),
    ...(typeof row.error==='string'&&/^HARDENING_[A-Z_]{1,90}$/.test(row.error)?{error:row.error}:{})} as HostMaintenanceIntent
}
export function recordMaintenanceEvent(intent:HostMaintenanceIntent,reason?:string) {
  const history=intent.history||[],last=history.at(-1)
  if(last?.phase===intent.phase&&last.reason===reason)return
  intent.history=[...history,{phase:intent.phase,at:new Date().toISOString(),...(reason?{reason}:{})}].slice(-16)
}
export function customerBootIdentity(value:{id:number;hostId:number;userId:number;incusId:string;uuid:string;attempt:string}):string {
  return createHash('sha256').update(JSON.stringify([value.id,value.hostId,value.userId,value.incusId,value.uuid,value.attempt])).digest('hex')
}
export type CustomerCurrentIntent = {id:number;hostId:number;userId:number;incusId:string;uuid:string;attempt:string;
  status:string; deletionIntent:unknown;cleanupPending:boolean;pendingOperation:boolean;expired:boolean;remoteState:string}
/** A pre-reboot running baseline grants no authority to override a newer
 * payment, suspension, stop, delete, move or customer identity. */
export function customerBootRecoveryAction(before:CustomerBootBaseline,current:CustomerCurrentIntent):'start'|'stop'|'keep'|'wait'|'blocked' {
  if(before.identityHash!==customerBootIdentity(current))return 'blocked'
  if(before.state==='suspended')return current.remoteState==='Stopped'?'keep':'blocked'
  // Keep queued work intact. Once its original is safely stopped, finishing
  // host verification releases the fence so the normal authorized worker can
  // continue. A newer intent must never wait for an obsolete baseline start.
  if(current.deletionIntent||current.cleanupPending||current.pendingOperation||current.expired||
    current.status==='deleted'||before.state==='stopped'||current.status==='stopped'||current.status==='suspended') {
    return current.remoteState==='Stopped'?'keep':current.remoteState==='Running'?'stop':'wait'
  }
  if(current.status!=='running')return 'wait'
  return current.remoteState==='Running'?'keep':current.remoteState==='Stopped'?'start':'wait'
}
export function nextMaintenanceAction(intent:HostMaintenanceIntent,proof:{identityHash:string;prepareHash:string;bootId:string;remotePhase:string;recoveryHeld:boolean},now=Date.now()) {
  if(proof.recoveryHeld)return 'wait' as const
  if(proof.identityHash!==intent.identityHash||proof.prepareHash!==intent.prepareHash)return 'blocked' as const
  if(['verified','aborted'].includes(intent.phase))return 'none' as const
  if(proof.bootId!==intent.bootId)return intent.rebootIssued&&['reboot-intent','customers-restored'].includes(proof.remotePhase)&&['reboot-intent','waiting-boot','restoring','blocked'].includes(intent.phase)?'restore' as const:'blocked' as const
  if(proof.remotePhase==='absent')return !intent.rebootIssued&&intent.prepareHash==='0'.repeat(64)&&now>=Date.parse(intent.deadline)?'aborted' as const:'blocked' as const
  if(proof.remotePhase==='rolled-back')return 'aborted' as const
  // Only a matching, original-boot remote journal before its reboot barrier
  // permits undoing our own preparation. Expiry never authorizes a reboot.
  if(now>=Date.parse(intent.deadline)&&['prepared','preparing'].includes(proof.remotePhase))return 'rollback' as const
  if(intent.phase==='blocked')return intent.rebootIssued&&proof.bootId!==intent.bootId&&proof.remotePhase==='reboot-intent'?'restore' as const:'none' as const
  if(now>=Date.parse(intent.deadline))return 'blocked' as const
  if(proof.remotePhase==='reboot-intent')return 'wait' as const
  // A committed intent with a still-prepared remote journal proves dispatch
  // did not cross the remote durable reboot barrier. Resend the same request,
  // whose root-owned journal deduplicates concurrent/lost requests.
  if(intent.phase==='reboot-intent'&&proof.remotePhase==='prepared')return 'reboot' as const
  if(intent.rebootIssued||['waiting-boot','restoring'].includes(intent.phase))return 'wait' as const
  return intent.phase==='prepared'&&proof.remotePhase==='prepared'?'reboot' as const:'blocked' as const
}

/** Activate only independently accepted native boot/customer recovery pairs.
 * AMD64 Alpine/GRUB evidence: automatic-hardening-native-2026-11-10.md.
 * Other architectures and boot layouts retain their separate acceptance gate. */
export const NATIVE_VALIDATED_MAINTENANCE_RECIPES:ReadonlyArray<string>=Object.freeze(['alpine-apparmor-grub-v1:x86_64'])
export function hostMaintenanceRecipe(environment:{bootloader?:unknown}):string|null {
  return environment.bootloader==='grub'?'alpine-apparmor-grub-v1':
    environment.bootloader==='extlinux'?'alpine-apparmor-extlinux-v1':null
}
export function automaticMaintenanceRecipeAllowed(recipe:string,architecture:string):boolean {
  return NATIVE_VALIDATED_MAINTENANCE_RECIPES.includes(`${recipe}:${architecture}`)
}
