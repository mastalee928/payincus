import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { randomUUID } from 'node:crypto'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use isolated local *_pool_test PostgreSQL')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/inbox.js')
const { sendHostInbox, sendAdministrativeInbox } = await import('../src/db/inbox-send.js')
const { advisoryTransactionLock, INSTANCE_OPERATION_LOCK_NAMESPACE } = await import('../src/db/advisory-locks.js')
const tag = `inbox-${randomUUID().replaceAll('-', '')}`
const admin = await prisma.user.create({ data: { username: `${tag}-admin`, passwordHash: 'unusable', role: 'admin' } })
const owner = await prisma.user.create({ data: { username: `${tag}-owner`, passwordHash: 'unusable' } })
const buyer = await prisma.user.create({ data: { username: `${tag}-buyer`, passwordHash: 'unusable', email: `${tag}-buyer@example.test` } })
const other = await prisma.user.create({ data: { username: `${tag}-other`, passwordHash: 'unusable', email: `${tag}-other@example.test` } })
const ids = [admin.id, owner.id, buyer.id, other.id]
const host = await prisma.host.create({ data: { userId: owner.id, name: tag, url: 'https://127.0.0.1:1' } })
const makeInstance = (userId: number, suffix: string) => prisma.instance.create({ data: { hostId: host.id, userId,
  name: `${tag}-${suffix}`, incusId: `${tag}-${suffix}`, image: 'fixture/debian', cpu: 100, memory: 1024, disk: 2048, status: 'running' } })
