import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { setTimeout as delay } from 'node:timers/promises'
import type { Prisma } from '@prisma/client'
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && /^\/[a-zA-Z0-9_]+_pool_test$/.test(database.pathname) && !database.search && !database.hash)
process.env.JWT_SECRET ||= 'points-write-fixture-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/admin-entertainment.js')
const prefix = `points-write-${randomUUID().slice(0,8)}`
const owner = await prisma.user.create({ data: { username: prefix, passwordHash: 'unusable-fixture', balance: 10 } })
const admin = await prisma.user.create({ data: { username: prefix + '-admin', passwordHash: 'unusable-fixture', role: 'admin' } })
let actor = { id: admin.id, username: admin.username, role: 'admin', sid: prefix, iat: Math.floor(Date.now()/1000) }
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = { ...actor } })
app.decorate('requireAdmin', async () => {})
const reset = async () => {
  actor = { id: admin.id, username: admin.username, role: 'admin', sid: prefix, iat: Math.floor(Date.now()/1000) }
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin', status: 'active' } })
  await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } })
  await prisma.userPoints.upsert({ where: { userId: owner.id }, create: { userId: owner.id, points: 10, totalEarned: 10, totalSpent: 0 }, update: { points: 10, totalEarned: 10, totalSpent: 0 } })
  await prisma.pointsLog.deleteMany({ where: { userId: owner.id } })
  await prisma.log.deleteMany({ where: { userId: admin.id } })
}
const snapshot = async () => ({ points: await prisma.userPoints.findUnique({ where: { userId: owner.id }, select: { points: true, totalEarned: true, totalSpent: true } }), ledger: await prisma.pointsLog.count({ where: { userId: owner.id } }), audit: await prisma.log.count({ where: { userId: admin.id } }) })
const submit = (amount: number) => app.inject({ method: 'POST', url: `/admin/entertainment/user-points/${owner.id}/adjust`, payload: { amount, remark: 'fixture points' } })
let failure: unknown
try {
  await app.register(routes, { prefix: '/admin/entertainment' }); await app.ready()
  const trigger = 'points_write_' + randomUUID().replaceAll('-', '')
  try {
    await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = ${admin.id} AND NEW.action = 'lottery.points.adjust' THEN RAISE EXCEPTION 'fixture points audit unavailable'; END IF; RETURN NEW; END $$`)
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
    for (const amount of [10,-10]) {
      await reset(); const before = await snapshot(), response = await submit(amount); assert.equal(response.statusCode,500); assert.deepEqual(await snapshot(),before)
    }
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON logs`)
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = ${owner.id} THEN RAISE EXCEPTION 'fixture points ledger unavailable'; END IF; RETURN NEW; END $$`)
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON points_logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
    for (const amount of [10,-10]) {
      await reset(); const before = await snapshot(), response = await submit(amount); assert.equal(response.statusCode,500); assert.deepEqual(await snapshot(),before)
    }
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON points_logs`)
    for (const amount of [1,-1,10,-10,1000000]) {
      await reset(); const response = await submit(amount); assert.equal(response.statusCode,200,response.body)
      assert.deepEqual(response.json(),{success:true,newPoints:10+amount})
      const saved = await snapshot(); assert.deepEqual(saved,{points:{points:10+amount,totalEarned:10+Math.max(0,amount),totalSpent:Math.max(0,-amount)},ledger:1,audit:1})
      const log=await prisma.pointsLog.findFirstOrThrow({where:{userId:owner.id}});assert.equal(log.amount,amount);assert.equal(log.pointsBefore,10);assert.equal(log.pointsAfter,10+amount)
    }
    for (const amount of [0,1.1,-11,1000001]) {
      await reset();const before=await snapshot(),response=await submit(amount);assert.equal(response.statusCode,400);assert.deepEqual(await snapshot(),before)
    }
  for (const state of ['banned', 'demoted', 'session', 'all-sessions']) {
    await reset(); const before = await snapshot()
    if (state === 'banned') await prisma.user.update({ where: { id: admin.id }, data: { status: 'banned' } })
    if (state === 'demoted') await prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
    if (state.endsWith('sessions') || state === 'session') await prisma.tokenInvalidation.create({ data: { userId: admin.id, sessionId: state === 'session' ? actor.sid : '__USER_LEVEL__', invalidatedAt: actor.iat } })
    const response = await submit(10); assert.equal(response.statusCode, 403); assert.deepEqual(await snapshot(), before)
  }
  // Hold the administrator row, revoke it, and prove the already authenticated write waits.
  for (const state of ['banned', 'demoted', 'session', 'all-sessions']) {
    await reset(); const before = await snapshot()
    let release!: () => void, entered!: (pid: number) => void, rejectReady!: (error: unknown) => void
    const hold = new Promise<void>(resolve => { release = resolve })
    const ready = new Promise<number>((resolve, reject) => { entered = resolve; rejectReady = reject })
    const blocker = prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${admin.id} FOR UPDATE`
      if (state === 'banned') await tx.user.update({ where: { id: admin.id }, data: { status: 'banned' } })
      if (state === 'demoted') await tx.user.update({ where: { id: admin.id }, data: { role: 'user' } })
      if (state === 'session' || state === 'all-sessions') await tx.tokenInvalidation.create({ data: { userId: admin.id, sessionId: state === 'session' ? actor.sid : '__USER_LEVEL__', invalidatedAt: actor.iat } })
      const [row] = await tx.$queryRaw<Array<{pid:number}>>`SELECT pg_backend_pid() AS pid`; entered(row.pid); await hold
    }, { timeout: 15000 })
    void blocker.catch(rejectReady); const pid = await ready
    let settled = false, blocked = false
    const operation = submit(10).then(response => { settled = true; return response })
    try {
      const end = Date.now() + 3500
      while (!settled && Date.now() < end) {
        const [row] = await prisma.$queryRaw<Array<{count:bigint}>>`SELECT count(*) FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`
        if (Number(row.count)) { blocked = true; break }; await delay(20)
      }
    } finally { release(); await blocker }
    assert.ok(blocked, `${state} revocation serializes with current write`); assert.equal((await operation).statusCode, 403); assert.deepEqual(await snapshot(), before)
  }

    for (const state of ['current','earned','spent']) {
      await reset()
      await prisma.userPoints.update({where:{userId:owner.id},data:state==='current'?{points:2147483647}:state==='earned'?{totalEarned:2147483647}:{totalSpent:2147483647}})
      const before=await snapshot();assert.equal((await submit(state==='spent'?-1:1)).statusCode,400);assert.deepEqual(await snapshot(),before,'overflow cannot increment any counter or audit')
    }
    await reset()
    const concurrent=await Promise.all([submit(-7),submit(-7)])
    assert.deepEqual(concurrent.map(r=>r.statusCode).sort(),[200,400],'two deductions serialize and only one can consume available points')
    assert.deepEqual(await snapshot(),{points:{points:3,totalEarned:10,totalSpent:7},ledger:1,audit:1})
    for (const actorChange of [{sid:''},{iat:0}]) {
      await reset();actor={...actor,...actorChange};const before=await snapshot();assert.equal((await submit(10)).statusCode,403);assert.deepEqual(await snapshot(),before)
    }
    // Missing target and failed authorization do not create an empty points record.
    await reset();await prisma.pointsLog.deleteMany({where:{userId:owner.id}});await prisma.userPoints.delete({where:{userId:owner.id}})
    await prisma.user.update({where:{id:admin.id},data:{status:'banned'}})
    assert.equal((await submit(10)).statusCode,403);assert.equal(await prisma.userPoints.count({where:{userId:owner.id}}),0)
    console.log('PASS actual PG points current admin/session and revocation lock races, atomic audit/ledger failure, positive/negative/zero/max counters and invalid balance preservation')
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON logs`);await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON points_logs`);await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`)
  }
} catch (error) { failure = error } finally {
  await app.close(); await prisma.log.deleteMany({ where: { userId: admin.id } }); await prisma.pointsLog.deleteMany({ where: { userId: owner.id } }); await prisma.userPoints.deleteMany({ where: { userId: owner.id } }); await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } }); await prisma.user.deleteMany({ where: { id: { in: [owner.id,admin.id] } } }); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
