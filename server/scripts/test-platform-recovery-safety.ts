import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { validatePrefix, validateObjectPrefix, validateObjectKey } from '../src/services/platform-backup-core.js'
import { assertGatewayNetworkAvailable } from '../src/services/platform-backup-gateway.js'
import { compareRecoveryIdentities, verifyRecoveryResources, assertRecoveryGuestResources } from '../src/services/platform-recovery-inventory.js'
import { recoveryMappingEnvironment } from '../src/services/platform-recovery-mapping.js'
import { recoverMappingJournal, type RecoveryMappingJournal } from '../src/services/platform-recovery-mapping-journal.js'
import { ProxyStrategyFactory } from '../src/lib/proxy/index.js'
import { resumeReviewedRecovery } from '../src/services/platform-recovery-resume.js'
import { recoveryHostErrorCode, recoveryHostPolicy } from '../src/services/platform-recovery-policy.js'
import { recoverySupervisorRetry, resumeInterruptedRecovery } from '../src/services/platform-recovery-supervisor.js'
import { interruptedRestoreAction, rollbackDatabasePlan, validateRestoreJournal, type RestoreJournal } from '../src/services/platform-recovery-restore-journal.js'
import { statePath } from '../src/services/platform-backup-core.js'
import { IncusClient, IncusApiError } from '../src/lib/incus/incus-client.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { ensure } from '../src/services/platform-backup-core.js'
import { recoveryOrderQuantity, assertRecoveredOrderPrincipal, recoveredRegistrationPrincipal, recoveredPartialPrincipal } from '../src/services/platform-recovery-accounting.js'
import { databaseAdminFailure } from '../src/services/platform-backup-database.js'
import { assertGatewayBaseline, gatewayBaseline, localGatewayBaseline } from '../src/services/platform-recovery-gateway-baseline.js'
import { recoverDedicatedNetwork, type RecoveryForward } from '../src/services/platform-recovery-network.js'
import { dedicatedIpv6Address } from '../src/lib/host-public-ipv6.js'
import { dedicatedIpv6NetworkDigest } from '../src/lib/incus/dedicated-ipv6.js'
import ssh2 from 'ssh2'
import { automaticResumeDecision, automaticResumeRetry } from '../src/services/platform-recovery-policy.js'
import { verifyRecoveryGatewayAutomation } from './fixtures/recovery-gateway.js'

await verifyRecoveryGatewayAutomation()
await (await import('./fixtures/recovery-delivery-network.js')).verifyRecoveryDeliveryNetwork()
import { assertRecoveryOrderOwnership } from '../src/services/platform-recovery-ownership.js'
import { assertRecoveryRefundableLifecycle, recoveryCompletedDeletion } from '../src/services/platform-recovery-lifecycle.js'

const deletedGuest={id:1,userId:1,hostId:1,incusId:'original',status:'deleted'}
assert.throws(()=>assertRecoveryRefundableLifecycle([deletedGuest]),/DELETION_CAUSE_REQUIRED/)
assert.throws(()=>assertRecoveryRefundableLifecycle([{...deletedGuest,snapshottedSpecs:{poolProvision:{version:1,phase:'creating'}}}]),/DELETION_CAUSE_REQUIRED/)
assertRecoveryRefundableLifecycle([{...deletedGuest,snapshottedSpecs:{poolProvision:{version:1,phase:'failed'}}}])
assert.throws(()=>assertRecoveryRefundableLifecycle([{...deletedGuest,deletionIntent:{refund:true},snapshottedSpecs:{poolProvision:{version:1,phase:'failed'}}}]),/WALLET_LINEAGE_REQUIRED/)
const completeIntent={version:1,revision:randomUUID(),actor:{id:1},mode:'admin',ownerId:1,hostId:1,name:'original',instanceVersion:0,
  hostIdentity:'original-host',requestedAt:new Date(Date.now()-1000).toISOString(),refund:true,refundAmount:1,status:'done',attempts:1,sites:[]}
assert.equal(recoveryCompletedDeletion({...deletedGuest,version:0,deletionIntent:completeIntent}),true)
for(const refundAmount of [NaN,Infinity,-1,0.001,Number.MAX_SAFE_INTEGER])
  assert.equal(recoveryCompletedDeletion({...deletedGuest,version:0,deletionIntent:{...completeIntent,refundAmount}}),false)
for(const patch of [{actor:{id:0}},{requestedAt:new Date(Date.now()+60000).toISOString()},{refundBillingRecordId:-1}])
  assert.equal(recoveryCompletedDeletion({...deletedGuest,version:0,deletionIntent:{...completeIntent,...patch}}),false)

const ownershipGuest={id:1,userId:3,hostId:5,incusId:'final-name',snapshottedSpecs:{recoveryIdentity:{uuid:'11111111-1111-4111-8111-111111111111'}}}
const transferProof=(from:number,to:number,time:number,oldName:string,newName:string)=>({instanceId:1,fromUserId:from,toUserId:to,status:'accepted',acceptedAt:new Date(time),
  cleanupState:{stage:'finalize',sourceOwnerId:from,targetOwnerId:to,hostId:5,remoteUuid:ownershipGuest.snapshottedSpecs.recoveryIdentity.uuid,oldIncusId:oldName,newIncusId:newName}})
const ownershipProofs=[transferProof(1,2,100,'original-name','middle-name'),transferProof(2,3,200,'middle-name','final-name')]
assertRecoveryOrderOwnership(1,new Date(0),ownershipGuest,ownershipProofs)
assert.throws(()=>assertRecoveryOrderOwnership(1,new Date(0),ownershipGuest,[]),/OWNERSHIP_UNPROVEN/)
assert.throws(()=>assertRecoveryOrderOwnership(1,new Date(0),ownershipGuest,ownershipProofs.slice(1)),/OWNERSHIP_UNPROVEN/)
assert.throws(()=>assertRecoveryOrderOwnership(1,new Date(150),ownershipGuest,ownershipProofs),/OWNERSHIP_UNPROVEN/)
assert.throws(()=>assertRecoveryOrderOwnership(1,new Date(0),{...ownershipGuest,hostId:6},ownershipProofs),/OWNERSHIP_UNPROVEN/)
assert.throws(()=>assertRecoveryOrderOwnership(1,new Date(0),ownershipGuest,[ownershipProofs[0],{...ownershipProofs[1],status:'processing'}]),/TRANSFER_PENDING/)
assert.throws(()=>assertRecoveryOrderOwnership(1,new Date(0),ownershipGuest,[ownershipProofs[0],{...ownershipProofs[1],cleanupState:{...ownershipProofs[1].cleanupState,remoteUuid:randomUUID()}}]),/OWNERSHIP_UNPROVEN/)

