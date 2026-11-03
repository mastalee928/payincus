import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import ssh2 from 'ssh2'
// @ts-ignore runtime auth dependency
import bcrypt from 'bcryptjs'
const url=new URL(process.env.DATABASE_URL||'')
assert.ok(url.hostname==='127.0.0.1' && url.port!=='5432' && url.pathname.endsWith('_recovery_test'))
process.env.NODE_ENV='test';process.env.JWT_SECRET='isolated-recovery-gateway';process.env.ENCRYPTION_KEY='isolated-gateway-encryption'
const folder=await mkdtemp(join(tmpdir(),'incudal-route-test-'));process.env.PLATFORM_BACKUP_STATE_DIR=folder
const {prisma,closePrismaDatabase}=await import('../src/db/prisma.js')
const core=await import('../src/services/platform-backup-core.js')
const op=await import('../src/services/platform-recovery-operator.js')
const {gatewayBaseline}=await import('../src/services/platform-recovery-gateway-baseline.js')
const {verifyRecoveryGateway,runRecoveryGatewayCheck}=await import('../src/services/platform-recovery-gateway.js')
const state=await import('../src/services/platform-recovery-state.js')
const {sshFingerprint}=await import('../src/services/onboarding-ssh.js')
const keys=ssh2.utils.generateKeyPairSync('ed25519'),parsed=ssh2.utils.parseKey(keys.private)
assert.ok(!(parsed instanceof Error))
const keyPath=join(folder,'key');await writeFile(keyPath,keys.private)
const identity={publicKey:Buffer.alloc(32,4).toString('base64'),controlIp:'10.253.240.1',network:'10.253.240.0/20',managementSshPublicKey:keys.public,
  endpoint:'gateway.example.test:51820',sshHost:'127.0.0.1',recoveryProtocolVersion:1}
