import { createHash } from 'node:crypto'
import type { Instance, Prisma } from '@prisma/client'
import type { IncusClient } from '../lib/incus/incus-client.js'
import { readRestoreIdentity,restoreConfigurationHash } from '../lib/incus/restore-identity.js'
import { readCustomerIsolation } from '../lib/incus/customer-isolation.js'
import { managedCleanupEndpointHash } from '../lib/managed-cleanup-identity.js'
import { customerBootIdentity, customerBootRecoveryAction, type CustomerBootBaseline } from '../lib/host-maintenance-plan.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from '../db/advisory-locks.js'
import { hasActiveTransferWorkflow } from '../db/transfers.js'
import { assertNoPendingSnapshotOperations } from '../db/snapshot-operation-guards.js'
import { assertNoPendingProxySiteOperations } from '../db/proxy-site-operation-guards.js'
import { alpineSshMaintenanceDependencies } from './alpine-ssh-maintenance.js'
import { decryptSensitiveData } from '../lib/security.js'
import { assertGuestNetworkProtection } from '../lib/guest-network-protection.js'

const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical)
  return value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b,'en')).map(([key,value])=>[key,canonical(value)])):value
}
const instancePath=(name:string)=>`/1.0/instances/${encodeURIComponent(name)}`
function fail(code='HARDENING_IDENTITY_CHANGED'):never {throw Error(code)}

export const customerBootDependencies={inspect:alpineSshMaintenanceDependencies.inspect,login:alpineSshMaintenanceDependencies.login}

/** Boot baselines are hashes only. No guest configuration, encrypted password,
 * host key or address is copied into a maintenance receipt or public view. */
export async function captureCustomerBootBaseline(client:IncusClient,instance:Instance,publicHost:string,deps=customerBootDependencies,allowed?:()=>Promise<void>):Promise<CustomerBootBaseline> {
  if(!['running','stopped','suspended'].includes(instance.status)||instance.provisioningCleanupPending||instance.deletionBillingPending||instance.deletionIntent)fail('HARDENING_CUSTOMER_BOOT_RECOVERY_UNVERIFIED')
  const remote=await readCustomerIsolation(client,instance.incusId),config=record(remote.config)
  // A platform-suspended customer must actually be stopped. A live Frozen
  // process and KVM require independent checkpoint/QEMU acceptance.
  if(remote.type!=='container')fail('HARDENING_VM_RUNTIME_UNVERIFIED')
  // Incus deletes ephemeral instances when they stop. Reboot recovery must
  // positively verify persistence before granting either start or stop.
  if(remote.ephemeral!==false)fail('HARDENING_CUSTOMER_BOOT_RECOVERY_UNVERIFIED')
  const identity=record(record(instance.snapshottedSpecs).managedCleanup)
  if(typeof identity.uuid!=='string'||typeof identity.attempt!=='string'||
    identity.endpointHash!==managedCleanupEndpointHash(client)||config['volatile.uuid']!==identity.uuid||
    config['user.payincus.provisioning-attempt']!==identity.attempt)fail()
  const runtime=await client.request<{status?:string}>('GET',instancePath(instance.incusId)+'/state',null,8000)
  if(runtime.status!==(instance.status==='running'?'Running':'Stopped'))fail('HARDENING_BUSY')
  const effective=record(remote.expanded_config??remote.config),autostart=config['boot.autostart']
  if(autostart!==undefined&& !['true','false','0','1'].includes(String(autostart)))fail('HARDENING_CUSTOMER_BOOT_RECOVERY_UNVERIFIED')
  if(effective['boot.autostart']!==undefined&&!['true','false','0','1'].includes(String(effective['boot.autostart'])))fail('HARDENING_CUSTOMER_BOOT_RECOVERY_UNVERIFIED')
  const original=await readRestoreIdentity(client,instance.incusId)
  const networkHash=await customerNetworkHash(client,instance.incusId)
  let fingerprints:string[]=[]
  if(instance.status==='running') {
    const inspection=await deps.inspect(allowed?client.withMaintenanceSshInspection(instance.incusId,allowed):client,instance.incusId)
    if(inspection.alpine&&!inspection.fixed)fail('ALPINE_SSH_PATCH_REQUIRED')
    fingerprints=[...new Set(inspection.fingerprints)].sort()
    if(!fingerprints.length||!instance.rootPassword)fail('ALPINE_SSH_PASSWORD_UNAVAILABLE')
    const password=decryptSensitiveData(instance.rootPassword)
    if(!password)fail('ALPINE_SSH_PASSWORD_UNAVAILABLE')
    // Original password must already work before permitting maintenance.
    if(!publicHost)fail('ALPINE_SSH_PASSWORD_UNAVAILABLE')
    await assertGuestNetworkProtection(client)
    await deps.login(publicHost,password,fingerprints,instance.sshPort||22)
  }
  const baseline:CustomerBootBaseline={id:instance.id,hostId:instance.hostId,userId:instance.userId,incusId:instance.incusId,
    uuid:identity.uuid as string,attempt:identity.attempt as string,state:instance.status as CustomerBootBaseline['state'],identityHash:'',
    boot:{configurationHash:original.configurationHash,guardedHash:restoreConfigurationHash(remote,true),networkHash,autostart:autostart===undefined?null:String(autostart),fingerprints}}
  baseline.identityHash=customerBootIdentity(baseline)
  return baseline
}