const movedUuid='22222222-2222-4222-8222-222222222222'
const replacementProof={instanceId:1,taskType:'replace_host',status:'COMPLETED',hostId:6,targetHostId:6,
  createdAt:new Date(125),finishedAt:new Date(150),replacementState:{stage:'delivered',sourceHostId:5,sourceIncusId:'middle-name',
    targetIncusId:'replacement-name',targetUuid:movedUuid,targetCreatedAt:new Date(140).toISOString(),sourceHostIdentity:'a'.repeat(64),targetHostIdentity:'b'.repeat(64)}}
const movedTransfer={...ownershipProofs[1],cleanupState:{...ownershipProofs[1].cleanupState,hostId:6,remoteUuid:movedUuid,oldIncusId:'replacement-name'}}
const movedGuest={...ownershipGuest,hostId:6}
assertRecoveryOrderOwnership(1,new Date(0),movedGuest,[ownershipProofs[0],movedTransfer],[replacementProof])
assertRecoveryOrderOwnership(1,new Date(0),{...movedGuest,userId:2,incusId:'replacement-name'},[ownershipProofs[0]],[replacementProof])
assertRecoveryOrderOwnership(1,new Date(0),{...movedGuest,userId:1,incusId:'replacement-name'},[],[replacementProof])
const nextReplacement={...replacementProof,hostId:7,targetHostId:7,createdAt:new Date(210),finishedAt:new Date(250),replacementState:{...replacementProof.replacementState,
  sourceHostId:6,sourceIncusId:'final-name',sourceUuid:movedUuid,targetIncusId:'last-name',targetUuid:randomUUID(),targetCreatedAt:new Date(240).toISOString()}}
assertRecoveryOrderOwnership(1,new Date(0),{...movedGuest,hostId:7,incusId:'last-name'},[ownershipProofs[0],movedTransfer],[nextReplacement,replacementProof])
for(const change of [{sourceHostId:9},{sourceIncusId:'wrong'},{sourceUuid:randomUUID()},{stage:'creating'},
  {targetUuid:'invalid'},{sourceHostIdentity:undefined},{targetCreatedAt:new Date(151).toISOString()}])
  assert.throws(()=>assertRecoveryOrderOwnership(1,new Date(0),movedGuest,[ownershipProofs[0],movedTransfer],
    [{...replacementProof,replacementState:{...replacementProof.replacementState,...change}}]),/REPLACEMENT_UNPROVEN/)
for(const change of [{createdAt:new Date(90)},{finishedAt:null},{hostId:8},{taskType:'change_host'}])
  assert.throws(()=>assertRecoveryOrderOwnership(1,new Date(0),movedGuest,[ownershipProofs[0],movedTransfer],[{...replacementProof,...change}]),/UNPROVEN/)
assert.throws(()=>assertRecoveryOrderOwnership(1,new Date(0),movedGuest,[ownershipProofs[0],movedTransfer],[{...replacementProof,status:'PROCESSING'}]),/INSTANCE_TASK_PENDING/)
assert.throws(()=>assertRecoveryOrderOwnership(1,new Date(0),movedGuest,[ownershipProofs[0],movedTransfer],[replacementProof,replacementProof]),/UNPROVEN/)
assert.throws(()=>assertRecoveryOrderOwnership(1,new Date(0),movedGuest,[ownershipProofs[0],{...movedTransfer,acceptedAt:new Date(145)}],[replacementProof]),/UNPROVEN/)
assert.throws(()=>assertRecoveryOrderOwnership(1,new Date(0),movedGuest,[ownershipProofs[0],{...movedTransfer,cleanupState:{...movedTransfer.cleanupState,remoteUuid:randomUUID()}}],[replacementProof]),/OWNERSHIP_UNPROVEN/)

assert.equal(automaticResumeDecision(null,'new',100),1)
assert.equal(automaticResumeDecision({sourceHash:'same',attempt:4,nextAt:new Date(200).toISOString(),status:'retry'},'same',100),null)
assert.equal(automaticResumeDecision({sourceHash:'same',attempt:4,nextAt:new Date(200).toISOString(),status:'retry'},'changed',100),null,'a changed source cannot bypass the minimum cooldown')
assert.equal(automaticResumeDecision({sourceHash:'same',attempt:4,nextAt:new Date(0).toISOString(),status:'blocked'},'same',100),null)
assert.equal(automaticResumeDecision({sourceHash:'same',attempt:4,nextAt:new Date(0).toISOString(),status:'blocked'},'changed',100),1)
assert.equal(automaticResumeDecision({sourceHash:'same',attempt:4,nextAt:new Date(0).toISOString(),status:'retry'},'same',100),5)
assert.equal(automaticResumeRetry('OSS_WORKER_START_FAILED',2).status,'retry')
assert.equal(automaticResumeRetry('OSS_WORKER_STOPPED',9).delayMs,1800000)
assert.equal(automaticResumeRetry('OSS_RECOVERY_FINAL_HOST_CHECK_FAILED',2).status,'blocked')
assert.deepEqual(recoverySupervisorRetry('OSS_RECOVERY_DELIVERY_CHECK_PENDING',99),{status:'retry',delayMs:15000})

const networkOwner={hostId:1,originalId:31,name:'original-guest',ipv4:'10.0.0.5',natBindIp:'192.0.2.1'}
const ipv4Rule={listen_address:'192.0.2.1',description:'payincus-dedicated:original-guest',config:{target_address:'10.0.0.5'},ports:[]}
assert.equal(recoverDedicatedNetwork(networkOwner,[ipv4Rule],null,[]).status,'none')
const address='2603:c020:802a:cc00::1',gatewayIp='fd42:1:2:3::1'
const privateIp=dedicatedIpv6Address(gatewayIp,31,address),fallbackIp=dedicatedIpv6Address(gatewayIp,31,`${address}:other-protocols`)
const ipv6Rule:RecoveryForward={listen_address:address,description:ipv4Rule.description,config:{target_address:fallbackIp},ports:['tcp','udp'].map(protocol=>({protocol,listen_port:'1-65535',target_address:privateIp,snat:true}))}
const bridgeConfig={'ipv6.address':gatewayIp+'/64','ipv6.nat':'true','user.payincus.ipv6.ready':dedicatedIpv6NetworkDigest([{publicIp:address,privateIp,fallbackIp,ready:true}])}
const savedNetwork={addresses:[privateIp,fallbackIp],gateway:gatewayIp,running:true}
const recoveredNetwork=recoverDedicatedNetwork(networkOwner,[ipv4Rule,ipv6Rule],bridgeConfig,[privateIp,fallbackIp],savedNetwork)
assert.equal(recoveredNetwork.mappings[0].privateIp,privateIp)
assert.equal(recoveredNetwork.mappings[0].ready,false,'configuration alone never claims working IPv6')
assert.equal(recoveredNetwork.status,'pending')
assert.equal(recoverDedicatedNetwork(networkOwner,[ipv4Rule,ipv6Rule],bridgeConfig,[],{...savedNetwork,running:false}).primary,address,'stopped guests retain original mapping without being started')
assert.throws(()=>recoverDedicatedNetwork({...networkOwner,originalId:32},[ipv4Rule,ipv6Rule],bridgeConfig,[privateIp,fallbackIp],savedNetwork),/FORWARD_MISMATCH/)
assert.throws(()=>recoverDedicatedNetwork(networkOwner,[ipv4Rule,ipv6Rule],bridgeConfig,[privateIp],savedNetwork),/GUEST_ADDRESSES_MISSING/)
assert.throws(()=>recoverDedicatedNetwork(networkOwner,[ipv4Rule,ipv6Rule],{...bridgeConfig,'user.payincus.ipv6.ready':''},[privateIp,fallbackIp],savedNetwork),/NETWORK_PENDING/)
assert.throws(()=>recoverDedicatedNetwork(networkOwner,[ipv4Rule,{...ipv6Rule,description:'another-guest'}],bridgeConfig,[privateIp,fallbackIp],savedNetwork),/FORWARD_MISMATCH/)
assert.throws(()=>recoverDedicatedNetwork(networkOwner,[ipv4Rule,ipv6Rule],bridgeConfig,[privateIp,fallbackIp]),/CONFIG_MISSING/)
assert.throws(()=>recoverDedicatedNetwork(networkOwner,[ipv4Rule,ipv6Rule],bridgeConfig,[privateIp,fallbackIp],{...savedNetwork,addresses:[fallbackIp,privateIp]}),/CONFIG_MISMATCH/)

