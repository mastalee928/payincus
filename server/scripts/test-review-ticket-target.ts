import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'),
  'Use isolated local *_pool_test PostgreSQL')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { createTicket, TicketMutationError } = await import('../src/db/tickets.js')
const { default: routes } = await import('../src/routes/tickets.js')
const tag = `ticket-target-${randomUUID()}`
const user = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
const other = await prisma.user.create({ data: { username: tag + '-other', passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: user.id, name: tag, url: 'https://127.0.0.1:1', certPath: '', keyPath: '' } })
const nextHost = await prisma.host.create({ data: { userId: other.id, name: tag, url: host.url, certPath: '', keyPath: '' } })
const instance = await prisma.instance.create({ data: { userId: user.id, hostId: host.id, name: tag, incusId: tag,
  image: 'fixture/debian', status: 'running', cpu: 100, memory: 512, disk: 1024 } })
const payload = { userId: user.id, instanceId: instance.id, hostId: host.id, subject: tag, content: 'fixture message content' }
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = { id: user.id, username: user.username, role: 'user' } })
app.decorate('requireAdmin', async (_request: any, reply: any) => reply.code(403).send({ error: 'FORBIDDEN' }))
const trigger = `ticket_target_${user.id}`
let triggerInstalled = false
try {
  await app.register(routes, { prefix: '/tickets' })
  for (const entry of ['helper', 'route']) {
    for (const change of [{ userId: other.id }, { hostId: nextHost.id }, { status: 'deleted' as const }]) {
      let release!: () => void, ready!: (pid: number) => void
      const held = new Promise<void>(resolve => { release = resolve })
      const entered = new Promise<number>(resolve => { ready = resolve })
      const blocker = prisma.$transaction(async tx => {
        await tx.instance.update({ where: { id: instance.id }, data: change })
        const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
        ready(row.pid)
        await held
      }, { timeout: 15000 })
      const pid = await entered
      const operation = entry === 'helper'
        ? createTicket(payload).then(value => ({ value }), error => ({ error }))
        : app.inject({ method: 'POST', url: '/tickets/', payload }).then(value => ({ value }), error => ({ error }))
      let blocked = false
      try {
        const deadline = Date.now() + 3000
        while (Date.now() < deadline) {
          const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`
          if (Number(row.count) > 0) { blocked = true; break }
          await delay(20)
        }
      } finally { release(); await blocker }
      const outcome = await operation
      assert.equal(blocked, true, `${entry}: create must wait for the in-flight target change`)
      if (entry === 'helper') {
        assert.ok('error' in outcome && outcome.error instanceof TicketMutationError)
      } else {
        assert.ok('value' in outcome && 'statusCode' in outcome.value)
        assert.equal(outcome.value.statusCode, 409, outcome.value.body)
        assert.equal(outcome.value.json().error, 'TICKET_TARGET_CHANGED')
      }
      assert.equal(await prisma.ticket.count({ where: { userId: user.id } }), 0)
      assert.equal(await prisma.ticketMessage.count({ where: { senderId: user.id } }), 0)
      await prisma.instance.update({ where: { id: instance.id }, data: { userId: user.id, hostId: host.id, status: 'running' } })
    }
  }
  await assert.rejects(createTicket({ ...payload, instanceId: null }), TicketMutationError)
  const created = await createTicket(payload)
  const current = await prisma.ticket.findUniqueOrThrow({ where: { id: created.ticketId } })
  assert.equal(current.instanceId, instance.id); assert.equal(current.hostId, host.id); assert.equal(current.userId, user.id)
  assert.equal(await prisma.ticketMessage.count({ where: { ticketId: created.ticketId } }), 1)
  await prisma.ticket.delete({ where: { id: created.ticketId } })
  const unscoped = await createTicket({ ...payload, instanceId: null, hostId: null })
  assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: unscoped.ticketId } })).hostId, null)
  await prisma.ticket.delete({ where: { id: unscoped.ticketId } })
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.sender_id = ${user.id} THEN RAISE EXCEPTION 'fixture-ticket-message-failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON ticket_messages FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  triggerInstalled = true
  await assert.rejects(createTicket(payload), /fixture-ticket-message-failure/)
  assert.equal(await prisma.ticket.count({ where: { userId: user.id } }), 0, 'first message failure rolls back ticket and association')
  console.log('PASS real PG/Fastify ticket target: helper and web route block on concurrent owner/host/deletion changes then reject without ticket/message writes; valid linked/unscoped creation and first-message DB rollback. Public API uses the same helper; token authentication and attachment services not exercised.')
} finally {
  if (triggerInstalled) {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON ticket_messages`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`)
  }
  await app.close()
  await prisma.ticket.deleteMany({ where: { userId: user.id } })
  await prisma.instance.delete({ where: { id: instance.id } })
  await prisma.host.deleteMany({ where: { id: { in: [host.id, nextHost.id] } } })
  await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id] } } })
  await closePrismaDatabase()
}
process.exit(process.exitCode || 0)
