import assert from 'node:assert/strict'
import {randomUUID,X509Certificate} from 'node:crypto'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {createServer} from 'node:https'
import {createRequire} from 'node:module'
const requireServer=createRequire(new URL('../package.json',import.meta.url))
const dburl=new URL(process.env.DATABASE_URL||'');assert.equal(dburl.hostname,'127.0.0.1');assert.ok(dburl.pathname.endsWith('_expiry_test'))
process.env.NODE_ENV='test'
const root=await mkdtemp(join(tmpdir(),'expiry-access-'));process.env.PLATFORM_BACKUP_STATE_DIR=root;process.env.ENV_FILE=join(root,'none.env')
const {prisma,closePrismaDatabase}=await import('../src/db/prisma.js')
const {WebSocket,WebSocketServer}=requireServer('ws'),backendWs=new WebSocketServer({noServer:true}),backendSockets=new Set<any>()
backendWs.on('connection',(s:any)=>{backendSockets.add(s);s.once('close',()=>backendSockets.delete(s))})
const {executeExpiryEnforcement,executeExpiryDelete}=await import('../src/services/billing-scheduler.js')
const {closeAllClients}=await import('../src/lib/incus/incus-pool.js')
const {closeCaddyClients}=await import('../src/lib/caddy-client.js')
const {stopSessionCleanup,closeAllSessions,getActiveSessionStats}=await import('../src/lib/terminal-proxy.js')
assert.equal(await prisma.user.count(),0)
execFileSync(process.env.REVIEW_OPENSSL||'openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost','-keyout',join(root,'tls.key'),'-out',join(root,'tls.crt')],{stdio:'pipe',windowsHide:true})
const cert=await readFile(join(root,'tls.crt'),'utf8'),guests=new Map<string,any>();let requests:string[]=[],execTarget:string|null=null,failDiscovery=false,loseStop=false,loseDelete=false,noStop=false
const server=createServer({key:await readFile(join(root,'tls.key')),cert,ca:cert,requestCert:true,rejectUnauthorized:true},(req,res)=>{void(async()=>{
 const u=new URL(req.url!,'https://fixture');requests.push(req.method+' '+u.pathname)
 const json=(code:number,metadata:unknown)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(code<400?{type:'sync',metadata}:{type:'error',error:'fixture absence'}))}
 if(u.pathname==='/1.0'){json(200,{auth:'trusted',api_version:'1.0'});return}
 if(u.pathname==='/1.0/operations'){json(200,execTarget?{running:[{id:'fixture-exec',class:'websocket',description:'Executing command',status:'Running',resources:{instances:['/1.0/instances/'+execTarget]}}]}:{});return}
 if(u.pathname==='/1.0/storage-pools'||u.pathname==='/1.0/networks'||u.pathname.includes('/forwards')){json(200,[]);return}
 if(u.pathname==='/1.0/instances'){json(200,u.searchParams.has('recursion')?[...guests.values()]:[...guests.keys()].map(n=>'/1.0/instances/'+n));return}
 const match=/^\/1\.0\/instances\/([^/]+)(\/(state|exec))?$/.exec(u.pathname)
 if(match){const name=decodeURIComponent(match[1]),g=guests.get(name);if(!g){json(404,{});return}
  if(req.method==='PATCH'){let body='';for await(const b of req)body+=b;Object.assign(g.config,JSON.parse(body).config);json(200,{});return}
  if(req.method==='DELETE'){guests.delete(name);if(loseDelete){req.socket.destroy();return}json(200,{});return}
  if(req.method==='GET'&&failDiscovery){json(500,{});return}
  if(req.method==='GET'){json(200,match[3]==='state'?{status:g.status,network:{eth0:{addresses:[{family:'inet',scope:'global',address:'10.0.0.2'}]}}}:g);return}
  if(req.method==='POST'&&match[3]==='exec'){req.resume();execTarget=name;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({type:'async',operation:'/1.0/operations/fixture-exec',metadata:{metadata:{fds:{0:'data',control:'control'}}}}));return}
  if(req.method==='PUT'&&match[3]==='state'){let body='';for await(const b of req)body+=b;const action=JSON.parse(body).action;if(!noStop)g.status=action==='start'?'Running':'Stopped';if(loseStop&&action==='stop'){req.socket.destroy();return}json(200,{});return}
 }
 json(404,{})
})().catch(e=>{console.error('FIXTURE_ERROR',e.message);process.exitCode=1;res.destroy()})})
server.on('upgrade',(req,socket,head)=>backendWs.handleUpgrade(req,socket,head,s=>backendWs.emit('connection',s)))
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
const owner=await prisma.user.create({data:{username:'expiry-access-owner',passwordHash:'unusable',role:'admin'}}),buyer=await prisma.user.create({data:{username:'expiry-access-user',passwordHash:'unusable'}})
const pkg=await prisma.package.create({data:{userId:owner.id,name:'fixture',cpuMax:100,memoryMax:128,diskMax:1024}})
const plan=await prisma.packagePlan.create({data:{packageId:pkg.id,name:'fixture',cpu:100,memory:128,disk:1024,price:1000,portLimit:0,snapshotLimit:0,backupLimit:1,siteLimit:0,trafficLimit:0n}})
const host=await prisma.host.create({data:{userId:owner.id,name:'fixture',status:'online',url:'https://127.0.0.1:'+(server.address() as any).port,certPath:join(root,'tls.crt'),keyPath:join(root,'tls.key'),serverCertificate:cert,serverFingerprint:new X509Certificate(cert).fingerprint256}})
const make=async(tag:string,status='running',planId:number|null=plan.id)=>{const name=tag+'-'+randomUUID(),g={name,status:status==='stopped'?'Stopped':'Running',type:'container',ephemeral:false,created_at:new Date().toISOString(),config:{'volatile.uuid':randomUUID(),'boot.autostart':'true'},devices:{root:{type:'disk',path:'/',pool:'default'}},profiles:[]};guests.set(name,g)
 return prisma.instance.create({data:{userId:buyer.id,hostId:host.id,packageId:pkg.id,packagePlanId:planId,name,incusId:name,image:'fixture/alpine',cpu:100,memory:128,disk:1024,status:status as any,expiresAt:new Date(Date.now()-60000),snapshottedSpecs:{recoveryIdentity:{uuid:g.config['volatile.uuid'],createdAt:g.created_at}}}})}