const instance = await makeInstance(buyer.id, 'one')
const second = await makeInstance(other.id, 'two')
const ownerActor = { id: owner.id, username: owner.username, role: 'user', sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
const adminActor = { ...ownerActor, id: admin.id, username: admin.username, role: 'admin' }
let actor = adminActor
let afterAuthentication: (() => Promise<unknown>) | undefined
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = { ...actor }; await afterAuthentication?.() })
const title = (value: string) => `${tag}-${value}`
const payload = (value: string) => ({ title: title(value), content: 'Fixture announcement content' })
const trigger = tag.replaceAll('-', '_')
let activeTriggerTable: string | undefined
const cleanupTrigger = async () => {
  if (!activeTriggerTable) return
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON ${activeTriggerTable}`)
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`)
  activeTriggerTable = undefined
}
const injectFailure = async (table: 'announcements' | 'host_notification_email_tasks') => {
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.title LIKE '${tag}%' THEN RAISE EXCEPTION 'fixture-inbox-write-failure'; END IF; RETURN NEW; END $$`)
  activeTriggerTable = table
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
}
const assertNoDelivery = async (name: string) => {
  assert.equal(await prisma.inboxMessage.count({ where: { title: title(name) } }), 0)
  assert.equal(await prisma.announcement.count({ where: { title: title(name) } }), 0)
  assert.equal(await prisma.hostNotificationEmailTask.count({ where: { title: title(name) } }), 0)
}
try {
  await app.register(routes, { prefix: '/inbox' })
  for (const route of [`/inbox/admin/send/${buyer.id}`, '/inbox/admin/broadcast']) {
    afterAuthentication = () => prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
    const result = await app.inject({ method: 'POST', url: route, payload: payload('demoted') })
    assert.equal(result.statusCode, 403, result.body)
    await assertNoDelivery('demoted')
    afterAuthentication = undefined
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
  }
  afterAuthentication = () => prisma.tokenInvalidation.create({ data: { userId: admin.id, sessionId: adminActor.sid, invalidatedAt: adminActor.iat } })
  assert.equal((await app.inject({ method: 'POST', url: `/inbox/admin/send/${buyer.id}`, payload: payload('logout') })).statusCode, 403)
  afterAuthentication = undefined
  await assertNoDelivery('logout')
  await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id } })
  assert.equal((await app.inject({ method: 'POST', url: `/inbox/admin/send/${buyer.id}`, payload: payload('direct') })).statusCode, 200)
  assert.equal(await prisma.inboxMessage.count({ where: { title: title('direct'), userId: buyer.id } }), 1)
  assert.equal(await prisma.announcement.count({ where: { title: title('direct'), targetUserId: buyer.id, recipientCount: 1 } }), 1)
  await injectFailure('announcements')
  for (const route of [`/inbox/admin/send/${buyer.id}`, '/inbox/admin/broadcast']) {
    const response = await app.inject({ method: 'POST', url: route, payload: payload('history-failure') })
    assert.equal(response.statusCode, 500, response.body)
    await assertNoDelivery('history-failure')
  }
  await cleanupTrigger()

  // Opposing broadcasts include both administrators as recipients; ordered
  // account locks must avoid the sender-vs-recipient foreign-key deadlock.
  await prisma.user.update({ where: { id: other.id }, data: { role: 'admin' } })
  const concurrentBroadcasts = await Promise.all([
    sendAdministrativeInbox(adminActor, payload('broadcast-a')),
    sendAdministrativeInbox({ ...adminActor, id: other.id }, payload('broadcast-b'))
  ])
  assert.ok(concurrentBroadcasts.every(count => count >= ids.length))
  for (const name of ['broadcast-a', 'broadcast-b']) {
    assert.equal(await prisma.inboxMessage.count({ where: { title: title(name), userId: { in: [admin.id, other.id] } } }), 2)
    assert.equal(await prisma.announcement.count({ where: { title: title(name) } }), 1)
  }
  await prisma.user.update({ where: { id: other.id }, data: { role: 'user' } })

  actor = ownerActor
  for (const route of [`/inbox/hosts/${host.id}/notify`, `/inbox/instances/${instance.id}/notify`]) {
    afterAuthentication = () => prisma.user.update({ where: { id: owner.id }, data: { status: 'banned' } })
    assert.equal((await app.inject({ method: 'POST', url: route, payload: payload('banned') })).statusCode, 403)
    await assertNoDelivery('banned')
    afterAuthentication = undefined
    await prisma.user.update({ where: { id: owner.id }, data: { status: 'active' } })
  }
  afterAuthentication = () => prisma.instance.update({ where: { id: instance.id }, data: { userId: other.id } })
  const currentRecipient = await app.inject({ method: 'POST', url: `/inbox/instances/${instance.id}/notify`, payload: payload('current-owner') })
  assert.equal(currentRecipient.statusCode, 200, currentRecipient.body)
  afterAuthentication = undefined
  assert.equal(await prisma.inboxMessage.count({ where: { title: title('current-owner'), userId: buyer.id } }), 0)
  assert.equal(await prisma.inboxMessage.count({ where: { title: title('current-owner'), userId: other.id } }), 1)
  await prisma.instance.update({ where: { id: instance.id }, data: { userId: buyer.id } })

  let entered!: () => void, release!: () => void
  const ready = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const ownershipChange = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM hosts WHERE id = ${host.id} FOR UPDATE`
    entered(); await gate
    await tx.host.update({ where: { id: host.id }, data: { userId: other.id } })
  })
  await ready
  const pendingSend = app.inject({ method: 'POST', url: `/inbox/hosts/${host.id}/notify`, payload: payload('stale-host') })
  await new Promise(resolve => setTimeout(resolve, 100))
  release(); await ownershipChange
  assert.equal((await pendingSend).statusCode, 403)
  await assertNoDelivery('stale-host')
  await prisma.host.update({ where: { id: host.id }, data: { userId: owner.id } })
  await prisma.$transaction(async tx => {
    await advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instance.id)
    const conflict = await app.inject({ method: 'POST', url: `/inbox/instances/${instance.id}/notify`, payload: payload('busy') })
    assert.equal(conflict.statusCode, 409, conflict.body)
  })
  await assertNoDelivery('busy')
  await injectFailure('announcements')
  for (const route of [`/inbox/hosts/${host.id}/notify`, `/inbox/instances/${instance.id}/notify`]) {
    assert.equal((await app.inject({ method: 'POST', url: route, payload: payload('host-history-failure') })).statusCode, 500)
    await assertNoDelivery('host-history-failure')
  }
  await cleanupTrigger()
  await injectFailure('host_notification_email_tasks')
  await assert.rejects(sendHostInbox(ownerActor, { hostId: host.id, ...payload('queue-failure'), sendEmail: true, smtpEnabled: true }), /fixture-inbox-write-failure/)
  await assertNoDelivery('queue-failure')
  await cleanupTrigger()
  const queued = await sendHostInbox(ownerActor, { hostId: host.id, ...payload('queued'), sendEmail: true, smtpEnabled: true })
  assert.equal(queued.count, 2); assert.equal(queued.queuedCount, 2)
  assert.equal(await prisma.announcement.count({ where: { title: title('queued'), recipientCount: 2, hostId: host.id } }), 1)
  const emails = await prisma.hostNotificationEmailTask.findMany({ where: { title: title('queued') }, orderBy: { scheduledFor: 'asc' } })
  assert.equal(emails.length, 2)
  assert.equal(emails[1].scheduledFor.getTime() - emails[0].scheduledFor.getTime(), 60000)
  assert.deepEqual(emails.map(row => row.userId).sort(), [buyer.id, other.id].sort())
  const direct = await sendHostInbox(ownerActor, { hostId: host.id, instanceIds: [instance.id], ...payload('single-email'), sendEmail: true, smtpEnabled: true })
  assert.equal(direct.queuedCount, 0); assert.equal(direct.emailRecipients[0].userId, buyer.id)
  await assert.rejects(sendHostInbox(ownerActor, { hostId: host.id, ...payload('no-smtp'), sendEmail: true, smtpEnabled: false }), /SMTP_NOT_CONFIGURED/)
  await assertNoDelivery('no-smtp')
  const empty = await sendHostInbox(ownerActor, { hostId: host.id, instanceIds: [], ...payload('empty') })
  assert.equal(empty.count, 0)
  await assertNoDelivery('empty')
  console.log('PASS real PostgreSQL/Fastify inbox: current admin/host actor/session/ownership, current recipients, shared instance exclusion, history and queued-email failure rollback, deduplication, queue spacing and direct authorized snapshot; no SMTP messages sent')
} finally {
  await cleanupTrigger()
  await app.close()
  await prisma.inboxMessage.deleteMany({ where: { title: { startsWith: tag } } })
  await prisma.announcement.deleteMany({ where: { title: { startsWith: tag } } })
  await prisma.hostNotificationEmailTask.deleteMany({ where: { title: { startsWith: tag } } })
  await prisma.instance.deleteMany({ where: { id: { in: [instance.id, second.id] } } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.tokenInvalidation.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
  await closePrismaDatabase()
}
process.exit(0)
