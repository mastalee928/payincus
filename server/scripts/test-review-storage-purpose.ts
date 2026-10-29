import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { Prisma } from '@prisma/client'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) &&
  /^\/[a-zA-Z0-9_]+_pool_test$/.test(database.pathname) && !database.search && !database.hash)
process.env.JWT_SECRET ||= 'storage-purpose-fixture-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/hosts.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const prefix = `storage-purpose-${randomUUID().slice(0, 8)}`
const owner = await prisma.user.create({ data: { username: prefix, passwordHash: 'unusable-fixture', role: 'user' } })
const admin = await prisma.user.create({ data: { username: prefix + '-admin', passwordHash: 'unusable-fixture', role: 'admin' } })
const other = await prisma.user.create({ data: { username: prefix + '-other', passwordHash: 'unusable-fixture', role: 'user' } })
const ids = [owner.id, admin.id, other.id]
const host = await prisma.host.create({ data: { userId: owner.id, name: prefix, url: 'https://127.0.0.1:1' } })
const pool = await prisma.storagePool.create({ data: { hostId: host.id, name: prefix, driver: 'lvm', purpose: 'instance_data', description: 'keep', config: { source: 'keep' } } })
let actor = { id: owner.id, role: 'user', username: prefix, sid: prefix, iat: Math.floor(Date.now() / 1000) }
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = { ...actor } })
app.decorate('authenticateUser', app.authenticate); app.decorate('authenticateAdmin', app.authenticate); app.decorate('requireAdmin', async () => {})
await app.register(routes, { prefix: '/hosts' }); await app.ready()
const submit = (name = prefix) => app.inject({ method: 'PATCH', url: `/hosts/${host.id}/storage-pools/${name}`, payload: { purpose: 'instance_storage' } })
const read = () => prisma.storagePool.findUniqueOrThrow({ where: { id: pool.id } })
const reset = async () => {
  actor = { id: owner.id, role: 'user', username: prefix, sid: prefix, iat: Math.floor(Date.now() / 1000) }
  await prisma.user.update({ where: { id: owner.id }, data: { status: 'active', role: 'user' } })
  await prisma.user.update({ where: { id: admin.id }, data: { status: 'active', role: 'admin' } })
  await prisma.tokenInvalidation.deleteMany({ where: { userId: { in: ids } } })
  await prisma.host.update({ where: { id: host.id }, data: { userId: owner.id } })
  await prisma.storagePool.update({ where: { id: pool.id }, data: { purpose: 'instance_data', name: prefix, description: 'keep', config: { source: 'keep' } } })
  await prisma.log.deleteMany({ where: { userId: { in: ids } } })
}
async function race(mutate: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  let release!: () => void, entered!: (pid: number) => void, rejectReady!: (error: unknown) => void
  const hold = new Promise<void>(resolve => { release = resolve }), ready = new Promise<number>((resolve, reject) => { entered = resolve; rejectReady = reject })
  const blocker = prisma.$transaction(async tx => {
    await mutate(tx)
    const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
    entered(row.pid); await hold
  }, { timeout: 15000 })
  void blocker.catch(rejectReady)
  const pid = await ready
  let settled = false, blocked = false
  const operation = submit().then(response => { settled = true; return response })
  try {
    const end = Date.now() + 3500
    while (!settled && Date.now() < end) {
      const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`
      if (Number(row.count)) { blocked = true; break }
      await delay(20)
    }
  } finally { release(); await blocker }
  return { response: await operation, blocked }
}
const trigger = 'storage_purpose_' + randomUUID().replaceAll('-', '')
let failure: unknown
try {
  const response = await submit()
  assert.equal(response.statusCode, 200, 'platform purpose must save without reaching an offline host')
  assert.equal((await read()).purpose, 'instance_storage'); assert.equal((await read()).description, 'keep')
  assert.deepEqual((await read()).config, { source: 'keep' })
  assert.equal(await prisma.log.count({ where: { userId: owner.id, action: 'storage.update' } }), 1)
  assert.equal((await submit('missing-pool')).statusCode, 404)
  for (const state of ['banned', 'session', 'all-sessions', 'host-owner', 'pool-changed', 'pool-renamed', 'same-timestamp-config', 'admin-demoted']) {
    await reset()
    if (state === 'admin-demoted') actor = { ...actor, id: admin.id, role: 'admin' }
    const result = await race(async tx => {
      if (state === 'host-owner') await tx.host.update({ where: { id: host.id }, data: { userId: other.id } })
      else if (state === 'pool-changed') await tx.storagePool.update({ where: { id: pool.id }, data: { description: 'changed during request' } })
      else if (state === 'pool-renamed') await tx.storagePool.update({ where: { id: pool.id }, data: { name: prefix + '-changed' } })
      else if (state === 'same-timestamp-config') {
        const previous = await tx.storagePool.findUniqueOrThrow({ where: { id: pool.id } })
        await tx.storagePool.update({ where: { id: pool.id }, data: { config: { source: 'changed' }, updatedAt: previous.updatedAt } })
      }
      else {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.id} FOR UPDATE`
        if (state === 'banned') await tx.user.update({ where: { id: actor.id }, data: { status: 'banned' } })
        else if (state === 'admin-demoted') await tx.user.update({ where: { id: actor.id }, data: { role: 'user' } })
        else await tx.tokenInvalidation.create({ data: { userId: actor.id, sessionId: state === 'session' ? actor.sid : '__USER_LEVEL__', invalidatedAt: actor.iat } })
      }
    })
    assert.ok(result.blocked, state)
    assert.ok([403, 409].includes(result.response.statusCode), `${state}: ${result.response.body}`)
    assert.equal((await read()).purpose, 'instance_data', state)
    assert.equal(await prisma.log.count({ where: { userId: { in: ids } } }), 0)
  }
  await reset(); actor = { ...actor, id: other.id }
  assert.equal((await submit()).statusCode, 403)
  await reset(); actor.sid = ''
  assert.equal((await submit()).statusCode, 403)
  await reset(); actor = { ...actor, id: admin.id, role: 'admin' }
  assert.equal((await submit()).statusCode, 200)
  assert.equal((await read()).purpose, 'instance_storage')
  await reset()
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = ${owner.id} AND NEW.action = 'storage.update' THEN RAISE EXCEPTION 'fixture audit unavailable'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  assert.equal((await submit()).statusCode, 500)
  assert.equal((await read()).purpose, 'instance_data', 'audit failure rolls back purpose')
  console.log('PASS offline platform purpose updates, current owner/admin/session/revocation/metadata races, missing pool and atomic audit rollback over real PG/Fastify')
} catch (error) { failure = error } finally {
  await app.close(); await closeAllClients()
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON logs`)
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`)
  await prisma.log.deleteMany({ where: { userId: { in: ids } } })
  await prisma.storagePool.deleteMany({ where: { hostId: host.id } }); await prisma.host.delete({ where: { id: host.id } })
  await prisma.tokenInvalidation.deleteMany({ where: { userId: { in: ids } } }); await prisma.user.deleteMany({ where: { id: { in: ids } } })
  await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
