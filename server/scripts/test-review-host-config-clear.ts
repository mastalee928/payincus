import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1','localhost','[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.JWT_SECRET ||= 'host-clear-fixture-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/hosts.js')
const prefix = 'host-clear-' + randomUUID().slice(0,8)
const owner = await prisma.user.create({ data: {username:prefix,passwordHash:'unusable-fixture',role:'admin'} })
const other = await prisma.user.create({data:{username:prefix+'-other',passwordHash:'unusable-fixture'}})
const host = await prisma.host.create({data:{userId:owner.id,name:prefix,url:'https://node.example.test:8443/path?scope=fixture',ipv6Mode:2,ipv6Subnet:'2001:db8::/64',ipv6ParentInterface:'eth0',location:'old description'}})
const app = Fastify();app.decorate('authenticate',async (request:any)=>{const user=request.headers['x-fixture-other']?other:owner;request.user={id:user.id,role:user.role,username:user.username,sid:prefix,iat:Math.floor(Date.now()/1000)+1}})
app.decorate('requireAdmin',async()=>{});app.decorate('authenticateAdmin',app.authenticate)
await app.register(routes,{prefix:'/hosts'})
const patch = (payload:object,otherActor=false)=>app.inject({method:'PATCH',url:`/hosts/${host.id}`,payload,headers:otherActor?{'x-fixture-other':'1'}:{}})
try {
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
 console.log('PASS real Fastify/PG modes 2/3 explicit clearing, omission preserves values, foreign actor rejects and route mode rejects before writes; URL and mode preserved')
} finally {
 await app.close();await prisma.log.deleteMany({where:{userId:{in:[owner.id,other.id]}}});await prisma.host.delete({where:{id:host.id}});await prisma.user.deleteMany({where:{id:{in:[owner.id,other.id]}}});await closePrismaDatabase()
}

// The route module starts shared maintenance timers; all fixture cleanup has completed.
process.exit(0)
