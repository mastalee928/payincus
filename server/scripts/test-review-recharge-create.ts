import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Client } from 'pg'
import { setTimeout as delay } from 'node:timers/promises'
import Fastify from 'fastify'
const database=new URL(process.env.DATABASE_URL||'')
assert.ok(database.hostname==='127.0.0.1'&&database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV='test'
process.env.ENCRYPTION_KEY=randomUUID()
const interval=globalThis.setInterval
globalThis.setInterval=((...args:Parameters<typeof setInterval>)=>{const timer=interval(...args);timer.unref();return timer}) as typeof setInterval
try {await import('../src/lib/security.js')}finally{globalThis.setInterval=interval}
const {prisma,closePrismaDatabase}=await import('../src/db/prisma.js')
const {createPaymentProvider}=await import('../src/db/payment-providers.js')
const {default:routes}=await import('../src/routes/recharge.js')
const tag='create-recharge-'+randomUUID()
const user=await prisma.user.create({data:{username:tag,passwordHash:'fixture'}})
const provider=await createPaymentProvider({name:tag,type:'manual',status:'active',config:{instructions:'Isolated test instructions'}})
const other=await prisma.user.create({data:{username:tag+'-other',passwordHash:'fixture'}})
const gateway=await createPaymentProvider({name:tag+'-gateway',type:'heleket',status:'active',config:{apiurl:'https://8.8.8.8',merchant_uuid:randomUUID(),api_key:randomUUID(),currency:'CNY'}})
const originalFetch=globalThis.fetch
const calls:Array<{id:string;resolve:()=>void;reject:()=>void}>=[]
globalThis.fetch=(async(input,init)=>{
 const url=new URL(String(input));assert.equal(url.hostname,'8.8.8.8');assert.equal(url.pathname,'/v1/payment')
 const body=JSON.parse(String(init?.body)),id=body.order_id
 return new Promise<Response>((resolve,reject)=>calls.push({id,resolve:()=>resolve(new Response(JSON.stringify({state:0,result:{order_id:id,url:'https://8.8.8.8/pay/'+id}}),{headers:{'content-type':'application/json'}})),reject:()=>reject(Error('fixture lost response'))}))
}) as typeof fetch
let actor=user
const app=Fastify(),session={sid:randomUUID(),iat:Math.floor(Date.now()/1000)}
app.decorate('authenticate',async(request:any)=>{request.user={id:actor.id,username:actor.username,role:'user',...session}})
app.decorate('requireAdmin',async(_request:any,reply:any)=>reply.code(403).send())
const holder=new Client({connectionString:database.href}),monitor=new Client({connectionString:database.href})
let failure:unknown,pending:Promise<any>|undefined
try {
 await app.register(routes);await holder.connect();await monitor.connect()
 await holder.query('BEGIN')
 await holder.query('CREATE TEMP TABLE recharge_records(user_id INTEGER NOT NULL) ON COMMIT DROP')
 await holder.query(readFileSync(new URL('../prisma/migrations/20261031130000_recharge_creation_identity/migration.sql',import.meta.url),'utf8'))
 await holder.query("INSERT INTO recharge_records(user_id,creation_request_id) VALUES(1,NULL),(1,NULL),(1,'same'),(2,'same')")
 await holder.query('SAVEPOINT duplicate_check')
 await assert.rejects(holder.query("INSERT INTO recharge_records(user_id,creation_request_id) VALUES(1,'same')"),(error:any)=>error.code==='23505')
 await holder.query('ROLLBACK')
 console.log('PASS migration on isolated temporary table: legacy nulls, account scope and duplicate rejection')
 const input={providerId:provider.id,amount:12,creditTarget:12,requestId:randomUUID()}
 const send=()=>app.inject({method:'POST',url:'/api/recharge/orders',payload:input})
 const first=await send(),second=await send()
 assert.equal(first.statusCode,200,first.body);assert.equal(second.statusCode,200,second.body)
 assert.equal(second.json().order.orderNo,first.json().order.orderNo,'a retry with the same creation intent must not open another payment order')
 assert.equal(await prisma.rechargeRecord.count({where:{userId:user.id}}),1)
 const concurrent={...input,requestId:randomUUID()}
 const responses=await Promise.all(Array.from({length:6},()=>app.inject({method:'POST',url:'/api/recharge/orders',payload:concurrent})))
 assert.ok(responses.every(r=>r.statusCode===200));assert.equal(new Set(responses.map(r=>r.json().order.orderNo)).size,1)
 assert.equal(await prisma.rechargeRecord.count({where:{userId:user.id}}),2)
 const changed=await app.inject({method:'POST',url:'/api/recharge/orders',payload:{...input,amount:13}})
 assert.equal(changed.statusCode,409)
 const found=await app.inject({method:'GET',url:'/api/recharge/requests/'+input.requestId});assert.equal(found.json().order.orderNo,first.json().order.orderNo)
 actor=other;assert.equal((await app.inject({method:'GET',url:'/api/recharge/requests/'+input.requestId})).json().order,null,'request recovery cannot read another account order');const otherResponse=await send();assert.equal(otherResponse.statusCode,200);assert.notEqual(otherResponse.json().order.orderNo,first.json().order.orderNo);actor=user
 await prisma.rechargeRecord.update({where:{orderNo:first.json().order.orderNo},data:{status:'cancelled'}})
 assert.equal((await send()).json().order.status,'cancelled','terminal intent never opens a new order')
 await prisma.paymentProvider.update({where:{id:provider.id},data:{status:'disabled'}})
 assert.equal((await send()).json().order.orderNo,first.json().order.orderNo,'provider changes do not erase the original intent')
 await prisma.paymentProvider.update({where:{id:provider.id},data:{status:'active'}})
 for(const requestId of [null,'bad',12,{},''])assert.equal((await app.inject({method:'POST',url:'/api/recharge/orders',payload:{...input,requestId}})).statusCode,400)
 const waitCalls=async(count:number)=>{const end=Date.now()+5000;while(calls.length<count){assert.ok(Date.now()<end,'gateway call not reached');await delay(10)}}
 const external={...input,providerId:gateway.id,requestId:randomUUID()}
 const firstExternal=app.inject({method:'POST',url:'/api/recharge/orders',payload:external})
 await waitCalls(1)
 const recovery=await app.inject({method:'POST',url:'/api/recharge/orders',payload:external})
 assert.equal(recovery.statusCode,200);assert.equal(recovery.json().order.orderNo,calls[0].id);assert.equal(calls.length,1,'in-flight replay never calls the gateway again')
 calls[0].reject();assert.equal((await firstExternal).statusCode,500)
 const retryExternal=await app.inject({method:'POST',url:'/api/recharge/orders',payload:external})
 assert.equal(retryExternal.json().order.orderNo,calls[0].id);assert.equal(calls.length,1,'lost gateway response still leaves the original receipt')
 const repay=()=>app.inject({method:'POST',url:'/api/recharge/orders/'+calls[0].id+'/repay',payload:{}})
 const oldRepay=repay();await waitCalls(2);const newerRepay=repay();await waitCalls(3)
 calls[2].resolve();assert.equal((await newerRepay).statusCode,200);calls[1].resolve();assert.equal((await oldRepay).statusCode,409,'late payment-link response cannot overwrite the accepted attempt')
 const details=(await prisma.rechargeRecord.findUniqueOrThrow({where:{orderNo:calls[0].id}})).paymentDetails as any
 assert.equal(details.paymentAttempt.current.gatewayOrderNo,calls[2].id)
 const changing={...external,requestId:randomUUID()}
 const delayedCreate=app.inject({method:'POST',url:'/api/recharge/orders',payload:changing});await waitCalls(4)
 const whileCreating=app.inject({method:'POST',url:'/api/recharge/orders/'+calls[3].id+'/repay',payload:{}});await waitCalls(5)
 calls[4].resolve();assert.equal((await whileCreating).statusCode,200);calls[3].resolve();assert.equal((await delayedCreate).statusCode,409,'late original link cannot be returned after a new attempt supersedes it')
 console.log('PASS controlled gateway: in-flight and failed creation replay, concurrent repayment CAS and superseded initial link')
 await prisma.rechargeRecord.update({where:{orderNo:calls[0].id},data:{paymentDetails:(await import('@prisma/client')).Prisma.DbNull}})
 const legacyRepay=repay();await waitCalls(6);calls[5].resolve();assert.equal((await legacyRepay).statusCode,200,'legacy null details still accept an unchanged payment attempt')
 const before=await prisma.rechargeRecord.count({where:{userId:user.id}})
 await holder.query('BEGIN');await holder.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[user.id])
 const pid=Number((await holder.query('SELECT pg_backend_pid() pid')).rows[0].pid)
 pending=app.inject({method:'POST',url:'/api/recharge/orders',payload:{...input,requestId:randomUUID()}})
 const end=Date.now()+5000
 while(!(await monitor.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) waiting',[pid])).rows[0].waiting){assert.ok(Date.now()<end);await delay(10)}
 await holder.query("UPDATE users SET status='banned' WHERE id=$1",[user.id]);await holder.query('COMMIT')
 assert.equal((await pending).statusCode,403);assert.equal(await prisma.rechargeRecord.count({where:{userId:user.id}}),before)
 assert.equal((await send()).statusCode,403,'replays still check current authorization')
 assert.equal(await prisma.balanceLog.count({where:{userId:{in:[user.id,other.id]}}}),0)
 console.log('PASS persistent recharge creation: concurrent replay, account/input/terminal/provider isolation and real lock-wait authorization')
}catch(error){failure=error}finally{
 for(const call of calls)call.reject()
 globalThis.fetch=originalFetch
 await holder.query('ROLLBACK').catch(()=>{});await pending?.catch(()=>{});await holder.end();await monitor.end();await app.close();await prisma.rechargeRecord.deleteMany({where:{userId:{in:[user.id,other.id]}}});await prisma.user.deleteMany({where:{id:{in:[user.id,other.id]}}});await prisma.paymentProvider.deleteMany({where:{id:{in:[provider.id,gateway.id]}}});await closePrismaDatabase()
}
if(failure){console.error(failure);process.exitCode=1}
