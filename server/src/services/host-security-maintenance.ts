import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { recoveryHeld } from './platform-backup-core.js'
import { hostMaintenanceCommand } from './host-maintenance-channel.js'
import { inspectHostSecurity, hardeningPreflightCheck, safeCustomerRuntime, type HostSecurityRuntime } from './host-security-inspection.js'
import { hardeningIdentityHash } from '../lib/hardening-identity.js'
import { hostMaintenanceBlocked } from '../lib/host-maintenance-gate.js'
import { withHostMaintenanceLane } from '../lib/host-operation-lane.js'
import { automaticMaintenanceRecipeAllowed, hostMaintenanceRecipe, readHostMaintenanceIntent, nextMaintenanceAction, recordMaintenanceEvent,
  type HostMaintenanceIntent } from '../lib/host-maintenance-plan.js'
import { SECURITY_HARDENING_ENABLED_KEY, SECURITY_HARDENING_REVISION, hardeningDiagnostic } from '../lib/security-hardening.js'
import { getIncusClient, removeIncusClient } from '../lib/incus/incus-pool.js'
import { captureCustomerBootBaseline, recoverCustomerAfterBoot } from './customer-boot-recovery.js'
import { INSTANCE_OPERATION_LOCK_NAMESPACE, tryAdvisoryTransactionLock } from '../db/advisory-locks.js'
import { hasActiveTransferWorkflow } from '../db/transfers.js'
import { assertNoPendingSnapshotOperations } from '../db/snapshot-operation-guards.js'
import { assertNoPendingProxySiteOperations } from '../db/proxy-site-operation-guards.js'
import { readRestoreIdentity,restoreConfigurationHash } from '../lib/incus/restore-identity.js'
import { readCustomerIsolation } from '../lib/incus/customer-isolation.js'
import { customerBootIdentity } from '../lib/host-maintenance-plan.js'
import { onboardingOwnsHardening, ownsOnboardingHardeningLease } from '../lib/onboarding-hardening-owner.js'

const include={onboardingNode:{include:{batch:true}},agent:true} as const
type Host=Prisma.HostGetPayload<{include:typeof include}>
type Enrollment={nodeId:string;leaseToken:string}
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
const json=(value:unknown)=>value as Prisma.InputJsonValue
export const hostMaintenanceDependencies={held:recoveryHeld,command:hostMaintenanceCommand,inspect:inspectHostSecurity,
  connect:getIncusClient,invalidate:removeIncusClient,accepted:automaticMaintenanceRecipeAllowed,
  capture: captureCustomerBootBaseline, recover: recoverCustomerAfterBoot}

/** Authority is freshly held only for a bounded remote request. No transaction
 * spans a reboot or wait for reconnection, and intents remain durable on error. */
