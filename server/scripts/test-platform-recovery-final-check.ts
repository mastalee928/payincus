import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url=new URL(process.env.DATABASE_URL || '')
assert.ok(url.hostname==='127.0.0.1' && url.port!=='5432' && url.pathname.endsWith('_recovery_test'))
process.env.NODE_ENV='test';process.env.JWT_SECRET='isolated-final-check-secret'
const folder=await mkdtemp(join(tmpdir(),'incudal-final-check-'));process.env.PLATFORM_BACKUP_STATE_DIR=folder
const {prisma,closePrismaDatabase}=await import('../src/db/prisma.js')
const core=await import('../src/services/platform-backup-core.js')
const {pgQuery}=await import('../src/services/platform-backup-database.js')
const {verifyCurrentRecoveryHosts,assertFinalRecoveryHosts}=await import('../src/services/platform-recovery-final-check.js')
const {recoveryHostSourceHash}=await import('../src/services/platform-recovery-state.js')
const {automaticResumeRetry}=await import('../src/services/platform-recovery-policy.js')
const batchId=randomUUID()
try {
  assert.equal(await prisma.host.count(),0,'dedicated empty fixture database')
  const admin=await prisma.user.create({data:{username:'final-check-admin',passwordHash:'not-a-login',role:'admin'}})
  await prisma.platformRecoveryBatch.create({data:{id:batchId,holdTaskId:batchId,mode:'restore',operatorId:admin.id}})
  await core.initBackupState()
  await core.writeJson(join(folder,'recovery-hold.json'),{taskId:batchId,batchId,mode:'restore',createdAt:new Date().toISOString()})
  await prisma.host.createMany({data:Array.from({length:12},(_,i)=>({userId:admin.id,name:'final-'+i,url:'https://192.0.2.1:8443',singleTenant:true,poolFaulted:true}))})
  const hosts=await prisma.host.findMany({orderBy:{id:'asc'}})
  await prisma.platformRecoveryHost.createMany({data:hosts.map(h=>({batchId,hostId:h.id}))})
  const calls=new Map<number,number>();let clock=0,inFlight=0,peak=0
  const success=async(id:number)=>{
    inFlight++;peak=Math.max(peak,inFlight);calls.set(id,(calls.get(id)||0)+1)
    try{return {hostId:id,checkedAt:new Date().toISOString(),managementVerified:true,
      inventory:{expectedCount:0,actualCount:0,missing:[],unexpected:[],conflicts:[],inventoryMatched:true},code:null}}
    finally{inFlight--}
  }
  await assert.rejects(verifyCurrentRecoveryHosts(batchId,pgQuery,async id=>{clock=100;return success(id)},
    {now:()=>clock,budgetMs:50}),/FINAL_HOST_CHECK_PENDING/)
  assert.ok(calls.size>0 && calls.size<=4);assert.equal(inFlight,0)
  const firstPass=calls.size
  await verifyCurrentRecoveryHosts(batchId,pgQuery,success)
  assert.equal(calls.size,12);assert.ok([...calls.values()].every(n=>n===1))
  await assertFinalRecoveryHosts(batchId,pgQuery)
  await verifyCurrentRecoveryHosts(batchId,pgQuery,success)
  assert.ok([...calls.values()].every(n=>n===1),'lost response does not repeat remote probes')
  const host=hosts[0]
  await prisma.host.update({where:{id:host.id},data:{name:'changed'}})
  await assert.rejects(assertFinalRecoveryHosts(batchId,pgQuery),/FINAL_HOST_CHECK_PENDING/)
  await assert.rejects(verifyCurrentRecoveryHosts(batchId,pgQuery,async()=>{throw Object.assign(Error('private-error'),{code:'ECONNRESET'})}),/FINAL_HOST_CHECK_FAILED/)
  const failure=await prisma.platformRecoveryHost.findUniqueOrThrow({where:{batchId_hostId:{batchId,hostId:host.id}}})
  assert.equal(failure.status,'retry')
  await verifyCurrentRecoveryHosts(batchId,pgQuery,success)
  assert.equal(calls.get(host.id),2)
  const hash=await recoveryHostSourceHash(host.id)
  await prisma.platformRecoveryEvidence.create({data:{batchId,category:'host-check',reference:'later-failure',sourceHash:hash,evidenceHash:'a'.repeat(64),
    observedAt:new Date(),actorId:admin.id,payload:{hostId:host.id,managementVerified:false,code:'OSS_REVIEW_IDENTITY_CHANGED'}}})
  await assert.rejects(assertFinalRecoveryHosts(batchId,pgQuery),/FINAL_HOST_CHECK_PENDING/)
  await verifyCurrentRecoveryHosts(batchId,pgQuery,success)
  assert.equal(calls.get(host.id),3,'later failure invalidates success even without a DB source change')
  await prisma.platformRecoveryEvidence.updateMany({where:{batchId,category:'host-final-check'},data:{createdAt:new Date(Date.now()-25*3600000)}})
  await assert.rejects(assertFinalRecoveryHosts(batchId,pgQuery),/FINAL_HOST_CHECK_PENDING/)
  await verifyCurrentRecoveryHosts(batchId,pgQuery,success)
  assert.equal(calls.get(host.id),4);assert.ok(peak<=4)
  assert.deepEqual(automaticResumeRetry('OSS_RECOVERY_FINAL_HOST_CHECK_PENDING',100),{status:'retry',delayMs:15000})
  console.log(JSON.stringify({passed:true,hosts:12,firstPass,peak,persistedContinuation:true,sourceChange:true,laterFailure:true,expiry:true,remoteTransport:'fixture'}))
}finally{await closePrismaDatabase();await rm(folder,{recursive:true,force:true})}
process.exit(0)
