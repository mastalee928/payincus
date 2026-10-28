import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use isolated local *_pool_test PostgreSQL')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/traffic.js')
const tag = `traffic-auth-${randomUUID()}`
const owner = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture', balance: 50 } })
const admin = await prisma.user.create({ data: { username: tag + '-admin', passwordHash: 'unusable-fixture', role: 'admin' } })
const hostOwner = await prisma.user.create({ data: { username: tag + '-host', passwordHash: 'unusable-fixture' } })
const stranger = await prisma.user.create({ data: { username: tag + '-other', passwordHash: 'unusable-fixture' } })
const userIds = [owner.id, admin.id, hostOwner.id, stranger.id]
const host = await prisma.host.create({ data: { userId: hostOwner.id, name: tag, url: 'https://127.0.0.1:1', certPath: '', keyPath: '' } })
const pkg = await prisma.package.create({ data: { userId: hostOwner.id, name: tag, cpuMax: 100, memoryMax: 512, diskMax: 1024, trafficResetPrice: 2.5 } })
const instance = await prisma.instance.create({ data: { userId: owner.id, hostId: host.id, packageId: pkg.id, name: tag, incusId: tag,
  image: 'fixture', cpu: 50, memory: 256, disk: 1024, status: 'stopped', monthlyTrafficUsed: 100n, trafficStatus: 'LIMITED' } })
