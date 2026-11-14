import { protectedAgentFixture } from './fixtures/guest-protection.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
const url = new URL(process.env.DATABASE_URL || '')
assert.ok(url.hostname === '127.0.0.1' && url.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'; process.env.JWT_SECRET ||= 'resale-test-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { upsertPoolPrice } = await import('../src/services/host-pool-prices.js')
const { queueDeletedPoolHost, processPoolCleanup } = await import('../src/services/host-pool-cleanup.js')
const { placePoolOrder } = await import('../src/services/pool-orders.js')
const { adminInstanceRenewalPrice } = await import('../src/services/admin-instance-renewal-price.js')
const tag = 'resale-' + randomUUID().slice(0,8)
const admin = await prisma.user.create({ data: { username: tag, passwordHash: 'fixture', role: 'admin' } })
const oldBuyer = await prisma.user.create({ data: { username: tag+'-old', passwordHash:'fixture',balance:100 } })
const buyer = await prisma.user.create({ data: { username: tag+'-new',passwordHash:'fixture',balance:100 } })
const group = await prisma.hostMachineGroup.create({data:{name:tag}})
const region = await prisma.hostRegionGroup.create({data:{machineGroupId:group.id,name:tag,countryCode:'us'}})
const price = (await upsertPoolPrice({ machineGroupId:group.id,regionGroupId:region.id,resourcePreset:'E2',diskGiB:30,monthlyPrice:1000,setupFee:0 },admin.id)).price
const plan = await prisma.packagePlan.findUniqueOrThrow({where:{id:price.shadowPlanId!}})
const image = await prisma.systemImage.create({data:{name:tag,remoteAlias:tag+'/debian',architecture:'x86_64',instanceType:'container',icon:'debian'}})
const host = await prisma.host.create({data:{userId:admin.id,name:tag,url:'https://127.0.0.1:1',singleTenant:true,
  machineGroupId:group.id,regionGroupId:region.id,resourcePreset:'E2',customerDiskGiB:30,architecture:'x86_64',
  status:'online',isInstalled:true,natPublicIp:'192.0.2.8',natBindIp:'10.0.0.8',certPath:'original.cert',keyPath:'original.key',
  natPortStart:1,natPortEnd:65535,
  cpuAllowanceMax:200,memoryMax:768,storageSize:34,cpuUsed:200,memoryUsed:768,diskUsed:30720,
  portProtocol:'tcp',portProtocolRevision:1,portProtocolApplied:'tcp',portProtocolAppliedRevision:1,
  agent:{create:protectedAgentFixture(['ingress-port-protocol-v1'])},storagePools:{create:{name:'default',driver: 'lvm', purpose: 'instance_data', config: { 'volume.block.filesystem': 'btrfs' }}}}})
const old = await prisma.instance.create({data:{hostId:host.id,userId:oldBuyer.id,name:tag,incusId:tag,image:image.remoteAlias,
  status:'stopped',cpu:200,memory:768,disk:30720,packageId:plan.packageId,packagePlanId:plan.id,billingPrice:10,billingCycle:1,
  expiresAt:new Date(Date.now()+86400000),dedicatedIpv4:true,dedicatedNetworkReady:true,poolPriceId:price.id}})
const actor={id:admin.id,sid:tag,iat:Math.floor(Date.now()/1000)+1}
const beforePrice=await prisma.hostPoolPrice.findUniqueOrThrow({where:{id:price.id}})
try {
 const quote=await adminInstanceRenewalPrice(old.id,actor)
 await adminInstanceRenewalPrice(old.id,actor,{revision:quote.revision,price:1.23})
 assert.deepEqual(await prisma.hostPoolPrice.findUniqueOrThrow({where:{id:price.id}}),beforePrice)
 assert.equal(Number((await prisma.packagePlan.findUniqueOrThrow({where:{id:plan.id}})).price),1000)
 // Start at a confirmed deletion; the real cleanup still checks every empty
 // guest/volume/forward inventory before releasing this same host.
 await prisma.instance.update({where:{id:old.id},data:{status:'deleted',deletionIntent:Prisma.DbNull}})
 await queueDeletedPoolHost(old.id)
 const connect:any=async()=>({request:async(method:string,path:string)=>{
  assert.equal(method,'GET','post-deletion reinspection cannot delete another instance')
  if(path==='/1.0/projects?recursion=1')return[{name:'default'}]
  if(path.includes('/operations?'))return{}
  if(path.includes('/storage-pools?'))return[{name:'default',status:'Created'}]
  if(path.includes('/networks?'))return[{name:'incusbr0',managed:true,type:'bridge'}]
  return[]
 }})
 await processPoolCleanup(host.id,connect)
 const freed=await prisma.host.findUniqueOrThrow({where:{id:host.id}})
 assert.equal(freed.poolFaulted,false);assert.deepEqual([freed.cpuUsed,freed.memoryUsed,freed.diskUsed],[0,0,0])
 assert.equal(Number((await prisma.instance.findUniqueOrThrow({where:{id:old.id}})).renewalPrice),1.23)
 const result=await placePoolOrder(buyer.id,buyer.username,{requestId:randomUUID(),items:[{poolPriceId:price.id,quantity:1,namePrefix:tag+'-new',image:image.remoteAlias}],expectedTotal:1000},undefined,{sid:tag+'-new',iat:actor.iat})
 const next=await prisma.instance.findUniqueOrThrow({where:{id:result.instances[0].id}})
 assert.equal(next.hostId,host.id);assert.notEqual(next.id,old.id);assert.equal(next.userId,buyer.id)
 assert.equal(next.renewalPrice,null);assert.equal(Number(next.billingPrice),10)
 assert.equal(Number((await prisma.instanceBillingRecord.findFirstOrThrow({where:{instanceId:next.id,type:'newPurchase'}})).amount),10)
 console.log('PASS modified old instance -> verified empty cleanup -> same host resold: original pool/plan price, new override null, new bill 10, historical override 1.23 unchanged')
}finally{await closePrismaDatabase()}
process.exit(0)
