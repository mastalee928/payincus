/** Actual isolated PostgreSQL journal; remote environment inspection is a fixture. */
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { GatewayTaskError, gatewayTaskHash, GATEWAY_TASK_STEPS, type GatewayTaskPlan } from '../src/lib/gateway-task-plan.js'
import { remoteGatewayInspectionId } from '../src/lib/remote-gateway-setup.js'
import type { ManagementGatewayInspectInput } from '../src/services/gateway-management.js'
import type { GatewayPreflightReport } from '../src/services/gateway-preflight.js'
const database = new URL(process.env.DATABASE_URL || 'postgresql://localhost/invalid')
assert.ok(['127.0.0.1','localhost','[::1]'].includes(database.hostname) && database.pathname.endsWith('_gateway_test'))
process.env.GATEWAY_PLATFORM_ID = randomUUID()
process.env.ENCRYPTION_KEY = 'isolated-remote-gateway-fixture-key'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const journal = await import('../src/services/gateway-task-journal.js')
const { prepareRemoteGateway } = await import('../src/services/remote-gateway-setup.js')
const { requestGatewayInstallation } = await import('../src/services/gateway-installation-management.js')
const { listManagementGateways } = await import('../src/services/gateway-management.js')
const platformId = process.env.GATEWAY_PLATFORM_ID, gatewayId = randomUUID(), requestId = randomUUID()
const admin = await prisma.user.create({data:{username:'remote-setup-'+requestId,passwordHash:'unusable-test-hash',role:'admin'}})
const fingerprint = 'SHA256:'+randomBytes(32).toString('base64').replace(/=+$/,'')
const machineId = randomBytes(16).toString('hex')
const input = {requestId,gatewayId,name:'Independent fixture gateway',purpose:'independent' as const,address:'8.8.4.4',hostname:'gateway.example.com',credentials:{password:'isolated-fixture-password'}}
let connections = 0, launches = 0
const canonical = (value: unknown): string => Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,val])=>JSON.stringify(key)+':'+canonical(val)).join(',')+'}':JSON.stringify(value)
async function inspect(value: ManagementGatewayInspectInput, actorId: number) {
  const existing = await prisma.managementGatewayTask.findUnique({where:{id:value.requestId}})
  if(existing) return {task:await journalTask(existing.id),report:(existing.inspection as unknown as {report:GatewayPreflightReport}).report,canWrite:false as const,duplicate:true}
  connections++
  const registered = await prisma.managementGateway.findUnique({where:{id:value.gatewayId}})
  const target = {mode:'remote' as const,machineId,ssh:{address:input.address,port:22,username:'root' as const,fingerprint}}
  if(registered) assert.equal((registered.target as unknown as typeof target).ssh.fingerprint,fingerprint)
  const request = {schemaVersion:1 as const,platformId,gatewayId,expectedMachineId:registered?.machineId||null,...value.configuration}
  const conflicts = connections===1
  const report: GatewayPreflightReport = {schemaVersion:1,machineId,osId:'ubuntu',architecture:'amd64',memoryMiB:1024,diskAvailableMiB:4096,
    tools:{wg:true,ip:true,ss:true,systemctl:true,node:true,python3:true},facts:{interface:{exists:false,owned:false,addressMatches:false},
      routeConflicts:conflicts?[{network:'10.252.0.0/20',interface:'fixture0'}]:[],portConflicts:conflicts?[{protocol:'udp',port:51820},{protocol:'tcp',port:18443}]:[],
      services:Object.fromEntries(['transport','console','backup'].map(key=>[key,{installed:false,owned:false,active:false,digest:null}]))},
    blockers:conflicts?['GATEWAY_MANAGEMENT_ROUTE_CONFLICT','GATEWAY_PORT_CONFLICT']:[],observedStateHash:'',inspectedAt:Date.now()}
  const stable={request,machineId,osId:report.osId,architecture:report.architecture,tools:report.tools,facts:report.facts,blockers:report.blockers}
  report.observedStateHash=createHash('sha256').update(canonical(stable)).digest('hex')
  await journal.registerManagementGateway({id:gatewayId,platformId,name:input.name,target},actorId)
  const plan:GatewayTaskPlan={schemaVersion:1,taskId:value.requestId,gatewayId,platformId,kind:'inspect',basedOnRevision:'0',target,
    configurationHash:gatewayTaskHash(value.configuration),observedStateHash:report.observedStateHash,componentHash:'c'.repeat(64)}
  await journal.createManagementGatewayTask(plan,actorId)
  const active=await journal.claimManagementGatewayTask(plan.taskId)
  for(const key of GATEWAY_TASK_STEPS.inspect){
    const step=await journal.beginManagementGatewayStep(plan.taskId,active!.leaseToken!,key)
    await journal.completeManagementGatewayStep(plan.taskId,active!.leaseToken!,key,{schemaVersion:1,taskId:plan.taskId,operationId:step.operationId,step:key,
      planHash:gatewayTaskHash(plan),targetHash:gatewayTaskHash(target),evidenceHash:report.observedStateHash,configurationHash:null,issuedAt:report.inspectedAt,outcome:'verified'})
  }
  const task=await journal.finishManagementGatewayTask(plan.taskId,active!.leaseToken!,{request,report})
  return {task,report,canWrite:false as const,duplicate:false}
}
const journalTask = async(id:string) => prisma.managementGatewayTask.findUniqueOrThrow({where:{id},select:journal.gatewayTaskPublicSelect})
const ops={inspect,resolve:async(host:string)=>/^[0-9.]+$/.test(host)?host:input.address,install:async(value:Parameters<typeof requestGatewayInstallation>[0],actorId:number)=>requestGatewayInstallation(value,actorId,{available:()=>true,launch:async()=>{launches++}})}
try{
  const invalidDomainRequest = randomUUID()
  await assert.rejects(prepareRemoteGateway({...input,requestId:invalidDomainRequest,hostname:'https://user:password@gateway.example.com'},admin.id,ops))
  const invalidDomain = (await listManagementGateways()).preparations.find(value=>value.requestId===invalidDomainRequest)!
  assert.equal(invalidDomain.step,'validate-domain')
  assert.equal(invalidDomain.hostname,'','invalid values with possible credentials are never persisted')
  assert.equal(invalidDomain.address,input.address)
  assert.ok(!JSON.stringify(invalidDomain).includes('password'))
  const malformedKey = `management_gateway_remote_attempt_${platformId}_${randomUUID()}`
  await prisma.systemConfig.create({data:{key:malformedKey,type:'json',value:JSON.stringify({state:'failed',password:'never-return-this'})}})
  assert.ok(!JSON.stringify(await listManagementGateways()).includes('never-return-this'))
  let addressResolutions = 0
  await assert.rejects(prepareRemoteGateway({...input,requestId:randomUUID(),gatewayId:randomUUID(),address:'ssh.example.com'},admin.id,{
    ...ops,resolve:async host=>{if(host==='ssh.example.com') addressResolutions++; return '8.8.4.4'},
    inspect:async value=>{ assert.equal(value.target?.address,'8.8.4.4','SSH gets the IPv4 verified with the DNS-only domain'); throw new GatewayTaskError('GATEWAY_INSTALL_EXECUTOR_UNAVAILABLE') }
  }),/EXECUTOR_UNAVAILABLE/)
  assert.equal(addressResolutions,1,'the SSH address is not independently resolved again after domain verification')
  let elapsed = 0, boundedConnections = 0, boundedInstalls = 0
  const boundedRequestId = randomUUID()
  await assert.rejects(prepareRemoteGateway({...input,requestId:boundedRequestId,gatewayId:randomUUID()},admin.id,{
    ...ops, now:()=>elapsed, inspect:async()=>{
      boundedConnections++; elapsed += 45001
      return {task:{} as never,canWrite:false as const,duplicate:false,report:{
        facts:{interface:{exists:false},services:{},routeConflicts:[{network:'10.252.0.0/20',interface:'fixture'}],portConflicts:[]}
      } as GatewayPreflightReport}
    },install:async()=>{boundedInstalls++;throw new Error('must not create an installation after the inspection budget expires')}
  }),/GATEWAY_INSPECTION_TIMEOUT/)
  assert.equal(boundedConnections,1);assert.equal(boundedInstalls,0)
  assert.equal((await listManagementGateways()).preparations.find(value=>value.requestId===boundedRequestId)!.code,'GATEWAY_INSPECTION_TIMEOUT')
  // Simulate interruption after read-only checks but before an installation intent.
  const interrupted={...ops,install:async()=>{throw new GatewayTaskError('GATEWAY_INSTALL_EXECUTOR_UNAVAILABLE')}}
  await assert.rejects(prepareRemoteGateway(input,admin.id,interrupted),/EXECUTOR_UNAVAILABLE/)
  assert.equal(connections,2)
  const resumed=await prepareRemoteGateway(input,admin.id,ops)
  assert.equal(connections,2,'retry uses the same persisted check plans')
  const intent=await prisma.managementGatewayTask.findUniqueOrThrow({where:{id:requestId}})
  const desired=(intent.installation as unknown as {desired:{network:string;listenPort:number;consolePort:number;consoleOrigin:string}}).desired
  assert.equal(desired.network,'10.252.32.0/20');assert.equal(desired.listenPort,51821);assert.equal(desired.consolePort,18444)
  assert.equal(desired.consoleOrigin,'https://gateway.example.com:18444');assert.equal(launches,1)
  assert.ok(intent.credentialsEncrypted && !JSON.stringify(resumed).includes(input.credentials.password))
  const duplicate=await prepareRemoteGateway(input,admin.id,ops)
  assert.equal(duplicate.gatewayId,gatewayId);assert.equal(connections,2);assert.equal(launches,1)
  await assert.rejects(prepareRemoteGateway({...input,address:'8.8.8.8'},admin.id,ops),/IDEMPOTENCY_CONFLICT/)
  await assert.rejects(prepareRemoteGateway({...input,purpose:'backup'},admin.id,ops),/IDEMPOTENCY_CONFLICT/)
  await assert.rejects(prepareRemoteGateway({...input,hostname:'other.example.com'},admin.id,ops),/IDEMPOTENCY_CONFLICT/)
  await assert.rejects(prepareRemoteGateway({...input,requestId:randomUUID(),gatewayId:randomUUID()},admin.id,
    {...ops,resolve:async host=>host===input.address?input.address:'8.8.8.8'}),/TARGET_MISMATCH/)
  assert.equal(connections,2,'DNS mismatch stops before SSH or remote writes')
  const failedAttempts = (await listManagementGateways()).preparations
  assert.ok(failedAttempts.some(value => value.code === 'GATEWAY_DNS_TARGET_MISMATCH' && value.step === 'validate-domain'))
  assert.ok(!JSON.stringify(failedAttempts).includes(input.credentials.password), 'durable preparation failures contain no credentials')
  const historyKey = `management_gateway_remote_attempt_${platformId}_${requestId}`
  const historyRow = await prisma.systemConfig.findUniqueOrThrow({where:{key:historyKey}})
  await prisma.systemConfig.update({where:{key:historyKey},data:{value:JSON.stringify({...JSON.parse(historyRow.value),state:'failed',code:'GATEWAY_INSTALL_EXECUTOR_UNAVAILABLE',password:'never-return-extra-fields'})}})
  for(let index=0;index<21;index++) {
    const newerId=randomUUID()
    await prisma.systemConfig.create({data:{key:`management_gateway_remote_attempt_${platformId}_${newerId}`,type:'json',
      value:JSON.stringify({...JSON.parse(historyRow.value),requestId:newerId,updatedAt:new Date(Date.now()+1000+index).toISOString()})}})
  }
  const preserved = (await listManagementGateways()).preparations
  assert.ok(preserved.some(value=>value.requestId===requestId),'recent successes cannot hide an earlier unresolved failure')
  assert.equal(preserved.find(value=>value.requestId===requestId)!.retryable,false,'an awaiting installation must continue through its original task instead of preparation retry')
  assert.ok(!JSON.stringify(preserved).includes('never-return-extra-fields'),'strict field projection excludes unknown credential-bearing fields')
  await prisma.systemConfig.update({where:{key:historyKey},data:{value:historyRow.value}})
  assert.equal(await prisma.managementGatewayTask.count({where:{gatewayId,kind:'inspect'}}),2)
  assert.ok(await prisma.managementGatewayTask.findUnique({where:{id:remoteGatewayInspectionId(requestId,1)}}))
  const checked = await prisma.managementGatewayTask.findUniqueOrThrow({where:{id:remoteGatewayInspectionId(requestId,1)}})
  for(let index=0;index<6;index++) {
    const id=randomUUID(), plan={...(checked.plan as unknown as GatewayTaskPlan),taskId:id}
    await prisma.managementGatewayTask.create({data:{id,gatewayId,createdById:admin.id,kind:'inspect',status:'succeeded',
      plan:plan as unknown as object,planHash:gatewayTaskHash(plan),basedOnRevision:0,
      inspection:checked.inspection as object,createdAt:new Date(Date.now()+1000+index)}})
  }
  const listed=(await listManagementGateways()).gateways as Array<{id:string;tasks:Array<{id:string;kind:string}>}>
  const history=listed.find(value=>value.id===gatewayId)!.tasks
  assert.ok(history.some(value=>value.id===requestId),'installation survives a full page of newer automatic inspections')
  assert.equal(new Set(history.map(value=>value.id)).size,history.length)
  assert.ok(history.length<=9 && !JSON.stringify(listed).includes(input.credentials.password))
  await assert.rejects(journal.retireUnusedGatewayCandidate(gatewayId,admin.id), /EXISTING_REQUIRES_ATTACH/,
    'an awaiting installation cannot be discarded while its worker may stage or write')
  await prisma.managementGatewayTask.update({where:{id:requestId},data:{status:'failed',preparationState:'failed'}})
  await prisma.managementGatewayStep.updateMany({where:{taskId:requestId,key:'install-components'},data:{status:'started'}})
  const failureToken = randomUUID()
  await prisma.managementGatewayTask.update({where:{id:requestId},data:{status:'running',leaseToken:failureToken,leaseUntil:new Date(Date.now()+60000),
    approvedById:admin.id,approvedAt:new Date(),approvalExpiresAt:new Date(Date.now()+60000)}})
  await journal.interruptManagementGatewayTask(requestId,failureToken,'GATEWAY_INSTALL_TRANSPORT_MISMATCH')
  const accurateFailure = await prisma.managementGatewayTask.findUniqueOrThrow({where:{id:requestId}})
  assert.equal(accurateFailure.status,'needs_review','partial installation retains review protection')
  assert.equal(accurateFailure.errorCode,'GATEWAY_INSTALL_TRANSPORT_MISMATCH','specific error survives the worker interruption boundary')
  await assert.rejects(journal.retireUnusedGatewayCandidate(gatewayId,admin.id), /EXISTING_REQUIRES_ATTACH/,
    'partly executed installation must preserve its identity and reservation')
  await prisma.managementGatewayTask.update({where:{id:requestId},data:{status:'failed'}})
  await prisma.managementGatewayStep.updateMany({where:{taskId:requestId,key:'install-components'},data:{status:'pending'}})
  const retiredAttemptKey = `management_gateway_remote_attempt_${platformId}_${requestId}`
  const retiredAttempt = await prisma.systemConfig.findUniqueOrThrow({where:{key:retiredAttemptKey}})
  await prisma.systemConfig.update({where:{key:retiredAttemptKey},data:{value:JSON.stringify({...JSON.parse(retiredAttempt.value),state:'failed',code:'GATEWAY_INSTALL_EXECUTOR_UNAVAILABLE'})}})
  await journal.retireUnusedGatewayCandidate(gatewayId,admin.id)
  assert.ok((await prisma.managementGateway.findUniqueOrThrow({where:{id:gatewayId}})).retiredAt)
  assert.ok(await prisma.managementGatewayTask.findUnique({where:{id:requestId}}), 'old identity and failure evidence retained')
  assert.equal((await listManagementGateways()).preparations.find(value=>value.gatewayId===gatewayId)?.retryable,false,
    'retired candidate failure history cannot offer ordinary retry against old identity')
  console.log('Remote setup integration passed: actual DB, conflict planning, interruption replay, fixed identity, encrypted credentials; remote execution is a fixture')
}finally{
  await prisma.systemConfig.deleteMany({where:{key:{startsWith:`management_gateway_remote_attempt_${platformId}_`}}})
  await prisma.managementGatewayStep.deleteMany({where:{task:{gatewayId}}})
  await prisma.managementGatewayTask.deleteMany({where:{gatewayId}})
  await prisma.managementGateway.deleteMany({where:{id:gatewayId}})
  await prisma.user.delete({where:{id:admin.id}})
  await closePrismaDatabase()
}
