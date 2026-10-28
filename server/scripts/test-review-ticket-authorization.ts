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
const tag = `ticket-auth-${randomUUID()}`
const user = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
const actor = { id: user.id, username: user.username, sid: randomUUID(), iat: Math.floor(Date.now() / 1000), role: 'user' as 'user' | 'admin' }
const payload = { userId: user.id, subject: tag, content: 'fixture message content' }
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = { ...actor } })
app.decorate('requireAdmin', async (_request: any, reply: any) => reply.code(403).send({ error: 'FORBIDDEN' }))
try {
  await app.register(routes, { prefix: '/tickets' })
  for (const entry of ['helper', 'route']) {
    for (const mode of ['banned', 'session', 'all-sessions', 'demoted']) {
      actor.role = mode === 'demoted' ? 'admin' : 'user'
      await prisma.user.update({ where: { id: user.id }, data: { status: 'active', role: actor.role } })
      let release!: () => void, ready!: (pid: number) => void
      const held = new Promise<void>(resolve => { release = resolve })
      const entered = new Promise<number>(resolve => { ready = resolve })
      const blocker = prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`
        if (mode === 'banned') await tx.user.update({ where: { id: user.id }, data: { status: 'banned' } })
        if (mode === 'demoted') await tx.user.update({ where: { id: user.id }, data: { role: 'user' } })
        if (mode === 'session' || mode === 'all-sessions') await tx.tokenInvalidation.create({ data: {
          userId: user.id, sessionId: mode === 'session' ? actor.sid : '__USER_LEVEL__', invalidatedAt: actor.iat
        } })
        const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
        ready(row.pid); await held
      }, { timeout: 15000 })
      const pid = await entered
      const operation = entry === 'helper'
        ? createTicket({ ...payload, actor: { ...actor } }).then(value => ({ value }), error => ({ error }))
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
      assert.equal(blocked, true, `${entry}/${mode}: creation must serialize with account revocation`)
      if (entry === 'helper') assert.ok('error' in outcome && outcome.error instanceof TicketMutationError && outcome.error.statusCode === 403)
      else {
        assert.ok('value' in outcome && 'statusCode' in outcome.value)
        assert.equal(outcome.value.statusCode, 403, outcome.value.body)
        assert.equal(outcome.value.json().error, 'TICKET_ACTOR_FORBIDDEN')
      }
      assert.equal(await prisma.ticket.count({ where: { userId: user.id } }), 0)
      assert.equal(await prisma.ticketMessage.count({ where: { senderId: user.id } }), 0)
      await prisma.tokenInvalidation.deleteMany({ where: { userId: user.id } })
      await prisma.user.update({ where: { id: user.id }, data: { status: 'active', role: 'user' } })
    }
  }
  actor.role = 'user'
  await assert.rejects(createTicket({ ...payload, actor: { id: user.id, role: 'user' } }), TicketMutationError)
  await assert.rejects(createTicket({ ...payload, actor: { ...actor, id: user.id + 1 } }), TicketMutationError)
  for (const role of ['user', 'admin'] as const) {
    await prisma.user.update({ where: { id: user.id }, data: { role } })
    const saved = await createTicket({ ...payload, actor: { ...actor, role } })
    assert.equal(await prisma.ticketMessage.count({ where: { ticketId: saved.ticketId } }), 1)
    await prisma.ticket.delete({ where: { id: saved.ticketId } })
  }
  await prisma.user.update({ where: { id: user.id }, data: { status: 'banned' } })
  await assert.rejects(createTicket(payload), TicketMutationError, 'non-web caller also rechecks current account status')
  console.log('PASS real PG/Fastify ticket creation: helper/web route serialize with ban, session/user-level logout and role demotion, reject missing/mismatched web actor, preserve current user/admin success and non-web banned-account rejection. No outbound notification or attachment upload performed; other ticket mutation and PAT revocation paths remain separate.')
} finally {
  await app.close()
  await prisma.ticket.deleteMany({ where: { userId: user.id } })
  await prisma.user.delete({ where: { id: user.id } })
  await closePrismaDatabase()
}
process.exit(process.exitCode || 0)