await prisma.userQuota.create({ data: { userId: owner.id, monthlyTrafficUsed: 2500n, monthlyTrafficLimit: 10000n, extraTrafficQuota: 500n, extraTrafficUsed: 100n } })
const originalTime = new Date('2026-01-01T00:00:00Z')
await prisma.trafficSnapshot.create({ data: { instanceId: instance.id, rxRaw: 900n, txRaw: 800n, updatedAt: originalTime } })
let actor = { id: admin.id, username: admin.username, role: 'admin' as 'admin' | 'user', sid: randomUUID(), iat: Math.floor(Date.now() / 1000) }
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = { ...actor } })
app.decorate('authenticateUser', async (request: any) => { request.user = { ...actor } })
app.decorate('authenticateAdmin', async (request: any) => { request.user = { ...actor } })
app.decorate('requireAdmin', async (request: any, reply: any) => { if (request.user.role !== 'admin') return reply.code(403).send({ error: 'FORBIDDEN' }) })
const reset = () => app.inject({ method: 'POST', url: `/instances/${instance.id}/traffic/reset` })
const restore = async () => {
  await prisma.tokenInvalidation.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { status: 'active', role: 'user' } })
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
  await prisma.user.update({ where: { id: owner.id }, data: { balance: 50 } })
  await prisma.host.update({ where: { id: host.id }, data: { userId: hostOwner.id } })
  await prisma.instance.update({ where: { id: instance.id }, data: { userId: owner.id, status: 'stopped', monthlyTrafficUsed: 100n, trafficStatus: 'LIMITED' } })
  await prisma.userQuota.update({ where: { userId: owner.id }, data: { monthlyTrafficUsed: 2500n, extraTrafficQuota: 500n, extraTrafficUsed: 100n } })
  await prisma.trafficSnapshot.update({ where: { instanceId: instance.id }, data: { rxRaw: 900n, txRaw: 800n, updatedAt: originalTime } })
  await prisma.balanceLog.deleteMany({ where: { instanceId: instance.id } })
}
const unchanged = async () => {
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).monthlyTrafficUsed, 100n)
  const quota = await prisma.userQuota.findUniqueOrThrow({ where: { userId: owner.id } })
  assert.equal(quota.monthlyTrafficUsed, 2500n); assert.equal(quota.extraTrafficQuota, 500n)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).balance), 50)
  assert.equal(await prisma.balanceLog.count({ where: { instanceId: instance.id } }), 0)
  assert.equal((await prisma.trafficSnapshot.findUniqueOrThrow({ where: { instanceId: instance.id } })).updatedAt.getTime(), originalTime.getTime())
}
try {
  await app.register(routes)
  // Let the request authenticate against the pre-commit state, then commit account revocation.
  for (const role of ['admin', 'host', 'owner'] as const) for (const mode of ['banned', 'session', 'all-sessions', ...(role === 'admin' ? ['demoted'] : [])]) {
    await restore()
    const user = role === 'admin' ? admin : role === 'host' ? hostOwner : owner
    actor = { ...actor, id: user.id, username: user.username, role: role === 'admin' ? 'admin' : 'user', sid: randomUUID() }
    let release!: () => void, entered!: (pid: number) => void
    const hold = new Promise<void>(resolve => { release = resolve }), ready = new Promise<number>(resolve => { entered = resolve })
    const blocker = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`
      if (mode === 'banned') await tx.user.update({ where: { id: user.id }, data: { status: 'banned' } })
      if (mode === 'demoted') await tx.user.update({ where: { id: user.id }, data: { role: 'user' } })
      if (mode === 'session' || mode === 'all-sessions') await tx.tokenInvalidation.create({ data: { userId: user.id, sessionId: mode === 'session' ? actor.sid : '__USER_LEVEL__', invalidatedAt: actor.iat } })
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
      entered(row.pid); await hold
    }, { timeout: 15000 })
    const pid = await ready
    let settled = false, blocked = false
    const operation = reset().then(response => { settled = true; return response })
    try {
      const deadline = Date.now() + 3000
      while (!settled && Date.now() < deadline) {
        const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`
        if (Number(row.count) > 0) { blocked = true; break }
        await delay(20)
      }
    } finally { release(); await blocker }
    const response = await operation
    assert.equal(response.statusCode, 403, `${role}/${mode}: revoked actor must not reset traffic; ${response.body}`)
    assert.equal(blocked, true, `${role}/${mode}: write must serialize with account revocation`)
    await unchanged()
  }
  for (const mode of ['host-transfer', 'instance-transfer', 'deleted']) {
    await restore()
    actor = { ...actor, id: hostOwner.id, username: hostOwner.username, role: 'user', sid: randomUUID() }
    let release!: () => void, entered!: (pid: number) => void
    const hold = new Promise<void>(resolve => { release = resolve }), ready = new Promise<number>(resolve => { entered = resolve })
    const blocker = prisma.$transaction(async tx => {
      if (mode === 'host-transfer') await tx.host.update({ where: { id: host.id }, data: { userId: stranger.id } })
      else await tx.instance.update({ where: { id: instance.id }, data: mode === 'deleted' ? { status: 'deleted' } : { userId: stranger.id } })
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
      entered(row.pid); await hold
    }, { timeout: 15000 })
    const pid = await ready
    const operation = reset(); let blocked = false
    try {
      const deadline = Date.now() + 3000
      while (Date.now() < deadline) {
        const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`
        if (Number(row.count) > 0) { blocked = true; break }
        await delay(20)
      }
    } finally { release(); await blocker }
    const response = await operation
    assert.equal(blocked, true, mode)
    assert.equal(response.statusCode, mode === 'deleted' ? 404 : mode === 'host-transfer' ? 403 : 409, response.body)
    await unchanged()
  }
  for (const role of ['admin', 'host', 'owner', 'stranger'] as const) {
    await restore()
    const user = role === 'admin' ? admin : role === 'host' ? hostOwner : role === 'owner' ? owner : stranger
    actor = { ...actor, id: user.id, username: user.username, role: role === 'admin' ? 'admin' : 'user', sid: randomUUID() }
    const response = await reset()
    if (role === 'stranger') { assert.equal(response.statusCode, 403); await unchanged(); continue }
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().price, role === 'owner' ? 2.5 : 0)
    const current = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
    assert.equal(current.monthlyTrafficUsed, 0n); assert.equal(current.trafficStatus, 'NORMAL')
    const quota = await prisma.userQuota.findUniqueOrThrow({ where: { userId: owner.id } })
    assert.equal(quota.monthlyTrafficUsed, 2400n); assert.equal(quota.extraTrafficQuota, 0n); assert.equal(quota.extraTrafficUsed, 0n)
    const snapshot = await prisma.trafficSnapshot.findUniqueOrThrow({ where: { instanceId: instance.id } })
    assert.equal(snapshot.rxRaw, 900n); assert.equal(snapshot.txRaw, 800n); assert.ok(snapshot.updatedAt > originalTime)
    const balance = Number((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).balance)
    assert.equal(balance, role === 'owner' ? 47.5 : 50)
    const logs = await prisma.balanceLog.findMany({ where: { instanceId: instance.id } })
    assert.equal(logs.length, role === 'owner' ? 1 : 0)
    if (role === 'owner') { assert.equal(Number(logs[0].balanceBefore), 50); assert.equal(Number(logs[0].balanceAfter), 47.5) }
  }
  await restore(); actor = { ...actor, id: owner.id, username: owner.username, role: 'user' }
  await prisma.user.update({ where: { id: owner.id }, data: { balance: 1 } })
  assert.equal((await reset()).statusCode, 400)
  await prisma.user.update({ where: { id: owner.id }, data: { balance: 50 } }); await unchanged()
  // A debit that finishes while reset is waiting must be reflected in the new balance log.
  await restore(); actor = { ...actor, id: owner.id, username: owner.username, role: 'user' }
  let releaseBalance!: () => void, enteredBalance!: (pid: number) => void
  const heldBalance = new Promise<void>(resolve => { releaseBalance = resolve })
  const readyBalance = new Promise<number>(resolve => { enteredBalance = resolve })
  const balanceBlocker = prisma.$transaction(async tx => {
    await tx.user.update({ where: { id: owner.id }, data: { balance: 20 } })
    const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
    enteredBalance(row.pid); await heldBalance
  }, { timeout: 15000 })
  const balancePid = await readyBalance, balanceOperation = reset(); let balanceBlocked = false
  try {
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE ${balancePid} = ANY(pg_blocking_pids(pid))`
      if (Number(row.count) > 0) { balanceBlocked = true; break }
      await delay(20)
    }
  } finally { releaseBalance(); await balanceBlocker }
  assert.equal(balanceBlocked, true)
  const balanceResponse = await balanceOperation; assert.equal(balanceResponse.statusCode, 200, balanceResponse.body)
  const balanceLog = await prisma.balanceLog.findFirstOrThrow({ where: { instanceId: instance.id } })
  assert.equal(Number(balanceLog.balanceBefore), 20); assert.equal(Number(balanceLog.balanceAfter), 17.5)
  console.log('PASS traffic reset: account/session/demotion and host/instance transfer/deletion races, unchanged state on rejection, current admin/host free reset, owner charge and balance log, quota subtraction/baseline preservation, stranger/insufficient balance. Real local PostgreSQL; stopped fixtures, no Incus or external payment.')
} finally {
  await app.close()
  await prisma.balanceLog.deleteMany({ where: { instanceId: instance.id } })
  await prisma.instance.delete({ where: { id: instance.id } })
  await prisma.package.delete({ where: { id: pkg.id } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await closePrismaDatabase()
}
// Imported application security modules own recurring cleanup intervals.
process.exit(0)