async function authorized(tx:Prisma.TransactionClient,host:Host,held:()=>boolean,enrollment?:Enrollment) {
  if(held())throw Error('HARDENING_RECOVERY_HELD')
  const node=host.onboardingNode
  const enrollmentReady=node&&enrollment&&node.id===enrollment.nodeId&&node.status==='running'&&node.step==='hardening'&&node.leaseToken===enrollment.leaseToken&&node.leaseUntil&&node.leaseUntil>new Date()
  if(!node||node.deletedAt||node.status!=='succeeded'&&!enrollmentReady||!host.singleTenant||!host.isInstalled||
    !node.managementIp||!node.nodePublicKey||!node.sshFingerprint||host.managementSshHost!==node.managementIp||
    host.managementSshPort!==node.sshPort||host.managementSshUser!=='root'||!host.serverCertificate||!host.serverFingerprint)throw Error('HARDENING_IDENTITY_MISSING')
  await tx.$queryRaw`SELECT id FROM host_onboarding_nodes WHERE id=${node.id} FOR SHARE`
  await tx.$queryRaw`SELECT id FROM host_onboarding_batches WHERE id=${node.batchId} FOR SHARE`
  await tx.$queryRaw`SELECT id FROM users WHERE id=${node.batch.createdById} FOR SHARE`
  await tx.$queryRaw`SELECT id FROM system_configs WHERE key=${SECURITY_HARDENING_ENABLED_KEY} FOR SHARE`
  const current=await tx.hostOnboardingNode.findUnique({where:{id:node.id},include:{batch:true}})
  if(!current||current.deletedAt||current.hostId!==host.id||current.nodePublicKey!==node.nodePublicKey||current.sshFingerprint!==node.sshFingerprint||
    current.batchId!==node.batchId||current.sshPort!==node.sshPort||hardeningIdentityHash({...host,onboardingNode:current})!==hardeningIdentityHash(host)||
    current.batch.createdById!==node.batch.createdById||current.status!==node.status||enrollmentReady&&
      (current.leaseToken!==enrollment!.leaseToken||!current.leaseUntil||current.leaseUntil<=new Date()||current.step!=='hardening'))throw Error('HARDENING_IDENTITY_CHANGED')
  const actor=await tx.user.findUnique({where:{id:node.batch.createdById},select:{status:true,role:true}})
  if(actor?.status!=='active'||actor.role!=='admin')throw Error('HARDENING_ADMIN_REQUIRED')
  if(!['true','1'].includes((await tx.systemConfig.findUnique({where:{key:SECURITY_HARDENING_ENABLED_KEY}}))?.value||''))throw Error('HARDENING_DISABLED')
  if(host.status!=='online')throw Error('HARDENING_OFFLINE')
  if(host.poolFaulted)throw Error('HARDENING_HOST_QUARANTINED')
  if(host.publicIpSyncBlocked)throw Error('HARDENING_PUBLIC_IP_PENDING')
  if(host.installPending)throw Error('HARDENING_INSTALL_PENDING')
}
async function lockMaintenanceCustomers(tx:Prisma.TransactionClient,id:number) {
  // Agent reports and lifecycle operations take instance -> host. Wait before
  // holding the host row, so a report can finish its own host-authority check.
  // This grants no maintenance authority: all current gates are checked again
  // after the host lock, including any customer added or moved while waiting.
  const customers=await tx.instance.findMany({where:{hostId:id,OR:[{status:{not:'deleted'}},{provisioningCleanupPending:true},
    {deletionBillingPending:true}]},select:{id:true},orderBy:{id:'asc'}})
  if(customers.length>1)throw Error('HARDENING_CUSTOMER_BOOT_RECOVERY_UNVERIFIED')
  for(const customer of customers) {
    const until=Date.now()+1500
    let acquired=await tryAdvisoryTransactionLock(tx,INSTANCE_OPERATION_LOCK_NAMESPACE,customer.id)
    while(!acquired&&Date.now()<until) {
      await new Promise(resolve=>setTimeout(resolve,Math.min(100,until-Date.now())))
      acquired=await tryAdvisoryTransactionLock(tx,INSTANCE_OPERATION_LOCK_NAMESPACE,customer.id)
    }
    if(!acquired)throw Error('HARDENING_BUSY')
    await tx.$queryRaw`SELECT id FROM instances WHERE id=${customer.id} FOR UPDATE`
  }
}
async function noCustomerConflicts(tx:Prisma.TransactionClient,id:number,intent?:HostMaintenanceIntent,restoring=false) {
  const customers=await tx.instance.findMany({where:{hostId:id,OR:[{status:{not:'deleted'}},{provisioningCleanupPending:true},{deletionBillingPending:true},
    ...(restoring&&intent?[{id:{in:intent.customers.map(customer=>customer.id)}}]:[])]},orderBy:{id:'asc'}})
  if(customers.length>1||intent&&customers.length!==intent.customers.length)throw Error('HARDENING_CUSTOMER_BOOT_RECOVERY_UNVERIFIED')
  for(let index=0;index<customers.length;index++) {
    if(!await tryAdvisoryTransactionLock(tx,INSTANCE_OPERATION_LOCK_NAMESPACE,customers[index].id))throw Error('HARDENING_BUSY')
    await tx.$queryRaw`SELECT id FROM instances WHERE id=${customers[index].id} FOR UPDATE`
    const customer=await tx.instance.findUniqueOrThrow({where:{id:customers[index].id}})
    customers[index]=customer
    if(customer.hostId!==id)throw Error('HARDENING_IDENTITY_CHANGED')
    if(!restoring) {
      await tx.$queryRaw`SELECT id FROM users WHERE id=${customer.userId} FOR SHARE`
      if((await tx.user.findUnique({where:{id:customer.userId},select:{status:true}}))?.status!=='active')throw Error('HARDENING_ADMIN_REQUIRED')
      if(customer.status==='running'&&customer.expiresAt&&customer.expiresAt<=new Date())throw Error('HARDENING_BUSY')
    }
    if(!restoring&&(!['running','stopped','suspended'].includes(customer.status)||customer.provisioningCleanupPending||customer.deletionBillingPending||
      customer.deletionIntent||await hasActiveTransferWorkflow(customer.id,tx)||
      await tx.instanceTransfer.count({where:{instanceId:customer.id,status:{in:['pending','processing']}}})))throw Error('HARDENING_BUSY')
    if(!restoring)try{await assertNoPendingSnapshotOperations(tx,customer.id);await assertNoPendingProxySiteOperations(tx,customer.id)}catch{throw Error('HARDENING_BUSY')}
    if(intent) {
      const before=intent.customers.find(before=>before.id===customer.id),saved=record(record(customer.snapshottedSpecs).managedCleanup)
      if(!before||before.identityHash!==customerBootIdentity({...customer,uuid:String(saved.uuid),attempt:String(saved.attempt)}))throw Error('HARDENING_IDENTITY_CHANGED')
    }
  }
  if(!restoring&&(await tx.checkoutReservation.count({where:{hostId:id}})||await tx.instanceTask.count({where:{status:{in:['PENDING','PROCESSING']},
    OR:[{hostId:id},{targetHostId:id},{replacementState:{path:['sourceHostId'],equals:id}}]}})||
    await tx.restoreTask.count({where:{hostId:id,status:{in:['PENDING','PROCESSING']}}})||
    await tx.backupUploadTask.count({where:{hostId:id,status:{in:['PENDING','PROCESSING']}}})))throw Error('HARDENING_BUSY')
  return customers
}
async function assertRemoteBaseline(host:Host,tx:Prisma.TransactionClient,deps:typeof hostMaintenanceDependencies,intent:HostMaintenanceIntent,restoring=false) {
  const client=await deps.connect(host,tx,8000)
  const inventory=await client.request<unknown[]>('GET','/1.0/instances?recursion=1&all-projects=true',null,8000)
  if(!Array.isArray(inventory)||inventory.length!==intent.customers.length)throw Error('HARDENING_IDENTITY_CHANGED')
  for(const row of inventory) {
    const remote=record(row),before=intent.customers.find(before=>before.incusId===remote.name)
    if(!before||!before.boot||remote.project&&remote.project!=='default')throw Error('HARDENING_IDENTITY_CHANGED')
    const identity=await readRestoreIdentity(client,before.incusId)
    const actual=await readCustomerIsolation(client,before.incusId)
    if(actual.type!=='container')throw Error('HARDENING_VM_RUNTIME_UNVERIFIED')
    if(actual.ephemeral!==false)throw Error('HARDENING_CUSTOMER_BOOT_RECOVERY_UNVERIFIED')
    if(identity.uuid!==before.uuid||restoreConfigurationHash(actual,true)!==before.boot.guardedHash||
      identity.configurationHash!==before.boot.configurationHash&&!['false','0'].includes(String(record(actual.expanded_config??actual.config)['boot.autostart'])))throw Error('HARDENING_IDENTITY_CHANGED')
    if(!restoring&&remote.status!==(before.state==='running'?'Running':'Stopped'))throw Error('HARDENING_BUSY')
  }
  const operations=await client.request<Record<string,unknown>>('GET','/1.0/operations?recursion=1',null,8000)
  // A mutation accepted before a backend crash can still be running in Incus.
  if(!operations||typeof operations!=='object'||Array.isArray(operations)||Object.values(operations).some(group=>
    !Array.isArray(group)||group.some(operation=>!operation||typeof operation!=='object'||
      !['Success','Failure','Cancelled'].includes(String((operation as {status?:unknown}).status)))))throw Error('HARDENING_BUSY')
}