const retire=(i:any)=>prisma.instance.update({where:{id:i.id},data:{status:'deleted',deletionBillingPending:false}})
const Fastify=requireServer('fastify'),web=Fastify(),actor={id:buyer.id,role:'user',username:buyer.username,sid:'expiry-access-fixture',iat:Math.floor(Date.now()/1000)}
web.decorate('authenticate',async(req:any)=>{req.user=actor});web.decorate('authenticateAdmin',web.authenticate);web.decorate('authenticateUser',web.authenticate)
const outcomes:any[]=[],clients:any[]=[]
let testFailure:unknown
const wait=async(fn:()=>boolean,label:string)=>{const end=Date.now()+5000;while(!fn()){assert.ok(Date.now()<end,label);await new Promise(r=>setTimeout(r,10))}}
try{
 const {stopExpiredCurrentGuest}=await import('../src/services/expiry-current-guest.js')
 const {sameGuestCreationTime,guestIdentityInstant}=await import('../src/lib/guest-identity-time.js')
 assert.equal(sameGuestCreationTime('2026-11-01T00:00:00.123Z','2026-11-01T08:00:00.123000000+08:00'),true)
 assert.equal(sameGuestCreationTime('2026-11-01T00:00:00.123000001Z','2026-11-01T00:00:00.123Z'),false)
 assert.equal(guestIdentityInstant('2026-02-30T00:00:00Z'),null)
 const row=await make('stop-binding')
 const {Client}=requireServer('pg'),holder=new Client({connectionString:process.env.DATABASE_URL});await holder.connect()
 await holder.query('BEGIN');await holder.query('SELECT id FROM instances WHERE id=$1 FOR UPDATE',[row.id])
 const pending=stopExpiredCurrentGuest(row.id)
 await new Promise(r=>setTimeout(r,100));await holder.query("UPDATE instances SET expires_at=(NOW() AT TIME ZONE 'UTC')+interval '1 day', version=version+1 WHERE id=$1",[row.id]);await holder.query('COMMIT')
 assert.equal(await pending,'renewed');assert.equal(guests.get(row.incusId).status,'Running');await retire(row)
 outcomes.push('committed renewal while expiry waits on row prevents stale stop')
 const locked=await make('manual-busy');await holder.query('BEGIN');await holder.query('SELECT id FROM instances WHERE id=$1 FOR UPDATE',[locked.id])
 const busy=stopExpiredCurrentGuest(locked.id).then(()=>false,()=>true);assert.equal(await busy,true);await holder.query('COMMIT')
 await stopExpiredCurrentGuest(locked.id);assert.equal(guests.get(locked.incusId).status,'Stopped');await retire(locked)
 outcomes.push('actual row lock timeout retained, next attempt automatically stops')
 const {recoverPoolHost}=await import('../src/services/host-pool-recovery.js')
 const concurrent=await make('recovery-lock');await Promise.allSettled([stopExpiredCurrentGuest(concurrent.id),recoverPoolHost(host.id,owner.id,{confirmation:'fixture',acknowledgeCleanup:false})])
 await stopExpiredCurrentGuest(concurrent.id);assert.equal(guests.get(concurrent.incusId).status,'Stopped');await retire(concurrent)
 outcomes.push('expiry and recovery lock order no longer deadlocks')
 await prisma.host.update({where:{id:host.id},data:{cpuAllowanceMax:100,memoryMax:128,storageSize:34,resourcePreset:'E1',customerDiskGiB:1}})
 const pool=await make('dedicated-delete');await prisma.host.update({where:{id:host.id},data:{singleTenant:true}})
 await prisma.instance.update({where:{id:pool.id},data:{expiresAt:new Date(Date.now()-4*86400000)}})
 const copy='restore-copy-'+randomUUID();guests.set(copy,{...guests.get(pool.incusId),name:copy,status:'Running'})
 // A dedicated inventory owns this customer's whole host, including abandoned copies.
 await executeExpiryDelete();assert.equal(guests.size,0)
 assert.equal(guests.has(pool.incusId),false);assert.equal(guests.has(copy),false)
 assert.equal((await prisma.instance.findUniqueOrThrow({where:{id:pool.id}})).deletionBillingPending,false)
 outcomes.push('dedicated deletion confirms all-project list empty, removes restored leftover copies')
 await holder.end()
 if(process.env.EXPIRY_RESULT_PATH)await writeFile(process.env.EXPIRY_RESULT_PATH,JSON.stringify({realPostgreSQL:true,realTls:true,incusFixture:true,productionChanges:false,outcomes},null,2))
 console.log('CONCURRENCY_REGRESSIONS_PASS '+JSON.stringify(outcomes))
}catch(e){testFailure=e;console.error('CONCURRENCY_REGRESSION_FAILED',e)}finally{
 closeAllSessions();stopSessionCleanup();for(const c of clients)c.terminate();for(const c of backendSockets)c.terminate();backendWs.close()
 const cron=requireServer('node-cron');for(const t of cron.getTasks().values())await t.destroy()
 await web.close();await closeAllClients();await closeCaddyClients();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await closePrismaDatabase();console.log('CONCURRENCY_RESOURCES_CLOSED');process.exit(testFailure?1:process.exitCode||0)
}
