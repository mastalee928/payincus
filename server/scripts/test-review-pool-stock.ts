import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { setTimeout as delay } from 'node:timers/promises'
const database=new URL(process.env.DATABASE_URL||'')
assert.ok(database.hostname==='127.0.0.1'&&database.pathname.endsWith('_pool_test'))
const {prisma,closePrismaDatabase}=await import('../src/db/prisma.js')
const {selectAndReserveHostWithLock}=await import('../src/db/hosts.js')
const {dedicatedHostReadyWhere}=await import('../src/lib/host-resource-usage.js')
const {SECURITY_HARDENING_REVISION}=await import('../src/lib/security-hardening.js')
const {hardeningIdentityHash}=await import('../src/lib/hardening-identity.js')
const tag='pool-stock-'+randomUUID(),holder=new Client({connectionString:database.href}),monitor=new Client({connectionString:database.href})
const owner=await prisma.user.create({data:{username:tag,passwordHash:'fixture'}})
const group=await prisma.hostMachineGroup.create({data:{name:tag}})
const region=await prisma.hostRegionGroup.create({data:{name:tag,machineGroupId:group.id,countryCode:'us'}})
const host=await prisma.host.create({data:{name:tag,userId:owner.id,url:'https://127.0.0.1:1',singleTenant:true,machineGroupId:group.id,regionGroupId:region.id,resourcePreset:'E2',customerDiskGiB:30,status:'online',isInstalled:true,architecture:'x86_64',cpuAllowanceMax:200,memoryMax:768,storageSize:38,natPublicIp:'192.0.2.1',natPortStart:20000,natPortEnd:30000}})
await prisma.storagePool.create({data:{hostId:host.id,name:'fixture',driver:'btrfs',purpose:'instance_data'}})
let failure:unknown,pending:Promise<unknown>|undefined
try {
 await holder.connect();await monitor.connect()
 const pid=Number((await holder.query('SELECT pg_backend_pid() pid')).rows[0].pid)
 const select=()=>prisma.$transaction(tx=>selectAndReserveHostWithLock(tx,{hostId:host.id,poolMachineGroupId:group.id,poolRegionGroupId:region.id,poolResourcePreset:'E2',poolDiskGiB:30,cpu:200,memory:768,disk:30720,networkMode:'nat'}))
 // Missing certificate references must fail closed before the allocator reaches the row lock.
 assert.equal(await select(),null,'a host without certificate references is not saleable')
 await prisma.host.update({where:{id:host.id},data:{certPath:'fixture.crt'}})
 assert.equal(await select(),null,'a host without the key reference is not saleable')
 await prisma.host.update({where:{id:host.id},data:{certPath:null,keyPath:'fixture.key'}})
 assert.equal(await select(),null,'a host without the certificate reference is not saleable')
 await prisma.host.update({where:{id:host.id},data:{certPath:'fixture.crt'}})
 assert.equal(await prisma.host.count({where:{id:host.id,...dedicatedHostReadyWhere()}}),1,'lock-race fixture must satisfy the current saleability prerequisites')
 assert.equal((await prisma.host.findUniqueOrThrow({where:{id:host.id}})).cpuUsed,0,'rejected allocations must not reserve stock')
 await holder.query('BEGIN');await holder.query('UPDATE hosts SET architecture=$1 WHERE id=$2',['aarch64',host.id])
 pending=select()
 const end=Date.now()+5000
 while(!(await monitor.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting',[pid])).rows[0].waiting){assert.ok(Date.now()<end,'must observe actual host row lock wait');await delay(10)}
 await holder.query('COMMIT')
 assert.equal(await pending,null,'a host whose architecture changed while locking cannot be sold as x86')
 assert.equal((await prisma.host.findUniqueOrThrow({where:{id:host.id}})).cpuUsed,0)
 await prisma.host.update({where:{id:host.id},data:{architecture:'x86_64'}})
 assert.equal((await select())?.id,host.id,'unchanged matching host remains selectable')
 await prisma.host.update({where:{id:host.id},data:{cpuUsed:0,memoryUsed:0,diskUsed:0}})
 await prisma.host.update({where:{id:host.id},data:{securityHardening:{revision:SECURITY_HARDENING_REVISION,status:'retry',phase:'host-inspection',nextCheckAt:new Date(Date.now()+60000).toISOString()}}})
 assert.equal(await select(),null,'a host in security inspection cannot reserve stock')
 const original=await prisma.host.findUniqueOrThrow({where:{id:host.id},include:{onboardingNode:{include:{batch:true}}}})
 const receipt={revision:SECURITY_HARDENING_REVISION,status:'verified',phase:'finished',identityHash:hardeningIdentityHash(original),nextCheckAt:new Date(Date.now()+60000).toISOString()}
 await prisma.host.update({where:{id:host.id},data:{securityHardening:receipt}})
 await prisma.host.update({where:{id:host.id},data:{managementSshHost:'192.0.2.44'}})
 assert.equal(await select(),null,'a successful receipt cannot release stock after management identity changes')
 await prisma.host.update({where:{id:host.id},data:{managementSshHost:original.managementSshHost}})
 assert.equal((await select())?.id,host.id,'a current successful receipt releases matching stock')
 await prisma.host.update({where:{id:host.id},data:{cpuUsed:0,memoryUsed:0,diskUsed:0,securityHardening:{...receipt,maintenance:{revision:'host-maintenance-v1',requestId:randomUUID(),phase:'waiting-boot'}}}})
 assert.equal(await select(),null,'unfinished maintenance cannot release stock')
 await prisma.host.update({where:{id:host.id},data:{securityHardening:{revision:SECURITY_HARDENING_REVISION,status:'verified',phase:'finished',nextCheckAt:new Date(0).toISOString()}}})
 assert.equal(await select(),null,'expired hardening cannot be sold as verified')
 console.log('PASS actual allocator host lock rechecks architecture and preserves valid stock')
}catch(error){failure=error}finally{
 await holder.query('ROLLBACK').catch(()=>{});await pending?.catch(()=>{});await holder.end();await monitor.end()
 await prisma.host.delete({where:{id:host.id}});await prisma.hostRegionGroup.delete({where:{id:region.id}});await prisma.hostMachineGroup.delete({where:{id:group.id}});await prisma.user.delete({where:{id:owner.id}});await closePrismaDatabase()
}
if(failure){console.error(failure);process.exitCode=1}
