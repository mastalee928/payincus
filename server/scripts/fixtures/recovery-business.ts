import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { prisma } from '../../src/db/prisma.js'
import { recoveryHeld, recoveryRequestAllowed } from '../../src/services/platform-backup-core.js'

// One selected-snapshot customer, with an original guest and paid expiry. All
// routes below use real PostgreSQL; no remote guest mutation or notification.
export async function recoveryBusinessFixture(hostId: number, adminId: number) {
  const owner=await prisma.user.create({data:{username:'snapshot-customer',passwordHash:'fixture-not-login',balance:100}})
  const other=await prisma.user.create({data:{username:'snapshot-other',passwordHash:'fixture-not-login'}})
  const pkg=await prisma.package.create({data:{userId:adminId,name:'snapshot-original',cpuMax:100,memoryMax:1024,diskMax:2048}})
  const plan=await prisma.packagePlan.create({data:{packageId:pkg.id,name:'monthly',cpu:100,memory:1024,disk:2048,price:1000,billingCycle:1,
    portLimit:1,snapshotLimit:0,backupLimit:0,siteLimit:0,trafficLimit:0}})
  const instance=await prisma.instance.create({data:{userId:owner.id,hostId,packageId:pkg.id,packagePlanId:plan.id,name:'original-customer-vps',
    incusId:'original-'+randomUUID(),image:'fixture',cpu:100,memory:1024,disk:2048,billingPrice:10,billingCycle:1,
    status:'stopped',autoRenew:true,expiresAt:new Date(Date.now()+12*3600000),snapshottedSpecs:{recoveryIdentity:{uuid:randomUUID(),project:'default'}}}})
  const app=Fastify(),oldFetch=globalThis.fetch
  let actor={id:owner.id,role:'user',username:owner.username,sid:randomUUID(),iat:Math.floor(Date.now()/1000)+1}
  for(const name of ['authenticate','authenticateUser','authenticateAdmin'])app.decorate(name,async(request:any)=>{request.user={...actor}})
  app.addHook('onRequest',async(request,reply)=>{
    if(recoveryHeld()&&!recoveryRequestAllowed(request.method,request.url))return reply.code(503).send({code:'PLATFORM_RECOVERY_HELD'})
  })
  await app.register((await import('../../src/routes/instances.js')).default,{prefix:'/api/instances'})
  await app.register((await import('../../src/routes/instance-billing.js')).default,{prefix:'/api/instances'})
  const {processAutoRenew}=await import('../../src/services/billing-scheduler.js')
  const snapshot=async()=>({guest:await prisma.instance.findUniqueOrThrow({where:{id:instance.id}}),
    balance:Number((await prisma.user.findUniqueOrThrow({where:{id:owner.id}})).balance),
    bills:await prisma.instanceBillingRecord.count({where:{instanceId:instance.id}}),logs:await prisma.balanceLog.count({where:{instanceId:instance.id}})})
  const before=await snapshot()
  return {
    async held(){
      assert.equal((await app.inject({method:'GET',url:'/api/instances/'})).statusCode,503)
      await processAutoRenew(instance)
      assert.deepEqual(await snapshot(),before,'restore hold permits no billing changes')
    },
    async restored(){
      globalThis.fetch=async()=>{throw Error('Unexpected external business request')}
      assert.deepEqual(await snapshot(),before,'restoring and checking heartbeats does not alter the original guest, paid expiry or balance')
      const own=await app.inject({method:'GET',url:'/api/instances/'})
      assert.equal(own.statusCode,200,own.body);assert.deepEqual(own.json().instances.map((row:any)=>row.id),[instance.id])
      assert.equal((await app.inject({method:'GET',url:`/api/instances/${instance.id}`})).statusCode,200)
      actor={...actor,id:other.id,username:other.username}
      assert.equal((await app.inject({method:'GET',url:`/api/instances/${instance.id}`})).statusCode,403)
      assert.equal((await app.inject({method:'GET',url:'/api/instances/'})).json().instances.length,0)
      actor={...actor,id:adminId,role:'admin'}
      const admin=await app.inject({method:'GET',url:`/api/instances/?userId=${owner.id}`})
      assert.equal(admin.statusCode,200,admin.body);assert.equal(admin.json().instances[0].userId,owner.id)
      assert.equal((await app.inject({method:'GET',url:`/api/instances/${instance.id}`})).statusCode,200)
      await processAutoRenew(instance);await processAutoRenew(instance)
      const renewed=await snapshot()
      assert.equal(renewed.balance,90);assert.equal(renewed.bills,1);assert.equal(renewed.logs,1)
      assert.equal(renewed.guest.incusId,before.guest.incusId);assert.deepEqual(renewed.guest.snapshottedSpecs,before.guest.snapshottedSpecs)
      assert.equal(renewed.guest.status,'stopped');assert.ok(renewed.guest.expiresAt!>before.guest.expiresAt!)
      console.log('PASS selected snapshot business: held writes refused; original user/admin guest views, cross-user rejection, one automatic renewal and unchanged guest identity')
    },
    async close(){globalThis.fetch=oldFetch;await app.close()}
  }
}
