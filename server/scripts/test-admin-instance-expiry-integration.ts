import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdtempSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Prisma } from '@prisma/client'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import ts from 'typescript'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.JWT_SECRET ||= 'expiry-fixture-only'
process.env.ADMIN_FRONTEND_URL = 'https://admin.example.test'
process.env.NODE_ENV = 'test'
process.env.PLATFORM_BACKUP_STATE_DIR = mkdtempSync(join(tmpdir(), 'admin-expiry-'))
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/admin-instance-expiry.js')
const { withInstanceBillingMutation } = await import('../src/lib/instance-billing-mutation.js')
const { performRenewal } = await import('../src/db/billing-operations.js')
const { INSTANCE_OPERATION_LOCK_NAMESPACE, advisoryTransactionLock } = await import('../src/db/advisory-locks.js')
const prefix = `expiry-${randomUUID().slice(0, 8)}`
const owner = await prisma.user.create({ data: { username: prefix, passwordHash: 'fixture-only', role: 'admin' } })
const buyer = await prisma.user.create({ data: { username: prefix + '-buyer', passwordHash: 'fixture-only', balance: 100 } })
const other = await prisma.user.create({ data: { username: prefix + '-other', passwordHash: 'fixture-only' } })
const ids = [owner.id, buyer.id, other.id]
const host = await prisma.host.create({ data: { userId: owner.id, name: prefix, url: 'https://127.0.0.1:1' } })
const pkg = await prisma.package.create({ data: { userId: owner.id, name: prefix, cpuMax: 100, memoryMax: 512, diskMax: 2048 } })
const plan = await prisma.packagePlan.create({ data: { packageId: pkg.id, name: prefix, cpu: 100, memory: 512, disk: 2048,
  portLimit: 1, snapshotLimit: 0, backupLimit: 0, siteLimit: 0, trafficLimit: 0n, price: 1000, billingCycle: 1 } })
const base = new Date('2030-02-02T04:00:00.123Z'), next = '2030-03-02T04:12:34.000Z'
const instance = await prisma.instance.create({ data: { userId: buyer.id, hostId: host.id, name: prefix, incusId: prefix,
  image: 'fixture/debian', cpu: 100, memory: 512, disk: 2048, status: 'running', expiresAt: base, autoRenew: true,
  packageId: pkg.id, packagePlanId: plan.id, billingPrice: 10, billingCycle: 1 } })
const session = { id: owner.id, role: 'admin', username: owner.username, sid: prefix, iat: Math.floor(Date.now() / 1000) + 1 }
const app = Fastify()
app.decorate('authenticateAdmin', async (req: any, reply: any) => {
  if (!req.headers.authorization) return reply.code(401).send({})
  // Stale admin claims deliberately reach the transaction's current-role check.
  req.user = { ...session, ...(req.headers['x-fixture-user'] ? { id: buyer.id } : {}), ...(req.headers['x-fixture-no-sid'] ? { sid: undefined } : {}) }
})
await app.register(routes)
const headers = { authorization: 'Bearer fixture-only', origin: process.env.ADMIN_FRONTEND_URL }
const url = `/api/admin/instances/${instance.id}/expiry`
const get = () => app.inject({ method: 'GET', url, headers })
const put = (revision: string, expiresAt: unknown = next, extra: Record<string, unknown> = {}, override: Record<string, string> = {}) =>
  app.inject({ method: 'PUT', url, headers: { ...headers, ...override }, payload: { revision, expiresAt, ...extra } })
