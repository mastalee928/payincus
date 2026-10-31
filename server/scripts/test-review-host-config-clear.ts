import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import Fastify from 'fastify'
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1','localhost','[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.JWT_SECRET ||= 'host-clear-fixture-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/hosts.js')
const prefix = 'host-clear-' + randomUUID().slice(0,8)
const createdHosts: number[] = []
const owner = await prisma.user.create({ data: {username:prefix,passwordHash:'unusable-fixture',role:'admin'} })
const other = await prisma.user.create({data:{username:prefix+'-other',passwordHash:'unusable-fixture'}})
const host = await prisma.host.create({data:{userId:owner.id,name:prefix,url:'https://node.example.test:8443/path?scope=fixture',ipv6Mode:2,ipv6Subnet:'2001:db8::/64',ipv6ParentInterface:'eth0',location:'old description'}})
const app = Fastify();app.decorate('authenticate',async (request:any)=>{const user=request.headers['x-fixture-other']?other:owner;request.user={id:user.id,role:user.role,username:user.username,sid:prefix,iat:Math.floor(Date.now()/1000)+1}})
app.decorate('requireAdmin',async()=>{});app.decorate('authenticateAdmin',app.authenticate)
await app.register(routes,{prefix:'/hosts'})
const patch = (payload:object,otherActor=false)=>app.inject({method:'PATCH',url:`/hosts/${host.id}`,payload,headers:otherActor?{'x-fixture-other':'1'}:{}})
try {
 // Exercise the real creation contract: route mode may start without IPv6.
 const create = await app.inject({method:'POST',url:'/hosts/',payload:{name:prefix+'-empty',url:'https://[2001:db8:ffff:'+prefix.slice(-8,-4)+':'+prefix.slice(-4)+'::1]:8443',ipv6Mode:1}})
 assert.equal(create.statusCode,201,'creating a routed host without IPv6 is supported')
 const emptyId = create.json().host.id as number; createdHosts.push(emptyId)
 const before = await prisma.host.findUniqueOrThrow({where:{id:emptyId}})
 assert.equal(before.ipv6Mode,1);assert.equal(before.ipv6Subnet,null);assert.equal(before.ipv6ParentInterface,null)
 for(const payload of [{location:'IPv4-only host'},{notifyDestroy:true,ipv6Subnet:'',ipv6ParentInterface:''}]) {
  const result=await app.inject({method:'PATCH',url:`/hosts/${emptyId}`,payload})
  assert.equal(result.statusCode,200,'new empty IPv6 host must allow unrelated edits')
 }
 const after=await prisma.host.findUniqueOrThrow({where:{id:emptyId}})
 assert.equal(after.location,'IPv4-only host');assert.equal(after.notifyDestroy,true)
 assert.deepEqual({...after,location:before.location,notifyDestroy:before.notifyDestroy,updatedAt:before.updatedAt},before)
 for(const payload of [{ipv6Subnet:'2001:db8::/64'},{ipv6ParentInterface:'eth0'}]) {
  const result=await app.inject({method:'PATCH',url:`/hosts/${emptyId}`,payload})
  assert.equal(result.statusCode,400);assert.equal(result.json().code,'HOST_IPV6_ROUTE_REQUIRES_CONFIG')
  assert.deepEqual(await prisma.host.findUniqueOrThrow({where:{id:emptyId}}),after)
 }
 assert.equal((await app.inject({method:'PATCH',url:`/hosts/${emptyId}`,payload:{ipv6Subnet:'2001:db8::/64',ipv6ParentInterface:'eth0'}})).statusCode,200)
 const configured=await prisma.host.findUniqueOrThrow({where:{id:emptyId}})
 assert.equal(configured.ipv6Subnet,'2001:db8::/64');assert.equal(configured.ipv6ParentInterface,'eth0')
 assert.equal((await app.inject({method:'PATCH',url:`/hosts/${emptyId}`,payload:{ipv6Subnet:'',ipv6ParentInterface:''}})).statusCode,400)
 assert.deepEqual(await prisma.host.findUniqueOrThrow({where:{id:emptyId}}),configured)
 // A stale empty form must not overwrite IPv6 committed while its UPDATE waits.
 await prisma.host.update({where:{id:emptyId},data:{ipv6Subnet:null,ipv6ParentInterface:null}})
 let release!:()=>void, entered!:(pid:number)=>void, rejectReady!:(error:unknown)=>void
 const hold=new Promise<void>(resolve=>{release=resolve}),ready=new Promise<number>((resolve,reject)=>{entered=resolve;rejectReady=reject})
 const blocker=prisma.$transaction(async tx=>{
  await tx.host.update({where:{id:emptyId},data:{ipv6Subnet:'2001:db8:2::/64',ipv6ParentInterface:'eth2'}})
  const [row]=await tx.$queryRaw<Array<{pid:number}>>`SELECT pg_backend_pid() AS pid`
  entered(row.pid);await hold
 },{timeout:15000})
 void blocker.catch(rejectReady)
 const pid=await ready
 let settled=false,blocked=false
 const waiting=app.inject({method:'PATCH',url:`/hosts/${emptyId}`,payload:{location:'Concurrent edit',ipv6Subnet:'',ipv6ParentInterface:''}}).then(result=>{settled=true;return result})
 try {
  const deadline=Date.now()+3500
  while(!settled&&Date.now()<deadline){
   const [row]=await prisma.$queryRaw<Array<{count:bigint}>>`SELECT count(*) FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`
   if(Number(row.count)){blocked=true;break};await delay(20)
  }
 } finally {release();await blocker}
 assert.equal((await waiting).statusCode,200);assert.ok(blocked,'observed real PostgreSQL row-lock competition')
 const concurrent=await prisma.host.findUniqueOrThrow({where:{id:emptyId}})
 assert.equal(concurrent.location,'Concurrent edit');assert.equal(concurrent.ipv6Subnet,'2001:db8:2::/64');assert.equal(concurrent.ipv6ParentInterface,'eth2')
 for(const mode of [2,3]) {
  await prisma.host.update({where:{id:host.id},data:{ipv6Mode:mode,location:'old description',ipv6Subnet:'2001:db8::/64',ipv6ParentInterface:'eth0'}})
  const response=await patch({location:'',ipv6Subnet:'',ipv6ParentInterface:''});assert.equal(response.statusCode,200)
  const row=await prisma.host.findUniqueOrThrow({where:{id:host.id}});assert.equal(row.location,'');assert.equal(row.ipv6Subnet,null);assert.equal(row.ipv6ParentInterface,null);assert.equal(row.url,host.url);assert.equal(row.ipv6Mode,mode)
 }
 await prisma.host.update({where:{id:host.id},data:{ipv6Mode:2,location:'retained',ipv6Subnet:'2001:db8::/64',ipv6ParentInterface:'eth0'}})
 assert.equal((await patch({notifyDestroy:true})).statusCode,200)
 let row=await prisma.host.findUniqueOrThrow({where:{id:host.id}});assert.equal(row.location,'retained');assert.equal(row.ipv6Subnet,'2001:db8::/64');assert.equal(row.ipv6ParentInterface,'eth0')
 assert.equal((await patch({location:'',ipv6Subnet:'',ipv6ParentInterface:''},true)).statusCode,403)
 row=await prisma.host.findUniqueOrThrow({where:{id:host.id}});assert.equal(row.location,'retained');assert.equal(row.ipv6Subnet,'2001:db8::/64')
 await prisma.host.update({where:{id:host.id},data:{ipv6Mode:1}})
 for(const payload of [{ipv6Subnet:''},{ipv6ParentInterface:''},{location:'',ipv6Subnet:'',ipv6ParentInterface:''}]) {
  const response=await patch(payload);assert.equal(response.statusCode,400);assert.equal(response.json().code,'HOST_IPV6_ROUTE_REQUIRES_CONFIG')
  row=await prisma.host.findUniqueOrThrow({where:{id:host.id}});assert.equal(row.location,'retained');assert.equal(row.ipv6Subnet,'2001:db8::/64');assert.equal(row.ipv6ParentInterface,'eth0')
 }
 console.log('PASS real Fastify/PG new empty routed host accepts unrelated edits, rejects incomplete additions and clearing configured IPv6; modes 2/3 explicit clearing, omission preservation and foreign ownership hold')
} finally {
 await app.close();await prisma.log.deleteMany({where:{userId:{in:[owner.id,other.id]}}});await prisma.host.deleteMany({where:{id:{in:[host.id,...createdHosts]}}});await prisma.user.deleteMany({where:{id:{in:[owner.id,other.id]}}});await closePrismaDatabase()
}

// The route module starts shared maintenance timers; all fixture cleanup has completed.
process.exit(0)
