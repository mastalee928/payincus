import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import Fastify from 'fastify'
import type { Prisma } from '@prisma/client'
import type { PublicApiWriteAuthorization } from '../src/db/public-api-write-authorization.js'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'),
  'Use isolated local *_pool_test PostgreSQL')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { createTicket, TicketMutationError } = await import('../src/db/tickets.js')
const { authorizePublicApiWrite } = await import('../src/db/public-api-write-authorization.js')
const { authenticatePublicApiRequest, hashPublicApiToken, getPublicApiTokenPrefix } = await import('../src/lib/public-api-auth.js')
const { default: publicRoutes } = await import('../src/routes/public-api.js')
const tag = `ticket-public-${randomUUID()}`
const user = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
const support = await prisma.user.create({ data: { username: tag + '-support', passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: support.id, name: tag, url: 'https://127.0.0.1:1', certPath: '', keyPath: '' } })
const instance = await prisma.instance.create({ data: { userId: user.id, hostId: host.id, name: tag, incusId: tag,
  image: 'fixture/debian', status: 'running', cpu: 100, memory: 512, disk: 1024 } })
const appRecord = await prisma.oAuthClientApp.create({ data: { name: tag, clientId: tag, clientSecretHash: 'unusable-fixture',
  scopes: ['tickets:write'], createdByUserId: support.id } })