const connections=new Set<import('ssh2').Connection>(),nodeId=randomUUID(),batchId=randomUUID()
let enabled=false,writes=0,fail=true,hostId=0,readCount=0
const deletedNodeId=randomUUID(),deletedNodeKey=Buffer.alloc(32,6).toString('base64')
let deletedPeerEnabled=false
const server=new ssh2.Server({hostKeys:[keys.private]},connection=>{
  connections.add(connection);connection.on('close',()=>connections.delete(connection))
  connection.on('authentication',ctx=>ctx.method==='publickey'?ctx.accept():ctx.reject())
  connection.on('ready',()=>connection.on('session',accept=>accept().on('exec',(accept,_reject,info)=>{
    const stream=accept();let input='';stream.on('data',(data:Buffer)=>{input+=data.toString()})
    stream.on('end',()=>{void(async()=>{
      if(info.command.startsWith('restore-route ')){
        assert.equal(info.command,'restore-route '+nodeId);const request=JSON.parse(input);assert.equal(request.managementIp,'10.253.240.2')
        const intent=await prisma.platformRecoveryEvidence.findUniqueOrThrow({where:{batchId_category_reference:{batchId,category:'gateway-route',reference:nodeId}}})
        assert.equal((intent.payload as any).status,'dispatched','real DB intent precedes SSH write')
        writes++;enabled=true
        if(fail){stream.write('INCUDAL_ERROR:SSH_COMMAND_TIMEOUT');stream.exit(1);stream.end();return}
        stream.write(JSON.stringify({nodeId,runtimeRouteRestored:true,savedConfigurationPreserved:true}))
      }else{
        assert.ok(['status','recovery-state'].includes(info.command));readCount++
        stream.write(JSON.stringify({...identity,...(info.command==='recovery-state'?{recovery:{version:1,observedAt:Date.now(),stateHash:'c'.repeat(64),configHash:'d'.repeat(64),runtimeHash:'e'.repeat(64),
          peers:[{nodeId,nodePublicKey:Buffer.alloc(32,5).toString('base64'),managementIp:'10.253.240.2',enabled},
            {nodeId:deletedNodeId,nodePublicKey:deletedNodeKey,managementIp:'10.253.240.3',enabled:deletedPeerEnabled}]}}:{})}))
      }
      stream.exit(0);stream.end()
    })().catch(error=>{console.error(error);stream.exit(1);stream.end()})})
  })))
})
try{
  await core.initBackupState()
  const actor=await prisma.user.create({data:{username:'admin',role:'admin',passwordHash:await bcrypt.hash('fixture-only',4)}})
  await op.captureRecoveryOperator(actor.id,batchId)
  const actorId=await op.installRecoveryOperator(batchId,batchId,'restore')
  await core.writeJson(join(folder,'recovery-hold.json'),{taskId:batchId,batchId,mode:'restore',createdAt:new Date(Date.now()-1000).toISOString(),gatewayBaseline:gatewayBaseline(identity)})
  const host=await prisma.host.create({data:{userId:actorId,name:'original-route-host',url:'https://10.253.240.2:8443'}});hostId=host.id
  const enrollment=await prisma.hostOnboardingBatch.create({data:{id:randomUUID(),createdById:actorId,name:'route-fixture',accountLabel:'isolated',defaults:{}}})
  await prisma.hostOnboardingNode.create({data:{id:nodeId,batchId:enrollment.id,hostId,name:'original-route-host',publicIp:'192.0.2.2',credentialsExpireAt:new Date(),sshPort:22,status:'succeeded',
    managementIp:'10.253.240.2',nodePublicKey:Buffer.alloc(32,5).toString('base64')}})
  await prisma.hostOnboardingNode.create({data:{id:deletedNodeId,batchId:enrollment.id,name:'deleted-route-host',publicIp:'192.0.2.3',credentialsExpireAt:new Date(),status:'succeeded',
    deletedAt:new Date(),managementIp:'10.253.240.3',nodePublicKey:deletedNodeKey}})
  await prisma.platformRecoveryHost.create({data:{batchId,hostId,status:'blocked',nextAttemptAt:new Date(Date.now()+1800000)}})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  Object.assign(process.env,{ONBOARDING_GATEWAY_HOST:'127.0.0.1',ONBOARDING_GATEWAY_PORT:String((server.address() as any).port),
    ONBOARDING_GATEWAY_KEY_PATH:keyPath,ONBOARDING_GATEWAY_FINGERPRINT:sshFingerprint(parsed.getPublicSSH()),ONBOARDING_WG_ENDPOINT:identity.endpoint})
  const batch=await state.activeRecoveryBatch()
  let releaseMutation!:()=>void,enteredMutation!:()=>void
  const entered=new Promise<void>(resolve=>{enteredMutation=resolve}),blocked=new Promise<void>(resolve=>{releaseMutation=resolve})
  const taskId=randomUUID()
  const active={id:taskId,kind:'restore',status:'pending',stage:'queued',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}
  const rootDispatch=core.serializeBackupMutation(async()=>{enteredMutation();await blocked;await core.writeJson(core.statePath('inbox','active.json'),active)})
  await entered
  const queuedCheck=runRecoveryGatewayCheck(batch)
  await new Promise<void>(resolve=>setImmediate(resolve))
  assert.equal(readCount,0,'gateway waits while a root dispatch owns the real mutation queue')
  releaseMutation();await rootDispatch;await queuedCheck
  assert.equal(readCount,0,'active root task prevents queued gateway check and route write')
  assert.equal(await prisma.platformRecoveryEvidence.count({where:{batchId,category:'gateway-check'}}),0)
  await core.writeJson(core.statePath('results',taskId+'.json'),{...active,status:'success',stage:'complete'})
  await runRecoveryGatewayCheck(batch)
  assert.equal(writes,1,'root completion automatically permits the same queued recovery flow')
  let ready=await state.recoveryReadiness()
  const route=ready.automation.find(row=>row.category==='gateway-route') as any
  assert.equal(route.hostId,hostId);assert.equal(route.status,'retry');assert.equal(route.code,'OSS_REVIEW_TRANSPORT_TIMEOUT')
  assert.equal(await prisma.platformRecoveryEvidence.count({where:{batchId,category:'gateway-route-attempt'}}),2)
  await verifyRecoveryGateway(batch,actorId,true)
  assert.equal(writes,1,'late successful mutation observed without second dispatch')
  ready=await state.recoveryReadiness()
  const recovered=ready.automation.find(row=>row.category==='gateway-route') as any
  assert.equal(recovered.status,'success');assert.equal(recovered.nextAction,'verify-host-connection')
  assert.ok((await prisma.platformRecoveryHost.findUniqueOrThrow({where:{batchId_hostId:{batchId,hostId}}})).nextAttemptAt<=new Date())
  assert.equal(await prisma.platformRecoveryEvidence.count({where:{batchId,category:'gateway-route-attempt'}}),3)
  await verifyRecoveryGateway(batch,actorId,false);assert.equal(writes,1)
  deletedPeerEnabled=true
  await assert.rejects(verifyRecoveryGateway(batch,actorId,false),/REVOCATION_CONFLICT/,'deleted records are accepted only with inactive original routes')
  deletedPeerEnabled=false
  await verifyRecoveryGateway(batch,actorId,false)
  assert.ok(readCount>=6)
  console.log('PASS real mutation queue: root dispatch barrier, persisted active task blocks all gateway IO, terminal receipt permits automatic continuation')
  console.log('PASS real PostgreSQL and pinned SSH: intent-before-write, lost response, history, readiness target, automatic host requeue and zero second mutation')
}finally{
  for(const connection of connections)connection.destroy()
  if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()))
  await closePrismaDatabase()
  assert.ok(folder.startsWith(join(tmpdir(),'incudal-route-test-')));await rm(folder,{recursive:true,force:true})
}
process.exit(0)
