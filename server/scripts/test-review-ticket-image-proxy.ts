import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'),
  'Use isolated local *_pool_test PostgreSQL')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/tickets.js')
const { MAX_TICKET_IMAGE_SIZE } = await import('../src/lib/ticket-attachments.js')
const tag = `ticket-image-${randomUUID()}`
const user = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
const other = await prisma.user.create({ data: { username: tag + '-other', passwordHash: 'unusable-fixture' } })
const ticket = await prisma.ticket.create({ data: { userId: user.id, subject: tag } })
const message = await prisma.ticketMessage.create({ data: { ticketId: ticket.id, senderId: user.id, content: tag } })
// A public literal passes URL validation without DNS; intercepted fetch below never opens a socket.
const imageUrl = 'https://8.8.8.8/isolated-ticket-image-fixture'
const attachment = await prisma.ticketMessageAttachment.create({ data: {
  ticketId: ticket.id, messageId: message.id, uploaderId: user.id, provider: 'fixture', providerVersion: 'v1',
  providerFileId: 'isolated-file', filename: 'fixture.png', originalName: 'fixture.png', mimeType: 'image/png',
  sizeBytes: 3, url: imageUrl,
} })
const originalFetch = globalThis.fetch
const app = Fastify()
let actorId = user.id
let fetches = 0
let signal: AbortSignal | undefined
let upstream: Response | undefined
let respond: (signal: AbortSignal) => Response | Promise<Response> = () => { throw new Error('No fixture response selected') }
app.decorate('authenticate', async (request: any) => { request.user = { id: actorId, role: 'user' } })
app.decorate('requireAdmin', async (_request: any, reply: any) => reply.code(403).send({ error: 'FORBIDDEN' }))
globalThis.fetch = async (input, init) => {
  fetches++
  assert.equal(String(input), imageUrl)
  assert.equal(init?.redirect, 'manual')
  assert.ok(init?.signal && 'dispatcher' in init, 'production must retain its deadline and safe outbound dispatcher')
  signal = init.signal
  upstream = await respond(signal)
  return upstream
}
const getImage = () => app.inject({ method: 'GET', url: `/tickets/attachments/${attachment.id}/content` })
let cases = 0
async function expectFailure(detail: string) {
  upstream = undefined
  const result = await getImage()
  assert.equal(result.statusCode, 502, result.body)
  assert.deepEqual(result.json(), { error: 'Upstream service error', code: 'UPSTREAM_ERROR', details: detail })
  assert.equal(signal?.aborted, true, 'route must finish or abort the upstream request')
  const completedUpstream = upstream as Response | undefined
  if (completedUpstream?.body) assert.equal(completedUpstream.body.locked, false, 'response reader must be released')
  cases++
}
try {
  await app.register(routes, { prefix: '/tickets' })
  actorId = other.id
  assert.equal((await getImage()).statusCode, 404)
  assert.equal(fetches, 0, 'foreign attachment must not contact upstream')
  actorId = user.id
  await prisma.ticketMessageAttachment.update({ where: { id: attachment.id }, data: { url: 'http://127.0.0.1/private' } })
  assert.equal((await getImage()).statusCode, 502)
  assert.equal(fetches, 0, 'private attachment target must be rejected before fetch')
  await prisma.ticketMessageAttachment.update({ where: { id: attachment.id }, data: { url: imageUrl } })
  cases += 2

  for (const [status, headers, detail] of [
    [302, { location: 'http://127.0.0.1/private' }, 'Failed to load remote image'],
    [503, {}, 'Failed to load remote image'],
    [200, { 'content-type': 'text/html' }, 'Remote file is not an allowed image type'],
    [200, { 'content-type': 'image/svg+xml' }, 'Remote file is not an allowed image type'],
    [200, { 'content-type': 'image/png', 'content-length': String(MAX_TICKET_IMAGE_SIZE + 1) }, 'Remote image is too large'],
  ] as const) {
    let cancelled = false
    respond = () => new Response(new ReadableStream({ cancel() { cancelled = true } }), { status, headers })
    const before: number = fetches
    await expectFailure(detail)
    assert.equal(fetches, before + 1, 'redirects must never be followed')
    assert.equal(cancelled, true, 'unread rejected responses must be cancelled')
  }
  await prisma.ticketMessageAttachment.update({ where: { id: attachment.id }, data: { mimeType: 'text/html' } })
  let invalidStoredCancelled = false
  respond = () => new Response(new ReadableStream({ cancel() { invalidStoredCancelled = true } }))
  await expectFailure('Attachment image type is not allowed')
  assert.equal(invalidStoredCancelled, true)
  await prisma.ticketMessageAttachment.update({ where: { id: attachment.id }, data: { mimeType: 'image/png' } })

  let overflowCancelled = false
  const megabyte = new Uint8Array(1024 * 1024)
  respond = () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(megabyte) },
    cancel() { overflowCancelled = true },
  }), { headers: { 'content-type': 'image/png', 'content-length': '3' } })
  await expectFailure('Remote image is too large')
  assert.equal(overflowCancelled, true, 'actual bytes must be bounded even with a false short content length')

  respond = () => new Response(new ReadableStream({
    start(controller) { controller.error(new Error('fixture-sensitive-upstream-reset')) },
  }), { headers: { 'content-type': 'image/png' } })
  await expectFailure('Failed to load remote image')
  respond = () => { throw new Error('fixture-sensitive-fetch-failure') }
  await expectFailure('Failed to load remote image')
  respond = () => { throw new DOMException('fixture timeout', 'TimeoutError') }
  await expectFailure('Remote image request timed out')

  const timeoutStart = Date.now()
  respond = requestSignal => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1]))
      requestSignal.addEventListener('abort', () => controller.error(requestSignal.reason), { once: true })
    },
  }), { headers: { 'content-type': 'image/png' } })
  await expectFailure('Remote image request timed out')
  assert.ok(Date.now() - timeoutStart >= 14000 && Date.now() - timeoutStart < 25000,
    'real production 15-second deadline must also bound stalled response body reads')

  for (const contentType of ['IMAGE/PNG; charset=binary', undefined]) {
    respond = () => new Response(new Uint8Array([1, 2, 3]), { headers: contentType ? { 'content-type': contentType } : {} })
    const result = await getImage()
    assert.equal(result.statusCode, 200)
    assert.deepEqual(result.rawPayload, Buffer.from([1, 2, 3]))
    assert.equal(result.headers['content-type'], 'image/png')
    assert.equal(result.headers['cache-control'], 'private, max-age=300')
    assert.equal(result.headers['x-content-type-options'], 'nosniff')
    assert.equal(signal?.aborted, true)
    assert.equal(upstream?.body?.locked, false)
    cases++
  }
  assert.equal(await prisma.ticketMessageAttachment.count({ where: { ticketId: ticket.id } }), 1)
  console.log(`PASS ${cases} real PG/Fastify image proxy cases: ID ownership, private URL, redirect, HTTP/MIME rejection, header/stream limits, reset, fetch error, real 15-second body timeout, normal MIME fallback/bytes and cancellation. Fetch transport is intercepted; no image provider or public socket used.`)
} finally {
  globalThis.fetch = originalFetch
  await app.close()
  await prisma.ticket.delete({ where: { id: ticket.id } })
  await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id] } } })
  await closePrismaDatabase()
}
process.exit(process.exitCode || 0)
