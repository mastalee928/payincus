import assert from 'node:assert/strict'
import { createServer } from 'node:https'
import { randomUUID, X509Certificate } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { protectedAgentFixture } from './fixtures/guest-protection.js'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['localhost','127.0.0.1'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
const {prisma,closePrismaDatabase}=await import('../src/db/prisma.js')
const {prepareEmptyPoolDisk}=await import('../src/services/pool-disk-preparation.js')
const {resolveStoragePoolForNewInstance}=await import('../src/db/storage-pools.js')
const {closeAllClients}=await import('../src/lib/incus/incus-pool.js')
const tag='disk-isolation-'+randomUUID(),dir=await mkdtemp(join(tmpdir(),tag)),certPath=join(dir,'cert.pem'),keyPath=join(dir,'key.pem')
execFileSync(process.env.REVIEW_OPENSSL||'openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=fixture','-addext','subjectAltName=IP:127.0.0.1','-keyout',keyPath,'-out',certPath],{stdio:'pipe',windowsHide:true})
const cert=await readFile(certPath),writes:string[]=[]
let mode='',remotePool:any=null,failed=false
const server=createServer({key:await readFile(keyPath),cert,ca:cert,requestCert:true,rejectUnauthorized:true},async(req,res)=>{
 res.setHeader('content-type','application/json')
 const ok=(metadata:unknown={})=>res.end(JSON.stringify({type:'sync',metadata})),bad=(code:number)=>{res.statusCode=code;res.end(JSON.stringify({type:'error',error:'fixture failure'}))}
 try{
 assert.ok((req.socket as any).authorized)
 const path=req.url!,method=req.method!
 if(path==='/1.0')return ok({api_version:'1.0'})
 if(path.startsWith('/1.0/instances?'))return ok(mode==='remote-guest'?[{name:'unregistered-customer'}]:[])
 if(path.startsWith('/1.0/operations?'))return ok({})
 if(path.includes('/volumes?'))return ok(mode==='custom-volume'?[{type:'custom'}]:[{type:'image'}])
 if(method==='GET'&&path==='/1.0/storage-pools/payincus-pool')return remotePool?ok(remotePool):bad(404)
 if(method==='DELETE'&&path==='/1.0/storage-pools/payincus-pool'){writes.push('DELETE');remotePool=null;if(mode==='delete-lost'&&!failed){failed=true;return bad(500)}return ok()}
 if(method==='POST'&&path==='/1.0/storage-pools'){let text='';for await(const part of req)text+=part;const b=JSON.parse(text);assert.equal(b.driver,'lvm');assert.equal(b.config['volume.block.filesystem'],'btrfs');writes.push('POST');remotePool={...b,status:'Created'};if(mode==='create-lost'&&!failed){failed=true;return bad(500)}return ok()}
 bad(404)
 }catch{bad(500)}
})
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
const user=await prisma.user.create({data:{username:tag,passwordHash:'unusable'}})
const agent=protectedAgentFixture();(agent.lastReport.hostProvisioningStatus as any).diskTools=true
const host=await prisma.host.create({data:{name:tag,userId:user.id,url:`https://127.0.0.1:${(server.address() as any).port}`,certPath,keyPath,serverCertificate:cert.toString(),serverFingerprint:new X509Certificate(cert).fingerprint256,
 singleTenant:true,isInstalled:true,status:'online',storageSize:34,customerDiskGiB:30,cpuAllowanceMax:200,memoryMax:768,storageDriver:'btrfs',agent:{create:agent},storagePools:{create:{name:'payincus-pool',driver:'btrfs',purpose:'instance_data'}}}})
try{
 for(const scenario of ['occupied','remote-guest','custom-volume','delete-lost','create-lost','success']){
  mode=scenario;failed=false;writes.length=0;remotePool={name:'payincus-pool',driver:'btrfs',config:{source:'/var/lib/incus/disks/payincus-pool.img'},used_by:[]}
  await prisma.storagePool.update({where:{hostId_name:{hostId:host.id,name:'payincus-pool'}},data:{driver:'btrfs',config:{}}})
  assert.equal(await resolveStoragePoolForNewInstance(host.id),null,'old storage cannot receive new pool customers')
  if(scenario==='occupied'){
   const i=await prisma.instance.create({data:{hostId:host.id,userId:user.id,name:tag,incusId:tag,image:'test',status:'running',cpu:100,memory:768,disk:30720}})
   assert.equal(await prepareEmptyPoolDisk(host.id),false);assert.equal(writes.length,0);await prisma.instance.delete({where:{id:i.id}});continue
  }
  if(['remote-guest','custom-volume'].includes(scenario)){await assert.rejects(prepareEmptyPoolDisk(host.id));assert.equal(writes.length,0);continue}
  if(scenario.endsWith('-lost'))await assert.rejects(prepareEmptyPoolDisk(host.id))
  assert.equal(await prepareEmptyPoolDisk(host.id),true)
  assert.equal(await resolveStoragePoolForNewInstance(host.id),'payincus-pool')
  assert.deepEqual(writes,['DELETE','POST'])
  const before=writes.length;assert.equal(await prepareEmptyPoolDisk(host.id),true);assert.equal(writes.length,before)
  assert.equal((await prisma.host.findUniqueOrThrow({where:{id:host.id}})).poolFaulted,false)
 }
 console.log('PASS real PostgreSQL and pinned mTLS: occupied/unknown storage retained, interrupted empty conversion resumed, new checkout uses isolated pool')
}finally{await closeAllClients();await prisma.host.delete({where:{id:host.id}});await prisma.user.delete({where:{id:user.id}});await closePrismaDatabase();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true})}
process.exit(0)