async function assertBootDefense(tx:Prisma.TransactionClient,hostId:number,intent:HostMaintenanceIntent,report:HostSecurityRuntime) {
  const agent=await tx.hostAgent.findUnique({where:{hostId},select:{enabled:true,lastSeenAt:true,lastReport:true}})
  const metrics=record(record(agent?.lastReport).metrics)
  if(report.preflight.bootId===intent.bootId||report.preflight.architecture!==intent.architecture||!report.apparmor||
    !report.preflight.apparmorActive||report.alpine&&!report.fixed||hardeningPreflightCheck(report.preflight).status!=='verified'||!agent?.enabled||
    !agent.lastSeenAt||agent.lastSeenAt.getTime()<Date.parse(intent.startedAt)||Date.now()-agent.lastSeenAt.getTime()>90000||
    metrics.bootId!==report.preflight.bootId)throw Error('HARDENING_RECONNECT_INCOMPLETE')
}

/** Activation remains gated by native acceptance. Customer baselines grant
 * only exact-instance restoration, with newer billing/stop/delete intent and
 * original configuration/password/network rechecked before each action. */
export async function prepareAutomaticHostMaintenance(hostId:number,deps=hostMaintenanceDependencies,enrollment?:Enrollment):Promise<void> {
  if(deps.held())return
  const candidate=await prisma.host.findUnique({where:{id:hostId},select:{securityHardening:true}})
  const candidateEnvironment=record(record(candidate?.securityHardening).environment)
  const recipe=hostMaintenanceRecipe(candidateEnvironment)
  if(!candidate)return
  let planned: {host:Host;intent:HostMaintenanceIntent}|null
  try { planned=await withHostMaintenanceLane(hostId,()=>prisma.$transaction(async tx=>{
    await tx.$executeRaw`SET LOCAL lock_timeout='2s'`
    // One global change lane, short-held. Persisted nonterminal intents block
    // the next target even after the process exits or its queue lease expires.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(4128,1)::text`
    await lockMaintenanceCustomers(tx,hostId)
    await tx.$queryRaw`SELECT id FROM hosts WHERE id=${hostId} FOR UPDATE`
    const host=await tx.host.findUniqueOrThrow({where:{id:hostId},include})
    if(enrollment?!ownsOnboardingHardeningLease(host.onboardingNode,enrollment):onboardingOwnsHardening(host.onboardingNode))return null
    await authorized(tx,host,deps.held,enrollment)
    const state=record(host.securityHardening),environment=record(state.environment)
    const previous=state.maintenance?readHostMaintenanceIntent(state.maintenance):undefined
    if(previous&&previous.phase!=='aborted')return null
    // The normal queue can independently prove that the original host is
    // healthy after a rollback. Historical preparation budgets must not
    // overwrite that fresh result or shorten its successful check interval.
    if(state.status==='verified'||record(record(state.host).apparmor).status==='verified')return null
    if(previous&&(previous.preparationRetries||0)>=2){
      const reason='HARDENING_PREPARATION_RETRY_EXHAUSTED'
      await tx.host.update({where:{id:hostId},data:{securityHardening:json({...state,status:'needs-maintenance',
        diagnostic:hardeningDiagnostic(reason,'host-inspection'),nextCheckAt:new Date(Date.now()+6*60*60000).toISOString()})}})
      return null
    }
    if(previous&&Date.now()<Date.parse(previous.deadline)+120000){
      await tx.host.update({where:{id:hostId},data:{securityHardening:json({...state,nextCheckAt:new Date(Date.parse(previous.deadline)+120000).toISOString()})}})
      return null
    }
    // No verified inspection means no authority to infer a boot repair from
    // stale or absent environment data. Preserve the original failure reason.
    if(state.revision!==SECURITY_HARDENING_REVISION||state.identityHash!==hardeningIdentityHash(host)||
      !environment.apparmorKernelSupport)return null
    if(record(record(state.host).preflight).status!=='verified'&&state.host!==undefined)return null
    if(state.host!==undefined&&!['verified','not-applicable'].includes(String(record(record(state.host).ssh).status)))return null
    // A missing activation recipe is not the primary problem when an existing
    // customer's identity, isolation or SSH check failed. Keep those actual
    // failures visible instead of replacing them with a release prerequisite.
    for(const value of Array.isArray(state.instances)?state.instances:[]) {
      const customer=record(value)
      const isolation=record(customer.isolation),ssh=record(customer.ssh)
      if(isolation.status==='verified'&&['verified','not-applicable'].includes(String(ssh.status)))continue
      // A deliberately stopped customer has no running process/SSH to probe.
      // It may retain that state through maintenance, but only this exact
      // finding qualifies; capture still verifies persistence, identity and
      // effective isolation before any remote preparation is authorized.
      if(isolation.status!=='needs-maintenance'||isolation.reason!=='HARDENING_GUEST_NOT_RUNNING'||
        ssh.status!=='needs-maintenance'||ssh.reason!==isolation.reason||!Number.isSafeInteger(customer.instanceId))return null
      const current=await tx.instance.findUnique({where:{id:Number(customer.instanceId)},select:{hostId:true,status:true}})
      if(current?.hostId!==hostId||!['stopped','suspended'].includes(current.status))return null
    }
    if(hostMaintenanceRecipe(environment)!==recipe)throw Error('HARDENING_IDENTITY_CHANGED')
    if(!recipe||!deps.accepted(recipe,String(environment.architecture))) {
      const reason=recipe?'HARDENING_NATIVE_ACCEPTANCE_REQUIRED':'HARDENING_BOOT_LAYOUT_UNSUPPORTED'
      const diagnostic=hardeningDiagnostic(reason,'host-inspection')
      await tx.host.update({where:{id:hostId},data:{securityHardening:json({...state,status:'needs-maintenance',
        diagnostic,nextCheckAt:new Date(Date.now()+6*60*60000).toISOString()})}})
      if(record(state.diagnostic).reason!==reason)await tx.log.create({data:{userId:host.onboardingNode!.batch.createdById,
        module:'host',action:'host.security_hardening',result:'warning',
        content:`宿主 #${hostId} 自动维护未启动：${reason==='HARDENING_NATIVE_ACCEPTANCE_REQUIRED'?'此系统与架构的固定方案尚未通过独立启动及原客户恢复验收':'当前引导布局没有固定维护方案'}；${diagnostic.nextAction}。`}})
      return null
    }
    if(!['x86_64','aarch64'].includes(String(environment.architecture)))throw Error('HARDENING_RECIPE_UNSUPPORTED')
    const others=await tx.host.findMany({where:{id:{not:hostId},securityHardening:{path:['maintenance'],not:Prisma.AnyNull}},select:{securityHardening:true}})
    if(others.some(row=>hostMaintenanceBlocked(row.securityHardening)))throw Error('HARDENING_BATCH_PAUSED')
    const customers=await noCustomerConflicts(tx,hostId)
    if(enrollment&&customers.length)throw Error('HARDENING_IDENTITY_CHANGED')
    if(previous){
      // Retry only an exactly rolled-back, never-dispatched preparation after
      // all prior one-minute wire requests have expired. Keep the original
      // identity/config baseline and finite budget; no new trust or reboot.
      if(previous.rebootIssued||previous.identityHash!==hardeningIdentityHash(host)||previous.bootId!==environment.bootId||
        previous.recipe!==recipe||previous.architecture!==environment.architecture)throw Error('HARDENING_IDENTITY_CHANGED')
      await noCustomerConflicts(tx,hostId,previous)
      await assertRemoteBaseline(host,tx,deps,previous)
      const proof=await deps.command(host,{...previous,action:'status'})
      if(!['rolled-back','absent'].includes(proof.phase)||proof.bootId!==previous.bootId)throw Error('HARDENING_JOURNAL_CONFLICT')
      const now=Date.now()
      const intent:HostMaintenanceIntent={...previous,phase:'prepared',prepareHash:'0'.repeat(64),
        preparationRetries:(previous.preparationRetries||0)+1,startedAt:new Date(now).toISOString(),deadline:new Date(now+20*60000).toISOString()}
      delete intent.error;recordMaintenanceEvent(intent)
      await tx.host.update({where:{id:hostId},data:{securityHardening:json({...state,status:'retry',maintenance:intent})}})
      return {host,intent}
    }
    const client=customers.length?await deps.connect(host,tx,8000):null
    const baselines=[]
    for(const customer of customers)baselines.push(await deps.capture(client!,customer,host.natPublicIp||'',undefined,()=>authorized(tx,host,deps.held,enrollment)))
    const plannedAt=Date.now()
    const intent:HostMaintenanceIntent={revision:'host-maintenance-v1',requestId:randomUUID(),identityHash:hardeningIdentityHash(host),
      bootId:String(environment.bootId),prepareHash:'0'.repeat(64),recipe,architecture:environment.architecture as 'x86_64'|'aarch64',
      phase:'prepared',rebootIssued:false,startedAt:new Date(plannedAt).toISOString(),deadline:new Date(plannedAt+20*60000).toISOString(),customers:baselines}
    readHostMaintenanceIntent(intent)
    recordMaintenanceEvent(intent)
    // Separate preparation-started state: a zero preparation hash is a marker,
    // never permission to reboot. Remote status/prepare resolves lost replies.
    await tx.host.update({where:{id:hostId},data:{securityHardening:json({...state,status:'retry',maintenance:intent})}})
    return {host,intent}
  },{maxWait:3000,timeout:60000})) } catch(error) {
    // A prerequisite failure before an intent exists must still be visible
    // and scheduled. No synthetic intent may claim a remote write occurred.
    const raw=error instanceof Error?error.message:''
    const code=/^(HARDENING|ALPINE_SSH)_[A-Z_]{1,90}$/.test(raw)?raw:'HARDENING_PREPARE_FAILED'
    await prisma.$transaction(async tx=>{
      await tx.$executeRaw`SET LOCAL lock_timeout='2s'`
      await tx.$queryRaw`SELECT id FROM hosts WHERE id=${hostId} FOR UPDATE`
      const host=await tx.host.findUnique({where:{id:hostId},include});if(!host)return
      if(enrollment?!ownsOnboardingHardeningLease(host.onboardingNode,enrollment):onboardingOwnsHardening(host.onboardingNode))return
      const state=record(host.securityHardening)
      if(state.identityHash!==hardeningIdentityHash(host))return
      if(state.maintenance&&readHostMaintenanceIntent(state.maintenance).phase!=='aborted')return
      await tx.host.update({where:{id:hostId},data:{securityHardening:json({...state,status:'retry',
        diagnostic:hardeningDiagnostic(code,'host-inspection'),nextCheckAt:new Date(Date.now()+30000).toISOString()})}})
    },{maxWait:3000,timeout:8000})
    throw error
  }
  if(planned)await resumeAutomaticHostMaintenance(hostId,deps,enrollment)
}

