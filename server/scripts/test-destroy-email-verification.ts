import assert from 'node:assert/strict'
import crypto, { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['postgresql:', 'postgres:'].includes(database.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) &&
  /^\/[a-zA-Z0-9_]+_pool_test$/.test(database.pathname) && !database.search && !database.hash, 'isolated local test database required')
process.env.JWT_SECRET ||= 'destroy-email-fixture-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { requestDestroyEmailVerification: requestCode, claimDestroyEmailVerification: claim } = await import('../src/lib/instance-destroy-verification.js')
const { default: routes } = await import('../src/routes/instance-destroy.js')
const { clearTransporterCache } = await import('../src/lib/mailer.js')
const { invalidateAllConfigCache } = await import('../src/lib/config-cache.js')
const { isOperationVerified, claimOperationVerificationRequirement, verifyOperationCode, requestOperationVerification, consumeOperationVerification } = await import('../src/lib/operation-verification.js')
const tag = 'destroy-email-' + randomUUID().slice(0, 8)
const messages: string[] = []
const sockets = new Set<import('node:net').Socket>()
let refuseMail = false
const smtp = createServer(socket => {
  sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.setEncoding('utf8')
  socket.write('220 isolated SMTP\r\n')
  let buffer = '', data = false, message = ''
  socket.on('data', chunk => {
    buffer += chunk
    while (buffer.includes('\r\n')) {
      const end = buffer.indexOf('\r\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 2)
      if (data) {
        if (line !== '.') { message += line + '\r\n'; continue }
        data = false
        if (refuseMail) socket.write('550 isolated delivery refused\r\n')
        else { messages.push(message); socket.write('250 queued\r\n') }
        message = ''; continue
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
const port = (smtp.address() as { port: number }).port
const config = { smtp_enabled: 'true', smtp_host: '127.0.0.1', smtp_port: String(port), smtp_secure: 'false',
  smtp_username: 'isolated', smtp_password: 'isolated-password', smtp_from_email: 'sender@example.test' }
const saved = await prisma.systemConfig.findMany({ where: { key: { in: Object.keys(config) } } })
const users = await Promise.all(['a', 'b'].map(letter => prisma.user.create({ data: {
  username: `${tag}-${letter}`, passwordHash: 'unusable-fixture', email: `${tag}-${letter}@example.test`
} })))
const actors = users.map(user => ({ id: user.id, username: user.username, role: 'user', sid: `${tag}-${user.id}`, iat: Math.floor(Date.now()/1000) + 1 }))
const host = await prisma.host.create({ data: { userId: users[0].id, name: tag, url: 'https://127.0.0.1:1', certPath: '/missing-fixture-cert', keyPath: '/missing-fixture-key' } })
const machines = await Promise.all([users[0], users[0], users[1]].map((user, i) => prisma.instance.create({ data: {
  userId: user.id, hostId: host.id, name: `${tag}-${i}`, incusId: `${tag}-${i}`, image: 'fixture/debian', status: 'stopped',
  cpu: 100, memory: 512, disk: 2048, dedicatedIpv4: true, dedicatedNetworkReady: true
} })))
const [a, a2, b] = machines.map(machine => machine.id)
const codeFor = (email: string) => {
  const message = messages.findLast(value => value.includes('To: ' + email))
  assert.ok(message, 'SMTP received account email')
  const decoded = message.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, value: string) => String.fromCharCode(parseInt(value, 16)))
  const code = decoded.match(/>\s*(\d{6})\s*</)?.[1]
  assert.ok(code, 'mail carries six-digit code')
  return code
}
const app = Fastify()
let actor = actors[0]
app.decorate('authenticate', async (request: any) => { request.user = { ...actor } })
app.decorate('authenticateUser', async (request: any) => { request.user = { ...actor } })
let failure: unknown
const originalRandom = crypto.randomInt
try {
  for (const [key, value] of Object.entries(config)) await prisma.systemConfig.upsert({ where: { key }, create: { key, value }, update: { value } })
  invalidateAllConfigCache(); clearTransporterCache()
  await app.register(routes, { prefix: '/instances' }); await app.ready()
  assert.equal((await app.inject({ method: 'POST', url: `/instances/${a}/destroy` })).statusCode, 400)
  assert.equal((await app.inject({ method: 'POST', url: '/instances/batch/destroy', payload: { instanceIds: [a, a2] } })).statusCode, 400)
  assert.equal((await claim(actors[0], [a], '000000')).success, false, 'absence of notification channels never bypasses email')
  // Force a random collision across actual concurrent A/B requests.
  let allocation = 0
  crypto.randomInt = ((...args: any[]) => ++allocation <= 2 ? 123456 : (originalRandom as any)(...args)) as typeof crypto.randomInt
  const results = await Promise.all([requestCode(actors[0], [a]), requestCode(actors[1], [b])])
  crypto.randomInt = originalRandom
  assert.ok(results.every(result => result.success), 'concurrent A/B mail request succeeds')
  const codeA = codeFor(users[0].email!), codeB = codeFor(users[1].email!)
  assert.notEqual(codeA, codeB, 'global allocation lock resolves forced equal random digits')
  for (const result of results) assert.deepEqual(Object.keys(result).sort(), ['channel', 'maskedTarget', 'resendAfter', 'success'])
  assert.ok(results.every(result => result.success && 'resendAfter' in result && result.resendAfter === 60), 'resend cooldown is sixty seconds')
  const sentAfterAB = messages.length
  assert.equal((await requestCode(actors[0], [a2])).success, false, 'changing target cannot bypass account cooldown')
  assert.equal((await requestCode({ ...actors[0], sid: 'new-session' }, [a])).success, false, 'changing session cannot bypass account cooldown')
  assert.equal((await requestCode(actors[0], [a])).success, true, 'same target reports existing mail without resending')
  assert.equal(messages.length, sentAfterAB, 'only one actual email within sixty seconds per account')
  const beforeGeneric = await prisma.operationVerification.findFirstOrThrow({ where: { userId: actors[0].id } })
  assert.equal((await verifyOperationCode(actors[0].id, 'delete_instance', codeA, a)).success, false, 'generic verifier cannot promote a destroy code')
  assert.equal((await requestOperationVerification(actors[0].id, 'delete_instance', a, beforeGeneric.resourceType!)).success, false, 'generic requests cannot create reserved destroy bindings')
  assert.deepEqual(await prisma.operationVerification.findUnique({ where: { id: beforeGeneric.id } }), beforeGeneric, 'generic verifier cannot change destroy attempts or lifetime')
  assert.equal((await claim(actors[0], [a], codeB)).success, false)
  assert.equal((await claim(actors[1], [b], codeA)).success, false)
  assert.equal((await claim(actors[0], [a2], codeA)).success, false)
  assert.equal((await claim({ ...actors[0], sid: 'another-session' }, [a], codeA)).success, false)
  assert.equal((await requestCode(actors[0], [b])).success, false, 'no email requested for another owner')
  await prisma.user.update({ where: { id: users[0].id }, data: { email: 'changed@example.test' } })
  assert.equal((await claim(actors[0], [a], codeA)).success, false, 'old mailbox grant cannot authorize new email')
  await prisma.user.update({ where: { id: users[0].id }, data: { email: users[0].email } })
  const oneUse = await Promise.all(Array.from({ length: 8 }, () => claim(actors[0], [a], codeA)))
  assert.equal(oneUse.filter(result => result.success).length, 1, 'eight concurrent consumers: exactly one succeeds')
  assert.equal((await claim(actors[0], [a], codeA)).success, false, 'consumed code cannot be replayed')
  assert.equal((await requestCode(actors[0], [a])).success, false, 'consumption cannot bypass sixty-second cooldown')
  await consumeOperationVerification(actors[0].id, 'delete_instance', a)
  assert.ok(await prisma.operationVerification.findUnique({ where: { id: beforeGeneric.id } }), 'generic consumption cannot erase destroy send budget')
  assert.equal(await isOperationVerified(actors[0].id, 'delete_instance', a), false, 'spent destroy code is not a generic verification grant')
  assert.equal((await claimOperationVerificationRequirement(actors[0].id, 'change_password')).verified, false)
  await prisma.operationVerification.deleteMany({ where: { userId: actors[0].id } })
  await requestCode(actors[0], [a, a2]); const batchCode = codeFor(users[0].email!)
  assert.equal((await claim(actors[0], [a], batchCode)).success, false, 'batch code cannot authorize a subset')
  assert.equal((await claim(actors[0], [a, b], batchCode)).success, false, 'batch code cannot authorize a changed set')
  assert.equal((await claim(actors[0], [a2, a], batchCode)).success, true, 'order does not change approved set')
  const reset = async () => { await prisma.operationVerification.deleteMany({ where: { userId: actors[0].id } }); await prisma.tokenInvalidation.deleteMany({ where: { userId: actors[0].id } }); await prisma.user.update({ where: { id: actors[0].id }, data: { status: 'active', email: users[0].email } }) }
  for (const mode of ['expired', 'attempts', 'revoked', 'banned', 'owner-changed', 'send-failed'] as const) {
    await reset(); refuseMail = mode === 'send-failed'
    const request = await requestCode(actors[0], [a]); refuseMail = false
    if (mode === 'send-failed') { assert.equal(request.success, false); assert.equal((await claim(actors[0], [a], '123456')).success, false); assert.equal((await requestCode(actors[0], [a2])).success, false, 'failed mail still keeps sixty-second limit'); continue }
    assert.equal(request.success, true); const code = codeFor(users[0].email!)
    if (mode === 'expired') await prisma.operationVerification.updateMany({ where: { userId: actors[0].id }, data: { createdAt: new Date(Date.now() - 11 * 60_000) } })
    if (mode === 'attempts') for (let i = 0; i < 5; i++) assert.equal((await claim(actors[0], [a], '000000')).success, false)
    if (mode === 'revoked') await prisma.tokenInvalidation.create({ data: { userId: actors[0].id, sessionId: actors[0].sid, invalidatedAt: actors[0].iat } })
    if (mode === 'banned') await prisma.user.update({ where: { id: actors[0].id }, data: { status: 'banned' } })
    if (mode === 'owner-changed') await prisma.instance.update({ where: { id: a }, data: { userId: actors[1].id } })
    assert.equal((await claim(actors[0], [a], code)).success, false, mode)
    if (mode === 'owner-changed') await prisma.instance.update({ where: { id: a }, data: { userId: actors[0].id } })
  }
  await reset()
  const sentBefore = messages.length
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => requestCode(actors[0], [a])))
  assert.equal(messages.length, sentBefore + 1, 'parallel same-target requests send only one email')
  assert.ok(concurrent.some(result => result.success))
  for (let i = 1; i < 5; i++) {
    await prisma.operationVerification.updateMany({ where: { userId: actors[0].id }, data: { createdAt: new Date(Date.now() - 3 * 60_000) } })
    assert.equal((await requestCode(actors[0], [a])).success, true)
  }
  await prisma.operationVerification.updateMany({ where: { userId: actors[0].id }, data: { createdAt: new Date(Date.now() - 3 * 60_000) } })
  assert.equal((await requestCode(actors[0], [a])).success, false, 'replaced/consumed history cannot erase hourly budget')
  actor = actors[0]
  assert.equal((await app.inject({ method: 'POST', url: '/instances/batch/destroy', payload: { instanceIds: [a, a], emailCode: '123456' } })).statusCode, 400)
  assert.equal((await app.inject({ method: 'POST', url: `/instances/${a}/destroy`, payload: { emailCode: '000000' } })).statusCode, 403)
  assert.ok((await prisma.instance.findMany({ where: { id: { in: [a, a2, b] } } })).every(machine => machine.status === 'stopped'), 'rejected verification never claims or deletes instances')
  assert.equal(await prisma.balanceLog.count({ where: { userId: { in: users.map(user => user.id) } } }), 0)
  console.log('PASS real PostgreSQL + local SMTP: concurrent A/B forced collision, cross-user/session/email/set isolation, single-use 8-way claim, expiry/attempt/revocation/ownership/send failures, send/hourly limits and actual route zero-write gates')
} catch (error) { failure = error }
finally {
  crypto.randomInt = originalRandom
  await app.close(); clearTransporterCache()
  for (const socket of sockets) socket.destroy()
  await new Promise<void>(resolve => smtp.close(() => resolve()))
  await prisma.instance.deleteMany({ where: { id: { in: machines.map(machine => machine.id) } } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } })
  for (const key of Object.keys(config)) {
    const previous = saved.find(row => row.key === key)
    if (previous) await prisma.systemConfig.update({ where: { key }, data: { value: previous.value } })
    else await prisma.systemConfig.deleteMany({ where: { key } })
  }
  invalidateAllConfigCache(); await closePrismaDatabase()
}
if (failure) throw failure
process.exit(0)