const originalGateway={publicKey:'A'.repeat(43)+'=',managementSshPublicKey:ssh2.utils.generateKeyPairSync('ed25519').public,controlIp:'10.253.240.1',network:'10.253.240.0/20',endpoint:'gateway.example.test:51820',sshHost:'192.0.2.1'}
assertGatewayBaseline(gatewayBaseline(originalGateway),{...originalGateway,sshHost:'192.0.2.2'})
for(const key of ['publicKey','managementSshPublicKey','controlIp','network'])assert.throws(()=>assertGatewayBaseline(gatewayBaseline(originalGateway),{...originalGateway,[key]:'changed'}),/IDENTITY_CHANGED/)
assert.throws(()=>assertGatewayBaseline(null,originalGateway),/BASELINE_INVALID/)
for(const change of [{managementSshPublicKey:'ssh-ed25519 invalid'}, {network:'10.253.240.1/20'}, {controlIp:'10.253.255.255'}, {controlIp:'192.0.2.1'}])
  assert.throws(()=>assertGatewayBaseline({...gatewayBaseline(originalGateway),...change},originalGateway),/BASELINE_INVALID/)
// RFC 7748 X25519 test vector; tests derivation from archived WG identity.
const wgPrivate=Buffer.from('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a','hex').toString('base64')
const derivedGateway=localGatewayBaseline(`[Interface]\nAddress = 10.253.240.1/20\nPrivateKey = ${wgPrivate}\n`,originalGateway.managementSshPublicKey)
assert.equal(derivedGateway.publicKey,Buffer.from('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a','hex').toString('base64'))
assert.equal(derivedGateway.network,'10.253.240.0/20')
assert.throws(()=>localGatewayBaseline(`[Interface]\nAddress = 10.253.240.1/20\nPrivateKey = ${wgPrivate}\nPrivateKey = ${wgPrivate}\n`,originalGateway.managementSshPublicKey),/BASELINE_INVALID/)