export async function resumeAutomaticHostMaintenance(hostId:number,deps=hostMaintenanceDependencies,enrollment?:Enrollment):Promise<void> {
  return withHostMaintenanceLane(hostId,()=>resumeMaintenance(hostId,deps,enrollment))
}
async function resumeMaintenance(hostId:number,deps:typeof hostMaintenanceDependencies,enrollment?:Enrollment):Promise<void> {
  if(deps.held())return
  let original:HostMaintenanceIntent|undefined
  try{
    const action=await prisma.$transaction(async tx=>{
      await tx.$executeRaw`SET LOCAL lock_timeout='2s'`
      const candidate=await tx.host.findUnique({where:{id:hostId},select:{securityHardening:true}})
      const pending=record(candidate?.securityHardening).maintenance
      if(!pending)return null
      original=readHostMaintenanceIntent(pending)
      if(['verified','aborted'].includes(original.phase))return null
      await lockMaintenanceCustomers(tx,hostId)
      await tx.$queryRaw`SELECT id FROM hosts WHERE id=${hostId} FOR UPDATE`
      const host=await tx.host.findUniqueOrThrow({where:{id:hostId},include}),state=record(host.securityHardening)
      // A periodic scan selected before enrollment changed, or an expired
      // worker, must not overwrite the current enrollment's schedule/receipt.
      if(enrollment?!ownsOnboardingHardeningLease(host.onboardingNode,enrollment):onboardingOwnsHardening(host.onboardingNode))return null
      if(!state.maintenance)return null
      const intent=readHostMaintenanceIntent(state.maintenance);original=intent
      if(['verified','aborted'].includes(intent.phase))return null
      await authorized(tx,host,deps.held,enrollment)
      if(hardeningIdentityHash(host)!==intent.identityHash)throw Error('HARDENING_IDENTITY_CHANGED')
      if(!deps.accepted(intent.recipe,intent.architecture))throw Error('HARDENING_RECIPE_UNSUPPORTED')
      const firstPreparation=intent.prepareHash==='0'.repeat(64)
      const expired=Date.now()>=Date.parse(intent.deadline)
      if(firstPreparation&&!expired) {
        await noCustomerConflicts(tx,hostId,intent)
        await assertRemoteBaseline(host,tx,deps,intent)
        if(Date.now()>=Date.parse(intent.deadline))throw Error('HARDENING_REQUEST_EXPIRED')
      }
      // An expired lost preparation reply grants only discovery/rollback.
      // Replaying prepare here could install packages or edit boot settings
      // after the maintenance deadline, before immediately undoing them.
      let receipt=await deps.command(host,{...intent,action:firstPreparation&&!expired?'prepare':'status'})
      if(intent.prepareHash==='0'.repeat(64))intent.prepareHash=receipt.prepareHash
      if(receipt.phase==='preparing'&&Date.now()<Date.parse(intent.deadline)&&!firstPreparation){
        await noCustomerConflicts(tx,hostId,intent)
        await assertRemoteBaseline(host,tx,deps,intent)
        if(Date.now()>=Date.parse(intent.deadline))throw Error('HARDENING_REQUEST_EXPIRED')
        receipt=await deps.command(host,{...intent,action:'prepare'})
      }
      if(receipt.phase==='preparing'&&Date.now()<Date.parse(intent.deadline)){
        recordMaintenanceEvent(intent)
        await tx.host.update({where:{id:hostId},data:{securityHardening:json({...state,maintenance:intent,nextCheckAt:new Date(Date.now()+30000).toISOString()})}})
        return null
      }
      const decision=nextMaintenanceAction(intent,{identityHash:receipt.identityHash,prepareHash:receipt.prepareHash,bootId:receipt.bootId,
        remotePhase:receipt.phase,recoveryHeld:deps.held()})
      if(decision==='blocked')throw Error('HARDENING_RECONNECT_TIMEOUT')
      if(decision==='none')return null
      if(decision==='rollback'){
        await assertRemoteBaseline(host,tx,deps,intent,true)
        const rollback=await deps.command(host,{...intent,action:'rollback'})
        if(rollback.phase!=='rolled-back'||rollback.bootId!==intent.bootId)throw Error('HARDENING_REMOTE_RESULT_UNKNOWN')
      }
      if(decision==='rollback'||decision==='aborted'){
        intent.phase='aborted';intent.rebootIssued=false;delete intent.error
      }else if(decision==='reboot'){
        await noCustomerConflicts(tx,hostId,intent)
        await assertRemoteBaseline(host,tx,deps,intent)
        intent.phase='reboot-intent';intent.rebootIssued=true
        await tx.host.update({where:{id:hostId},data:{securityHardening:json({...state,maintenance:intent})}})
      }else if(decision==='restore')intent.phase='restoring'
      else if(receipt.phase==='reboot-intent')intent.phase='waiting-boot'
      recordMaintenanceEvent(intent)
      await tx.host.update({where:{id:hostId},data:{securityHardening:json({...state,maintenance:intent,nextCheckAt:new Date(Date.now()+30000).toISOString()})}})
      return {host,intent,decision,bootId:receipt.bootId,bootPolicyRestored:receipt.phase==='customers-restored'}
    },{maxWait:3000,timeout:70000})
    if(!action)return
    if(action.decision==='reboot'){
      // Commit before dispatch. A lost reply is resolved against the remote
      // journal; only its still-prepared phase permits same-request dispatch.
      await prisma.$transaction(async tx=>{
        await tx.$executeRaw`SET LOCAL lock_timeout='2s'`
        await lockMaintenanceCustomers(tx,hostId)
        await tx.$queryRaw`SELECT id FROM hosts WHERE id=${hostId} FOR UPDATE`
        const host=await tx.host.findUniqueOrThrow({where:{id:hostId},include}),state=record(host.securityHardening)
        await authorized(tx,host,deps.held,enrollment)
        const intent=readHostMaintenanceIntent(state.maintenance)
        await noCustomerConflicts(tx,hostId,intent)
        if(intent.requestId!==action.intent.requestId||intent.phase!=='reboot-intent'||intent.identityHash!==hardeningIdentityHash(host))throw Error('HARDENING_IDENTITY_CHANGED')
        await assertRemoteBaseline(host,tx,deps,intent)
        if(Date.now()>=Date.parse(intent.deadline))throw Error('HARDENING_REQUEST_EXPIRED')
        const receipt=await deps.command(host,{...intent,action:'reboot'})
        if(receipt.phase!=='reboot-intent')throw Error('HARDENING_REMOTE_RESULT_UNKNOWN')
        intent.phase='waiting-boot'
        recordMaintenanceEvent(intent)
        await tx.host.update({where:{id:hostId},data:{securityHardening:json({...state,maintenance:intent,nextCheckAt:new Date(Date.now()+30000).toISOString()})}})
      },{maxWait:3000,timeout:70000})
      await deps.invalidate(hostId)
    }else if(action.decision==='restore'){
      await deps.invalidate(hostId)
      // Keep the additional read-only host proof outside the existing bounded
      // customer recovery transaction, while retaining the same host lane.
      // No durable success is recorded; retries obtain a fresh proof again.
      const bootReport=await prisma.$transaction(async tx=>{
        await tx.$executeRaw`SET LOCAL lock_timeout='2s'`
        await tx.$queryRaw`SELECT id FROM hosts WHERE id=${hostId} FOR UPDATE`
        const host=await tx.host.findUniqueOrThrow({where:{id:hostId},include}),state=record(host.securityHardening)
        await authorized(tx,host,deps.held,enrollment)
        const intent=readHostMaintenanceIntent(state.maintenance)
        if(intent.requestId!==action.intent.requestId||intent.identityHash!==hardeningIdentityHash(host)||
          intent.phase!=='restoring')throw Error('HARDENING_IDENTITY_CHANGED')
        const report=await deps.inspect(host,[],false,()=>authorized(tx,host,deps.held,enrollment),Date.now()+40000,randomUUID())
        await assertBootDefense(tx,hostId,intent,report)
        if(report.preflight.bootId!==action.bootId)throw Error('HARDENING_RECONNECT_INCOMPLETE')
        return report
      },{maxWait:3000,timeout:60000})
      await prisma.$transaction(async tx=>{
        await tx.$executeRaw`SET LOCAL lock_timeout='2s'`
        await lockMaintenanceCustomers(tx,hostId)
        await tx.$queryRaw`SELECT id FROM hosts WHERE id=${hostId} FOR UPDATE`
        const host=await tx.host.findUniqueOrThrow({where:{id:hostId},include}),state=record(host.securityHardening)
        await authorized(tx,host,deps.held,enrollment)
        const intent=readHostMaintenanceIntent(state.maintenance)
        await noCustomerConflicts(tx,hostId,intent,true)
        if(intent.requestId!==action.intent.requestId||intent.identityHash!==hardeningIdentityHash(host))throw Error('HARDENING_IDENTITY_CHANGED')
        const client=await deps.connect(host,tx,8000)
        await assertRemoteBaseline(host,tx,deps,intent,true)
        // Final guest checks alone would detect a failed AppArmor boot only
        // after starting a customer. Recheck the independent host/Agent proof
        // under current authority before granting any customer action.
        await assertBootDefense(tx,hostId,intent,bootReport)
        const guests=[]
        for(const customer of intent.customers) {
          const result=await deps.recover(tx,client,customer,()=>authorized(tx,host,deps.held,enrollment),host.natPublicIp||'',undefined,action.bootPolicyRestored)
          if(result.state==='running') {
            const runtime=await client.request<{status?:string;pid?:number}>('GET',`/1.0/instances/${encodeURIComponent(customer.incusId)}/state`,null,8000)
            if(runtime.status!=='Running'||!Number.isSafeInteger(runtime.pid)||runtime.pid!<=0)throw Error('HARDENING_RECONNECT_INCOMPLETE')
            guests.push({instanceId:customer.id,pid:runtime.pid!})
          }
        }
        const report=guests.length?await deps.inspect(host,guests,false,()=>authorized(tx,host,deps.held,enrollment),Date.now()+40000,randomUUID()):bootReport
        await assertBootDefense(tx,hostId,intent,report)
        if(report.preflight.bootId!==bootReport.preflight.bootId)throw Error('HARDENING_RECONNECT_INCOMPLETE')
        if(report.guests.length!==guests.length||report.guests.some(guest=>!safeCustomerRuntime(guest)||!guest.apparmor?.startsWith('incus-')||!guest.apparmor.includes('(enforce)')))throw Error('HARDENING_RECONNECT_INCOMPLETE')
        // Keep the remote boot fence disabled until all recovery checks pass.
        // A lost restore response is resolved by its independent remote phase.
        // Empty hosts need the same durable remote completion as occupied
        // hosts. Otherwise the old reboot-intent journal survives a local
        // success and conflicts with the next maintenance or onboarding.
        const restored=await deps.command(host,{...intent,action:'restore-customers'})
        if(restored.phase!=='customers-restored'||restored.bootId!==report.preflight.bootId)throw Error('HARDENING_RECONNECT_INCOMPLETE')
        for(const customer of intent.customers)if((await readRestoreIdentity(client,customer.incusId)).configurationHash!==customer.boot!.configurationHash)throw Error('HARDENING_IDENTITY_CHANGED')
        intent.phase='verified'
        delete intent.error
        recordMaintenanceEvent(intent)
        await tx.host.update({where:{id:hostId},data:{securityHardening:json({...state,revision:SECURITY_HARDENING_REVISION,status:'retry',maintenance:intent,nextCheckAt:new Date(0).toISOString()})}})
      },{maxWait:3000,timeout:120000})
    }
  }catch(error){
    if(!original)throw error
    const raw=error instanceof Error?error.message:'',code=/^HARDENING_[A-Z_]{1,90}$/.test(raw)?raw:'HARDENING_REMOTE_RESULT_UNKNOWN'
    await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM hosts WHERE id=${hostId} FOR UPDATE`
      const host=await tx.host.findUnique({where:{id:hostId},include});if(!host)return
      if(enrollment?!ownsOnboardingHardeningLease(host.onboardingNode,enrollment):onboardingOwnsHardening(host.onboardingNode))return
      const state=record(host.securityHardening),intent=readHostMaintenanceIntent(state.maintenance)
      if(intent.requestId!==original!.requestId)return
      intent.error=code
      if(['HARDENING_IDENTITY_CHANGED','HARDENING_RECIPE_UNSUPPORTED','HARDENING_RECONNECT_TIMEOUT','HARDENING_JOURNAL_CONFLICT'].includes(code)||Date.now()>Date.parse(intent.deadline))intent.phase='blocked'
      recordMaintenanceEvent(intent,code)
      await tx.host.update({where:{id:hostId},data:{securityHardening:json({...state,status:'retry',maintenance:intent,nextCheckAt:new Date(Date.now()+30000).toISOString()})}})
    })
  }
}
