import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer, type Socket } from 'node:net'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['postgresql:', 'postgres:'].includes(database.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) &&
  /^\/[a-zA-Z0-9_]+_pool_test$/.test(database.pathname) && !database.search && !database.hash)
process.env.JWT_SECRET ||= 'verification-resend-fixture-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/verification.js')
const { clearTransporterCache } = await import('../src/lib/mailer.js')
const { invalidateAllConfigCache } = await import('../src/lib/config-cache.js')
const tag = 'verification-resend-' + randomUUID().slice(0, 8), messages: string[] = [], sockets = new Set<Socket>()
let delivery: 'accepted' | 'held' | 'rejected' = 'accepted'
const held: Array<{ message: string; finish: () => void }> = []
const smtp = createServer(socket => {
  sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.setEncoding('utf8'); socket.write('220 isolated SMTP\r\n')
  let buffer = '', data = false, message = ''
  socket.on('data', chunk => {
    buffer += chunk
    while (buffer.includes('\r\n')) {
      const end = buffer.indexOf('\r\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 2)
      if (data) {
        if (line !== '.') { message += line + '\r\n'; continue }
        data = false
        const completed = message; message = ''
        if (delivery === 'held') held.push({ message: completed, finish: () => { messages.push(completed); socket.write('250 queued\r\n') } })
        else if (delivery === 'rejected') socket.write('550 fixture rejects delivery\r\n')
        else { messages.push(completed); socket.write('250 queued\r\n') }
        continue
      }
      if (/^EHLO|^HELO/.test(line)) socket.write('250-isolated\r\n250 AUTH PLAIN\r\n')
      else if (/^AUTH/.test(line)) socket.write('235 authenticated\r\n')
      else if (/^DATA/.test(line)) { data = true; socket.write('354 send mail\r\n') }
      else if (/^QUIT/.test(line)) socket.end('221 bye\r\n')
      else socket.write('250 ok\r\n')
    }
  })
})
await new Promise<void>(resolve => smtp.listen(0, '127.0.0.1', resolve))
const config = { smtp_enabled: 'true', smtp_host: '127.0.0.1', smtp_port: String((smtp.address() as { port: number }).port),
  smtp_secure: 'false', smtp_username: 'isolated', smtp_password: 'isolated-password', smtp_from_email: 'sender@example.test' }
const saved = await prisma.systemConfig.findMany({ where: { key: { in: Object.keys(config) } } })
const users = await Promise.all(['a', 'b'].map(letter => prisma.user.create({ data: {
  username: `${tag}-${letter}`, passwordHash: 'unusable-fixture', email: `${tag}-${letter}@example.test`
} })))
let actor = users[0]
const app = Fastify()
app.decorate('authenticate', async request => { request.user = { id: actor.id, username: actor.username, role: 'user', sid: tag, iat: Math.floor(Date.now() / 1000) + 1 } })
const request = () => app.inject({ method: 'POST', url: '/verification/request', payload: { operationType: 'disable_2fa' } })
const record = () => prisma.operationVerification.findFirstOrThrow({ where: { userId: actor.id, operationType: 'disable_2fa' }, orderBy: { createdAt: 'desc' } })
const codeFor = (email: string) => {
  const message = [...messages].reverse().find(value => value.includes('To: ' + email)); assert.ok(message)
  const decoded = message.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, value: string) => String.fromCharCode(parseInt(value, 16)))
  const code = decoded.match(/>\s*(\d{6})\s*</)?.[1]; assert.ok(code); return code
}
let failure: unknown
try {
  for (const [key, value] of Object.entries(config)) await prisma.systemConfig.upsert({ where: { key }, create: { key, value }, update: { value } })
  invalidateAllConfigCache(); clearTransporterCache(); await app.register(routes, { prefix: '/verification' })
  const initial = await request(); assert.equal(initial.statusCode, 200, initial.body)
  assert.equal(messages.length, 1)
  const original = await record(), oldCode = codeFor(actor.email!)
  await prisma.operationVerification.update({ where: { id: original.id }, data: { createdAt: new Date(Date.now() - 61_000) } })
  const resent = await request(); assert.equal(resent.statusCode, 200, resent.body)
  assert.equal(messages.length, 2, 'a real second SMTP message must be sent after the UI sixty-second interval')
  assert.equal(resent.json().alreadySent, false)
  assert.equal(resent.json().resendAfter, 60)
  const current = await record(); assert.notEqual(current.id, original.id)
  assert.ok(!resent.body.includes(oldCode) && !resent.body.includes(current.code) && !resent.body.includes(actor.email!))
  console.log('PASS after 61 seconds real SMTP receives a new message and response carries no code/hash/full email')
  await prisma.operationVerification.update({ where: { id: current.id }, data: { createdAt: new Date(Date.now() - 30_000) } })
  const duplicate = await request(); assert.equal(duplicate.statusCode, 200)
  assert.equal(messages.length, 2)
  assert.equal(duplicate.json().alreadySent, true)
  assert.ok(duplicate.json().resendAfter >= 28 && duplicate.json().resendAfter <= 30)
  assert.ok(duplicate.json().expiresIn > 500)
  await prisma.operationVerification.update({ where: { id: current.id }, data: { createdAt: new Date(Date.now() - 60_000) } })
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => request()))
  assert.ok(concurrent.every(response => response.statusCode === 200 ||
    (response.statusCode === 400 && response.json().code === 'VERIFICATION_PENDING')),
  'concurrent requests report accepted delivery or explicitly pending delivery')
  assert.equal(messages.length, 3, 'eight concurrent requests at the resend boundary produce one SMTP delivery')
  assert.equal(concurrent.filter(response => response.json().alreadySent === false).length, 1)
  assert.equal(await prisma.operationVerification.count({ where: { userId: actor.id, operationType: 'disable_2fa', verified: false } }), 1)
  console.log('PASS cooldown reports remaining seconds and exact 60-second concurrent boundary sends once')
  actor = users[1]
  const other = await request(); assert.equal(other.statusCode, 200); assert.equal(messages.length, 4)
  assert.equal(other.json().alreadySent, false)
  const bCode = codeFor(actor.email!)
  actor = users[0]
  const wrong = await app.inject({ method: 'POST', url: '/verification/verify', payload: { operationType: 'disable_2fa', code: bCode } })
  assert.equal(wrong.statusCode, 400, 'another account code cannot verify this account')
  const aCode = codeFor(actor.email!)
  const right = await app.inject({ method: 'POST', url: '/verification/verify', payload: { operationType: 'disable_2fa', code: aCode } })
  assert.equal(right.statusCode, 200); assert.equal(right.json().verified, true)
  const destroy = await prisma.operationVerification.create({ data: { userId: actor.id, operationType: 'delete_instance', resourceType: 'destroy-email:v1:isolated',
    channel: 'email', code: 'fixture-destroy-hash', expiresAt: new Date(Date.now() + 600_000) } })
  await request()
  assert.deepEqual(await prisma.operationVerification.findUniqueOrThrow({ where: { id: destroy.id } }), destroy)
  console.log('PASS account-isolated delivery/verification and generic request preserves destroy-email records')

  await prisma.operationVerification.deleteMany({ where: { userId: actor.id, operationType: 'disable_2fa' } })
  const beforeHeld = messages.length
  delivery = 'held'
  const sending = request()
  for (let attempt = 0; !held.length; attempt++) {
    assert.ok(attempt < 200, 'SMTP must reach held final acknowledgement')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  try {
    const duplicatePending = await request()
    assert.equal(duplicatePending.statusCode, 400, 'a pending SMTP delivery must not report an already-sent success')
    assert.equal(duplicatePending.json().code, 'VERIFICATION_PENDING')
    assert.equal(messages.length, beforeHeld)
    const raw = held[0].message.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, value: string) => String.fromCharCode(parseInt(value, 16)))
    const pendingCode = raw.match(/>\s*(\d{6})\s*</)?.[1]; assert.ok(pendingCode)
    const premature = await app.inject({ method: 'POST', url: '/verification/verify', payload: { operationType: 'disable_2fa', code: pendingCode } })
    assert.equal(premature.statusCode, 400, 'a not-yet-accepted delivery cannot grant verification')
    const pendingRecord = await record()
    await prisma.operationVerification.update({ where: { id: pendingRecord.id }, data: { createdAt: new Date(Date.now() - 61_000) } })
    const stillSending = await request()
    assert.equal(stillSending.statusCode, 400, 'crossing resend interval must not overlap an in-flight delivery')
    assert.equal(stillSending.json().code, 'VERIFICATION_PENDING')
    await prisma.operationVerification.delete({ where: { id: pendingRecord.id } })
    const removedSending = await request()
    assert.equal(removedSending.statusCode, 400, 'in-flight gate survives removal of its database marker')
    assert.equal(removedSending.json().code, 'VERIFICATION_PENDING')
    await prisma.operationVerification.create({ data: pendingRecord })
  } finally { held.splice(0).forEach(item => item.finish()) }
  const sent = await sending
  assert.equal(sent.statusCode, 200); assert.equal(messages.length, beforeHeld + 1)
  const deliveredCode = codeFor(actor.email!)
  const verifiedDelivery = await app.inject({ method: 'POST', url: '/verification/verify', payload: { operationType: 'disable_2fa', code: deliveredCode } })
  assert.equal(verifiedDelivery.statusCode, 200)
  console.log('PASS SMTP pending receipts cannot report success, verify early, or overlap after sixty seconds; acknowledgement enables verification')

  await prisma.operationVerification.deleteMany({ where: { userId: actor.id, operationType: 'disable_2fa' } })
  delivery = 'rejected'
  const rejected = await request(); assert.equal(rejected.statusCode, 400)
  assert.equal(rejected.json().code, 'SEND_FAILED')
  const failedRecord = await record()
  delivery = 'accepted'
  const failedCooldown = await request(); assert.equal(failedCooldown.statusCode, 400)
  assert.equal(failedCooldown.json().code, 'VERIFICATION_RATE_LIMITED', 'failed delivery preserves its resend budget')
  assert.equal(messages.length, beforeHeld + 1)
  await prisma.operationVerification.update({ where: { id: failedRecord.id }, data: { createdAt: new Date(Date.now() - 61_000) } })
  const retryDelivery = await request(); assert.equal(retryDelivery.statusCode, 200)
  assert.equal(messages.length, beforeHeld + 2)
  assert.deepEqual(await prisma.operationVerification.findUniqueOrThrow({ where: { id: destroy.id } }), destroy)
  console.log('PASS rejected SMTP keeps sixty-second cooldown and retry succeeds afterwards without changing destroy-email records')

  await prisma.operationVerification.deleteMany({ where: { userId: actor.id, operationType: 'disable_2fa' } })
  const interrupted = await prisma.operationVerification.create({ data: { userId: actor.id, operationType: 'disable_2fa',
    channel: 'email', code: 'sha256:interrupted-fixture', attempts: 6, expiresAt: new Date(Date.now() + 600_000),
    createdAt: new Date(Date.now() - 30_000) } })
  const interruptedCooldown = await request()
  assert.equal(interruptedCooldown.statusCode, 400); assert.equal(interruptedCooldown.json().code, 'VERIFICATION_RATE_LIMITED')
  assert.equal((await prisma.operationVerification.findUniqueOrThrow({ where: { id: interrupted.id } })).attempts, 7)
  assert.equal(messages.length, beforeHeld + 2)
  await prisma.operationVerification.update({ where: { id: interrupted.id }, data: { createdAt: new Date(Date.now() - 61_000) } })
  assert.equal((await request()).statusCode, 200)
  assert.equal(messages.length, beforeHeld + 3)
  console.log('PASS interrupted-process pending marker cannot prove delivery and recovers after the resend cooldown')
} catch (error) { failure = error } finally {
  held.splice(0).forEach(item => item.finish())
  await app.close(); clearTransporterCache()
  await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } })
  await prisma.systemConfig.deleteMany({ where: { key: { in: Object.keys(config) } } })
  for (const row of saved) await prisma.systemConfig.create({ data: row })
  invalidateAllConfigCache()
  for (const socket of sockets) socket.destroy()
  await new Promise<void>(resolve => smtp.close(() => resolve())); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