const read = () => prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
async function reset() {
  await prisma.instanceTask.deleteMany({ where: { instanceId: instance.id } })
  await prisma.instanceTransfer.deleteMany({ where: { instanceId: instance.id } })
  await prisma.autoSnapshotOperation.deleteMany({ where: { instanceId: instance.id } })
  await prisma.proxySiteOperation.deleteMany({ where: { instanceId: instance.id } })
  await prisma.log.deleteMany({ where: { instanceId: instance.id } })
  await prisma.tokenInvalidation.deleteMany({ where: { userId: owner.id } })
  await prisma.user.update({ where: { id: owner.id }, data: { status: 'active', role: 'admin' } })
  await prisma.host.update({ where: { id: host.id }, data: { securityHardening: Prisma.DbNull } })
  await prisma.instance.update({ where: { id: instance.id }, data: { userId: buyer.id, incusId: prefix, expiresAt: base, version: 0,
    status: 'running', autoRenew: true, suspendedAt: null, suspendedBy: null, suspendReason: null,
    deletionIntent: Prisma.DbNull, provisioningCleanupPending: false, deletionBillingPending: false,
    expiryNotifiedAt: base, autoRenewAttempts: 3, lastAutoRenewAttemptAt: base } })
}
async function moneyUnchanged() {
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), 100)
  assert.equal(await prisma.balanceLog.count({ where: { userId: { in: ids } } }), 0)
  assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: instance.id } }), 0)
}
async function race(mutation: (tx: Prisma.TransactionClient) => Promise<unknown>, revision: string) {
  let release!: () => void, entered!: (pid: number) => void
  const ready = new Promise<number>(resolve => { entered = resolve })
  const hold = new Promise<void>(resolve => { release = resolve })
  const blocker = prisma.$transaction(async tx => {
    await mutation(tx)
    const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
    entered(row.pid); await hold
  }, { timeout: 10000 })
  const pid = await ready
  let settled = false, blocked = false
  const operation = put(revision).then(result => { settled = true; return result })
  try {
    const end = Date.now() + 2000
    while (!settled && Date.now() < end) {
      const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`
      if (Number(row.count)) { blocked = true; break }
      await delay(15)
    }
  } finally { release(); await blocker }
  return { response: await operation, blocked }
}
let failure: unknown
try {
  await reset()
  const before = (await get()).json()
  assert.equal(before.expiresAt, base.toISOString())
  const changed = await put(before.revision)
  assert.equal(changed.statusCode, 200, changed.body)
  assert.equal((await read()).expiresAt!.toISOString(), next)
  assert.equal((await read()).autoRenew, true)
  assert.equal((await read()).expiryNotifiedAt, null)
  assert.equal((await read()).version, 1)
  const log = await prisma.log.findFirstOrThrow({ where: { instanceId: instance.id } })
  assert.equal(log.userId, owner.id); assert.ok(log.content.includes(base.toISOString()) && log.content.includes(next))
  await moneyUnchanged()
  assert.equal((await put(before.revision)).statusCode, 409)
  const unchanged = await put(changed.json().revision, next)
  assert.equal(unchanged.json().changed, false)
  assert.equal(await prisma.log.count({ where: { instanceId: instance.id } }), 1)
  console.log('PASS exact second/millisecond UTC expiry, audit, replay/no-op, no billing or balance changes')

  for (const input of [null, '', '2030-02-30T04:00:00Z', '2030-02-02T24:00:00Z', '2030-02-02T04:00:00', '2030-02-02T12:00:00+08:00', '1999-01-01T00:00:00Z', 123]) {
    assert.equal((await put(changed.json().revision, input)).statusCode, 400, String(input))
  }
  assert.equal((await put(changed.json().revision, next, { balance: 0 })).statusCode, 400)
  assert.equal((await put(changed.json().revision, next, {}, { origin: 'https://evil.example.test' })).statusCode, 403)
  assert.equal((await put(changed.json().revision, next, {}, { 'sec-fetch-site': 'cross-site' })).statusCode, 403)
  assert.equal((await put(changed.json().revision, next, {}, { 'x-fixture-no-sid': '1' })).statusCode, 403)
  assert.equal((await put(changed.json().revision, next, {}, { 'x-fixture-user': '1' })).statusCode, 403)
  assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401)
  for (const id of ['0', '1.5', '-1', '2147483648', 'abc']) assert.equal((await app.inject({ method: 'GET', url: `/api/admin/instances/${id}/expiry`, headers })).statusCode, 400)
  console.log('PASS invalid calendar/offset/fields/IDs and non-admin, missing session, foreign origin rejected')

  for (const manual of [false, true]) {
    await reset()
    await prisma.instance.update({ where: { id: instance.id }, data: { status: 'suspended', suspendedAt: new Date(),
      suspendReason: 'expired', suspendedBy: manual ? owner.id : null } })
    assert.equal((await put((await get()).json().revision)).statusCode, 200)
    assert.equal((await read()).status, manual ? 'suspended' : 'stopped')
    assert.equal(await prisma.instanceTask.count({ where: { instanceId: instance.id } }), 0)
  }
  await reset()
  assert.equal((await put((await get()).json().revision, '2020-01-01T00:00:00Z')).statusCode, 200)
  assert.equal((await read()).status, 'running')
  console.log('PASS only system expiry suspension clears for future date; manual suspension preserved; no remote tasks')

  for (const mode of ['renewal', 'owner', 'incus', 'deleted', 'deletion-intent', 'role', 'session', 'ban']) {
    await reset(); const revision = (await get()).json().revision
    const result = await race(async tx => {
      if (['role', 'session', 'ban'].includes(mode)) {
        await tx.$queryRaw`SELECT id FROM users WHERE id=${owner.id} FOR UPDATE`
        if (mode === 'session') await tx.tokenInvalidation.create({ data: { userId: owner.id, sessionId: prefix, invalidatedAt: session.iat } })
        else await tx.user.update({ where: { id: owner.id }, data: mode === 'role' ? { role: 'user' } : { status: 'banned' } })
      } else await tx.instance.update({ where: { id: instance.id }, data: mode === 'renewal' ? { expiresAt: new Date('2030-04-02T04:00:00Z'), version: { increment: 1 } }
        : mode === 'owner' ? { userId: other.id } : mode === 'incus' ? { incusId: prefix + '-new' } : mode === 'deleted' ? { status: 'deleted' } : { deletionIntent: {} } })
    }, revision)
    assert.equal(result.blocked, true, mode)
    assert.equal(result.response.statusCode, ['role', 'session', 'ban'].includes(mode) ? 403 : 409, mode + result.response.body)
    assert.equal(await prisma.log.count({ where: { instanceId: instance.id } }), 0)
  }
  console.log('PASS real PostgreSQL lock races: renewed expiry, changed ownership/identity/deletion and revoked administrator')

  for (const mode of ['cleanup', 'billing', 'creating', 'task', 'transfer', 'maintenance', 'resume', 'no-expiry', 'snapshot', 'proxy']) {
    await reset(); const revision = (await get()).json().revision
    if (mode === 'task' || mode === 'resume') await prisma.instanceTask.create({ data: { instanceId: instance.id, hostId: host.id, userId: buyer.id,
      taskType: 'start', ...(mode === 'resume' ? { status: 'FAILED', operationEntry: 'auto-renew-resume-v1', replacementState: { terminal: false } } : {}) } })
    else if (mode === 'transfer') await prisma.instanceTransfer.create({ data: { instanceId: instance.id, fromUserId: buyer.id, toUserId: other.id, snapshot: {} } })
    else if (mode === 'maintenance') await prisma.host.update({ where: { id: host.id }, data: { securityHardening: { maintenance: {} } } })
    else if (mode === 'snapshot') await prisma.autoSnapshotOperation.create({ data: { id: randomUUID(), instanceId: instance.id, ownerId: buyer.id, hostId: host.id,
      incusId: prefix, identityHash: 'fixture', snapshotName: prefix } })
    else if (mode === 'proxy') await prisma.proxySiteOperation.create({ data: { id: randomUUID(), siteId: 0, siteKey: randomUUID(), instanceId: instance.id,
      hostId: host.id, ownerId: buyer.id, actorId: buyer.id, actorSid: prefix, actorIat: 1, authority: 'user', identityHash: 'fixture', incusId: prefix,
      revision: 1, action: 'upsert', desiredConfig: {}, requestHash: 'fixture' } })
    else await prisma.instance.update({ where: { id: instance.id }, data: mode === 'cleanup' ? { provisioningCleanupPending: true }
      : mode === 'billing' ? { deletionBillingPending: true } : mode === 'no-expiry' ? { expiresAt: null } : { status: 'creating' } })
    assert.equal((await put(revision)).statusCode, 409, mode)
  }
  await reset()
  const revision = (await get()).json().revision
  const simultaneous = await Promise.all([put(revision), put(revision)])
  assert.deepEqual(simultaneous.map(r => r.statusCode).sort(), [200, 409])
  await reset()
  const locked = await race(tx => advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instance.id), (await get()).json().revision)
  assert.equal(locked.response.statusCode, 409)
  let release!: () => void, entered!: () => void
  const ready = new Promise<void>(resolve => { entered = resolve }), hold = new Promise<void>(resolve => { release = resolve })
  const lane = withInstanceBillingMutation(instance.id, async () => { entered(); await hold })
  await ready
  try {
    const waiting = await Promise.race([get(), delay(1000).then(() => null)])
    assert.equal(waiting?.statusCode, 409, 'interactive reads must fail busy rather than queue')
    assert.equal((await put(revision)).json().code, 'EXPIRY_BUSY')
  } finally { release(); await lane }
  assert.equal((await read()).expiresAt!.toISOString(), base.toISOString(), 'rejected writes must not run after lane release')
  assert.equal((await get()).statusCode, 200)
  console.log('PASS pending tasks/transfer/cleanup/snapshot/proxy/maintenance/resume fences and concurrent edits/billing lane')

  await reset()
  const cancelledResume = await prisma.instanceTask.create({ data: { instanceId: instance.id, hostId: host.id, userId: buyer.id,
    taskType: 'start', status: 'PENDING', operationEntry: 'auto-renew-resume-v1', replacementState: { terminal: false } } })
  const { cancelInstanceTask } = await import('../src/db/instance-tasks.js')
  assert.ok(await cancelInstanceTask(cancelledResume.id))
  assert.equal((await get()).statusCode, 200, 'a cancelled auto-start must not block expiry editing forever')
  console.log('PASS cancelled auto-start releases editing; busy lane returns immediately and cannot write later')

  // Execute the production decorators verbatim without starting app.ts workers
  // or a second listening backend. Real JWT signatures and PG account/session
  // checks are used; the earlier fixture separately covers post-auth lock races.
  const authSource = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8')
  const start = authSource.indexOf('async function ensureActiveAccessToken(')
  const end = authSource.indexOf('// 注意: 安全响应头', start)
  assert.ok(start >= 0 && end > start)
  const { isAccessTokenInvalidated } = await import('../src/lib/security.js')
  const { recoveryHeld } = await import('../src/services/platform-backup-core.js')
  const { validateRecoverySession } = await import('../src/services/platform-recovery-operator.js')
  const authApp = Fastify()
  await authApp.register(fastifyJwt, { secret: 'expiry-signed-isolated-jwt-only' })
  const register = new Function('fastify', 'prisma', 'isAccessTokenInvalidated', 'recoveryHeld', 'validateRecoverySession',
    ts.transpileModule(authSource.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText)
  register(authApp, prisma, isAccessTokenInvalidated, recoveryHeld, validateRecoverySession)
  await authApp.register(routes)
  const { default: instanceRoutes } = await import('../src/routes/instances.js')
  await authApp.register(instanceRoutes, { prefix: '/api/instances' })
  const token = (id: number, role: 'user' | 'admin', extra: Record<string, unknown> = {}) => {
    const claims = { id, username: 'isolated-expiry-test', role, sid: prefix, iat: session.iat, ...extra }
    return authApp.jwt.sign(claims)
  }
  const authRequest = (method: 'GET' | 'PUT', value?: string, payload?: object) => authApp.inject({ method, url,
    headers: { origin: process.env.ADMIN_FRONTEND_URL!, ...(value ? { authorization: 'Bearer ' + value } : {}), 'x-role': 'admin' },
    ...(method === 'PUT' ? { payload: payload || { revision, expiresAt: next } } : {}) })
  try {
    await reset()
    const valid = token(owner.id, 'admin')
    const latest = (await authRequest('GET', valid)).json()
    assert.equal(latest.ownerId, buyer.id); assert.equal(latest.hostId, host.id); assert.equal(latest.incusId, prefix)
    const detail = await authApp.inject({ method: 'GET', url: `/api/instances/${instance.id}`, headers: { authorization: 'Bearer ' + valid } })
    assert.equal(detail.statusCode, 200, detail.body)
    assert.deepEqual(detail.json().instance.expiryIdentity, { ownerId: buyer.id, hostId: host.id, incusId: prefix })
    const customerToken = token(buyer.id, 'user')
    const customerDetail = await authApp.inject({ method: 'GET', url: `/api/instances/${instance.id}`, headers: { authorization: 'Bearer ' + customerToken } })
    assert.equal(customerDetail.statusCode, 200, customerDetail.body)
    assert.equal(customerDetail.json().instance.expiryIdentity, undefined, 'the customer detail API must not expose admin edit metadata')
    for (const path of ['rename', 'config']) {
      const result = await authApp.inject({ method: 'PATCH', url: `/api/instances/${instance.id}/${path}`, headers: { authorization: 'Bearer ' + customerToken },
        payload: { ...(path === 'rename' ? { name: prefix } : {}), expiresAt: next, expires_at: next, role: 'admin' } })
      assert.equal(result.statusCode, path === 'rename' ? 200 : 400, result.body)
      assert.equal((await read()).expiresAt!.toISOString(), base.toISOString(), 'customer update must never mass-assign expiry')
    }
    await prisma.log.deleteMany({ where: { instanceId: instance.id } })
    for (const value of [undefined, 'pat_fixture', 'poa_fixture', token(buyer.id, 'user'), token(other.id, 'user'),
      token(buyer.id, 'admin'), token(owner.id, 'admin', { sid: null }), token(owner.id, 'admin', { exp: 1 }), valid + 'tampered']) {
      for (const method of ['GET', 'PUT'] as const) {
        const denied = await authRequest(method, value)
        assert.ok([401, 403].includes(denied.statusCode), method + ' must reject non-admin/invalid credentials: ' + denied.statusCode)
        assert.equal(denied.json().revision, undefined)
      }
    }
    // Owning the host never grants an administrator's expiry permission.
    await prisma.host.update({ where: { id: host.id }, data: { userId: other.id } })
    for (const method of ['GET', 'PUT'] as const) assert.equal((await authRequest(method, token(other.id, 'admin'))).statusCode, 403)
    await prisma.host.update({ where: { id: host.id }, data: { userId: owner.id } })
    for (const mode of ['role', 'ban', 'session']) {
      if (mode === 'role') await prisma.user.update({ where: { id: owner.id }, data: { role: 'user' } })
      if (mode === 'ban') await prisma.user.update({ where: { id: owner.id }, data: { status: 'banned' } })
      if (mode === 'session') await prisma.tokenInvalidation.create({ data: { userId: owner.id, sessionId: prefix, invalidatedAt: session.iat } })
      for (const method of ['GET', 'PUT'] as const) assert.ok([401, 403].includes((await authRequest(method, valid)).statusCode), mode)
      await reset()
    }
    const { adminInstanceExpiry } = await import('../src/services/admin-instance-expiry.js')
    await assert.rejects(adminInstanceExpiry(instance.id, { ...session, id: buyer.id }, { revision: latest.revision, expiresAt: new Date(next) }), /ADMIN_ACTOR_FORBIDDEN/)
    assert.equal((await read()).expiresAt!.toISOString(), base.toISOString())
    assert.equal(await prisma.log.count({ where: { instanceId: instance.id } }), 0)
    await moneyUnchanged()
    assert.equal((await authRequest('PUT', valid, { revision: latest.revision, expiresAt: next })).statusCode, 200)
  } finally { await authApp.close(); await prisma.host.update({ where: { id: host.id }, data: { userId: owner.id } }); await reset() }
  console.log('PASS production auth decorators + signed JWT + PostgreSQL: customer, host-owner, spoofed role, invalid signature/PAT/OAuth, missing/expired/revoked session denied; active admin allowed')
  console.log('PASS actual instance detail admin-only edit identity; customer rename/config cannot inject expiry or role fields')

  const trigger = `expiry_audit_${randomUUID().replaceAll('-', '')}`
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.instance_id = ${instance.id} THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  try {
    assert.equal((await put((await get()).json().revision)).statusCode, 500)
    assert.equal((await read()).expiresAt!.toISOString(), base.toISOString())
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON logs`)
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
  }
  await moneyUnchanged()
  console.log('PASS audit failure rolls expiry back atomically; financial tables remain untouched')
  const holdPath = join(process.env.PLATFORM_BACKUP_STATE_DIR, 'recovery-hold.json')
  writeFileSync(holdPath, '{}')
  try { assert.equal((await put(revision)).json().code, 'EXPIRY_RECOVERY_HELD') } finally { unlinkSync(holdPath) }
  console.log('PASS recovery protection rejects expiry writes')
  await reset()
  const oldInstance = await read(), oldRevision = (await get()).json().revision
  const renewed = await performRenewal(buyer.id, oldInstance, 1, undefined, { sid: prefix + '-buyer', iat: session.iat })
  assert.equal(renewed.amount, 10)
  assert.equal((await put(oldRevision)).json().code, 'EXPIRY_CHANGED')
  assert.equal((await read()).expiresAt!.getTime(), renewed.newExpiresAt.getTime())
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), 90)
  assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: instance.id } }), 1)
  const { calculateInstanceRemainingRefundQuote } = await import('../src/db/billing-operations.js')
  const renewedInstance = await read()
  assert.equal((await put((await get()).json().revision, '2030-06-02T04:00:00Z')).statusCode, 200)
  const quote = await calculateInstanceRemainingRefundQuote(await read())
  assert.equal(quote.refundableValue, 10, 'free admin extension cannot increase the paid refundable total')
  await assert.rejects(performRenewal(buyer.id, renewedInstance, 1, undefined, { sid: prefix + '-buyer', iat: session.iat }), /状态已变更/)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), 90)
  assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: instance.id } }), 1)
  console.log('PASS actual paid renewal then stale edit and admin edit then stale paid renewal: no overwrite or extra charge')
} catch (error) { failure = error } finally {
  await app.close()
  await prisma.autoSnapshotOperation.deleteMany({ where: { instanceId: instance.id } })
  await prisma.proxySiteOperation.deleteMany({ where: { instanceId: instance.id } })
  await prisma.instanceTask.deleteMany({ where: { instanceId: instance.id } })
  await prisma.instanceTransfer.deleteMany({ where: { instanceId: instance.id } })
  await prisma.log.deleteMany({ where: { instanceId: instance.id } })
  await prisma.instanceBillingRecord.deleteMany({ where: { instanceId: instance.id } })
  await prisma.balanceLog.deleteMany({ where: { userId: { in: ids } } })
  await prisma.instance.delete({ where: { id: instance.id } })
  await prisma.package.delete({ where: { id: pkg.id } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
  await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
