import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import ts from 'typescript'
import { ensure } from '../../src/services/platform-backup-core.js'
import { automaticResumeDecision, recoveryHostErrorCode, recoveryHostPolicy } from '../../src/services/platform-recovery-policy.js'

export async function verifyRecoveryGatewayAutomation() {
  const recoveryHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const source=await readFile(new URL('../../src/services/platform-recovery-gateway.ts',import.meta.url),'utf8')
  const start=source.indexOf('export async function verifyRecoveryGateway(')
  assert.ok(start>0)
  const compiled=ts.transpileModule(source.slice(start).replaceAll('export async','async')+'\nreturn {verifyRecoveryGateway,runRecoveryGatewayCheck}',
    {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
  for(const scenario of ['success','read-only','no-capability','unknown','revoked','cooldown','blocked','condition-changed','exhausted','timeout','lost-reply','save-failed','stale']) {
    const batch={id:randomUUID(),operator_id:7}, node={id:randomUUID(),nodePublicKey:'a'.repeat(43)+'=',managementIp:'10.253.240.2',deletedAt:null as Date|null,hostId:4}
    const current={publicKey:'b'.repeat(43)+'=',recoveryProtocolVersion:1,recovery:{version:1,observedAt:Date.now(),stateHash:'c'.repeat(64),configHash:'d'.repeat(64),runtimeHash:'e'.repeat(64),
      peers:[{nodeId:node.id,nodePublicKey:node.nodePublicKey,managementIp:node.managementIp,enabled:false}]}}
    if(scenario==='no-capability')delete (current.recovery as any).runtimeHash
    if(scenario==='unknown')current.recovery.peers[0].nodePublicKey='x'.repeat(43)+'='
    if(scenario==='revoked'){node.deletedAt=new Date();current.recovery.peers[0].enabled=true}
    const sourceHash=recoveryHash({node,configHash:current.recovery.configHash,runtimeHash:current.recovery.runtimeHash,publicKey:current.publicKey})
    let prior:any=null,writes=0,checks=0,reads=0;const history:any[]=[],stages:string[]=[]
    if(['cooldown','blocked','condition-changed','exhausted'].includes(scenario))prior={sourceHash:scenario==='condition-changed'?'old':sourceHash,
      payload:{status:scenario==='cooldown'?'dispatched':scenario==='exhausted'?'retry':'blocked',attempt:scenario==='exhausted'?8:2,
        nextAt:new Date(scenario==='cooldown'?Date.now()+60000:0).toISOString()}}
    const evidence={findMany:async()=>prior?[prior]:[],update:async({data}:any)=>{prior={...prior,...data}},findUnique:async()=>prior,findFirst:async()=>history.filter(row=>row.category==='gateway-check').at(-1),
      upsert:async(input:any)=>{if(scenario==='save-failed')throw Error('DB unavailable');
        if(input.create.category==='gateway-route'){prior=input.create;stages.push(prior.payload.status)}return {id:randomUUID(),...input.create}},
      create:async({data}:any)=>{history.push(data);return {id:randomUUID(),...data}}}
    const prisma={hostOnboardingNode:{findMany:async()=>[node]},platformRecoveryEvidence:evidence,
      $transaction:async(fn:any)=>fn({platformRecoveryEvidence:evidence,platformRecoveryHost:{updateMany:async()=>({count:1})}})}
    const bindings={prisma,ensure,recoveryHash,randomUUID,automaticResumeDecision,recoveryHostErrorCode,recoveryHostPolicy,
      serializeBackupMutation:async(fn:()=>unknown)=>fn(),activeBackupTask:async()=>null,
      recoveryGatewayIdentity:(value:any)=>value,activeRecoveryBatch:async()=>batch,
      recoveryDatasetHash:async()=>scenario==='stale' && ++reads>1?'changed':'dataset',
      gatewayCommand:async()=>{checks++;return current},assertSavedRecoveryGateway:async()=>{},
      restoreGatewayRuntimeRoute:async(id:string,input:any)=>{writes++;assert.equal(id,node.id);assert.equal(input.configHash,current.recovery.configHash);
        assert.equal(stages.at(-1),'dispatched','intent saved before SSH mutation');
        if(scenario==='timeout')throw Object.assign(Error(),{code:'SSH_COMMAND_TIMEOUT'});
        current.recovery.peers[0].enabled=true
        if(scenario==='lost-reply')throw Object.assign(Error(),{code:'SSH_COMMAND_TIMEOUT'})}}
    const actual=new Function(...Object.keys(bindings),compiled)(...Object.values(bindings))
    let error:any
    try{await actual.verifyRecoveryGateway(batch,7,scenario!=='read-only')}catch(caught){error=caught}
    assert.ok(error,scenario+' must not declare full gateway verified from pre-repair state')
    const allowed=['success','condition-changed','timeout','lost-reply'].includes(scenario)
    assert.equal(writes,allowed?1:0,scenario)
    if(allowed){assert.equal(history.filter(row=>row.category==='gateway-route-attempt').length,2);assert.equal(error.code,'OSS_RECOVERY_GATEWAY_ROUTE_RECHECK')}
    if(scenario==='blocked')assert.equal(stages.length,0,'unchanged deterministic conflict cannot repeat mutation')
    if(scenario==='exhausted')assert.equal(prior.payload.code,'OSS_RECOVERY_GATEWAY_ROUTE_ATTEMPTS_EXHAUSTED')
    if(scenario==='timeout'){
      await assert.rejects(actual.verifyRecoveryGateway(batch,7,true));assert.equal(writes,1,'cooldown survives lost or failed response')
    }
    if(scenario==='success' || scenario==='lost-reply'){
      const receipt=await actual.verifyRecoveryGateway(batch,7,true);assert.equal(receipt.peers,1);assert.equal(writes,1,'fresh read observes previous completed mutation')
      assert.equal(prior.payload.nextAction,'verify-host-connection');assert.equal(prior.payload.status,'success')
    }
    if(scenario==='success'){
      await actual.runRecoveryGatewayCheck(batch,async()=>{throw Object.assign(Error(),{code:'OSS_RECOVERY_GATEWAY_ROUTE_RECHECK'})})
      const last=history.at(-1);assert.equal(last.payload.nextAction,'verify-restored-route')
      assert.ok(Date.parse(last.payload.nextAt)-Date.now()<=30000)
      const before=checks;await actual.runRecoveryGatewayCheck(batch);assert.equal(checks,before,'next tick respects check cooldown')
    }
  }
  console.log('PASS original gateway runtime route: exact source, persisted intent/history, bounded retry, conflict changes, lost receipt, read-only final check')
}
