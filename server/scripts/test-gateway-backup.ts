import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decryptGatewaySnapshot, encryptGatewaySnapshot, gatewayBackupJob, gatewayBackupPrefix, restoreGatewaySnapshot,
  uploadGatewaySnapshot,retainGatewaySnapshots, type GatewaySnapshot, type GatewayBackupStore } from '../src/services/gateway-backup.js'
import { createGatewayOssStore } from '../src/services/gateway-backup-oss.js'

const platformId=randomUUID(),gatewayId=randomUUID(),password='fixture-gateway-backup-password'
const files=['gateway-identity.json','gateway-transport.json','wireguard.key'].map(name=>{
  const raw=Buffer.from('fixture-only-'+name);return {name,base64:raw.toString('base64'),sha256:createHash('sha256').update(raw).digest('hex')}
})
const snapshot:GatewaySnapshot={schemaVersion:1,purpose:'gateway-backup',platformId,gatewayId,id:randomUUID(),createdAt:Date.now(),epoch:'3',sequence:'2',componentVersion:'test',files}
const memory=new Map<string,Buffer>(),prefix='gateway-test/'
const store:GatewayBackupStore={put:async(key,value)=>{assert.ok(!memory.has(key));memory.set(key,Buffer.from(value))},get:async(key,max)=>{const result=memory.get(key);assert.ok(result&&result.length<=max);return Buffer.from(result)},list:async prefix=>[...memory.keys()].filter(key=>key.startsWith(prefix)),delete:async key=>{memory.delete(key)}}
let checks=0
const directory=await mkdtemp(join(tmpdir(),'payincus-gateway-backup-'))
try{
  await chmod(directory,0o700)
  const encoded=await encryptGatewaySnapshot(snapshot,password)
  assert.deepEqual(await decryptGatewaySnapshot(encoded,password,{platformId,gatewayId}),snapshot);checks++
  await assert.rejects(decryptGatewaySnapshot(encoded,'wrong-password-1234',{platformId,gatewayId}));checks++
  await assert.rejects(decryptGatewaySnapshot(encoded,password,{platformId:randomUUID(),gatewayId}));checks++
  const damaged=Buffer.from(encoded);damaged[40]^=1
  await assert.rejects(decryptGatewaySnapshot(damaged,password,{platformId,gatewayId}));checks++
  await assert.rejects(encryptGatewaySnapshot({...snapshot,files:[...files,{name:'../secret',base64:'',sha256:'a'.repeat(64)}]},password));checks++
  for(const value of ['../backups/','/backups/','backups/%2e/','backups//'])assert.throws(()=>gatewayBackupPrefix(value,platformId,gatewayId));checks++
  const complete=await uploadGatewaySnapshot(store,prefix,snapshot,password)
  assert.equal(complete.id,snapshot.id);assert.deepEqual(await restoreGatewaySnapshot(store,prefix,{platformId,gatewayId},snapshot.id,password),snapshot);checks++
  await assert.rejects(restoreGatewaySnapshot(store,prefix,{platformId,gatewayId:randomUUID()},snapshot.id,password));checks++
  const failed={...snapshot,id:randomUUID()}
  const badStore={...store,get:async(key:string,max:number)=>key.endsWith('payload.enc')?Buffer.from('wrong ciphertext'):store.get(key,max)}
  await assert.rejects(uploadGatewaySnapshot(badStore,prefix,failed,password))
  assert.ok(![...memory.keys()].some(key=>key.includes(failed.id)&&key.endsWith('complete.json')));checks++
  await assert.rejects(gatewayBackupJob(directory,badStore,prefix,{...snapshot,id:randomUUID()},password))
  const state=JSON.parse(await readFile(join(directory,'backup-status.json'),'utf8'));assert.equal(state.phase,'failed');assert.equal(state.lastCompletedAt,null);checks++
  const another={...snapshot,id:randomUUID()};await gatewayBackupJob(directory,store,prefix,another,password)
  assert.equal(JSON.parse(await readFile(join(directory,'backup-status.json'),'utf8')).phase,'complete');checks++
  assert.ok([...memory.keys()].some(key=>key.includes(snapshot.id)));checks++
  await assert.rejects(gatewayBackupJob(directory,badStore,prefix,{...snapshot,id:randomUUID()},password))
  assert.ok(JSON.parse(await readFile(join(directory,'backup-status.json'),'utf8')).lastCompletedAt);checks++
  // Remove failed partial fixtures only from this memory store before retention.
  for(const key of [...memory.keys()])if(key.endsWith('payload.enc')&&!memory.has(key.replace('payload.enc','complete.json')))memory.delete(key)
  for(let i=0;i<3;i++)await uploadGatewaySnapshot(store,prefix,{...snapshot,id:randomUUID(),createdAt:snapshot.createdAt+i+1},password)
  assert.equal(await retainGatewaySnapshots(store,prefix,{platformId,gatewayId},password,3,[snapshot.id]),1);checks++
  assert.ok([...memory.keys()].some(key=>key.includes(snapshot.id)&&key.endsWith('complete.json')));checks++
  const entry=await readFile(new URL('../src/scripts/run-gateway-backup.ts',import.meta.url),'utf8')
  assert.ok(entry.includes('Object.entries(config.sources)')&&entry.includes('acquireDiscoveryMutationLock(config.stateDirectory)'));checks++
  const badRetention={...store,list:async()=>{throw Error('listing unavailable')}}
  await assert.rejects(gatewayBackupJob(directory,badRetention,prefix,{...snapshot,id:randomUUID()},password,{count:3,protectedIds:[]}))
  assert.equal(JSON.parse(await readFile(join(directory,'backup-status.json'),'utf8')).phase,'failed');checks++
  const scoped=createGatewayOssStore({region:'oss-cn-hangzhou',bucket:'fixture-gateway-bucket',accessKeyId:'FixtureAccessKeyId',accessKeySecret:'FixtureSecretOnly',prefix,platformId,gatewayId})
  try{
    for(const key of ['other-prefix/file',`${prefix}${platformId}/${randomUUID()}/file`,`${prefix}${platformId}/${gatewayId}/../file`]){
      await assert.rejects(scoped.get(key,64));await assert.rejects(scoped.put(key,Buffer.from('fixture')));await assert.rejects(scoped.delete(key));await assert.rejects(scoped.list(key))
    }
  }finally{scoped.close()}
  checks++
  console.log(`Gateway backup guards passed: ${checks} encrypted identity/archive, tamper/path, readback, failure marker and historical snapshot checks`)
}finally{await rm(directory,{recursive:true,force:true})}

const installer=await readFile(new URL('../../scripts/install-gateway-backup.sh',import.meta.url),'utf8')
assert.ok(installer.includes('--plan')&&installer.includes('ProtectSystem=strict')&&installer.includes('ReadWritePaths=$state')&&installer.includes('CapabilityBoundingSet='))
assert.ok(!/Requires=.*(?:incudal-backend|postgres|nginx)|PartOf=|BindsTo=/.test(installer))
console.log('Gateway backup installer independence and protected state guards passed')
