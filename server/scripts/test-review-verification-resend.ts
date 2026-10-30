import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer, type Socket } from 'node:net'
import Fastify from 'fastify'
import type { Prisma } from '@prisma/client'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['postgresql:', 'postgres:'].includes(database.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) &&
  /^\/[a-zA-Z0-9_]+_pool_test$/.test(database.pathname) && !database.search && !database.hash)
process.env.JWT_SECRET ||= 'verification-resend-fixture-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/verification.js')
const { clearTransporterCache } = await import('../src/lib/mailer.js')
const { invalidateAllConfigCache } = await import('../src/lib/config-cache.js')
const { claimOperationVerificationRequirement, isOperationVerified, cleanupExpiredVerifications } = await import('../src/lib/operation-verification.js')
const { sendVerificationNotification } = await import('../src/lib/notifier.js')
const { accountOperationVerificationBinding } = await import('../src/db/operation-verification-binding.js')
const tag = 'verification-resend-' + randomUUID().slice(0, 8), messages: string[] = [], sockets = new Set<Socket>()
const originalFetch = globalThis.fetch
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
let sessionId = tag, issuedAt = Math.floor(Date.now() / 1000) + 1
const currentActor = () => ({ id: actor.id, sid: sessionId, iat: issuedAt })
const app = Fastify()
app.decorate('authenticate', async request => { request.user = { id: actor.id, username: actor.username, role: 'user', sid: sessionId, iat: issuedAt } })
const request = () => app.inject({ method: 'POST', url: '/verification/request', payload: { operationType: 'disable_2fa' } })
app.post('/fixture/claim-resource', async () => claimOperationVerificationRequirement(actor.id, 'reinstall_instance', 910001))
const record = () => prisma.operationVerification.findFirstOrThrow({ where: { userId: actor.id, operationType: 'disable_2fa' }, orderBy: { createdAt: 'desc' } })
const codeFor = (email: string) => {
  const message = [...messages].reverse().find(value => value.includes('To: ' + email)); assert.ok(message)
  const decoded = message.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, value: string) => String.fromCharCode(parseInt(value, 16)))
  const code = decoded.match(/>\s*(\d{6})\s*</)?.[1]; assert.ok(code); return code
}
async function queuedRequest(mutate: (tx: Prisma.TransactionClient) => Promise<unknown>, run = request) {
  let release!: () => void, ready!: (pid: number) => void, rejectReady!: (err: unknown) => void
  const hold = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<number>((resolve, reject) => { ready = resolve; rejectReady = reject })
  const blocker = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.id} FOR UPDATE`
    await mutate(tx)
    const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
    ready(row.pid); await hold
  }, { timeout: 15000 })
  void blocker.catch(rejectReady)
  const pid = await started
  let settled = false, blocked = false
  const pending = run().then(response => { settled = true; return response })
  try {
    const end = Date.now() + 3500
    while (!settled && Date.now() < end) {
      const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`
      if (Number(row.count)) { blocked = true; break }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  } finally { release(); await blocker }
  return { blocked, response: await pending }
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
    const crossOperationSending = await app.inject({ method: 'POST', url: '/verification/request', payload: { operationType: 'change_password' } })
    assert.equal(crossOperationSending.statusCode, 400); assert.equal(crossOperationSending.json().code, 'VERIFICATION_PENDING')
    assert.equal(held.length, 1, 'a removed pending row and elapsed cooldown cannot allow another operation to send in parallel')
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
  assert.equal((await app.inject({ method: 'POST', url: '/verification/request', payload: { operationType: 'change_password' } })).json().code, 'VERIFICATION_RATE_LIMITED',
    'delivery failure cannot be bypassed by switching sensitive operations')
  assert.equal(messages.length, beforeHeld + 1)
  await prisma.operationVerification.update({ where: { id: failedRecord.id }, data: { createdAt: new Date(Date.now() - 61_000) } })
  const retryDelivery = await request(); assert.equal(retryDelivery.statusCode, 200)
  assert.equal(messages.length, beforeHeld + 2)
  assert.deepEqual(await prisma.operationVerification.findUniqueOrThrow({ where: { id: destroy.id } }), destroy)
  console.log('PASS rejected SMTP keeps sixty-second cooldown and retry succeeds afterwards without changing destroy-email records')

  await prisma.operationVerification.deleteMany({ where: { userId: actor.id, operationType: 'disable_2fa' } })
  const interrupted = await prisma.operationVerification.create({ data: { userId: actor.id, operationType: 'disable_2fa',
    resourceType: accountOperationVerificationBinding(currentActor(), actor.email),
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

  await prisma.operationVerification.deleteMany({ where: { userId: actor.id, operationType: 'disable_2fa' } })
  await request()
  const beforeExhausted = messages.length
  for (let attempt = 0; attempt < 5; attempt++) {
    const wrongAttempt = await app.inject({ method: 'POST', url: '/verification/verify', payload: { operationType: 'disable_2fa', code: '000000' } })
    assert.equal(wrongAttempt.statusCode, 400)
  }
  const exhaustedCooldown = await request()
  assert.equal(exhaustedCooldown.statusCode, 400, 'exhausting verification attempts must not reset the resend budget')
  assert.equal(exhaustedCooldown.json().code, 'VERIFICATION_RATE_LIMITED')
  assert.equal((await app.inject({ method: 'POST', url: '/verification/request', payload: { operationType: 'change_password' } })).json().code, 'VERIFICATION_RATE_LIMITED',
    'exhausted attempts cannot be bypassed by switching sensitive operations')
  assert.equal(messages.length, beforeExhausted)
  const exhausted = await record(); assert.equal(exhausted.attempts, 5)
  const exhaustedCode = codeFor(actor.email!)
  const exhaustedVerify = await app.inject({ method: 'POST', url: '/verification/verify', payload: { operationType: 'disable_2fa', code: exhaustedCode } })
  assert.equal(exhaustedVerify.statusCode, 400)
  await prisma.operationVerification.update({ where: { id: exhausted.id }, data: { createdAt: new Date(Date.now() - 61_000) } })
  assert.equal((await request()).statusCode, 200)
  const concurrentAttemptRecord = await record()
  const concurrentWrong = await Promise.all(Array.from({ length: 8 }, () => app.inject({ method: 'POST', url: '/verification/verify',
    payload: { operationType: 'disable_2fa', code: '000000' } })))
  assert.ok(concurrentWrong.every(response => response.statusCode === 400))
  assert.equal((await prisma.operationVerification.findUniqueOrThrow({ where: { id: concurrentAttemptRecord.id } })).attempts, 5)
  assert.equal((await request()).json().code, 'VERIFICATION_RATE_LIMITED')
  assert.equal(messages.length, beforeExhausted + 1)
  console.log('PASS exhausted and concurrent wrong attempts remain capped at five and retain sixty-second resend cooldown')

  await prisma.operationVerification.deleteMany({ where: { userId: actor.id, operationType: 'disable_2fa' } })
  await request()
  const beforeConsume = messages.length, verificationCode = codeFor(actor.email!)
  assert.equal((await app.inject({ method: 'POST', url: '/verification/verify', payload: { operationType: 'disable_2fa', code: verificationCode } })).statusCode, 200)
  const afterVerification = await request()
  assert.equal(afterVerification.statusCode, 400, 'verification itself must not reset the sixty-second send budget')
  assert.equal(afterVerification.json().code, 'VERIFICATION_RATE_LIMITED')
  assert.equal(messages.length, beforeConsume)
  const consumed = await Promise.all(Array.from({ length: 8 }, () => claimOperationVerificationRequirement(actor.id, 'disable_2fa', undefined, currentActor())))
  assert.equal(consumed.filter(result => result.verified).length, 1)
  assert.equal(await isOperationVerified(actor.id, 'disable_2fa', undefined, currentActor()), false)
  const consumedRecord = await record()
  assert.equal(consumedRecord.verifiedAt, null)
  const afterConsumption = await request()
  assert.equal(afterConsumption.statusCode, 400, 'atomic consumption must preserve the resend timestamp')
  assert.equal(afterConsumption.json().code, 'VERIFICATION_RATE_LIMITED')
  assert.equal((await app.inject({ method: 'POST', url: '/verification/request', payload: { operationType: 'change_password' } })).json().code, 'VERIFICATION_RATE_LIMITED',
    'grant consumption cannot be bypassed by switching sensitive operations')
  assert.equal(messages.length, beforeConsume)
  await prisma.operationVerification.update({ where: { id: consumedRecord.id }, data: { createdAt: new Date(Date.now() - 61_000) } })
  assert.equal((await request()).statusCode, 200)
  assert.equal(messages.length, beforeConsume + 1)
  assert.equal((await claimOperationVerificationRequirement(actor.id, 'disable_2fa', undefined, currentActor())).verified, false)
  console.log('PASS verified and single-use consumed grants retain sixty-second send history; new delivery cannot revive the consumed grant')

  const deliveries: Array<{ chat: string; text: string }> = []
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://api.telegram.org/botfixture-token/sendMessage', 'verification stays on its captured transport')
    const body = JSON.parse(String(init?.body)) as { chat_id: string; text: string }
    deliveries.push({ chat: body.chat_id, text: body.text })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  const createChannel = (name: string, chatId: string, createdAt: number, extras: { isGlobal?: boolean; alertCategory?: string; enabled?: boolean } = {}) =>
    prisma.notificationChannel.create({ data: { userId: actor.id, name, type: 'telegram', config: { botToken: 'fixture-token', chatId },
      createdAt: new Date(createdAt), ...extras } })
  const now = Date.now()
  await createChannel('newer inserted first', '222222222', now - 10_000)
  const selected = await createChannel('oldest personal', '111111111', now - 20_000)
  await createChannel('same timestamp larger ID', '777777777', now - 20_000)
  await createChannel('global', '333333333', now - 40_000, { isGlobal: true })
  await createChannel('administrator alert', '444444444', now - 50_000, { alertCategory: 'host' })
  await createChannel('disabled', '555555555', now - 60_000, { enabled: false })
  await prisma.operationVerification.updateMany({ where: { userId: actor.id, operationType: 'disable_2fa' }, data: { createdAt: new Date(Date.now() - 61_000) } })
  const notifyRequest = (resourceId: number) => app.inject({ method: 'POST', url: '/verification/request',
    payload: { operationType: 'reinstall_instance', resourceId } })
  const notified = await notifyRequest(910001)
  assert.equal(notified.statusCode, 200, notified.body)
  assert.equal(notified.json().maskedTarget, 'Telegram (111111***)', 'only the selected personal target is described')
  assert.deepEqual(deliveries.map(value => value.chat), ['111111111'], 'actual transport receives the same oldest personal target shown by the route')
  const notifiedRecord = await prisma.operationVerification.findFirstOrThrow({ where: { userId: actor.id, operationType: 'reinstall_instance', resourceId: 910001 } })
  assert.equal(notifiedRecord.channel, 'telegram'); assert.equal(notifiedRecord.attempts, 0)
  assert.ok(notifiedRecord.resourceType?.startsWith('notification-target:v1:') && !notifiedRecord.resourceType.includes('fixture-token') && !notifiedRecord.resourceType.includes('111111111'))
  const notificationCode = deliveries[0].text.match(/\d{6}/)?.[0]; assert.ok(notificationCode)
  assert.ok(!notified.body.includes(notificationCode) && !notified.body.includes('fixture-token') && !notified.body.includes('111111111'))
  console.log('PASS deterministic personal channel selection excludes global/administrator/disabled channels and matches the actual transport')

  const notifyDuplicate = await notifyRequest(910001)
  assert.equal(notifyDuplicate.statusCode, 200); assert.equal(notifyDuplicate.json().alreadySent, true)
  assert.equal(notifyDuplicate.json().maskedTarget, notified.json().maskedTarget); assert.equal(deliveries.length, 1)

  await prisma.notificationChannel.update({ where: { id: selected.id }, data: { enabled: false, config: { botToken: 'fixture-token', chatId: '999999999' } } })
  const changedTargetVerify = await app.inject({ method: 'POST', url: '/verification/verify', payload: {
    operationType: 'reinstall_instance', resourceId: 910001, code: notificationCode
  } })
  assert.equal(changedTargetVerify.statusCode, 400, 'a changed personal notification target must reject the old code without another request')
  assert.equal((await prisma.operationVerification.findUniqueOrThrow({ where: { id: notifiedRecord.id } })).attempts, 0)
  await prisma.operationVerification.update({ where: { id: notifiedRecord.id }, data: { verified: true, verifiedAt: new Date() } })
  const changedTargetCheck = await app.inject({ method: 'GET', url: '/verification/check?operationType=reinstall_instance&resourceId=910001' })
  assert.equal(changedTargetCheck.json().verified, false)
  assert.equal((await claimOperationVerificationRequirement(actor.id, 'reinstall_instance', 910001)).verified, false,
    'a changed notification target cannot consume a previous-target grant')
  assert.ok((await prisma.operationVerification.findUniqueOrThrow({ where: { id: notifiedRecord.id } })).verifiedAt)
  for (const phase of ['verify', 'check', 'claim'] as const) {
    await prisma.notificationChannel.update({ where: { id: selected.id }, data: {
      enabled: true, config: { botToken: 'fixture-token', chatId: '111111111' }
    } })
    await prisma.operationVerification.update({ where: { id: notifiedRecord.id }, data: {
      verified: phase !== 'verify', verifiedAt: phase === 'verify' ? null : new Date()
    } })
    const queued = await queuedRequest(tx => tx.notificationChannel.update({ where: { id: selected.id }, data: {
      config: { botToken: 'fixture-token', chatId: '999999999' }
    } }), () => phase === 'verify' ? app.inject({ method: 'POST', url: '/verification/verify', payload: {
      operationType: 'reinstall_instance', resourceId: 910001, code: notificationCode
    } }) : phase === 'check' ? app.inject({ method: 'GET', url: '/verification/check?operationType=reinstall_instance&resourceId=910001' })
      : app.inject({ method: 'POST', url: '/fixture/claim-resource' }))
    assert.equal(queued.blocked, true, `${phase} must wait for the actual current notification row mutation`)
    if (phase === 'verify') assert.equal(queued.response.statusCode, 400)
    else assert.equal(queued.response.json().verified, false)
    const unchanged = await prisma.operationVerification.findUniqueOrThrow({ where: { id: notifiedRecord.id } })
    assert.equal(unchanged.attempts, 0)
    assert.equal(unchanged.verified, phase !== 'verify')
    assert.equal(Boolean(unchanged.verifiedAt), phase !== 'verify')
  }
  await prisma.notificationChannel.update({ where: { id: selected.id }, data: {
    enabled: true, config: { botToken: 'fixture-token', chatId: '111111111' }
  } })
  const resourceClaims = await Promise.all(Array.from({ length: 8 }, () => claimOperationVerificationRequirement(actor.id, 'reinstall_instance', 910001)))
  assert.equal(resourceClaims.filter(result => result.verified).length, 1)
  assert.equal((await prisma.operationVerification.findUniqueOrThrow({ where: { id: notifiedRecord.id } })).verifiedAt, null)
  await prisma.notificationChannel.update({ where: { id: selected.id }, data: { enabled: false, config: { botToken: 'fixture-token', chatId: '999999999' } } })
  await prisma.operationVerification.update({ where: { id: notifiedRecord.id }, data: { verified: false, verifiedAt: null } })
  console.log('PASS changed personal targets reject old codes/checks/claims before resend, actual row-lock mutations recheck each phase, and eight current-target claims consume once')
  const changedDuplicate = await notifyRequest(910001)
  assert.equal(changedDuplicate.statusCode, 400); assert.equal(changedDuplicate.json().code, 'VERIFICATION_RATE_LIMITED')
  assert.ok(!changedDuplicate.body.includes('777777') && !changedDuplicate.body.includes('999999') && !changedDuplicate.body.includes('maskedTarget'))
  assert.equal(deliveries.length, 1)
  assert.equal((await prisma.operationVerification.findUniqueOrThrow({ where: { id: notifiedRecord.id } })).verifiedAt, null)
  assert.equal((await app.inject({ method: 'POST', url: '/verification/verify', payload: { operationType: 'reinstall_instance', resourceId: 910001, code: notificationCode } })).statusCode, 400)
  console.log('PASS changed targets cannot mislabel a prior delivery, revive its code or bypass the resend budget')
  const fixed = await sendVerificationNotification(selected, { operationName: 'Snapshot fixture', code: '123456', expiresInMinutes: 10, username: actor.username })
  assert.equal(fixed.success, true)
  assert.equal(deliveries.at(-1)?.chat, '111111111', 'a captured delivery must not reselect or reread a changed notification target')
  console.log('PASS a prepared notification snapshot retains its original transport/config throughout delivery')

  await prisma.notificationChannel.deleteMany({ where: { userId: actor.id, isGlobal: false, alertCategory: null } })
  const noPersonal = await notifyRequest(910002)
  assert.equal(noPersonal.statusCode, 200); assert.equal(noPersonal.json().required, false)
  assert.equal(deliveries.length, 2)
  assert.equal(await prisma.operationVerification.count({ where: { userId: actor.id, resourceId: 910002 } }), 0)
  console.log('PASS administrator-only channels cannot impose or receive personal resource verification')

  const emailTarget = `${tag}-channel@example.test`
  await prisma.operationVerification.update({ where: { id: notifiedRecord.id }, data: { createdAt: new Date(Date.now() - 61_000) } })
  await prisma.notificationChannel.create({ data: { userId: actor.id, name: 'personal email', type: 'email', config: { email: emailTarget } } })
  const beforeChannelMail = messages.length
  const mailed = await notifyRequest(910003)
  assert.equal(mailed.statusCode, 200, mailed.body)
  assert.equal(mailed.json().channel, 'email'); assert.equal(mailed.json().maskedTarget, `${emailTarget.slice(0, 2)}***@example.test`)
  assert.equal(messages.length, beforeChannelMail + 1)
  assert.ok(messages.at(-1)?.includes('To: ' + emailTarget), 'resource email delivery uses the configured channel address')
  assert.ok(!mailed.body.includes(emailTarget))
  console.log('PASS configured personal email receives real SMTP delivery and the response masks the actual recipient')

  const personalEmail = await prisma.notificationChannel.findFirstOrThrow({ where: { userId: actor.id, name: 'personal email' } })
  await prisma.notificationChannel.update({ where: { id: personalEmail.id }, data: { config: 'invalid-json' } })
  const invalidConfig = await notifyRequest(910004)
  assert.equal(invalidConfig.statusCode, 400); assert.equal(invalidConfig.json().code, 'SEND_FAILED')
  assert.equal(messages.length, beforeChannelMail + 1)
  assert.equal(await prisma.operationVerification.count({ where: { userId: actor.id, resourceId: 910004 } }), 0)
  console.log('PASS malformed stored notification configuration fails without issuing an eligible code or sending')

  await prisma.operationVerification.deleteMany({ where: { userId: actor.id, NOT: { resourceType: { startsWith: 'destroy-email:v1:' } } } })
  await prisma.operationVerification.deleteMany({ where: { userId: actor.id, resourceType: null } })
  const beforeAccountBudget = messages.length
  const accountFirst = await request(); assert.equal(accountFirst.statusCode, 200, accountFirst.body)
  const otherOperation = await app.inject({ method: 'POST', url: '/verification/request', payload: { operationType: 'change_password' } })
  assert.equal(otherOperation.statusCode, 400, 'switching sensitive operations cannot bypass the account send budget')
  assert.equal(otherOperation.json().code, 'VERIFICATION_RATE_LIMITED'); assert.ok(otherOperation.json().resendAfter > 0)
  assert.equal(messages.length, beforeAccountBudget + 1)
  console.log('PASS different sensitive operations share the same account sixty-second send budget')

  await prisma.notificationChannel.update({ where: { id: personalEmail.id }, data: { config: { email: emailTarget } } })
  const crossResource = await notifyRequest(910005)
  assert.equal(crossResource.statusCode, 400); assert.equal(crossResource.json().code, 'VERIFICATION_RATE_LIMITED')
  assert.equal(messages.length, beforeAccountBudget + 1)
  actor = users[1]
  await prisma.operationVerification.deleteMany({ where: { userId: actor.id } })
  const independentAccount = await request(); assert.equal(independentAccount.statusCode, 200)
  assert.equal(messages.length, beforeAccountBudget + 2)
  actor = users[0]
  await prisma.operationVerification.updateMany({ where: { userId: actor.id, operationType: 'disable_2fa' }, data: { createdAt: new Date(Date.now() - 61_000) } })
  const beforeMixed = messages.length
  const mixed = await Promise.all(Array.from({ length: 8 }, (_, i) => app.inject({ method: 'POST', url: '/verification/request',
    payload: i % 2 ? { operationType: 'change_password' } : { operationType: 'reinstall_instance', resourceId: 920000 + i } })))
  assert.equal(mixed.filter(response => response.statusCode === 200).length, 1)
  assert.ok(mixed.every(response => response.statusCode === 200 || ['VERIFICATION_PENDING', 'VERIFICATION_RATE_LIMITED'].includes(response.json().code)))
  assert.equal(messages.length, beforeMixed + 1, 'mixed operation/resource requests deliver once under an account lock')
  const mixedRecord = await prisma.operationVerification.findFirstOrThrow({ where: { userId: actor.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  assert.equal(mixedRecord.attempts, 0)
  await prisma.operationVerification.update({ where: { id: mixedRecord.id }, data: { expiresAt: new Date(Date.now() - 1) } })
  await cleanupExpiredVerifications()
  assert.ok(await prisma.operationVerification.findUnique({ where: { id: mixedRecord.id } }), 'recent expired rows still retain the send budget')
  const expiredBudget = await request(); assert.equal(expiredBudget.statusCode, 400); assert.equal(expiredBudget.json().code, 'VERIFICATION_RATE_LIMITED')
  assert.equal(messages.length, beforeMixed + 1)
  await prisma.operationVerification.update({ where: { id: mixedRecord.id }, data: { createdAt: new Date(Date.now() - 61_000) } })
  await cleanupExpiredVerifications()
  assert.equal(await prisma.operationVerification.findUnique({ where: { id: mixedRecord.id } }), null)
  const resumedAccount = await request(); assert.equal(resumedAccount.statusCode, 200)
  assert.equal(messages.length, beforeMixed + 2)
  console.log('PASS resource switching/mixed eight-way concurrency share one account budget, other accounts remain independent, and expiry cleanup retains recent send history')

  await prisma.operationVerification.updateMany({ where: { userId: actor.id, operationType: 'disable_2fa' }, data: { createdAt: new Date(Date.now() - 61_000) } })
  await prisma.user.update({ where: { id: actor.id }, data: { status: 'banned' } })
  const beforeRevoked = messages.length
  const suspendedRequest = await request()
  assert.equal(suspendedRequest.statusCode, 400, 'an authenticated request must recheck current account status before preparing mail')
  assert.equal(suspendedRequest.json().code, 'AUTHENTICATION_STATE_CHANGED')
  assert.equal(messages.length, beforeRevoked)
  await prisma.user.update({ where: { id: actor.id }, data: { status: 'active' } })
  await prisma.tokenInvalidation.create({ data: { userId: actor.id, sessionId, invalidatedAt: issuedAt } })
  const revokedRequest = await request()
  assert.equal(revokedRequest.statusCode, 400); assert.equal(revokedRequest.json().code, 'AUTHENTICATION_STATE_CHANGED')
  assert.equal(messages.length, beforeRevoked)
  sessionId += '-fresh'; issuedAt += 1
  assert.equal((await request()).statusCode, 200)
  assert.equal(messages.length, beforeRevoked + 1)
  console.log('PASS current banned/revoked sessions cannot send, while a fresh current session can request normally')

  for (const mode of ['banned', 'email', 'session', 'account'] as const) {
    await prisma.operationVerification.updateMany({ where: { userId: actor.id, operationType: 'disable_2fa' }, data: { createdAt: new Date(Date.now() - 61_000) } })
    const beforeQueued: number = messages.length
    const result = await queuedRequest(tx => mode === 'banned'
      ? tx.user.update({ where: { id: actor.id }, data: { status: 'banned' } })
      : mode === 'email' ? tx.user.update({ where: { id: actor.id }, data: { email: `${tag}-changed@example.test` } })
      : tx.tokenInvalidation.upsert({ where: { userId_sessionId: { userId: actor.id, sessionId: mode === 'session' ? sessionId : '__USER_LEVEL__' } },
        create: { userId: actor.id, sessionId: mode === 'session' ? sessionId : '__USER_LEVEL__', invalidatedAt: issuedAt }, update: { invalidatedAt: issuedAt } }))
    assert.equal(result.blocked, true, mode + ' must wait on the actual account row lock')
    assert.equal(result.response.statusCode, 400, result.response.body)
    assert.equal(result.response.json().code, 'AUTHENTICATION_STATE_CHANGED')
    assert.equal(messages.length, beforeQueued, 'queued ' + mode + ' change must send no mail')
    await prisma.user.update({ where: { id: actor.id }, data: { status: 'active', email: actor.email } })
    sessionId += '-next'; issuedAt += 1
  }
  console.log('PASS actual account row-lock waits recheck banned status, email and session/account revocations before issuing or sending')

  for (const mode of ['banned', 'email', 'session'] as const) {
    await prisma.operationVerification.updateMany({ where: { userId: actor.id, operationType: 'disable_2fa' }, data: { createdAt: new Date(Date.now() - 61_000) } })
    delivery = 'held'
    const pending = request()
    for (let attempt = 0; !held.length; attempt++) { assert.ok(attempt < 200); await new Promise(resolve => setTimeout(resolve, 10)) }
    if (mode === 'banned') await prisma.user.update({ where: { id: actor.id }, data: { status: 'banned' } })
    else if (mode === 'email') await prisma.user.update({ where: { id: actor.id }, data: { email: `${tag}-inflight@example.test` } })
    else await prisma.tokenInvalidation.create({ data: { userId: actor.id, sessionId, invalidatedAt: issuedAt } })
    held.splice(0).forEach(item => item.finish())
    const response = await pending
    assert.equal(response.statusCode, 400); assert.equal(response.json().code, 'AUTHENTICATION_STATE_CHANGED')
    const inactive = await record(); assert.equal(inactive.attempts, 7); assert.equal(inactive.verified, false)
    assert.equal((await app.inject({ method: 'POST', url: '/verification/verify', payload: { operationType: 'disable_2fa', code: codeFor(actor.email!) } })).statusCode, 400)
    await prisma.user.update({ where: { id: actor.id }, data: { status: 'active', email: actor.email } })
    delivery = 'accepted'; sessionId += '-after'; issuedAt += 1
  }
  console.log('PASS SMTP acknowledgement after banned status/email/session changes cannot activate an eligible code')

  await prisma.operationVerification.updateMany({ where: { userId: actor.id, operationType: 'disable_2fa' }, data: { createdAt: new Date(Date.now() - 61_000) } })
  assert.equal((await request()).statusCode, 200)
  const issuedRecord = await record()
  let issuedCode = codeFor(actor.email!)
  await prisma.user.update({ where: { id: actor.id }, data: { status: 'banned' } })
  const deniedVerify = await app.inject({ method: 'POST', url: '/verification/verify', payload: { operationType: 'disable_2fa', code: issuedCode } })
  assert.equal(deniedVerify.statusCode, 400, 'a banned actor cannot promote a delivered code to a verified grant')
  assert.equal(deniedVerify.json().code, 'AUTHENTICATION_STATE_CHANGED')
  const deniedWrong = await app.inject({ method: 'POST', url: '/verification/verify', payload: { operationType: 'disable_2fa', code: '000000' } })
  assert.equal(deniedWrong.statusCode, 400); assert.equal(deniedWrong.json().code, 'AUTHENTICATION_STATE_CHANGED')
  assert.deepEqual(await prisma.operationVerification.findUniqueOrThrow({ where: { id: issuedRecord.id } }), issuedRecord,
    'rejected authentication cannot consume code attempts or verify the grant')
  await prisma.user.update({ where: { id: actor.id }, data: { status: 'active' } })
  await prisma.tokenInvalidation.create({ data: { userId: actor.id, sessionId, invalidatedAt: issuedAt } })
  const invalidatedVerify = await app.inject({ method: 'POST', url: '/verification/verify', payload: { operationType: 'disable_2fa', code: issuedCode } })
  assert.equal(invalidatedVerify.statusCode, 400); assert.equal(invalidatedVerify.json().code, 'AUTHENTICATION_STATE_CHANGED')
  console.log('PASS delivered verification checks reject banned or revoked actors without changing the pending record')

  sessionId += '-verify'; issuedAt += 1
  const submitCode = () => app.inject({ method: 'POST', url: '/verification/verify', payload: { operationType: 'disable_2fa', code: issuedCode } })
  for (const mode of ['banned', 'session', 'account'] as const) {
    const result = await queuedRequest(tx => mode === 'banned' ? tx.user.update({ where: { id: actor.id }, data: { status: 'banned' } })
      : tx.tokenInvalidation.upsert({ where: { userId_sessionId: { userId: actor.id, sessionId: mode === 'session' ? sessionId : '__USER_LEVEL__' } },
        create: { userId: actor.id, sessionId: mode === 'session' ? sessionId : '__USER_LEVEL__', invalidatedAt: issuedAt }, update: { invalidatedAt: issuedAt } }), submitCode)
    assert.equal(result.blocked, true); assert.equal(result.response.statusCode, 400); assert.equal(result.response.json().code, 'AUTHENTICATION_STATE_CHANGED')
    assert.deepEqual(await prisma.operationVerification.findUniqueOrThrow({ where: { id: issuedRecord.id } }), issuedRecord)
    await prisma.user.update({ where: { id: actor.id }, data: { status: 'active' } })
    sessionId += '-current'; issuedAt += 1
  }
  await prisma.operationVerification.update({ where: { id: issuedRecord.id }, data: { createdAt: new Date(Date.now() - 61_000) } })
  assert.equal((await request()).statusCode, 200)
  issuedCode = codeFor(actor.email!)
  const concurrentVerified = await Promise.all(Array.from({ length: 8 }, () => submitCode()))
  assert.equal(concurrentVerified.filter(response => response.statusCode === 200).length, 1)
  assert.ok(concurrentVerified.every(response => response.statusCode === 200 || response.statusCode === 400))
  assert.equal((await record()).attempts, 0)
  console.log('PASS verification waits on current account changes and eight concurrent correct codes promote exactly one grant')

  await prisma.operationVerification.updateMany({ where: { userId: actor.id, operationType: 'disable_2fa' }, data: { createdAt: new Date(Date.now() - 61_000) } })
  assert.equal((await request()).statusCode, 200)
  const boundCode = codeFor(actor.email!), boundRecord = await record(), originalSession = sessionId
  assert.ok(boundRecord.resourceType?.startsWith('account-session:v1:') && !boundRecord.resourceType.includes(originalSession) && !boundRecord.resourceType.includes(actor.email!))
  sessionId += '-second-login'
  const secondSessionVerify = await app.inject({ method: 'POST', url: '/verification/verify', payload: { operationType: 'disable_2fa', code: boundCode } })
  assert.equal(secondSessionVerify.statusCode, 400, 'another legitimate login cannot verify this session code')
  assert.equal((await prisma.operationVerification.findUniqueOrThrow({ where: { id: boundRecord.id } })).attempts, 0,
    'another session cannot consume this session attempt budget')
  const otherSessionRequest = await request()
  assert.equal(otherSessionRequest.statusCode, 400); assert.equal(otherSessionRequest.json().code, 'VERIFICATION_RATE_LIMITED')
  assert.equal((await prisma.operationVerification.findUniqueOrThrow({ where: { id: boundRecord.id } })).verified, false)
  sessionId = originalSession
  await prisma.user.update({ where: { id: actor.id }, data: { email: `${tag}-bound-changed@example.test` } })
  const changedEmailVerify = await app.inject({ method: 'POST', url: '/verification/verify', payload: { operationType: 'disable_2fa', code: boundCode } })
  assert.equal(changedEmailVerify.statusCode, 400, 'a previous recipient code cannot verify the current email')
  await prisma.user.update({ where: { id: actor.id }, data: { email: actor.email } })
  assert.equal((await app.inject({ method: 'POST', url: '/verification/verify', payload: { operationType: 'disable_2fa', code: boundCode } })).statusCode, 200)
  console.log('PASS account verification codes bind their original session and email without consuming another session attempts')

  assert.equal(await isOperationVerified(actor.id, 'disable_2fa', undefined, currentActor()), true)
  sessionId += '-other-check'
  const otherSessionCheck = await app.inject({ method: 'GET', url: '/verification/check?operationType=disable_2fa' })
  assert.equal(otherSessionCheck.statusCode, 200); assert.equal(otherSessionCheck.json().verified, false)
  assert.equal((await claimOperationVerificationRequirement(actor.id, 'disable_2fa', undefined, currentActor())).verified, false)
  sessionId = originalSession
  await prisma.user.update({ where: { id: actor.id }, data: { email: `${tag}-grant-email@example.test` } })
  assert.equal(await isOperationVerified(actor.id, 'disable_2fa', undefined, currentActor()), false)
  assert.equal((await claimOperationVerificationRequirement(actor.id, 'disable_2fa', undefined, currentActor())).verified, false)
  await prisma.user.update({ where: { id: actor.id }, data: { email: actor.email } })
  const boundClaims = await Promise.all(Array.from({ length: 8 }, () => claimOperationVerificationRequirement(actor.id, 'disable_2fa', undefined, currentActor())))
  assert.equal(boundClaims.filter(result => result.verified).length, 1)
  assert.equal((await record()).verifiedAt, null)
  console.log('PASS check/claim reject another session or email and the original bound grant consumes once under eight-way concurrency')

  await prisma.operationVerification.update({ where: { id: boundRecord.id }, data: { verified: false, verifiedAt: null, resourceType: null, code: '654321' } })
  const legacyVerify = await app.inject({ method: 'POST', url: '/verification/verify', payload: { operationType: 'disable_2fa', code: '654321' } })
  assert.equal(legacyVerify.statusCode, 400, 'legacy account codes lack trusted session/recipient binding and must be reissued')
  await prisma.operationVerification.update({ where: { id: boundRecord.id }, data: { verified: true, verifiedAt: new Date() } })
  assert.equal(await isOperationVerified(actor.id, 'disable_2fa', undefined, currentActor()), false)
  assert.equal((await claimOperationVerificationRequirement(actor.id, 'disable_2fa', undefined, currentActor())).verified, false)
  console.log('PASS unbound legacy account codes and grants cannot inherit a current session')
} catch (error) { failure = error } finally {
  globalThis.fetch = originalFetch
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
