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
const {executeExpiryEnforcement}=await import('../src/services/billing-scheduler.js')
const {closeAllClients}=await import('../src/lib/incus/incus-pool.js')
const {closeCaddyClients}=await import('../src/lib/caddy-client.js')
const {stopSessionCleanup,closeAllSessions,getActiveSessionStats}=await import('../src/lib/terminal-proxy.js')
assert.equal(await prisma.user.count(),0)
execFileSync(process.env.REVIEW_OPENSSL||'openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost','-keyout',join(root,'tls.key'),'-out',join(root,'tls.crt')],{stdio:'pipe',windowsHide:true})
const cert=await readFile(join(root,'tls.crt'),'utf8'),guests=new Map<string,any>();let requests:string[]=[],execTarget:string|null=null,failDiscovery=false,loseStop=false,loseDelete=false,noStop=false,busyStopTarget:string|null=null
const server=createServer({key:await readFile(join(root,'tls.key')),cert,ca:cert,requestCert:true,rejectUnauthorized:true},(req,res)=>{void(async()=>{
 const u=new URL(req.url!,'https://fixture');requests.push(req.method+' '+u.pathname)
 const json=(code:number,metadata:unknown)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(code<400?{type:'sync',metadata}:{type:'error',error:'fixture absence'}))}
 if(u.pathname==='/1.0'){json(200,{auth:'trusted',api_version:'1.0'});return}
 if(u.pathname==='/1.0/operations'){json(200,busyStopTarget?{running:[{id:'stale-update',status:'Running',may_cancel:true,resources:{instances:['/1.0/instances/'+busyStopTarget]}}]}:execTarget?{running:[{id:'fixture-exec',class:'websocket',description:'Executing command',status:'Running',resources:{instances:['/1.0/instances/'+execTarget]}}]}:{});return}
 if(u.pathname==='/1.0/operations/stale-update'&&req.method==='DELETE'){busyStopTarget=null;json(200,{});return}
 if(u.pathname==='/1.0/storage-pools'||u.pathname==='/1.0/networks'||u.pathname.includes('/forwards')){json(200,[]);return}
 if(u.pathname==='/1.0/instances'){json(200,[...guests.keys()].map(n=>'/1.0/instances/'+n));return}
 const match=/^\/1\.0\/instances\/([^/]+)(\/(state|exec))?$/.exec(u.pathname)
 if(match){const name=decodeURIComponent(match[1]),g=guests.get(name);if(!g){json(404,{});return}
  if(req.method==='PATCH'){let body='';for await(const b of req)body+=b;Object.assign(g.config,JSON.parse(body).config);json(200,{});return}
  if(req.method==='DELETE'){guests.delete(name);if(loseDelete){req.socket.destroy();return}json(200,{});return}
  if(req.method==='GET'&&failDiscovery){json(500,{});return}
  if(req.method==='GET'){json(200,match[3]==='state'?{status:g.status,network:{eth0:{addresses:[{family:'inet',scope:'global',address:'10.0.0.2'}]}}}:g);return}
  if(req.method==='POST'&&match[3]==='exec'){req.resume();execTarget=name;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({type:'async',operation:'/1.0/operations/fixture-exec',metadata:{metadata:{fds:{0:'data',control:'control'}}}}));return}
  if(req.method==='PUT'&&match[3]==='state'){let body='';for await(const b of req)body+=b;const action=JSON.parse(body).action;if(busyStopTarget===name&&action==='stop'){json(409,{});return}if(!noStop)g.status=action==='start'?'Running':'Stopped';if(loseStop&&action==='stop'){req.socket.destroy();return}json(200,{});return}
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
 await web.register(requireServer('@fastify/websocket'))
 await web.register((await import('../src/routes/public-api.js')).default,{prefix:'/api/v1'})
 await web.register((await import('../src/routes/terminal.js')).default,{prefix:'/instances'})
 await web.register((await import('../src/routes/backups.js')).default,{prefix:'/backups'})
 await web.listen({host:'127.0.0.1',port:0})
 const worker=await import('../src/workers/instanceTaskWorker.js')
 const apiAuth=await import('../src/lib/public-api-auth.js'),token=apiAuth.generatePublicApiToken()
 await prisma.publicApiToken.create({data:{userId:buyer.id,name:'fixture',tokenPrefix:apiAuth.getPublicApiTokenPrefix(token),tokenHash:apiAuth.hashPublicApiToken(token),scopes:['services:operate']}})
 const target=await make('term-api','stopped')
 const api=await web.inject({method:'POST',url:`/api/v1/services/${target.id}/actions`,headers:{authorization:'Bearer '+token},payload:{action:'start'}})
 assert.equal(api.statusCode,403);assert.equal(await prisma.instanceTask.count({where:{instanceId:target.id}}),0)
 const queued=await prisma.instanceTask.create({data:{instanceId:target.id,hostId:host.id,userId:buyer.id,taskType:'start',status:'PROCESSING',startedAt:new Date()}})
 await worker.executeTask(queued.id,{startedAt:queued.startedAt,retryCount:queued.retryCount})
 assert.equal(guests.get(target.incusId).status,'Stopped');assert.equal((await prisma.instanceTask.findUniqueOrThrow({where:{id:queued.id}})).status,'FAILED')
 await retire(target);outcomes.push('PAT and queued worker cannot boot an expired instance')
 const original=await make('rollback','suspended');guests.get(original.incusId).status='Stopped'
 const task=await prisma.restoreTask.create({data:{instanceId:original.id,hostId:host.id,userId:buyer.id,status:'FAILED',progress:'restoring',startedAt:new Date(),finishedAt:new Date(),originalInstanceName:original.name,originalIncusId:original.incusId,
  recoveryState:{version:1,stage:'importing',original:{uuid:guests.get(original.incusId).config['volatile.uuid'],type:'container',pool:'default',configurationHash:'fixture'},backups:[],snapshots:[]}}})
 const rollback=await web.inject({method:'POST',url:`/backups/${original.id}/restore/${task.id}/rollback`})
 assert.notEqual(rollback.statusCode,200);assert.equal(guests.get(original.incusId).status,'Stopped');await retire(original)
 outcomes.push('restore rollback cannot boot expiry-suspended original')
 const terminal=await make('terminal')
 assert.equal((await web.inject({method:'POST',url:`/instances/${terminal.id}/terminal-ticket`})).statusCode,400)
 await prisma.instance.update({where:{id:terminal.id},data:{expiresAt:new Date(Date.now()+60000)}})
 const ticket=await web.inject({method:'POST',url:`/instances/${terminal.id}/terminal-ticket`});assert.equal(ticket.statusCode,200)
 const c=new WebSocket(`ws://127.0.0.1:${(web.server.address() as any).port}/instances/${terminal.id}/terminal?ticket=${ticket.json().ticket}`);clients.push(c);const messages:any[]=[];c.on('message',(m:any)=>messages.push(JSON.parse(String(m))));c.on('error',()=>{})
 await wait(()=>messages.some(m=>m.type==='connected'),'active terminal opened')
 await prisma.instance.update({where:{id:terminal.id},data:{expiresAt:new Date(Date.now()-60000)}})
 await executeExpiryEnforcement()
 assert.equal(guests.get(terminal.incusId).status,'Stopped');assert.equal(getActiveSessionStats().byInstance.has(terminal.id),false)
 await wait(()=>backendSockets.size===0,'expiry closed terminal sockets');execTarget=null;await retire(terminal)
 outcomes.push('expired terminal admission rejected; active exec closes and does not veto stop')
 const planDb=await import('../src/db/package-plans.js')
 const fresh=await prisma.packagePlan.create({data:{packageId:pkg.id,name:'race',cpu:100,memory:128,disk:1024,price:1000,portLimit:0,snapshotLimit:0,backupLimit:0,siteLimit:0,trafficLimit:0n}})
 assert.equal((await planDb.canDeletePlan(fresh.id)).canDelete,true)
 const race=await make('plan-race','running',fresh.id);await assert.rejects(planDb.deletePlan(fresh.id),/PLAN_HAS_INSTANCES/)
 assert.equal((await prisma.instance.findUniqueOrThrow({where:{id:race.id}})).packagePlanId,fresh.id);await retire(race)
 outcomes.push('plan delete transaction rejects creation committed after admission check')
 for(const variant of ['null-rebuild','no-plan','manual','wrong-uuid','wrong-created','empty-section','blocked-snapshot','pending-start','starting','unknown']){
  const i=await make(variant,'running',variant==='no-plan'?null:plan.id)
  if(variant==='null-rebuild')await prisma.instanceTask.create({data:{instanceId:i.id,hostId:host.id,userId:buyer.id,taskType:'rebuild',status:'COMPLETED',finishedAt:new Date()}})
  if(variant==='manual')await prisma.instance.update({where:{id:i.id},data:{status:'suspended',suspendedBy:owner.id,suspendReason:'manual'}})
  if(variant==='wrong-uuid'||variant==='wrong-created'||variant==='empty-section')await prisma.instance.update({where:{id:i.id},data:{snapshottedSpecs:{recoveryIdentity:variant==='empty-section'?{}:{uuid:randomUUID(),createdAt:'2020-01-01T00:00:00Z'}}}})
  if(variant==='blocked-snapshot')await prisma.autoSnapshotOperation.create({data:{id:randomUUID(),instanceId:i.id,ownerId:buyer.id,hostId:host.id,incusId:i.incusId,identityHash:'fixture',snapshotName:'fixture',state:'blocked'}})
  if(variant==='pending-start')await prisma.instanceTask.create({data:{instanceId:i.id,hostId:host.id,userId:buyer.id,taskType:'start',status:'PENDING'}})
  if(variant==='starting')guests.get(i.incusId).status='Starting'
  if(variant==='unknown')guests.get(i.incusId).status='Unknown'
  await executeExpiryEnforcement();assert.equal(guests.get(i.incusId).status,'Stopped',variant);assert.equal(guests.get(i.incusId).config['boot.autostart'],'false',variant)
  await retire(i);outcomes.push('stopped without metadata or workflow veto: '+variant)
 }
 const {withInstanceBillingMutation}=await import('../src/lib/instance-billing-mutation.js'),holds:any[]=[]
 const busy:any[]=[]
 for(let k=0;k<5;k++){
  const i=await make('lane'+k);busy.push(i);let release!:()=>void,entered!:()=>void
  const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r)
  const promise=withInstanceBillingMutation(i.id,async()=>{entered();await gate});holds.push({release,promise});await started
 }
 const sixth=await make('fair-scan');await executeExpiryEnforcement();assert.equal(guests.get(sixth.incusId).status,'Stopped')
 for(const h of holds)h.release();await Promise.all(holds.map(h=>h.promise));for(const i of [...busy,sixth])await retire(i)
 outcomes.push('five occupied billing lanes cannot starve sixth expired instance')
 const lost=await make('lease')
 await prisma.distributedLock.create({data:{lockKey:'billing:expiry-suspend:instance:'+lost.id,ownerId:'dead-writer',acquiredAt:new Date(),expiresAt:new Date(Date.now()+1800000)}})
 await executeExpiryEnforcement();assert.equal(guests.get(lost.incusId).status,'Stopped');await retire(lost)
 outcomes.push('abandoned 30-minute lease cannot veto stop')
 const {performRenewal}=await import('../src/db/billing-operations.js')
 const {RENEWAL_RESUME_ENTRY}=await import('../src/services/renewal-resume.js')
 await prisma.user.update({where:{id:buyer.id},data:{balance:100}})
 const renew=await make('legacy-paid-resume','suspended');guests.get(renew.incusId).status='Stopped'
 await prisma.instance.update({where:{id:renew.id},data:{suspendReason:'expired',suspendedAt:new Date(),autoRenew:true,billingPrice:10,billingCycle:1}})
 await prisma.instanceTask.create({data:{instanceId:renew.id,hostId:host.id,userId:buyer.id,taskType:'rebuild',status:'COMPLETED',finishedAt:new Date()}})
 await performRenewal(buyer.id,await prisma.instance.findUniqueOrThrow({where:{id:renew.id}}),1,{expiryThreshold:new Date(Date.now()+86400000)})
 const resume=await prisma.instanceTask.findFirstOrThrow({where:{instanceId:renew.id,operationEntry:RENEWAL_RESUME_ENTRY}})
 const claim=await worker.claimNextTask(host.id);assert.equal(claim?.id,resume.id)
 await worker.executeTask(claim!.id,{startedAt:claim!.startedAt,retryCount:claim!.retryCount});assert.equal((await prisma.instanceTask.findUniqueOrThrow({where:{id:resume.id}})).status,'COMPLETED')
 assert.equal(guests.get(renew.incusId).status,'Running');assert.equal(await prisma.instanceBillingRecord.count({where:{instanceId:renew.id,type:'renew'}}),1);await retire(renew)
 outcomes.push('legacy NULL identity automatic renewal restores Running and debits once')
 for(const mode of ['late-suspension','missing-suspended-at','running-after-grace']){
  const i=await make(mode);await prisma.instance.update({where:{id:i.id},data:{expiresAt:new Date(Date.now()-5*86400000),status:mode==='running-after-grace'?'running':'suspended',suspendedAt:mode==='missing-suspended-at'?null:new Date(),suspendReason:'expired'}})
  await executeExpiryEnforcement();assert.equal(guests.has(i.incusId),false,mode);assert.equal((await prisma.instance.findUniqueOrThrow({where:{id:i.id}})).deletionBillingPending,false,mode)
  outcomes.push('grace deletes current guest independent of suspension timestamp: '+mode)
 }
 const noGrace=await make('renewal-cutoff');await prisma.instance.update({where:{id:noGrace.id},data:{expiresAt:new Date(Date.now()-5*86400000),autoRenew:true,billingPrice:0}})
 await executeExpiryEnforcement();assert.equal(await prisma.instanceBillingRecord.count({where:{instanceId:noGrace.id,type:'renew'}}),0);assert.equal(guests.has(noGrace.incusId),false)
 outcomes.push('already past grace cannot renew even when still running and price zero')
 const discovery=await make('discovery-failure');failDiscovery=true;await executeExpiryEnforcement();failDiscovery=false
 assert.equal(guests.get(discovery.incusId).status,'Stopped');await executeExpiryEnforcement();await retire(discovery)
 outcomes.push('failed GET discovery still dispatches stop; next read closes verification')
 const lostStopGuest=await make('lost-stop');loseStop=true;await executeExpiryEnforcement();loseStop=false
 assert.equal(guests.get(lostStopGuest.incusId).status,'Stopped')
 const stopCount=requests.filter(r=>r==='PUT /1.0/instances/'+lostStopGuest.incusId+'/state').length
 await executeExpiryEnforcement();assert.equal(requests.filter(r=>r==='PUT /1.0/instances/'+lostStopGuest.incusId+'/state').length,stopCount)
 await retire(lostStopGuest);outcomes.push('lost accepted stop response confirms without duplicate stop')
 const ineffective=await make('no-effect');noStop=true;await executeExpiryEnforcement();noStop=false
 assert.equal(guests.get(ineffective.incusId).status,'Running');assert.equal(await prisma.log.count({where:{instanceId:ineffective.id,action:'instance.expiry_stop_reconciled'}}),0)
 await executeExpiryEnforcement();assert.equal(guests.get(ineffective.incusId).status,'Stopped');await retire(ineffective)
 outcomes.push('HTTP success without stop stays failed then recovers automatically')
 const blocked=await make('busy-remote');busyStopTarget=blocked.incusId;await executeExpiryEnforcement()
 assert.equal(guests.get(blocked.incusId).status,'Stopped');assert.equal(busyStopTarget,null);await retire(blocked)
 outcomes.push('refused force stop cancels exact cancellable stale operation then confirms Stopped')
 const lostDelete=await make('lost-delete');await prisma.instance.update({where:{id:lostDelete.id},data:{expiresAt:new Date(Date.now()-4*86400000)}})
 loseDelete=true;await executeExpiryEnforcement();loseDelete=false;assert.equal(guests.has(lostDelete.incusId),false)
 await executeExpiryEnforcement();assert.equal((await prisma.instance.findUniqueOrThrow({where:{id:lostDelete.id}})).deletionBillingPending,false)
 outcomes.push('lost accepted delete response settles absence without duplicate delete')
 const saveFailure=await make('savepoint-failure')
 await prisma.$executeRawUnsafe(`CREATE FUNCTION expiry_test_save_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id=${saveFailure.id} AND NEW.snapshotted_specs IS DISTINCT FROM OLD.snapshotted_specs THEN RAISE EXCEPTION 'fixture expiry boot write failure'; END IF; RETURN NEW; END $$`)
 await prisma.$executeRawUnsafe(`CREATE TRIGGER expiry_test_save_failure BEFORE UPDATE ON instances FOR EACH ROW EXECUTE FUNCTION expiry_test_save_failure()`)
 try{await executeExpiryEnforcement();assert.equal(guests.get(saveFailure.incusId).status,'Stopped')}finally{
  await prisma.$executeRawUnsafe('DROP TRIGGER expiry_test_save_failure ON instances');await prisma.$executeRawUnsafe('DROP FUNCTION expiry_test_save_failure()')
 }
 await executeExpiryEnforcement();assert.equal(guests.get(saveFailure.incusId).config['boot.autostart'],'false');await retire(saveFailure)
 outcomes.push('real PostgreSQL boot write failure rolls back savepoint; physical stop still executes and later repairs original policy')
 const renewalFailure=await make('renew-scan-failure'),independent=await make('renew-independent')
 await prisma.instance.update({where:{id:renewalFailure.id},data:{autoRenew:true}})
 const findUnique=prisma.instance.findUnique
 prisma.instance.findUnique=(async(args:any)=>args?.where?.id===renewalFailure.id?Promise.reject(Error('fixture renewal read failure')):findUnique(args)) as any
 try{await executeExpiryEnforcement()}finally{prisma.instance.findUnique=findUnique}
 assert.equal(guests.get(independent.incusId).status,'Stopped');await retire(renewalFailure);await retire(independent)
 outcomes.push('single renewal read failure cannot abort unrelated expiry stop')
 const {startExpiryEnforcement,stopExpiryEnforcement,getExpiryEnforcementStatus}=await import('../src/services/billing-scheduler.js')
 const immediate=await make('startup-expiry'),deadline=await make('exact-deadline')
 await prisma.instance.update({where:{id:deadline.id},data:{expiresAt:new Date(Date.now()+2000)}})
 await startExpiryEnforcement();await wait(()=>guests.get(immediate.incusId).status==='Stopped','startup catchup')
 await wait(()=>guests.get(deadline.incusId).status==='Stopped','exact deadline wakeup')
 await stopExpiryEnforcement();while((await getExpiryEnforcementStatus()).running)await new Promise(r=>setTimeout(r,10))
 await retire(immediate);await retire(deadline);outcomes.push('startup catches overdue immediately and exact expiry wakes before next five-minute tick')
 if(process.env.EXPIRY_RESULT_PATH)await writeFile(process.env.EXPIRY_RESULT_PATH,JSON.stringify({actualSource:true,realPostgreSQL:true,realTlsWebsocket:true,incusFixture:true,productionChanges:false,outcomes},null,2))
 console.log('REGRESSIONS_PASS '+JSON.stringify(outcomes))
}catch(error){testFailure=error;console.error('REGRESSION_FAILED',error)}finally{
 closeAllSessions();stopSessionCleanup();for(const c of clients)c.terminate();for(const c of backendSockets)c.terminate();backendWs.close()
 const cron=requireServer('node-cron');for(const t of cron.getTasks().values())await t.destroy()
 await web.close();await closeAllClients();await closeCaddyClients();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await closePrismaDatabase();console.log('REGRESSION_RESOURCES_CLOSED')
 // Import-only application timers are not services started by this fixture.
 // All owned sockets/database handles above are closed before exiting.
 process.exit(testFailure?1:process.exitCode||0)
}
