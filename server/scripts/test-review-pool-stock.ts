import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { setTimeout as delay } from 'node:timers/promises'
const database=new URL(process.env.DATABASE_URL||'')
assert.ok(database.hostname==='127.0.0.1'&&database.pathname.endsWith('_pool_test'))
const {prisma,closePrismaDatabase}=await import('../src/db/prisma.js')
const {selectAndReserveHostWithLock}=await import('../src/db/hosts.js')
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
 await holder.query('BEGIN');await holder.query('UPDATE hosts SET architecture=$1 WHERE id=$2',['aarch64',host.id])
 pending=select()
 const end=Date.now()+5000
 while(!(await monitor.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting',[pid])).rows[0].waiting){assert.ok(Date.now()<end,'must observe actual host row lock wait');await delay(10)}
 await holder.query('COMMIT')
 assert.equal(await pending,null,'a host whose architecture changed while locking cannot be sold as x86')
 assert.equal((await prisma.host.findUniqueOrThrow({where:{id:host.id}})).cpuUsed,0)
 await prisma.host.update({where:{id:host.id},data:{architecture:'x86_64'}})
 assert.equal((await select())?.id,host.id,'unchanged matching host remains selectable')
 console.log('PASS actual allocator host lock rechecks architecture and preserves valid stock')
}catch(error){failure=error}finally{
 await holder.query('ROLLBACK').catch(()=>{});await pending?.catch(()=>{});await holder.end();await monitor.end()
 await prisma.host.delete({where:{id:host.id}});await prisma.hostRegionGroup.delete({where:{id:region.id}});await prisma.hostMachineGroup.delete({where:{id:group.id}});await prisma.user.delete({where:{id:owner.id}});await closePrismaDatabase()
}
if(failure){console.error(failure);process.exitCode=1}