async function customerNetworkHash(client:IncusClient,name:string) {
  const network=await client.request<{config?:unknown}>('GET','/1.0/networks/incusbr0',null,8000)
  const forwards=await client.request<unknown[]>('GET','/1.0/networks/incusbr0/forwards?recursion=1',null,8000)
  if(!network||!network.config||!Array.isArray(forwards))fail('HARDENING_RECONNECT_INCOMPLETE')
  const owned=forwards.filter(value=>record(value).description===`payincus-dedicated:${name}`)
  const config={...record(network.config)}
  // Host-only protection receipts refresh independently of customer network
  // identity. Keep every address/route/forward and all other settings guarded.
  delete config['user.payincus.guest-guard']
  return hash([config,owned.sort((a,b)=>String(record(a).listen_address).localeCompare(String(record(b).listen_address),'en'))])
}

/** Caller holds the host maintenance lane and current host row. The instance
 * lane, latest billing/stop/delete state and remote identity are re-read in the
 * same transaction as each action. No database status is rewritten from a
 * stale running baseline, and only start of the exact original is allowed. */
export async function recoverCustomerAfterBoot(tx:Prisma.TransactionClient,client:IncusClient,before:CustomerBootBaseline,
  allowed:()=>Promise<void>,publicHost:string,deps=customerBootDependencies,bootPolicyRestored=false):Promise<{instanceId:number;state:'running'|'stopped'}> {
  if(!before.boot)fail('HARDENING_CUSTOMER_BOOT_RECOVERY_UNVERIFIED')
  if(!await tryAdvisoryTransactionLock(tx,INSTANCE_OPERATION_LOCK_NAMESPACE,before.id))fail('HARDENING_BUSY')
  await tx.$queryRaw`SELECT id FROM instances WHERE id=${before.id} FOR UPDATE`
  const instance=await tx.instance.findUnique({where:{id:before.id}})
  if(!instance)fail()
  await tx.$queryRaw`SELECT id FROM users WHERE id=${instance.userId} FOR SHARE`
  const owner=await tx.user.findUnique({where:{id:instance.userId},select:{status:true}})
  const remote=await readCustomerIsolation(client,instance.incusId),config=record(remote.config)
  if(remote.type!=='container')fail('HARDENING_VM_RUNTIME_UNVERIFIED')
  if(remote.ephemeral!==false)fail('HARDENING_CUSTOMER_BOOT_RECOVERY_UNVERIFIED')
  const saved=record(record(instance.snapshottedSpecs).managedCleanup)
  if(saved.endpointHash!==managedCleanupEndpointHash(client)||saved.uuid!==before.uuid||saved.attempt!==before.attempt||
    config['volatile.uuid']!==before.uuid||config['user.payincus.provisioning-attempt']!==before.attempt||
    before.identityHash!==customerBootIdentity({...instance,uuid:String(config['volatile.uuid']),attempt:String(config['user.payincus.provisioning-attempt'])}))fail()
  await readRestoreIdentity(client,instance.incusId)
  if(restoreConfigurationHash(remote,true)!==before.boot.guardedHash||
    !(bootPolicyRestored?config['boot.autostart']=== (before.boot.autostart??undefined):['false','0'].includes(String(record(remote.expanded_config??remote.config)['boot.autostart'])))||
    await customerNetworkHash(client,instance.incusId)!==before.boot.networkHash)fail()
  const pending={instanceId:instance.id,status:{in:['PENDING','PROCESSING'] as Array<'PENDING'|'PROCESSING'>}}
  let pendingOperation=Boolean(await hasActiveTransferWorkflow(instance.id,tx)||await tx.instanceTask.count({where:pending})||
    await tx.restoreTask.count({where:pending})||await tx.backupUploadTask.count({where:pending})||
    await tx.instanceTransfer.count({where:{instanceId:instance.id,status:{in:['pending','processing']}}}))
  try {await assertNoPendingSnapshotOperations(tx,instance.id);await assertNoPendingProxySiteOperations(tx,instance.id)}catch{pendingOperation=true}
  let runtime=await client.request<{status?:string}>('GET',instancePath(instance.incusId)+'/state',null,8000)
  const action=customerBootRecoveryAction(before,{...instance,uuid:before.uuid,attempt:before.attempt,
    cleanupPending:instance.provisioningCleanupPending||instance.deletionBillingPending||owner?.status!=='active',pendingOperation,
    expired:Boolean(instance.expiresAt&&instance.expiresAt<=new Date()),remoteState:String(runtime.status)})
  if(action==='blocked')fail()
  if(action==='wait')fail('HARDENING_BUSY')
  await allowed()
  if(action==='start'||action==='stop') {
    // withMaintenanceStart is a request-local, exact instance capability. It
    // cannot unlock the pool, exec, deletion, config, another host or customer.
    const actionAllowed=async()=>{
      await allowed()
      if(action==='start'&&instance.expiresAt&&instance.expiresAt<=new Date())fail('HARDENING_BUSY')
    }
    const scoped=action==='start'?client.withMaintenanceStart(instance.incusId,actionAllowed):client.withMaintenanceStop(instance.incusId,actionAllowed)
    await scoped.request('PUT',instancePath(instance.incusId)+'/state',action==='start'?{action:'start',timeout:30}:{action:'stop',timeout:30,force:false},40000)
    runtime=await client.request('GET',instancePath(instance.incusId)+'/state',null,8000)
  }
  const state=action==='stop'||runtime.status==='Stopped'?'stopped':'running'
  if(runtime.status!==(state==='running'?'Running':'Stopped'))fail('HARDENING_RECONNECT_INCOMPLETE')
  if(state==='running') {
    const inspection=await deps.inspect(client.withMaintenanceSshInspection(instance.incusId,allowed),instance.incusId)
    if(hash([...new Set(inspection.fingerprints)].sort())!==hash(before.boot.fingerprints)||inspection.alpine&&!inspection.fixed)fail('HARDENING_RECONNECT_INCOMPLETE')
    if(!instance.rootPassword)fail('ALPINE_SSH_PASSWORD_UNAVAILABLE')
    const password=decryptSensitiveData(instance.rootPassword)
    if(!password||!publicHost)fail('ALPINE_SSH_PASSWORD_UNAVAILABLE')
    await assertGuestNetworkProtection(client)
    await deps.login(publicHost,password,before.boot.fingerprints,instance.sshPort||22)
  }
  await allowed()
  if(restoreConfigurationHash(await readCustomerIsolation(client,instance.incusId),true)!==before.boot.guardedHash||
    await customerNetworkHash(client,instance.incusId)!==before.boot.networkHash)fail()
  return {instanceId:instance.id,state}
}
