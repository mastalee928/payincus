import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'),
  'Use isolated local *_pool_test PostgreSQL')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { createTicket, addTicketMessage, updateTicketStatus, TicketMutationError } = await import('../src/db/tickets.js')
const { default: routes } = await import('../src/routes/tickets.js')
const tag = `ticket-auth-${randomUUID()}`
const user = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
const support = await prisma.user.create({ data: { username: tag + '-support', passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: support.id, name: tag, url: 'https://127.0.0.1:1', certPath: '', keyPath: '' } })
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
  await prisma.user.update({ where: { id: user.id }, data: { status: 'active', role: 'user' } })
  const ticket = await prisma.ticket.create({ data: { userId: user.id, hostId: host.id, subject: tag } })
  for (const entry of ['helper', 'route']) {
    for (const mode of ['banned', 'session', 'all-sessions', 'demoted', 'host-transferred', 'closed']) {
      actor.id = mode === 'host-transferred' || mode === 'demoted' ? support.id : user.id
      actor.role = mode === 'demoted' ? 'admin' : 'user'
      const fromSupport = actor.id === support.id
      await prisma.user.update({ where: { id: actor.id }, data: { status: 'active', role: actor.role } })
      let release!: () => void, ready!: (pid: number) => void
      const held = new Promise<void>(resolve => { release = resolve })
      const entered = new Promise<number>(resolve => { ready = resolve })
      const blocker = prisma.$transaction(async tx => {
        if (mode === 'host-transferred') await tx.host.update({ where: { id: host.id }, data: { userId: user.id } })
        else if (mode === 'closed') await tx.ticket.update({ where: { id: ticket.id }, data: { status: 'closed' } })
        else {
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.id} FOR UPDATE`
          if (mode === 'banned') await tx.user.update({ where: { id: actor.id }, data: { status: 'banned' } })
          if (mode === 'demoted') await tx.user.update({ where: { id: actor.id }, data: { role: 'user' } })
          if (mode === 'session' || mode === 'all-sessions') await tx.tokenInvalidation.create({ data: {
            userId: actor.id, sessionId: mode === 'session' ? actor.sid : '__USER_LEVEL__', invalidatedAt: actor.iat
          } })
        }
        const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
        ready(row.pid); await held
      }, { timeout: 15000 })
      const pid = await entered
      const operation = entry === 'helper'
        ? addTicketMessage(ticket.id, actor.id, 'fixture reply', fromSupport, [], { ...actor }).then(value => ({ value }), error => ({ error }))
        : app.inject({ method: 'POST', url: `/tickets/${ticket.id}/messages`, payload: { content: 'fixture reply' } }).then(value => ({ value }), error => ({ error }))
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
      assert.equal(blocked, true, `reply ${entry}/${mode}: current authorization must wait for concurrent changes`)
      if (entry === 'helper') assert.ok('error' in outcome && outcome.error instanceof Error)
      else {
        assert.ok('value' in outcome && 'statusCode' in outcome.value)
        assert.equal(outcome.value.statusCode, mode === 'closed' ? 400 : 403, outcome.value.body)
      }
      assert.equal(await prisma.ticketMessage.count({ where: { ticketId: ticket.id } }), 0)
      assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).firstRespondedAt, null)
      await prisma.tokenInvalidation.deleteMany({ where: { userId: actor.id } })
      await prisma.user.update({ where: { id: actor.id }, data: { status: 'active', role: 'user' } })
      await prisma.host.update({ where: { id: host.id }, data: { userId: support.id } })
      await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'open' } })
    }
  }
  const supportActor = { ...actor, id: support.id, role: 'user' as const }
  const customerActor = { ...actor, id: user.id, role: 'user' as const }
  const supported = await addTicketMessage(ticket.id, support.id, 'support reply', true, [], supportActor)
  assert.equal(supported.isFromOwner, true)
  assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status, 'in_progress')
  await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'resolved' } })
  assert.equal((await addTicketMessage(ticket.id, user.id, 'customer reply', false, [], customerActor)).isFromOwner, false)
  assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status, 'in_progress')
  await assert.rejects(addTicketMessage(ticket.id, user.id, 'wrong identity', true, [], customerActor), TicketMutationError)
  await assert.rejects(addTicketMessage(ticket.id, support.id, 'no web session', true), TicketMutationError)
  assert.equal((await addTicketMessage(ticket.id, user.id, 'public API customer reply', false)).isFromOwner, false)
  for (const action of ['status', 'close'] as const) {
    for (const mode of ['banned', 'session', 'demoted', 'host-transferred', 'stale-status']) {
      actor.id = support.id; actor.role = mode === 'demoted' ? 'admin' : 'user'
      await prisma.user.update({ where: { id: actor.id }, data: { status: 'active', role: actor.role } })
      await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'open', resolvedAt: null, closedAt: null } })
      let release!: () => void, ready!: (pid: number) => void
      const held = new Promise<void>(resolve => { release = resolve })
      const entered = new Promise<number>(resolve => { ready = resolve })
      const blocker = prisma.$transaction(async tx => {
        if (mode === 'host-transferred') await tx.host.update({ where: { id: host.id }, data: { userId: user.id } })
        else if (mode === 'stale-status') await tx.ticket.update({ where: { id: ticket.id }, data: { status: 'resolved' } })
        else {
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.id} FOR UPDATE`
          if (mode === 'banned') await tx.user.update({ where: { id: actor.id }, data: { status: 'banned' } })
          if (mode === 'demoted') await tx.user.update({ where: { id: actor.id }, data: { role: 'user' } })
          if (mode === 'session') await tx.tokenInvalidation.create({ data: { userId: actor.id, sessionId: actor.sid, invalidatedAt: actor.iat } })
        }
        const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
        ready(row.pid); await held
      }, { timeout: 15000 })
      const pid = await entered
      const pending = app.inject({ method: action === 'status' ? 'PATCH' : 'POST', url: `/tickets/${ticket.id}/${action}`,
        ...(action === 'status' ? { payload: { status: 'in_progress' } } : {}) }).then(value => ({ value }), error => ({ error }))
      let blocked = false
      try {
        const deadline = Date.now() + 3000
        while (Date.now() < deadline) {
          const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`
          if (Number(row.count) > 0) { blocked = true; break }
          await delay(20)
        }
      } finally { release(); await blocker }
      const outcome = await pending
      assert.equal(blocked, true, `${action}/${mode}: mutation must await current committed state`)
      assert.ok('value' in outcome)
      assert.equal(outcome.value.statusCode, mode === 'stale-status' ? 409 : 403, outcome.value.body)
      const saved = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })
      assert.equal(saved.status, mode === 'stale-status' ? 'resolved' : 'open')
      assert.equal(saved.closedAt, null)
      await prisma.tokenInvalidation.deleteMany({ where: { userId: actor.id } })
      await prisma.user.update({ where: { id: actor.id }, data: { status: 'active', role: 'user' } })
      await prisma.host.update({ where: { id: host.id }, data: { userId: support.id } })
    }
  }
  await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'open' } })
  await assert.rejects(updateTicketStatus(ticket.id, 'resolved', { actor: customerActor, action: 'status', expectedStatus: 'open' }), TicketMutationError)
  await updateTicketStatus(ticket.id, 'closed', { actor: customerActor, action: 'close', expectedStatus: 'open' })
  await updateTicketStatus(ticket.id, 'open', { actor: customerActor, action: 'status', expectedStatus: 'closed' })
  await updateTicketStatus(ticket.id, 'resolved', { actor: supportActor, action: 'status', expectedStatus: 'open' })
  await assert.rejects(updateTicketStatus(ticket.id, 'closed', { actor: customerActor, action: 'close', expectedStatus: 'open' }), TicketMutationError)
  assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status, 'resolved')
  console.log('PASS real PG/Fastify ticket authorization: creation 8, reply 12 and status/close 10 concurrent revocation/ownership/state cases; no denied messages/SLA/status writes. Current support/customer replies, customer close/reopen and support resolve preserved. No outbound notification or attachment upload; notes/links/deletion/notification and PAT revocation remain separate.')
} finally {
  await app.close()
  await prisma.ticket.deleteMany({ where: { userId: user.id } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.delete({ where: { id: support.id } })
  await prisma.user.delete({ where: { id: user.id } })
  await closePrismaDatabase()
}
process.exit(process.exitCode || 0)