const mappingSource=await readFile(new URL('../src/services/platform-recovery-mapping.ts',import.meta.url),'utf8')
const mappingStart=mappingSource.indexOf('export async function inspectRecoveryMapping(')
assert.ok(mappingStart>0)
const mappingJs=ts.transpileModule(mappingSource.slice(mappingStart).replace('export async','async')+'\nreturn inspectRecoveryMapping',
  {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
for(const modern of [false,true]) {
  const commands:string[]=[];let closed=false
  const candidate={...originalGateway,...(modern?{recoveryProtocolVersion:1,recovery:{version:1,observedAt:Date.now(),peers:[]}}:{})}
  const bindings={recoveryMappingEnvironment,readFile:async()=>Buffer.from('test-only-key'),
    parseEnv:()=>({ONBOARDING_GATEWAY_KEY_PATH:'/test-key',ONBOARDING_GATEWAY_FINGERPRINT:'original-pin',ONBOARDING_WG_ENDPOINT:'gateway.example.test:51820'}),
    connectOnboardingSsh:async(options:any,pin:(value:string)=>Promise<boolean>)=>{assert.equal(options.host,'192.0.2.2');assert.equal(await pin('original-pin'),true);assert.equal(await pin('new-pin'),false);return {end:()=>{closed=true}}},
    sshExec:async(_client:unknown,command:string)=>{commands.push(command);return JSON.stringify(candidate)},
    validateGatewayResponse:(raw:any)=>raw,assertSavedRecoveryGateway:async(value:any)=>assertGatewayBaseline(gatewayBaseline(originalGateway),value),ensure}
  const inspect=new Function(...Object.keys(bindings),mappingJs)(...Object.values(bindings))
  const mapped=await inspect("ONBOARDING_GATEWAY_HOST='192.0.2.1'\nONBOARDING_GATEWAY_FINGERPRINT='SHA256:"+'A'.repeat(43)+"'\nONBOARDING_GATEWAY_KEY_PATH='/opt/incudal/server/certs/gateway.key'\n",'192.0.2.2')
  assert.ok(mapped.environment.includes('192.0.2.2'));assert.equal(closed,true)
  assert.deepEqual(commands,modern?['status','recovery-state']:['status'],'old helper mapping does not require the unavailable old address')
}

for(const [code,expected] of [['57P03','OSS_DATABASE_UNAVAILABLE'],['55P03','OSS_DATABASE_BUSY'],['53100','OSS_DATABASE_STORAGE_FULL'],['28P01','OSS_DATABASE_ADMIN_FAILED']])
  assert.equal(databaseAdminFailure(`FATAL:  ${code}: discarded private text`,false),expected)
assert.equal(databaseAdminFailure('arbitrary network wording',false),'OSS_DATABASE_ADMIN_FAILED')
assert.equal(databaseAdminFailure('',true),'OSS_DATABASE_ADMIN_TIMEOUT')

assert.equal(recoveryOrderQuantity([{quantity:2},{quantity:1}]),3)
for(const display of [[],[{quantity:0}],[{quantity:101}],[{quantity:1.5}]])assert.throws(()=>recoveryOrderQuantity(display),/QUANTITY_REQUIRED/)
const paidBills=[{instanceId:1,type:'newPurchase',amount:'4.00'},{instanceId:2,type:'newPurchase',amount:'6.00'},{instanceId:2,type:'refund',amount:'-2.00'}]
assert.equal(recoveredRegistrationPrincipal(1000,2,[],[],400),400)
assert.equal(recoveredRegistrationPrincipal(1000,2,[{id:1}],[paidBills[0]],600),600)
for(const amount of [undefined,0,599,601,1000])assert.throws(()=>recoveredRegistrationPrincipal(1000,2,[{id:1}],[paidBills[0]],amount),/PRINCIPAL_MISMATCH/)
assert.throws(()=>recoveredRegistrationPrincipal(1000,2,[],[],1000),/PRINCIPAL_MISMATCH/)
assert.throws(()=>recoveredRegistrationPrincipal(1000,2,[{id:1},{id:2}],paidBills,1),/QUANTITY_MISMATCH/)
assertRecoveredOrderPrincipal(1000,2,[{id:1},{id:2}],paidBills)
assert.throws(()=>assertRecoveredOrderPrincipal(1000,2,[{id:1}],paidBills),/QUANTITY_MISMATCH/)
assert.throws(()=>assertRecoveredOrderPrincipal(1000,1,[{id:1}],[{instanceId:1,type:'newPurchase',amount:'4.00'}]),/PRINCIPAL_MISMATCH/)
assert.throws(()=>assertRecoveredOrderPrincipal(1000,2,[{id:1},{id:2}],[...paidBills,{instanceId:2,type:'refund',amount:'-9.00'}]),/PRINCIPAL_MISMATCH/)
assert.equal(recoveredPartialPrincipal(1000,2,[{id:1,status:'running'}],[paidBills[0]]).missingCents,600)
assert.equal(recoveredPartialPrincipal(1000,2,[{id:1,status:'running'},{id:2,status:'deleted'}],paidBills).missingCents,0)
assert.throws(()=>recoveredPartialPrincipal(1000,1,[{id:1,status:'running'}],[paidBills[0]]),/PARTIAL_REQUIRED/)
assert.throws(()=>recoveredPartialPrincipal(400,2,[{id:1,status:'running'}],[paidBills[0]]),/PRINCIPAL_MISMATCH/)
assert.throws(()=>recoveredPartialPrincipal(1000,2,[{id:1,status:'running'}],paidBills),/PRINCIPAL_MISMATCH/)
assert.throws(()=>recoveredPartialPrincipal(1000,2,[{id:1,status:'deleted'}],[paidBills[0]]),/PARTIAL_REQUIRED/)

// Exercise the real connect wrapper; no sockets or private certificates.
for (const inner of [{code:'ECONNRESET'}, {code:'UND_ERR_CONNECT_TIMEOUT'}, {code:'INCUS_FINGERPRINT_MISMATCH'}]) {
  const receiver = { connected:true, agent:null, createTransport:()=>({}), getServerInfo:async()=>{throw inner} }
  let caught:unknown
  try { await IncusClient.prototype.connect.call(receiver as unknown as IncusClient) } catch(error) { caught=error }
  assert.equal((caught as Error).cause,inner)
  assert.equal(recoveryHostErrorCode(caught),recoveryHostErrorCode(inner))
}
assert.equal(recoveryHostErrorCode({cause:{cause:{code:'UND_ERR_SOCKET'}}}),'OSS_REVIEW_HOST_UNREACHABLE')
assert.equal(recoveryHostErrorCode({code:'CERTIFICATE_NETWORK_UNAVAILABLE'}),'OSS_REVIEW_UNEXPECTED_FAILURE','unknown certificate text is not proof of changed identity')
const cyclic:{cause?:unknown}={};cyclic.cause=cyclic
assert.equal(recoveryHostErrorCode(cyclic),'OSS_REVIEW_UNEXPECTED_FAILURE')

const restoreId = randomUUID()
const restoreJournal: RestoreJournal = {version:2,taskId:restoreId,workerPid:123,rollbackBatchId:randomUUID(),originalOid:10,restoredOid:20,
  database:'original',staging:`incudal_restore_${restoreId.replace(/-/g,'')}`,rollback:`incudal_before_${restoreId.replace(/-/g,'')}`,
  stage:'switching',config:{} as RestoreJournal['config'],files:[]}
validateRestoreJournal(restoreJournal,statePath('private',restoreId))
const failedDatabase=`incudal_failed_${restoreId.replace(/-/g,'')}`
for (const crash of ['before','old-renamed','both-renamed','failed-renamed','rollback-renamed']) {
  const databases = crash==='before'?[{name:'original',oid:10},{name:restoreJournal.staging,oid:20}]:
    crash==='old-renamed'?[{name:restoreJournal.rollback,oid:10},{name:restoreJournal.staging,oid:20}]:
    crash==='both-renamed'?[{name:restoreJournal.rollback,oid:10},{name:'original',oid:20}]:
    crash==='failed-renamed'?[{name:restoreJournal.rollback,oid:10},{name:failedDatabase,oid:20}]:
    [{name:'original',oid:10},{name:failedDatabase,oid:20}]
  for (const rename of rollbackDatabasePlan(restoreJournal,databases)) {
    assert.ok(!databases.some(row=>row.name===rename.to),'never replace an occupied database name')
    databases.find(row=>row.name===rename.from)!.name=rename.to
  }
  assert.equal(databases.find(row=>row.name==='original')?.oid,10,crash)
  assert.equal(databases.find(row=>row.oid===20)?.oid,20,'recovered data is preserved even on rollback')
  assert.deepEqual(rollbackDatabasePlan(restoreJournal,databases),[],'retry after completed rename is idempotent')
}
for (const databases of [[{name:'original',oid:99}],[{name:restoreJournal.rollback,oid:99}],
  [{name:restoreJournal.rollback,oid:10},{name:'original',oid:20},{name:failedDatabase,oid:99}]])
  assert.throws(()=>rollbackDatabasePlan(restoreJournal,databases),/IDENTITY_CHANGED/)
for (const stage of ['protected_start','rollback_prepared']) assert.equal(interruptedRestoreAction({...restoreJournal,stage}),'start')
for (const stage of ['prepared','switching','database_switched','files_switched','rolling_back']) assert.equal(interruptedRestoreAction({...restoreJournal,stage}),'rollback')
for (const stage of ['awaiting_review','rolled_back_review']) assert.equal(interruptedRestoreAction({...restoreJournal,stage}),'none')
assert.throws(()=>interruptedRestoreAction({...restoreJournal,version:undefined}),/IDENTITY_MISSING/)
assert.throws(()=>validateRestoreJournal({...restoreJournal,files:[{target:'/etc/passwd',saved:null,mode:0o600}]},statePath('private',restoreId)),/STATE_INVALID/)
assert.throws(()=>validateRestoreJournal({...restoreJournal,files:[{target:'/opt/incudal/.env',saved:'../before-1',mode:0o600}]},statePath('private',restoreId)),/STATE_INVALID/)
const noStop:string[]=[]
await resumeInterruptedRecovery({stop:async()=>{throw Error('committed service must not stop')},prepare:async()=>{noStop.push('prepare')},
  start:async()=>{noStop.push('start')},ready:async()=>{noStop.push('ready')},health:async()=>{noStop.push('health')}},false)
assert.deepEqual(noStop,['prepare','start','ready','health'])
console.log('PASS interrupted restore OID identity, every rename boundary, retained recovered database and start-only continuation')

// Run the actual supervisor orchestration with filesystem, PostgreSQL and
// systemd boundaries injected. This checks durable decisions, not real systemd.
const supervisorSource=await readFile(new URL('../src/services/platform-recovery-supervisor.ts',import.meta.url),'utf8')
const supervisorStart=supervisorSource.indexOf('async function superviseRecoveryAttempt()')
assert.ok(supervisorStart>0)
const compiledSupervisor=ts.transpileModule(supervisorSource.slice(supervisorStart,supervisorSource.indexOf('export async function superviseRecovery()'))+'\nreturn superviseRecoveryAttempt',
  {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
for(const scenario of ['prepared','committed','restore-rollback','restore-start','restore-offline','lost-start','receipt-condition','unchanged-conflict','changed-evidence','changed-file','database-down']) {
  const id=randomUUID(),batchId=randomUUID(),holdTaskId=randomUUID(),root='fixture-root'
  let now=1000000, starts=0, stops=0, prepares=0, envHash='a'.repeat(64), fileVersion=1, databaseDown=scenario==='database-down', failStart=scenario==='lost-start', conflict=['unchanged-conflict','changed-evidence','changed-file'].includes(scenario)
  const files=new Map<string,unknown>(),resultPath=join(root,'results',id+'.json'),receiptPath=join(root,'recovery-supervisor.json')
  let active:any=scenario.startsWith('restore-')?null:{version:1,taskId:id,batchId,workerPid:123,phase:scenario==='committed'?'committed':'prepared',
    hold:{taskId:holdTaskId,batchId,mode:'restore',createdAt:'2026-11-02T00:00:00Z'},before:{hosts:[],operator:[]}}
  let restored:any=scenario.startsWith('restore-')?{directory:'private-task',hold:{taskId:id,batchId,mode:'restore'},
    journal:{...restoreJournal,taskId:id,...(scenario==='restore-offline'?{snapshotAt:'2026-11-03T00:00:00Z'}:{}),stage:['restore-start','restore-offline'].includes(scenario)?'protected_start':'database_switched'}}:null
  let deliveryOffline=scenario==='restore-offline'
  files.set(resultPath,{id,kind:'restore',status:'running',stage:'stopping'})
  files.set(join(root,'recovery-hold.json'),restored?.hold||active.hold)
  const read=async(path:string)=>structuredClone(files.get(path)??null)
  const write=async(path:string,value:unknown)=>{files.set(path,structuredClone(value));if(path===join('private-task','journal.json'))restored.journal=structuredClone(value)}
  const bindings={
    process:{platform:'linux',getuid:()=>0},Date:{now:()=>now},join,backupRoot:()=>root,statePath:(area:string,name:string)=>join(root,area,name),
    ensure,validateId:(value:unknown)=>assert.match(String(value),/^[a-f0-9-]{36}$/),createHash,hashFile:async()=>envHash,
    continuationError:(error:any)=>error.code||'OSS_RECOVERY_SUPERVISOR_FAILED',
    recoveryContinuationObservation:async()=>({files:fileVersion,error:databaseDown?'OSS_DATABASE_UNAVAILABLE':undefined}),
    recoveryActivationPath:()=>join(root,'activation'),recoveryMappingPath:()=>join(root,'mapping'),
    readJson:async(path:string)=>path===join(root,'activation')?structuredClone(active):await read(path),writeJson:write,
    durableUnlink:async(path:string)=>{files.delete(path)},validateRecoveryActivation:()=>{},validateRecoveryMappingJournal:()=>{},
    readHeldRestoreJournal:async()=>structuredClone(restored),restoreWorkerAlive:async()=>false,interruptedRestoreAction,
    assertRestoreStartIdentity:async()=>{},pgQuery:async()=>[{hold_task_id:holdTaskId,completed_at:scenario==='committed'?new Date():null}],
    completeRestoredSnapshot:async()=>{
      assert.ok(starts>0,'protected backend starts before waiting on original hosts')
      if(deliveryOffline)throw Object.assign(Error('original host offline'),{code:'OSS_REVIEW_HOST_UNREACHABLE'})
    },
    prepareInterruptedRestoreRollback:async()=>{prepares++;restored.journal.stage='rollback_prepared';restored.hold.mode='rollback';restored.hold.batchId=randomUUID();files.set(join(root,'recovery-hold.json'),restored.hold);envHash='b'.repeat(64)},
    recoverInterruptedMapping:async()=>{},recoverInterruptedActivation:async(ready:boolean)=>{
      if(!active)return
      if(conflict)throw Object.assign(Error('private conflict'),{code:'OSS_RECOVERY_MAPPING_FILES_CHANGED'})
      if(active.phase==='prepared'){prepares++;active=null}
      else{files.delete(join(root,'recovery-hold.json'));if(ready)active=null}
    },
    resumeInterruptedRecovery,recoverySupervisorRetry,waitForProtectedBackendHealth:async()=>{
      if(scenario==='receipt-condition' && fileVersion===1)throw Object.assign(Error('context'),{code:'OSS_RECOVERY_CONTEXT_CHANGED'})
    },
    promisify:()=>async(_program:string,args:string[])=>{if(args[0]==='stop')stops++;else{starts++;if(failStart){failStart=false;throw Error('start failure')}}},execFile:()=>{}
  }
  // Date is also constructed for public timestamps; override only now.
  class Clock extends Date {static now(){return now}}
  const run=new Function(...Object.keys(bindings),compiledSupervisor)(...Object.values({...bindings,Date:Clock})) as ()=>Promise<void>
  await run()
  if(scenario==='restore-offline'){
    assert.equal(starts,1);assert.equal(stops,0,'original host outage leaves recovery UI available')
    assert.equal((files.get(receiptPath) as any).status,'retry')
    await run();assert.equal(starts,1,'backoff avoids repeated service operations')
    deliveryOffline=false;now+=1800001;await run();assert.equal(stops,0)
  }else if(scenario==='receipt-condition') {
    assert.equal(active,null);assert.equal((files.get(receiptPath) as any).status,'blocked')
    now+=1800001;await run();assert.equal(starts,1,'same no-WAL conflict does not repeat start')
    fileVersion++;await run();assert.equal(starts,2,'changed observed batch resumes without recreating WAL')
    assert.equal(stops,1,'completed prepare is not repeated')
  }else if(scenario==='database-down') {
    assert.equal((files.get(receiptPath) as any).status,'retry');assert.equal(stops,0);assert.equal(starts,0)
    databaseDown=false;now+=1800001;await run()
  }else if(scenario==='lost-start'){
    assert.equal((files.get(receiptPath) as any).status,'retry');assert.equal(active,null,'receipt survives removed activation WAL')
    now+=1800001;await run();assert.equal(stops,1,'completed recovery must not stop again to retry a lost start')
  }else if(conflict){
    assert.equal((files.get(receiptPath) as any).status,'blocked');assert.equal(starts,0)
    now+=1800001;await run();assert.equal(stops,1,'unchanged deterministic conflict does not repeat stop')
    if(scenario==='changed-evidence'){envHash='c'.repeat(64);conflict=false;await run()}
    if(scenario==='changed-file'){fileVersion++;conflict=false;await run();assert.equal(envHash,'a'.repeat(64))}
  }
  if(scenario!=='unchanged-conflict')assert.equal(files.has(receiptPath),false,'successful receipt clears pending continuation')
  if(['committed','restore-start'].includes(scenario))assert.equal(stops,0,'start-only state must not interrupt a running backend')
  if(scenario==='restore-rollback'){assert.equal(prepares,1);assert.equal(restored.journal.stage,'rolled_back_review');assert.ok(files.has(join(root,'recovery-hold.json')))}
}
console.log('PASS actual supervisor decisions: durable receipt, lost start, prepared rollback, committed start, unchanged conflicts and changed evidence')

assert.equal(recoverySupervisorRetry('OSS_PROTECTED_START_FAILED',8).status,'retry')
assert.equal(recoverySupervisorRetry('ENOSPC',99).delayMs,1800000)
for(const code of ['OSS_RECOVERY_MAPPING_FILES_CHANGED','OSS_RECOVERY_CONTEXT_CHANGED','OSS_RECOVERY_STATE_INVALID','EACCES'])
  assert.equal(recoverySupervisorRetry(code,1).status,'blocked','deterministic conflicts cannot restart the backend in a loop')
for(const failed of ['stop','prepare','start','ready','health','none']) {
  const calls:string[]=[]
  const step=async(name:string)=>{calls.push(name);if(name===failed)throw new Error('injected:'+name)}
  const run=resumeInterruptedRecovery({stop:()=>step('stop'),prepare:()=>step('prepare'),start:()=>step('start'),ready:()=>step('ready'),health:()=>step('health')})
  if(failed==='none')await run;else await assert.rejects(run,/injected/)
  const order=['stop','prepare','start','ready','health']
  assert.deepEqual(calls,failed==='none'?order:order.slice(0,order.indexOf(failed)+1),'failed stage never advances to an unsafe later stage')
}

assert.equal(recoveryHostErrorCode({code:'SSH_HOST_KEY_CHANGED'}),'OSS_REVIEW_IDENTITY_CHANGED')
assert.equal(recoveryHostErrorCode({code:'SSH_AUTH_FAILED'}),'OSS_REVIEW_SSH_AUTH_FAILED')
assert.equal(recoveryHostErrorCode({code:'SSH_CONNECT_FAILED'}),'OSS_REVIEW_HOST_UNREACHABLE')
assert.equal(recoveryHostErrorCode(new IncusApiError('discarded',503,'/1.0')),'OSS_REVIEW_HOST_UNREACHABLE')
assert.equal(recoveryHostErrorCode(new IncusApiError('discarded',401,'/1.0')),'OSS_REVIEW_INCUS_AUTH_FAILED')
assert.equal(recoveryHostErrorCode({code:'CERT_HAS_EXPIRED'}),'OSS_REVIEW_CERTIFICATE_EXPIRED')
assert.equal(recoveryHostErrorCode(new Error('private-detail-must-not-escape')),'OSS_REVIEW_UNEXPECTED_FAILURE')
for (const code of ['OSS_REVIEW_IDENTITY_CHANGED','OSS_REVIEW_SSH_AUTH_FAILED','OSS_REVIEW_MANAGEMENT_REQUIRED','OSS_REVIEW_INVENTORY_MISMATCH','OSS_REVIEW_UNEXPECTED_FAILURE']) {
  assert.equal(recoveryHostPolicy({managementVerified:false,code},1).status,'blocked',`${code} cannot enter a retry loop`)
  assert.equal(recoveryHostPolicy({managementVerified:false,code},1).delayMs,1800000,'read-only observation can detect repaired remote conditions')
}
const outage={managementVerified:false,code:'OSS_REVIEW_HOST_UNREACHABLE'}
assert.equal(recoveryHostPolicy(outage,1).delayMs,30000)
assert.equal(recoveryHostPolicy(outage,8).mode,'observing')
assert.equal(recoveryHostPolicy(outage,1000000).delayMs,1800000,'long outages keep sparse reads and can resume without a click')
assert.equal(recoveryHostPolicy({managementVerified:true,inventory:{inventoryMatched:true}},1000000).status,'success')
assert.equal(recoveryHostPolicy({managementVerified:true,inventory:{inventoryMatched:true}},1,true).status,'retry','changed source cannot pass')

const prefix = validatePrefix('a'.repeat(350)), full = `${prefix}${randomUUID()}/${randomUUID()}/`
assert.equal(validateObjectPrefix(full), full)
assert.equal(validateObjectKey(full + 'payload.enc'), full + 'payload.enc')
assert.equal(validateObjectKey('a'.repeat(1023)).length, 1023)
assert.throws(() => validateObjectKey('a'.repeat(1024)))
assert.throws(() => validatePrefix('汉'.repeat(267)))
assert.equal(Buffer.byteLength(validatePrefix('汉'.repeat(266))), 799)
for (const path of ['../backup','a/../b','a//b','/root','a\\b','a%2fb','a\u0000b']) assert.throws(() => validateObjectPrefix(path))
const config = '[Interface]\nAddress = 10.253.240.1/20\n'
assertGatewayNetworkAvailable(config, [{dst:'default',dev:'eth0'},{dst:'10.253.240.0/20',dev:'incudal-mgmt'}], [{ifname:'eth0',addr_info:[{family:'inet',local:'192.0.2.2',prefixlen:24}]}])
for (const routes of [[{dst:'10.253.240.0/24',dev:'eth0'}],[{dst:'10.253.244.7/32',table:200,dev:'wg0'}],
  [{dst:'10.253.240.0/20',dev:'incudal-mgmt',nexthops:[{dev:'eth0'}]}]]) assert.throws(() => assertGatewayNetworkAvailable(config,routes,[]), /OSS_GATEWAY_NETWORK_CONFLICT/)
assert.throws(() => assertGatewayNetworkAvailable(config,[],[{ifname:'eth1',addr_info:[{family:'inet',local:'10.253.242.5',prefixlen:32}]}]), /OSS_GATEWAY_NETWORK_CONFLICT/)
const guest = {name:'original',uuid:randomUUID(),createdAt:'2026-10-01T00:00:00Z',ownerId:42,status:'running',storagePoolName:'customer'}
const live = {name:guest.name,created_at:guest.createdAt,status:'Running',config:{'volatile.uuid':guest.uuid,'user.payincus.user-id':'42'},expanded_devices:{root:{type:'disk',path:'/',pool:'customer'}}}
assert.equal(compareRecoveryIdentities([guest],[live]).inventoryMatched,true)
assert.equal(compareRecoveryIdentities([guest],[{...live,status:'Stopped'}]).inventoryMatched,false)
assert.equal(compareRecoveryIdentities([guest],[{...live,status:'Stopped'}],true).inventoryMatched,true,'snapshot restore observes natural guest shutdown without restarting it')
assert.equal(compareRecoveryIdentities([{...guest,status:'stopped'}],[live],true).inventoryMatched,true)
assert.equal(compareRecoveryIdentities([{...guest,status:'suspended'}],[live],true).inventoryMatched,false,'billing suspension is not a natural running-state change')
assert.equal(compareRecoveryIdentities([guest],[{...live,status:'Error'}],true).inventoryMatched,false)
for (const changed of [{...live,config:{...live.config,'volatile.uuid':randomUUID()}},{...live,created_at:'2026-11-01T00:00:00Z'},
  {...live,config:{...live.config,'user.payincus.user-id':'43'}},{...live,expanded_devices:{root:{type:'disk',path:'/',pool:'wrong'}}}]) {
  assert.equal(compareRecoveryIdentities([guest],[changed]).inventoryMatched,false)
  assert.equal(compareRecoveryIdentities([guest],[changed],true).inventoryMatched,false,'snapshot mode preserves identity and disk checks')
}
assert.equal(compareRecoveryIdentities([{...guest,uuid:undefined}],[live]).inventoryMatched,false)
assert.equal(compareRecoveryIdentities([{...guest,createdAt:undefined}],[live]).inventoryMatched,true,'legacy saved UUID pins the original guest even without creation timestamp')
assert.equal(compareRecoveryIdentities([{...guest,createdAt:undefined}],[{...live,config:{...live.config,'volatile.uuid':randomUUID()}}]).inventoryMatched,false)
assert.equal(compareRecoveryIdentities([guest],[]).inventoryMatched,false)
const resources={...live,type:'container',config:{...live.config,'limits.cpu':'1','limits.cpu.allowance':'100%','limits.memory':'512MB'},
  expanded_devices:{root:{...live.expanded_devices.root,size:'1024MB'}}}
assertRecoveryGuestResources({cpu:100,memory:512,disk:1024,instanceType:'container'},resources)
for(const changed of [{...resources,type:'virtual-machine'},{...resources,config:{...resources.config,'limits.memory':'512MiB'}},
  {...resources,expanded_devices:{root:{...resources.expanded_devices.root,size:'2048MB'}}}])
  assert.throws(()=>assertRecoveryGuestResources({cpu:100,memory:512,disk:1024,instanceType:'container'},changed),/RESOURCE_MISMATCH/)
const mapping="ONBOARDING_GATEWAY_HOST='192.0.2.10'\nONBOARDING_GATEWAY_KEY_PATH='/opt/incudal/server/certs/original.key'\nONBOARDING_GATEWAY_FINGERPRINT='SHA256:"+'a'.repeat(43)+"'\nONBOARDING_SSH_JUMP_HOST='192.0.2.10'\nONBOARDING_WG_ENDPOINT='gateway.example.test:51820'\n"
const remapped=recoveryMappingEnvironment(mapping,'192.0.2.20')
assert.ok(remapped.includes("ONBOARDING_GATEWAY_HOST='192.0.2.20'"))
assert.ok(remapped.includes("ONBOARDING_SSH_JUMP_HOST='192.0.2.20'"))
assert.ok(remapped.includes("ONBOARDING_GATEWAY_KEY_PATH='/opt/incudal/server/certs/original.key'"))
for(const address of ['127.0.0.1','169.254.169.254','224.0.0.1','example.com','192.0.2.1;id'])assert.throws(()=>recoveryMappingEnvironment(mapping,address))
assert.throws(()=>recoveryMappingEnvironment(mapping.replace('192.0.2.10','127.0.0.1'),'192.0.2.20'),/EXTERNAL_GATEWAY_REQUIRED/)

for (const type of ['container','virtual-machine'] as const) for (const networkMode of ['nat','nat_ipv6_nat']) {
  const host={natBindIp:'192.0.2.8',natPublicIp:null,natBindIpv6:'2001:db8::8',natPublicIpv6:null}
  const expected={incusId:'original',storagePoolName:'customer',ipv4:'10.0.0.5',networkMode,portMappings:[{protocol:'tcp',publicPort:2200,privatePort:22}]}
  const proxy=ProxyStrategyFactory.getStrategy(type).createProxyDevice(host.natBindIp,host.natBindIpv6,networkMode,'tcp',2200,22)
  const devices:Record<string,Record<string,string>>={root:{type:'disk',path:'/',pool:'customer'}}
  for(const entry of proxy.deviceConfigs || [{deviceConfig:proxy.deviceConfig!}]) devices['proxy-tcp-2200'+(entry.nameSuffix||'')]={...entry.deviceConfig}
  let volumes=[{name:'original',type}], forwards:unknown[]=[]
  const client={request:async<T>(_method:string,path:string):Promise<T>=>{
    const reply=path.startsWith('/1.0/projects')?[{name:'default'}]:path.startsWith('/1.0/operations')?{}:
      path.includes('/volumes?')?volumes:path.startsWith('/1.0/storage-pools?')?[{name:'customer'}]:path.includes('/forwards?')?forwards:[{name:'incusbr0',managed:true,type:'bridge'}]
    return reply as T
  }}
  const actual={...live,type,expanded_devices:devices}
  await verifyRecoveryResources(client,[expected],[actual],host)
  for(const key of ['listen','connect','nat']) {
    const changed=structuredClone(actual);changed.expanded_devices['proxy-tcp-2200'][key]='changed'
    await assert.rejects(verifyRecoveryResources(client,[expected],[changed],host),/FORWARD_MISMATCH/)
  }
  const unknown=structuredClone(actual);unknown.expanded_devices['unexpected-proxy']={type:'proxy',listen:'tcp:0.0.0.0:99'}
  await assert.rejects(verifyRecoveryResources(client,[expected],[unknown],host),/FORWARD_MISMATCH/)
  volumes=[]
  await assert.rejects(verifyRecoveryResources(client,[expected],[actual],host),/VOLUME_MISSING/)
  volumes=[{name:'original',type}];forwards=[{listen_address:'192.0.2.99'}]
  await assert.rejects(verifyRecoveryResources(client,[expected],[actual],host),/FORWARD_MISMATCH/)
}

for (const failed of ['none','check1','stop1','check2','release','start1','health1','commit','removeHold','health2','finish']) {
  const calls:string[]=[]; let held=true, changed=false, running=true, committed=false
  const counters:Record<string,number>={}
  const step=(name:string)=> { calls.push(name); counters[name]=(counters[name]||0)+1; if (failed===name || failed===name+counters[name]) throw Error('injected:'+failed) }
  const result=resumeReviewedRecovery({
    check:async phase=>{assert.equal(running,phase==='protected','remote checks run before stopping the progress backend');step('check')},stop:async()=>{step('stop');running=false},start:async()=>{step('start');running=true},
    release:async()=>{changed=true;step('release')},restore:async()=>{step('restore');changed=false},
    commit:async()=>{assert.equal(held,true);step('commit');committed=true},committed:async()=>committed,finish:async()=>{step('finish')},
    health:async expected=>{step('health');assert.equal(held,expected)},
    removeHold:async()=>{assert.equal(committed,true);held=false;step('removeHold')},restoreHold:async()=>{held=true;step('restoreHold')}
  })
  if(failed==='none'){await result;assert.equal(held,false);assert.equal(changed,true)}
  else {await assert.rejects(result,/injected/);assert.equal(held,!committed,failed);assert.equal(changed,committed,failed)}
  assert.equal(running,true,failed)
  if (failed!=='none' && failed!=='check1' && !committed) assert.ok(calls.indexOf('restoreHold')<calls.indexOf('restore'))
  if (committed) assert.ok(!calls.includes('restore'), 'committed business state must never be rolled back')
}
console.log('Recovery safety passed: long OSS paths, UTF-8 limits, network overlaps, original guest identity and durable resume fault cases.')

for (const phase of ['prepared','committed'] as const) for (const failure of ['none','restore','invalidate','health','receipt','remove']) {
  const record: RecoveryMappingJournal = {version:1,taskId:randomUUID(),batchId:randomUUID(),workerPid:2147483647,
    phase,previousHash:'a'.repeat(64),nextHash:'b'.repeat(64)}
  let current = record.nextHash, present = true, fail = failure
  const calls: string[] = []
  const step = (name: string) => {calls.push(name);if (fail===name) {fail='none';throw Error('injected:'+name)}}
  const runtime = {
    activeBatch:async()=>record.batchId,currentHash:async()=>current,
    savedHash:async(name:'before'|'next')=>name==='before'?record.previousHash:record.nextHash,
    restore:async()=>{step('restore');current=record.previousHash},invalidate:async()=>{step('invalidate')},health:async()=>{step('health')},
    receipt:async(committed:boolean)=>{step('receipt');assert.equal(committed,phase==='committed')},remove:async()=>{step('remove');present=false}
  }
  const relevant = phase==='prepared'?['restore','invalidate','receipt','remove']:['health','receipt','remove']
  if (relevant.includes(failure)) {
    await assert.rejects(recoverMappingJournal(record,true,runtime),/injected/)
    assert.equal(present,true,'failed recovery retains its journal')
  }
  await recoverMappingJournal(record,true,runtime)
  assert.equal(present,false)
  assert.equal(current,phase==='committed'?record.nextHash:record.previousHash)
  if(phase==='committed') assert.ok(!calls.includes('restore'),'committed destination is not rolled back')
  calls.length=0
  await assert.rejects(recoverMappingJournal(record,true,{...runtime,activeBatch:async()=>randomUUID()}),/CONTEXT_CHANGED/)
  await assert.rejects(recoverMappingJournal(record,true,{...runtime,currentHash:async()=>'c'.repeat(64)}),/FILES_CHANGED/)
  await assert.rejects(recoverMappingJournal(record,true,{...runtime,savedHash:async()=>'c'.repeat(64)}),/FILES_CHANGED/)
  assert.deepEqual(calls,[],'foreign context or changed files must produce no writes')
}
console.log('PASS mapping interruption: prepared rollback, committed completion, receipt failures, stale batch and changed env refusal')

// Exercise the actual timer boundary, including a persistence outage. No
// database or system service is started by this orchestration fixture.
const queueSource=await readFile(new URL('../src/services/platform-recovery-queue.ts',import.meta.url),'utf8')
const queueStart=queueSource.indexOf('let timer: ReturnType<typeof setInterval>')
const compiledQueue=ts.transpileModule(queueSource.slice(queueStart).replace(/export /g,'')+'\nreturn {startRecoveryReviewWorker,stopRecoveryReviewWorker}',
  {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
let queueNow=0,seedCount=0,queueFailures=true,queueHeld=true,queueActive=false,tick:(()=>void)|undefined,autoCalls=0
const queueBindings={Date:{now:()=>queueNow},recoveryHeld:()=>queueHeld,activeBackupTask:async()=>queueActive?{}:null,
  advanceAutomaticRestore:async()=>{},
  dispatchRecoveryHelper:async()=>{},
  dispatchRecoveryMapping:async()=>{},
  serializeBackupMutation:async(action:()=>Promise<unknown>)=>action(),reconcileIntactLegacyOrders:async()=>{},reconcileIntactCheckoutOrders:async()=>{},
  seedRecoveryHosts:async()=>{seedCount++;if(queueFailures)throw Error('database unavailable');return {hold:{restorePolicy:'snapshot-v1'}}},
  runRecoveryHostCheck:async()=>{},runRecoveryGatewayCheck:async()=>{},autoResumeRecovery:async()=>{autoCalls++},
  setInterval:(callback:()=>void)=>{tick=callback;return {unref(){}}},clearInterval:()=>{tick=undefined},console:{warn(){}}}
const timerQueue=new Function(...Object.keys(queueBindings),compiledQueue)(...Object.values(queueBindings))
const drain=async()=>{for(let index=0;index<30;index++)await Promise.resolve()}
timerQueue.startRecoveryReviewWorker();await drain();assert.equal(seedCount,1)
for(let index=0;index<14;index++){queueNow+=1000;tick!();await drain()}
assert.equal(seedCount,1,'database failure does not rescan every second')
queueNow=15000;tick!();await drain();assert.equal(seedCount,2)
queueFailures=false;queueNow=44999;tick!();await drain();assert.equal(seedCount,2)
queueNow=45000;tick!();await drain();assert.equal(seedCount,3);assert.equal(autoCalls,1)
queueActive=true;queueNow+=1000;tick!();await drain();assert.equal(seedCount,3,'active root task owns recovery')
queueActive=false;queueHeld=false;queueNow+=1000;tick!();await drain();assert.equal(seedCount,3,'no recovery work outside hold')
timerQueue.stopRecoveryReviewWorker();assert.equal(tick,undefined)
console.log('PASS recovery queue timer: durable backoff, resumed observation, active-task exclusion and stopped timer')