const grant = await prisma.oAuthGrant.create({ data: { appId: appRecord.id, userId: user.id, scopes: ['tickets:write'] } })
const app = Fastify()
let captured: PublicApiWriteAuthorization | undefined
app.get('/capture', async (request, reply) => {
  const token = await authenticatePublicApiRequest(request, reply, 'tickets:write')
  if (!token) return
  captured = token.writeAuthorization
  return { authenticated: true }
})
let races = 0
async function waitBlocked(pid: number): Promise<void> {
  const deadline = Date.now() + 2500
  while (Date.now() < deadline) {
    const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`
    if (Number(row.count) > 0) return
    await delay(15)
  }
  assert.fail('Expected a real PostgreSQL row-lock wait before releasing the race')
}
async function issue(source: PublicApiWriteAuthorization['source']) {
  await prisma.user.update({ where: { id: user.id }, data: { status: 'active' } })
  await prisma.oAuthClientApp.update({ where: { id: appRecord.id }, data: { enabled: true, scopes: ['tickets:write'] } })
  await prisma.oAuthGrant.update({ where: { id: grant.id }, data: { revokedAt: null, scopes: ['tickets:write'] } })
  const raw = `${source === 'api_token' ? 'pat_' : 'poa_'}${randomBytes(32).toString('base64url')}`
  const data = { userId: user.id, tokenHash: hashPublicApiToken(raw), tokenPrefix: getPublicApiTokenPrefix(raw),
    scopes: ['tickets:write'], expiresAt: new Date(Date.now() + 60_000) }
  const token = source === 'api_token'
    ? await prisma.publicApiToken.create({ data: { ...data, name: tag } })
    : await prisma.oAuthAccessToken.create({ data: { ...data, appId: appRecord.id, grantId: grant.id } })
  const headers = { authorization: `Bearer ${raw}` }
  const authenticated = await app.inject({ method: 'GET', url: '/capture', headers })
  assert.equal(authenticated.statusCode, 200, authenticated.body)
  assert.ok(captured)
  return { token, headers, binding: { ...captured } }
}
async function removeToken(binding: PublicApiWriteAuthorization) {
  if (binding.source === 'api_token') await prisma.publicApiToken.deleteMany({ where: { id: binding.tokenId } })
  else await prisma.oAuthAccessToken.deleteMany({ where: { id: binding.tokenId } })
}
const payload = { userId: user.id, hostId: host.id, instanceId: instance.id, subject: tag, content: 'isolated ticket content' }
try {
  await app.register(publicRoutes, { prefix: '/v1' })
  for (const source of ['api_token', 'oauth_access_token'] as const) {
    for (const entry of ['helper', 'route']) {
      for (const mode of ['revoke', 'delete', 'expire', 'scope', 'identity', 'account',
        ...(source === 'oauth_access_token' ? ['app-disabled', 'app-scope', 'grant-revoked', 'grant-scope', 'grant-missing'] : [])]) {
        const { headers, binding } = await issue(source)
        let release!: () => void, ready!: (pid: number) => void
        const held = new Promise<void>(resolve => { release = resolve })
        const entered = new Promise<number>(resolve => { ready = resolve })
        const blocker = prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM instances WHERE id = ${instance.id} FOR UPDATE`
          const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
          ready(row.pid); await held
        }, { timeout: 15000 })
        const pid = await entered
        const operation = entry === 'helper'
          ? createTicket({ ...payload, apiAuthorization: binding }).then(value => ({ value }), error => ({ error }))
          : app.inject({ method: 'POST', url: '/v1/tickets', headers, payload }).then(value => ({ value }), error => ({ error }))
        try {
          await waitBlocked(pid)
          if (mode === 'account') await prisma.user.update({ where: { id: user.id }, data: { status: 'banned' } })
          else if (mode === 'app-disabled') await prisma.oAuthClientApp.update({ where: { id: appRecord.id }, data: { enabled: false } })
          else if (mode === 'app-scope') await prisma.oAuthClientApp.update({ where: { id: appRecord.id }, data: { scopes: [] } })
          else if (mode === 'grant-revoked') await prisma.oAuthGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } })
          else if (mode === 'grant-scope') await prisma.oAuthGrant.update({ where: { id: grant.id }, data: { scopes: [] } })
          else if (mode === 'grant-missing') await prisma.oAuthAccessToken.update({ where: { id: binding.tokenId }, data: { grantId: null } })
          else if (mode === 'delete') await removeToken(binding)
          else {
            const data = mode === 'revoke' ? { revokedAt: new Date() } : mode === 'expire' ? { expiresAt: new Date(0) }
              : mode === 'scope' ? { scopes: [] } : { tokenHash: hashPublicApiToken(randomUUID()) }
            if (source === 'api_token') await prisma.publicApiToken.update({ where: { id: binding.tokenId }, data })
            else await prisma.oAuthAccessToken.update({ where: { id: binding.tokenId }, data })
          }
        } finally { release(); await blocker }
        const outcome = await operation
        if (entry === 'helper') assert.ok('error' in outcome && outcome.error instanceof TicketMutationError && outcome.error.statusCode === 403, `${source}/${mode}`)
        else {
          assert.ok('value' in outcome && 'statusCode' in outcome.value)
          assert.equal(outcome.value.statusCode, 403, `${source}/${mode}: ${outcome.value.body}`)
          assert.ok(['TICKET_API_FORBIDDEN', 'TICKET_ACTOR_FORBIDDEN'].includes(outcome.value.json().code))
        }
        assert.equal(await prisma.ticket.count({ where: { userId: user.id } }), 0)
        assert.equal(await prisma.ticketMessage.count({ where: { senderId: user.id } }), 0)
        assert.equal(await prisma.inboxMessage.count({ where: { userId: support.id } }), 0)
        await removeToken(binding)
        races++
      }
    }
    const { headers, binding } = await issue(source)
    await assert.rejects(createTicket({ ...payload, apiAuthorization: { ...binding, userId: support.id } }), TicketMutationError)
    if (source === 'oauth_access_token') {
      await assert.rejects(createTicket({ ...payload, apiAuthorization: { ...binding, grantId: null } }), TicketMutationError)
    }
    const allowed = await app.inject({ method: 'POST', url: '/v1/tickets', headers, payload })
    assert.equal(allowed.statusCode, 201, allowed.body)
    assert.equal(allowed.body.includes('tokenHash'), false)
    assert.equal(allowed.body.includes('writeAuthorization'), false)
    assert.equal(await prisma.ticket.count({ where: { userId: user.id } }), 1)
    assert.equal(await prisma.ticketMessage.count({ where: { senderId: user.id } }), 1)
    await prisma.ticket.deleteMany({ where: { userId: user.id } })
    await prisma.inboxMessage.deleteMany({ where: { userId: support.id } })

    // Hold the credential lock through the commit; revoke must wait for this transaction.
    let release!: () => void, ready!: (pid: number) => void
    const held = new Promise<void>(resolve => { release = resolve })
    const entered = new Promise<number>(resolve => { ready = resolve })
    const blocker = prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      assert.equal(await authorizePublicApiWrite(tx, user.id, binding, 'tickets:write'), true)
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
      ready(row.pid); await held
    }, { timeout: 15000 })
    const pid = await entered
    const revoke = source === 'api_token'
      ? prisma.publicApiToken.update({ where: { id: binding.tokenId }, data: { revokedAt: new Date() } }).then(() => undefined)
      : prisma.oAuthAccessToken.update({ where: { id: binding.tokenId }, data: { revokedAt: new Date() } }).then(() => undefined)
    try { await waitBlocked(pid) } finally { release(); await blocker; await revoke }
    await assert.rejects(createTicket({ ...payload, apiAuthorization: binding }), TicketMutationError)
    await removeToken(binding)
  }
  assert.equal(await prisma.notificationChannel.count({ where: { userId: { in: [user.id, support.id] } } }), 0)
  console.log(`PASS ${races} real PG/Fastify public ticket create races across PAT/POA revoke/delete/expiry/scopes/identity/account and OAuth app/grant checks. Bearer middleware is real; both valid routes create exactly one ticket, internal bindings are not exposed, and credential revocation waits for the write lock. No external channels or image service.`)
} finally {
  await app.close()
  await prisma.ticket.deleteMany({ where: { userId: user.id } })
  await prisma.instance.delete({ where: { id: instance.id } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.oAuthClientApp.delete({ where: { id: appRecord.id } })
  await prisma.publicApiToken.deleteMany({ where: { userId: user.id } })
  await prisma.user.deleteMany({ where: { id: { in: [user.id, support.id] } } })
  await closePrismaDatabase()
}
process.exit(process.exitCode || 0)
