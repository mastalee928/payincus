import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {prisma} from '../../src/db/prisma.js'
import {pendingDeliveryIdentity,pendingDeliveryLocation,reconcileRestoredDeliveries} from '../../src/services/platform-recovery-delivery.js'

export async function verifySnapshotDelivery(batchId:string,userId:number) {
  const host=await prisma.host.create({data:{name:'snapshot-inflight',userId,url:'https://192.0.2.20:8443',singleTenant:true,poolFaulted:false,cpuAllowanceMax:100,memoryMax:256,customerDiskGiB:1,cpuUsed:100,memoryUsed:256,diskUsed:1024}})
  const purchaseBatchId=randomUUID(),attempt=randomUUID(),uuid=randomUUID(),endpointHash='a'.repeat(64)
  await prisma.poolOrder.create({data:{id:purchaseBatchId,userId,requestHash:'test',totalCents:1000}})
  const row=await prisma.instance.create({data:{name:'pending-original',incusId:'pending-original',userId,hostId:host.id,status:'creating',image:'images:alpine/3.21',
    cpu:100,memory:256,disk:1024,ipv4:'10.10.0.8',dedicatedIpv4:true,dedicatedNetworkReady:false,storagePoolName:'customer',purchaseBatchId,
    billingPrice:10,monthlyTrafficUsed:9007199254740993n,expiresAt:new Date('2030-01-01'),snapshottedSpecs:{poolProvision:{version:1,phase:'creating'},managedCleanup:{attempt,endpointHash}}}})
  await prisma.host.update({where:{id:host.id},data:{poolFaulted:true}})
  const live={name:row.incusId,status:'Running',type:'container',created_at:'2026-11-01T01:00:00Z',config:{'volatile.uuid':uuid,
    'user.payincus.provisioning-attempt':attempt,'user.payincus.user-id':String(userId),'limits.cpu':'1','limits.cpu.allowance':'100%','limits.memory':'256MB'},
    expanded_devices:{root:{type:'disk',path:'/',pool:'customer',size:'1024MB'}}}
  const identity=pendingDeliveryIdentity(row,endpointHash,live)
  const locatedLive={...live,expanded_devices:{...live.expanded_devices,eth0:{type:'nic',network:'incusbr0','ipv4.address':row.ipv4!}}}
  assert.deepEqual(pendingDeliveryLocation(row,locatedLive),{ipv4:row.ipv4,storagePoolName:row.storagePoolName})
  for(const drift of [
    {...locatedLive,expanded_devices:{...locatedLive.expanded_devices,eth0:{...locatedLive.expanded_devices.eth0,'ipv4.address':'10.10.0.9'}}},
    {...locatedLive,expanded_devices:{...locatedLive.expanded_devices,root:{...locatedLive.expanded_devices.root,pool:'different'}}},
    live])assert.throws(()=>pendingDeliveryLocation(row,drift),/OSS_REVIEW_RESOURCE_MISMATCH/,
      'persisted DB location never bypasses the original guest device check')
  for(const phase of ['prepared','creating']) {
    const unlocated={...row,ipv4:null,storagePoolName:null,snapshottedSpecs:{poolProvision:{version:1,phase},managedCleanup:{attempt,endpointHash}}}
    const location=pendingDeliveryLocation(unlocated,locatedLive)
    assert.deepEqual(location,{ipv4:row.ipv4,storagePoolName:row.storagePoolName})
    assert.equal(pendingDeliveryIdentity({...unlocated,...location},endpointHash,locatedLive).uuid,uuid)
    for(const address of ['10.10.0.0','10.10.0.1','10.10.3.255','10.10.4.2','192.0.2.1'])
      assert.throws(()=>pendingDeliveryLocation(unlocated,{...locatedLive,expanded_devices:{...locatedLive.expanded_devices,eth0:{...locatedLive.expanded_devices.eth0,'ipv4.address':address}}}))
    assert.throws(()=>pendingDeliveryLocation(unlocated,{...locatedLive,config:{...live.config,'user.payincus.provisioning-attempt':randomUUID()}}))
    assert.throws(()=>pendingDeliveryLocation({...unlocated,storagePoolName:'different'},locatedLive))
  }
  assert.equal(pendingDeliveryIdentity(row,endpointHash,{...live,status:'Stopped'}).uuid,uuid,
    'the original stopped guest keeps its identity without a forced start')
  assert.equal(identity.uuid,uuid,'persisted creation attempt recognizes the original guest before UUID receipt')
  for(const mutation of [
    {...live,config:{...live.config,'user.payincus.provisioning-attempt':randomUUID()}},
    {...live,config:{...live.config,'user.payincus.user-id':String(userId+1)}},
    {...live,config:{...live.config,'limits.memory':'512MB'}},
    {...live,expanded_devices:{root:{...live.expanded_devices.root,pool:'different'}}},
    {...live,status:'Error'}])assert.throws(()=>pendingDeliveryIdentity(row,endpointHash,mutation))
  assert.throws(()=>pendingDeliveryIdentity(row,'b'.repeat(64),live))
  assert.throws(()=>pendingDeliveryIdentity({...row,provisioningCleanupPending:true},endpointHash,live))
  assert.throws(()=>pendingDeliveryIdentity({...row,snapshottedSpecs:{poolProvision:{version:1,phase:'creating'},managedCleanup:{attempt,endpointHash,uuid:randomUUID()}}},endpointHash,live))
  assert.throws(()=>pendingDeliveryIdentity({...row,snapshottedSpecs:{poolProvision:{version:1,phase:'prepared'}}},endpointHash,live))
  const money=await prisma.user.findUniqueOrThrow({where:{id:userId}}),bills=await prisma.instanceBillingRecord.count(),logs=await prisma.balanceLog.count()
  let now=Date.now()
  const runtime={now:()=>now,budgetMs:120000}
  let inspections=0
  const inspect=async()=>{inspections++;return {status:'running' as const,identity,network:{version:1 as const,hostId:host.id,instanceName:row.incusId,mappings:[],primary:null,status:'none' as const,checkedAt:new Date().toISOString(),error:null}}}
  await assert.rejects(reconcileRestoredDeliveries(batchId,async(_row,step)=>{step('management');throw Object.assign(Error('not public'),{code:'ECONNREFUSED'})},runtime),/DELIVERY_CHECK_PENDING/)
  assert.equal((await prisma.instance.findUniqueOrThrow({where:{id:row.id}})).status,'creating')
  const first=await prisma.platformRecoveryEvidence.findUniqueOrThrow({where:{batchId_category_reference:{batchId,category:'snapshot-delivery-check',reference:`instance-${row.id}`}}})
  assert.equal((first.payload as any).code,'OSS_REVIEW_HOST_UNREACHABLE')
  assert.equal((first.payload as any).hostId,host.id)
  await assert.rejects(reconcileRestoredDeliveries(batchId,inspect,runtime),/DELIVERY_CHECK_PENDING/)
  assert.equal(inspections,0,'backoff persists across invocations')
  now+=30001
  await reconcileRestoredDeliveries(batchId,inspect,runtime);await reconcileRestoredDeliveries(batchId,inspect,runtime)
  const restored=await prisma.instance.findUniqueOrThrow({where:{id:row.id}})
  assert.equal(inspections,1);assert.equal(restored.status,'running');assert.equal(restored.dedicatedNetworkReady,true)
  assert.equal(restored.expiresAt?.toISOString(),row.expiresAt?.toISOString());assert.equal(restored.billingPrice?.toString(),row.billingPrice?.toString())
  assert.equal(restored.userId,row.userId);assert.equal(restored.incusId,row.incusId)
  assert.equal(restored.monthlyTrafficUsed,9007199254740993n,'large traffic counters retain their exact integer value')
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:userId}})).balance.toString(),money.balance.toString())
  // A prepared snapshot can recognize the same later guest and persist its
  // location; the lease table has no instance owner and must not be invented.
  await prisma.platformRecoveryEvidence.deleteMany({where:{batchId,category:{in:['snapshot-delivery','snapshot-delivery-check']},reference:`instance-${row.id}`}})
  await prisma.instance.update({where:{id:row.id},data:{status:'creating',ipv4:null,storagePoolName:null,snapshottedSpecs:{poolProvision:{version:1,phase:'prepared'},managedCleanup:{attempt,endpointHash}}}})
  await reconcileRestoredDeliveries(batchId,async()=>({...await inspect(),location:{ipv4:row.ipv4!,storagePoolName:row.storagePoolName!}}),runtime)
  const recognized=await prisma.instance.findUniqueOrThrow({where:{id:row.id}})
  assert.equal(recognized.ipv4,row.ipv4);assert.equal(recognized.storagePoolName,row.storagePoolName)
  assert.equal(recognized.userId,row.userId);assert.equal(recognized.expiresAt?.toISOString(),row.expiresAt?.toISOString())
  assert.equal(recognized.billingPrice?.toString(),row.billingPrice?.toString())
  assert.equal(await prisma.instanceBillingRecord.count(),bills);assert.equal(await prisma.balanceLog.count(),logs)
  assert.equal((await prisma.host.findUniqueOrThrow({where:{id:host.id}})).poolFaulted,true)
  assert.equal(await prisma.platformRecoveryEvidence.count({where:{batchId,category:'snapshot-delivery',reference:`instance-${row.id}`}}),1)
  await prisma.instance.update({where:{id:row.id},data:{status:'creating',dedicatedNetworkReady:false,snapshottedSpecs:row.snapshottedSpecs!}})
  await prisma.platformRecoveryEvidence.deleteMany({where:{batchId,category:'snapshot-delivery',reference:`instance-${row.id}`}})
  await reconcileRestoredDeliveries(batchId,async()=>({...await inspect(),status:'stopped' as const}),runtime)
  const stopped=await prisma.instance.findUniqueOrThrow({where:{id:row.id}})
  assert.equal(stopped.status,'stopped');assert.equal(stopped.incusId,row.incusId)
  assert.equal(stopped.expiresAt?.toISOString(),row.expiresAt?.toISOString())
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:userId}})).balance.toString(),money.balance.toString())
  // Distinct single-tenant hosts: an early outage must not starve later guests.
  const rows=[]
  for(let index=0;index<7;index++) {
    const nextHost=await prisma.host.create({data:{name:`inflight-${index}`,userId,url:`https://192.0.2.${30+index}:8443`,singleTenant:true,poolFaulted:false,
      cpuAllowanceMax:100,memoryMax:256,customerDiskGiB:1,cpuUsed:100,memoryUsed:256,diskUsed:1024}})
    const {id:_id,createdAt:_created,updatedAt:_updated,...data}=row
    rows.push(await prisma.instance.create({data:{...data,hostId:nextHost.id,incusId:`inflight-${index}`,name:`inflight-${index}`,snapshottedSpecs:row.snapshottedSpecs!}}))
    await prisma.host.update({where:{id:nextHost.id},data:{poolFaulted:true}})
  }
  let active=0,maxActive=0,offline=true
  const calls:number[]=[]
  const wave=()=>{
    let entered=0,release!:()=>void
    const wait=new Promise<void>(resolve=>{release=resolve})
    return async()=>{entered++;if(entered===4)release();if(entered<=4)await wait}
  }
  let barrier=wave()
  type PendingRow=Parameters<NonNullable<Parameters<typeof reconcileRestoredDeliveries>[1]>>[0]
  const manyInspect=async(item:PendingRow,step:(value:'management'|'inventory')=>void)=>{
    active++;maxActive=Math.max(active,maxActive);calls.push(item.id)
    try {
      step('inventory');await barrier()
      if(item.id===rows[0].id && offline)throw Object.assign(Error('not public'),{code:'ECONNREFUSED'})
      const result=await inspect()
      return {...result,network:{...result.network,hostId:item.hostId,instanceName:item.incusId}}
    } finally {active--}
  }
  await assert.rejects(reconcileRestoredDeliveries(batchId,manyInspect,runtime),/DELIVERY_CHECK_PENDING/)
  assert.equal(maxActive,4);assert.equal(active,0)
  assert.equal(calls.length,7)
  assert.equal(await prisma.instance.count({where:{id:{in:rows.slice(1).map(item=>item.id)},status:'running'}}),6)
  await assert.rejects(reconcileRestoredDeliveries(batchId,manyInspect,runtime),/DELIVERY_CHECK_PENDING/)
  assert.equal(calls.length,7)
  offline=false;now+=30001
  await reconcileRestoredDeliveries(batchId,manyInspect,runtime)
  assert.deepEqual(calls.slice(7),[rows[0].id],'only the failed guest resumes')
  // Reset the fixture with original source rows to exercise the time budget.
  await prisma.platformRecoveryEvidence.deleteMany({where:{batchId,reference:{in:rows.map(item=>`instance-${item.id}`)},category:{in:['snapshot-delivery','snapshot-delivery-check']}}})
  await prisma.instance.updateMany({where:{id:{in:rows.map(item=>item.id)}},data:{status:'creating',snapshottedSpecs:row.snapshottedSpecs!}})
  calls.length=0
  barrier=wave()
  const budgetInspect=async(item:PendingRow,step:(value:'management'|'inventory')=>void)=>{
    const result=await manyInspect(item,step);now+=120000;return result
  }
  await assert.rejects(reconcileRestoredDeliveries(batchId,budgetInspect,runtime),/DELIVERY_CHECK_PENDING/)
  assert.equal(active,0,'budget expiry waits for every active lane')
  assert.equal(calls.length,4)
  await reconcileRestoredDeliveries(batchId,manyInspect,runtime)
  assert.equal(calls.length,7);assert.equal(new Set(calls).size,7,'next pass resumes remaining rows without duplicate inspection')
  const retained=(await prisma.platformRecoveryEvidence.findMany({where:{batchId,category:'snapshot-delivery-attempt'}})).filter(item=>(item.payload as any).instanceId===rows[0].id)
  assert.equal(retained.length,3,'failure, resumed success and separate source check retain history')
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:userId}})).balance.toString(),money.balance.toString())
  assert.equal(await prisma.instanceBillingRecord.count(),bills);assert.equal(await prisma.balanceLog.count(),logs)
  await prisma.instance.deleteMany({where:{id:{in:rows.map(item=>item.id)}}})
  await prisma.host.deleteMany({where:{id:{in:rows.map(item=>item.hostId)}}})
  await prisma.instance.delete({where:{id:row.id}});await prisma.poolOrder.delete({where:{id:purchaseBatchId}});await prisma.host.delete({where:{id:host.id}})
  console.log('PASS snapshot delivery: original attempt/UUID, owner, resources, disk, offline retention, one-time finalize and unchanged money/expiry/stock; remote inspection supplied by fixture')
}
