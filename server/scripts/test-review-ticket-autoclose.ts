import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
const database=new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1','localhost','[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'),
  'Use an isolated local *_pool_test PostgreSQL database')
process.env.NODE_ENV='test'
const {prisma,closePrismaDatabase}=await import('../src/db/prisma.js')
const {autoCloseTickets,getTicketsForAutoClose,deleteTicketMessage,addTicketMessage}=await import('../src/db/tickets.js')
const tag='autoclose-race-'+randomUUID()
const user=await prisma.user.create({data:{username:tag,passwordHash:'unusable-fixture'}})
const admin=await prisma.user.create({data:{username:tag+'-admin',passwordHash:'unusable-fixture',role:'admin'}})
const actor={id:admin.id,role:'admin' as const,sid:randomUUID(),iat:Math.floor(Date.now()/1000)}
const ticket=await prisma.ticket.create({data:{userId:user.id,subject:tag,status:'resolved'}})
const old=new Date(Date.now()-2*86400000)
let failure:unknown
const originalTransaction=prisma.$transaction
let release!:()=>void
try{
  const question=await prisma.ticketMessage.create({data:{ticketId:ticket.id,senderId:user.id,content:'customer question',isFromOwner:false,createdAt:new Date(old.getTime()-60000)}})
  const answer=await prisma.ticketMessage.create({data:{ticketId:ticket.id,senderId:admin.id,content:'support answer',isFromOwner:true,createdAt:old}})
  assert.ok((await getTicketsForAutoClose(86400000)).some(row=>row.id===ticket.id))
  let entered!:()=>void,read=false
  const ready=new Promise<void>(resolve=>{entered=resolve}),held=new Promise<void>(resolve=>{release=resolve})
  prisma.$transaction=(async(callback:any,options:any)=>originalTransaction.call(prisma,async tx=>{
    const originalFind=tx.ticket.findUnique.bind(tx.ticket) as (...args: any[]) => Promise<unknown>
    const proxy=new Proxy(tx,{get(target,key,receiver){
      if(key!=='ticket')return Reflect.get(target,key,receiver)
      return new Proxy(tx.ticket,{get(model,key,receiver){
        if(key!=='findUnique')return Reflect.get(model,key,receiver)
        return async(...args:any[])=>{const result=await originalFind(...args);if(!read){read=true;entered();await held}return result}
      }})
    }})
    return callback(proxy)
  },options)) as typeof prisma.$transaction
  const closing=autoCloseTickets([ticket.id],86400000)
  await Promise.race([ready,delay(4000).then(()=>{throw Error('auto close did not reach captured last public reply')})])
  prisma.$transaction=originalTransaction
  const deleting=deleteTicketMessage(answer.id,ticket.id,actor)
  const deleteWon=await Promise.race([deleting.then(()=>true),delay(500).then(()=>false)])
  release()
  const closed=await closing;await deleting
  const latest=await prisma.ticketMessage.findFirst({where:{ticketId:ticket.id},orderBy:{createdAt:'desc'}})
  assert.equal(latest?.id,question.id)
  console.log('Measured deletion committed before auto-close claim:',deleteWon,'auto-close returned:',closed.length)
  assert.ok(!deleteWon||closed.length===0,'deleting the last support reply before close must invalidate the old auto-close decision')
  console.log('PASS deletion and auto-close are serialized or stale claim is rejected')
  const reset=async()=>{
    await prisma.ticketMessage.deleteMany({where:{ticketId:ticket.id}})
    await prisma.ticket.update({where:{id:ticket.id},data:{status:'resolved',closedAt:null,updatedAt:old}})
    await prisma.ticketMessage.create({data:{ticketId:ticket.id,senderId:user.id,content:'question',isFromOwner:false,createdAt:new Date(old.getTime()-60000)}})
    return prisma.ticketMessage.create({data:{ticketId:ticket.id,senderId:admin.id,content:'answer',isFromOwner:true,createdAt:old}})
  }
  await reset()
  const concurrent=await Promise.all(Array.from({length:8},()=>autoCloseTickets([ticket.id,ticket.id],86400000)))
  assert.equal(concurrent.flat().length,1)
  assert.equal((await prisma.ticket.findUniqueOrThrow({where:{id:ticket.id}})).status,'closed')
  assert.deepEqual(await autoCloseTickets([ticket.id],86400000),[])
  console.log('PASS eight concurrent auto-close callers and duplicate IDs yield exactly one receipt')
  for(const scenario of ['delete-first','reply-first','fresh-reply','customer-last','no-messages']){
    const answer=await reset()
    if(scenario==='fresh-reply')await prisma.ticketMessage.update({where:{id:answer.id},data:{createdAt:new Date()}})
    if(scenario==='customer-last')await prisma.ticketMessage.update({where:{id:answer.id},data:{isFromOwner:false}})
    if(scenario==='no-messages')await prisma.ticketMessage.deleteMany({where:{ticketId:ticket.id}})
    if(scenario.endsWith('-first')){
      let entered!:()=>void,releaseMutation!:()=>void,pid=0,heldOnce=false
      const ready=new Promise<void>(resolve=>{entered=resolve}),held=new Promise<void>(resolve=>{releaseMutation=resolve})
      prisma.$transaction=(async(callback:any,options:any)=>originalTransaction.call(prisma,async tx=>{
        const result=await callback(tx)
        if(!heldOnce){heldOnce=true;const [row]=await tx.$queryRaw<Array<{pid:number}>>`SELECT pg_backend_pid() AS pid`;pid=row!.pid;entered();await held}
        return result
      },options)) as typeof prisma.$transaction
      const mutation=scenario==='delete-first'?deleteTicketMessage(answer.id,ticket.id,actor):
        addTicketMessage(ticket.id,user.id,'new customer reply',false,[],{id:user.id,role:'user',sid:randomUUID(),iat:actor.iat})
      await ready;prisma.$transaction=originalTransaction
      const closing=autoCloseTickets([ticket.id],86400000)
      let blocked=false
      try{
        const until=Date.now()+2000
        while(Date.now()<until){const [row]=await prisma.$queryRaw<Array<{count:bigint}>>`SELECT count(*) FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`;if(Number(row!.count)){blocked=true;break}await delay(10)}
        assert.equal(blocked,true,scenario+' must wait on the original mutation transaction')
      }finally{releaseMutation();await mutation}
      assert.deepEqual(await closing,[])
    }else assert.deepEqual(await autoCloseTickets([ticket.id],86400000),[])
    assert.notEqual((await prisma.ticket.findUniqueOrThrow({where:{id:ticket.id}})).status,'closed')
    console.log('PASS auto-close rechecks current public reply:',scenario)
  }
  await reset()
  const before=await prisma.ticket.findUniqueOrThrow({where:{id:ticket.id}})
  prisma.$transaction=(async(callback:any,options:any)=>originalTransaction.call(prisma,async tx=>{
    const result=await callback(tx);void result;throw Error('controlled auto-close transaction failure')
  },options)) as typeof prisma.$transaction
  assert.deepEqual(await autoCloseTickets([ticket.id],86400000),[])
  prisma.$transaction=originalTransaction
  assert.deepEqual(await prisma.ticket.findUniqueOrThrow({where:{id:ticket.id}}),before)
  console.log('PASS failed auto-close transaction rolls back and returns no success receipt')

  const batch = await Promise.all(Array.from({length:3},(_,index)=>prisma.ticket.create({data:{
    userId:user.id,subject:tag+'-batch-'+index,status:'resolved',updatedAt:old,
    messages:{create:{senderId:admin.id,content:'old support reply',isFromOwner:true,createdAt:old}}
  }})))
  try {
    let call=0
    prisma.$transaction=(async(callback:any,options:any)=>originalTransaction.call(prisma,async tx=>{
      const current=++call,result=await callback(tx)
      if(current===2)throw Error('controlled middle ticket failure')
      return result
    },options)) as typeof prisma.$transaction
    const receipts=await autoCloseTickets(batch.map(item=>item.id),86400000).catch(()=>null)
    assert.deepEqual(receipts?.map(item=>item.id),[batch[0].id,batch[2].id],
      'a failed middle ticket must retain prior committed receipts and continue later tickets')
    assert.equal((await prisma.ticket.findUniqueOrThrow({where:{id:batch[1].id}})).status,'resolved')
    console.log('PASS a failed middle ticket retains prior committed close receipts and later work')
    prisma.$transaction=originalTransaction
    await prisma.ticket.updateMany({where:{id:{in:batch.map(item=>item.id)}},data:{status:'resolved',closedAt:null}})
    let locked!:()=>void,unlock!:()=>void
    const lockReady=new Promise<void>(resolve=>{locked=resolve}),lockHeld=new Promise<void>(resolve=>{unlock=resolve})
    const blocker=prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM tickets WHERE id = ${batch[1].id} FOR UPDATE`
      locked();await lockHeld
    },{timeout:10000})
    await lockReady
    try {
      const receipts=await autoCloseTickets(batch.map(item=>item.id),86400000)
      assert.deepEqual(receipts.map(item=>item.id),[batch[0].id,batch[2].id])
      assert.equal((await prisma.ticket.findUniqueOrThrow({where:{id:batch[1].id}})).status,'resolved')
      console.log('PASS real PostgreSQL lock timeout skips only the held ticket and preserves other committed receipts')
    }finally{unlock();await blocker}
    assert.deepEqual((await autoCloseTickets(batch.map(item=>item.id),86400000)).map(item=>item.id),[batch[1].id])
  }finally{prisma.$transaction=originalTransaction;await prisma.ticket.deleteMany({where:{id:{in:batch.map(item=>item.id)}}})}

  // Run the original scheduler and notifier against actual inbox/audit tables.
  // Only this process's configuration cache and candidate query are scoped.
  const {setCachedConfig,invalidateCachedConfig}=await import('../src/lib/config-cache.js')
  const {startTicketAutoCloseScheduler,stopTicketAutoCloseScheduler}=await import('../src/services/ticket-auto-close-scheduler.js')
  // Concurrent INSERTs can obtain sequence IDs in a different order from their
  // Promise.all positions. Match the scheduler fixture's actual ID ordering.
  const scheduled=(await Promise.all(Array.from({length:3},(_,index)=>prisma.ticket.create({data:{
    userId:user.id,subject:tag+'-scheduled-'+index,status:'resolved',updatedAt:old,
    messages:{create:{senderId:admin.id,content:'old support reply',isFromOwner:true,createdAt:old}}
  }})))).sort((a,b)=>a.id-b.id)
  const originalFindMany=prisma.ticket.findMany,originalInterval=globalThis.setInterval,originalConsole=console.log
  let runCycle!:()=>Promise<void>,finish!:()=>void
  const finished=new Promise<void>(resolve=>{finish=resolve})
  const sent=()=>prisma.inboxMessage.findMany({where:{userId:user.id,eventType:'ticket_auto_closed'},orderBy:{id:'asc'}})
  const logged=()=>prisma.log.findMany({where:{userId:user.id,action:'ticket.auto_closed'},orderBy:{id:'asc'}})
  try {
    setCachedConfig('ticket_auto_close_enabled','true');setCachedConfig('ticket_auto_close_hours','24')
    prisma.ticket.findMany=(async(args:any)=>originalFindMany.call(prisma.ticket,{
      ...args,where:{AND:[args?.where||{},{id:{in:scheduled.map(item=>item.id)}}]},orderBy:{id:'asc'}
    })) as unknown as typeof originalFindMany
    globalThis.setInterval=((callback:()=>Promise<void>,ms:number)=>{
      runCycle=callback;return originalInterval(callback,ms)
    }) as typeof globalThis.setInterval
    console.log=(...args:unknown[])=>{
      originalConsole(...args)
      if(String(args[0]).startsWith('[TicketAutoClose] 成功自动关闭'))finish()
    }
    let transactionCount=0
    prisma.$transaction=(async(callback:any,options:any)=>originalTransaction.call(prisma,async tx=>{
      const current=++transactionCount,result=await callback(tx)
      if(current===2)throw Error('controlled scheduler middle ticket failure')
      return result
    },options)) as typeof prisma.$transaction
    startTicketAutoCloseScheduler()
    await Promise.race([finished,delay(8000).then(()=>{throw Error('scheduler did not finish partial batch')})])
    stopTicketAutoCloseScheduler();globalThis.setInterval=originalInterval;console.log=originalConsole
    prisma.$transaction=originalTransaction
    const messages=await sent(),logs=await logged()
    assert.equal(messages.length,2);assert.equal(logs.length,2)
    assert.deepEqual(messages.map(item=>(item.data as {subject:string}).subject),[scheduled[0].subject,scheduled[2].subject])
    assert.ok(logs.every(item=>item.result==='success'))
    assert.equal((await prisma.ticket.findUniqueOrThrow({where:{id:scheduled[1].id}})).status,'resolved')
    await runCycle()
    assert.equal((await sent()).length,3);assert.equal((await logged()).length,3)
    assert.equal((await sent())[2].data && ((await sent())[2].data as {subject:string}).subject,scheduled[1].subject)
    await runCycle()
    assert.equal((await sent()).length,3);assert.equal((await logged()).length,3)
    console.log('PASS original scheduler persists only committed inbox/audit results, retries failed ticket and never duplicates prior notifications')
    await prisma.ticket.updateMany({where:{id:{in:scheduled.map(item=>item.id)}},data:{status:'resolved',closedAt:null}})
    prisma.$transaction=(async(callback:any,options:any)=>originalTransaction.call(prisma,async tx=>{
      await callback(tx);throw Error('controlled scheduler all-ticket failure')
    },options)) as typeof prisma.$transaction
    await runCycle();prisma.$transaction=originalTransaction
    assert.equal((await sent()).length,3);assert.equal((await logged()).length,3)
    assert.equal(await prisma.ticket.count({where:{id:{in:scheduled.map(item=>item.id)},status:'resolved'}}),3)
    console.log('PASS all-failed scheduler cycle retains every ticket and writes no success inbox/audit')
  }finally{
    stopTicketAutoCloseScheduler();globalThis.setInterval=originalInterval;console.log=originalConsole
    prisma.$transaction=originalTransaction;prisma.ticket.findMany=originalFindMany
    invalidateCachedConfig('ticket_auto_close_enabled');invalidateCachedConfig('ticket_auto_close_hours')
    await prisma.ticket.deleteMany({where:{id:{in:scheduled.map(item=>item.id)}}})
  }
}catch(error){failure=error}
finally{
  release?.();prisma.$transaction=originalTransaction
  await prisma.ticket.delete({where:{id:ticket.id}})
  await prisma.log.deleteMany({where:{userId:{in:[user.id,admin.id]}}})
  await prisma.user.deleteMany({where:{id:{in:[user.id,admin.id]}}})
  await closePrismaDatabase()
}
if(failure){console.error(failure);process.exit(1)}process.exit(0)
