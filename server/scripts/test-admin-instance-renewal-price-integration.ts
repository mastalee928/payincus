import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Prisma } from '@prisma/client'
import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import ts from 'typescript'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) &&
  /^\/[a-zA-Z0-9_]+_pool_test$/.test(database.pathname) && !database.search && !database.hash, 'isolated loopback pool test database required')
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'renewal-price-isolated-jwt-only'
process.env.ADMIN_FRONTEND_URL = 'https://admin.example.test'
const stateRoot = mkdtempSync(join(tmpdir(), 'instance-renewal-price-'))
process.env.PLATFORM_BACKUP_STATE_DIR = stateRoot
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const billing = await import('../src/db/billing-operations.js')
const { withInstanceBillingMutation } = await import('../src/lib/instance-billing-mutation.js')
const { INSTANCE_OPERATION_LOCK_NAMESPACE, USER_AFF_BALANCE_LOCK_NAMESPACE, advisoryTransactionLock } = await import('../src/db/advisory-locks.js')
const { isAccessTokenInvalidated } = await import('../src/lib/security.js')
const { recoveryHeld } = await import('../src/services/platform-backup-core.js')
const { validateRecoverySession } = await import('../src/services/platform-recovery-operator.js')
const { default: adminRoutes } = await import('../src/routes/admin-billing.js')
const { default: instanceBillingRoutes } = await import('../src/routes/instance-billing.js')
const { default: hostRoutes } = await import('../src/routes/hosts.js')
const { default: instanceRoutes } = await import('../src/routes/instances.js')
const prefix = 'renew-price-' + randomUUID().slice(0, 8)
const now = Date.now(), deadline = new Date(now + 15 * 86400000), periodStart = new Date(now - 15 * 86400000)
const admin = await prisma.user.create({ data: { username: prefix + '-admin', role: 'admin', passwordHash: 'unusable-fixture' } })
const buyer = await prisma.user.create({ data: { username: prefix + '-buyer', balance: 1000, passwordHash: 'unusable-fixture' } })
const other = await prisma.user.create({ data: { username: prefix + '-other', passwordHash: 'unusable-fixture' } })
const userIds = [admin.id, buyer.id, other.id]
// Give this account a real VIP tier in the isolated DB, then restore global
// settings on exit. No production config or real account is touched.
const configKeys = ['user_vip_metric', 'vip_benefits_config']
const savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: configKeys } } })
const savedVipRule = await prisma.vipLevelRule.findUnique({ where: { type_level: { type: 'user', level: 5 } } })
const { invalidateAllConfigCache } = await import('../src/lib/config-cache.js')
const host = await prisma.host.create({ data: { userId: admin.id, name: prefix, url: 'https://127.0.0.1:1' } })
const pkg = await prisma.package.create({ data: { userId: admin.id, name: prefix, cpuMax: 400, memoryMax: 4096, diskMax: 40960 } })
const plan = await prisma.packagePlan.create({ data: { packageId: pkg.id, name: prefix, cpu: 100, memory: 512, disk: 1024,
  portLimit: 1, snapshotLimit: 0, backupLimit: 0, siteLimit: 0, trafficLimit: 0n, price: 1000, billingCycle: 1 } })
const make = (suffix: string) => prisma.instance.create({ data: { userId: buyer.id, hostId: host.id, packageId: pkg.id, packagePlanId: plan.id,
  name: prefix + suffix, incusId: prefix + suffix, image: 'isolated/debian', cpu: 100, memory: 512, disk: 1024,
  status: 'stopped', expiresAt: deadline, billingPrice: 10, billingCycle: 1, autoRenew: true } })
const instance = await make('-one'), second = await make('-two'), instanceIds = [instance.id, second.id]
const aff = await prisma.affCode.create({ data: { code: prefix, userId: other.id, discountRate: 0.5, commissionRate: 0.1 } })
await prisma.affBinding.create({ data: { instanceId: instance.id, affCodeId: aff.id } })
const session = { sid: prefix, iat: Math.floor(now / 1000) + 1 }
const app = Fastify()
await app.register(jwt, { secret: process.env.JWT_SECRET })
// Execute the production decorators verbatim; no app.ts listener or workers.
const authSource = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8')
const start = authSource.indexOf('async function ensureActiveAccessToken('), end = authSource.indexOf('// 注意: 安全响应头', start)
assert.ok(start >= 0 && end > start)
new Function('fastify', 'prisma', 'isAccessTokenInvalidated', 'recoveryHeld', 'validateRecoverySession',
  ts.transpileModule(authSource.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
)(app, prisma, isAccessTokenInvalidated, recoveryHeld, validateRecoverySession)
await app.register(adminRoutes)
await app.register(instanceBillingRoutes, { prefix: '/api/instances' })
await app.register(hostRoutes, { prefix: '/api/hosts' })
await app.register(instanceRoutes, { prefix: '/api/instances' })
const token = (id = admin.id, role = 'admin', extra: Record<string, unknown> = {}) => app.jwt.sign({ id, username: prefix, role, ...session, ...extra })
const authHeaders = (value = token()) => ({ authorization: 'Bearer ' + value, origin: process.env.ADMIN_FRONTEND_URL! })
const url = `/api/admin/instances/${instance.id}/renewal-price`
const get = () => app.inject({ method: 'GET', url, headers: authHeaders() })
const put = (revision: string, price: unknown = '12.34', overrides: Record<string, string> = {}, extra: Record<string, unknown> = {}) =>
  app.inject({ method: 'PUT', url, headers: { ...authHeaders(), ...overrides }, payload: { revision, price, ...extra } })
const read = () => prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
const finances = async () => ({
  balances: await prisma.user.findMany({ where: { id: { in: userIds } }, orderBy: { id: 'asc' }, select: { id: true, balance: true } }),
  ledger: await prisma.balanceLog.findMany({ where: { userId: { in: userIds } }, orderBy: { id: 'asc' } }),
  bills: await prisma.instanceBillingRecord.findMany({ where: { instanceId: { in: instanceIds } }, orderBy: { id: 'asc' } }),
  other: await prisma.instance.findUniqueOrThrow({ where: { id: second.id } }), plan: await prisma.packagePlan.findUniqueOrThrow({ where: { id: plan.id } })
})
async function reset() {
  await prisma.instanceTask.deleteMany({ where: { instanceId: instance.id } })
  await prisma.instanceTransfer.deleteMany({ where: { instanceId: instance.id } })
  await prisma.log.deleteMany({ where: { instanceId: { in: instanceIds } } })
  await prisma.balanceLog.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.instanceBillingRecord.deleteMany({ where: { instanceId: { in: instanceIds } } })
  await prisma.renewalRequest.deleteMany({ where: { userId: buyer.id } })
  await prisma.tokenInvalidation.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin', status: 'active' } })
  await prisma.user.update({ where: { id: buyer.id }, data: { balance: 1000, status: 'active' } })
  await prisma.host.update({ where: { id: host.id }, data: { userId: admin.id, securityHardening: Prisma.DbNull } })
  await prisma.instance.update({ where: { id: instance.id }, data: { userId: buyer.id, hostId: host.id, incusId: instance.incusId,
    status: 'stopped', expiresAt: deadline, billingPrice: 10, billingCycle: 1, renewalPrice: null, packagePlanId: plan.id,
    version: 0, autoRenew: true, autoRenewAttempts: 0, lastAutoRenewAttemptAt: null, suspendedAt: null, suspendedBy: null, suspendReason: null,
    deletionIntent: Prisma.DbNull, deletionBillingPending: false, provisioningCleanupPending: false } })
  await prisma.instanceBillingRecord.createMany({ data: instanceIds.map(instanceId => ({ instanceId, userId: buyer.id,
    type: 'newPurchase' as const, amount: 10, months: 1, periodStart, periodEnd: deadline })) })
}
async function race(mutation: (tx: Prisma.TransactionClient) => Promise<unknown>, revision: string) {
  let entered!: (pid: number) => void, release!: () => void
  const ready = new Promise<number>(resolve => { entered = resolve }), hold = new Promise<void>(resolve => { release = resolve })
  const blocking = prisma.$transaction(async tx => {
    await mutation(tx); const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
    entered(row.pid); await hold
  }, { timeout: 12000 })
  const pid = await ready
  let settled = false, blocked = false
  const operation = put(revision).then(value => { settled = true; return value })
  try {
    const timeout = Date.now() + 2000
    while (!settled && Date.now() < timeout) {
      const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`
      if (Number(row.count)) { blocked = true; break }; await delay(15)
    }
  } finally { release(); await blocking }
  return { response: await operation, blocked }
}
let failure: unknown
try {
  await reset()
  for (const price of ['12.34', '0', '100000', '0.01']) {
    const before = await read(), oldMoney = await finances(), snapshot = (await get()).json()
    const response = await put(snapshot.revision, price)
    assert.equal(response.statusCode, 200, response.body)
    const after = await read()
    assert.deepEqual({ ...after, renewalPrice: before.renewalPrice, version: before.version, updatedAt: before.updatedAt }, before,
      'saving changes only final renewal price, revision and update timestamp')
    assert.deepEqual(await finances(), oldMoney, 'paid bills, balance, other instance and plan unchanged')
    assert.equal(Number(after.renewalPrice), Number(price)); assert.equal(after.version, before.version + 1)
    const audit = await prisma.log.findFirstOrThrow({ where: { instanceId: instance.id, action: 'instance.renewal_price_update' }, orderBy: { id: 'desc' } })
    assert.equal(audit.userId, admin.id); assert.ok(audit.content.includes(Number(price).toFixed(2)) && audit.content.includes(buyer.id.toString()))
    assert.equal((await put(snapshot.revision, price)).statusCode, 409)
    const current = (await get()).json(), count = await prisma.log.count({ where: { instanceId: instance.id } })
    assert.equal((await put(current.revision, price)).json().changed, false)
    assert.equal(await prisma.log.count({ where: { instanceId: instance.id } }), count)
  }
  console.log('PASS signed admin API: exact/zero/max prices, atomic audit, stale/no-op, unchanged paid bills/balance/expiry/other instance/plan')
  await reset(); const revision = (await get()).json().revision
  for (const price of [null, true, false, 12.34, '', '1e2', '01', '-1', '1.234', '100000.01', ' 10 ', 'Infinity']) {
    assert.equal((await put(revision, price)).statusCode, 400, String(price))
  }
  assert.equal((await put(revision, '10', {}, { balance: 0 })).statusCode, 400)
  assert.equal((await put(revision, '10', { origin: 'https://evil.example.test' })).statusCode, 403)
  assert.equal((await put(revision, '10', { 'sec-fetch-site': 'cross-site' })).statusCode, 403)
  for (const value of [token(buyer.id, 'user'), token(other.id, 'user'), token(buyer.id), token(admin.id, 'admin', { sid: null }),
    token(admin.id, 'admin', { exp: 1 }), token() + '-tampered', 'pat_fixture', 'poa_fixture']) {
    for (const method of ['GET', 'PUT'] as const) {
      const response = await app.inject({ method, url, headers: authHeaders(value), ...(method === 'PUT' ? { payload: { revision, price: '20' } } : {}) })
      assert.ok([401, 403].includes(response.statusCode), 'customer/spoofed/invalid authentication rejected')
    }
  }
  for (const id of ['0', '-1', '1.5', '2147483648', 'abc']) assert.equal((await app.inject({ method: 'GET', url: url.replace(String(instance.id), id), headers: authHeaders() })).statusCode, 400)
  console.log('PASS strict money/body/ID/origin; production JWT decorators reject customer, forged admin, invalid/PAT/OAuth/expired/missing session')
  await prisma.host.update({ where: { id: host.id }, data: { userId: other.id } })
  try {
    for (const value of [token(buyer.id, 'user'), token(other.id, 'user'), token(other.id, 'admin')]) {
      const before = await read(), money = await finances()
      for (const request of [
        { method: 'PUT' as const, url, payload: { revision, price: '25' } },
        { method: 'POST' as const, url: `/api/admin/instances/${instance.id}/update-price`, payload: { newPrice: 25, settleBalance: true, expectedVersion: 0 } },
        { method: 'POST' as const, url: '/api/admin/instances/batch-update-price', payload: { instanceIds: [instance.id], newPrice: 25, settleBalance: false, expectations: [{ instanceId: instance.id, version: 0 }] } },
        { method: 'PATCH' as const, url: `/api/hosts/${host.id}/instances/${instance.id}/renewal-price`, payload: { newPrice: 25 } }
      ]) {
        const result = await app.inject({ ...request, headers: { ...authHeaders(value), 'x-role': 'admin' } })
        assert.ok([401, 403].includes(result.statusCode), 'customer and host owner must never change renewal prices: ' + request.url + ' ' + result.body)
      }
      assert.deepEqual(await read(), before); assert.deepEqual(await finances(), money)
    }
  } finally { await prisma.host.update({ where: { id: host.id }, data: { userId: admin.id } }) }
  console.log('PASS customer/host owner/spoofed administrator rejected at every new and legacy price mutation endpoint')
  for (const mutation of ['config', 'rename']) {
    const before = await read()
    const result = await app.inject({ method: 'PATCH', url: `/api/instances/${instance.id}/${mutation}`,
      headers: authHeaders(token(buyer.id, 'user')), payload: { ...(mutation === 'rename' ? { name: before.name } : {}),
        billingPrice: 1, billing_price: 1, renewalPrice: 1, renewal_price: 1, newPrice: 1, role: 'admin' } })
    assert.ok([200, 400].includes(result.statusCode), result.body)
    const after = await read(); assert.equal(after.renewalPrice, before.renewalPrice); assert.equal(Number(after.billingPrice), Number(before.billingPrice))
  }
  const userDetail = await app.inject({ method: 'GET', url: `/api/instances/${instance.id}`, headers: authHeaders(token(buyer.id, 'user')) })
  assert.equal(userDetail.statusCode, 200, userDetail.body); assert.equal(userDetail.json().instance.expiryIdentity, undefined)
  console.log('PASS customer config/rename cannot inject price fields; customer detail has no administrator edit identity')
  for (const mode of ['demoted', 'banned', 'session', 'all-sessions']) {
    await reset(); const before = await finances(), revision = (await get()).json().revision
    const raced = await race(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id=${admin.id} FOR UPDATE`
      if (mode === 'demoted') await tx.user.update({ where: { id: admin.id }, data: { role: 'user' } })
      else if (mode === 'banned') await tx.user.update({ where: { id: admin.id }, data: { status: 'banned' } })
      else await tx.tokenInvalidation.create({ data: { userId: admin.id, sessionId: mode === 'session' ? session.sid : '__USER_LEVEL__', invalidatedAt: session.iat } })
    }, revision)
    assert.ok(raced.blocked); assert.ok([401, 403].includes(raced.response.statusCode), raced.response.body)
    assert.equal((await read()).renewalPrice, null); assert.deepEqual(await finances(), before)
  }
  for (const mode of ['price', 'owner', 'guest', 'delete']) {
    await reset(); const revision = (await get()).json().revision
    const raced = await race(async tx => {
      await tx.$queryRaw`SELECT id FROM instances WHERE id=${instance.id} FOR UPDATE`
      await tx.instance.update({ where: { id: instance.id }, data: mode === 'price' ? { renewalPrice: 30, version: { increment: 1 } } :
        mode === 'owner' ? { userId: other.id } : mode === 'guest' ? { incusId: instance.incusId + '-changed' } : { deletionIntent: { state: 'claimed' } } })
    }, revision)
    assert.ok(raced.blocked); assert.equal(raced.response.statusCode, 409, raced.response.body)
  }
  console.log('PASS real row-lock races: current admin role/status/session, changed price/owner/guest and deletion reject stale writes')
  await reset()
  await prisma.host.update({ where: { id: host.id }, data: { securityHardening: { maintenance: { unknown: true } } } })
  assert.equal((await get()).json().code, 'RENEWAL_PRICE_BUSY')
  await reset()
  const task = await prisma.instanceTask.create({ data: { instanceId: instance.id, hostId: host.id, userId: buyer.id, taskType: 'start', status: 'PENDING' } })
  assert.equal((await get()).json().code, 'RENEWAL_PRICE_BUSY'); await prisma.instanceTask.delete({ where: { id: task.id } })
  await reset()
  await prisma.instance.update({ where: { id: instance.id }, data: { status: 'suspended', suspendReason: 'expired', suspendedAt: new Date(now - 4 * 86400000), expiresAt: new Date(now - 4 * 86400000) } })
  assert.equal((await get()).json().code, 'RENEWAL_PRICE_DELETING')
  await reset()
  const locked = await race(tx => advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instance.id), (await get()).json().revision)
  assert.equal(locked.response.statusCode, 409)
  let entered!: () => void, release!: () => void
  const ready = new Promise<void>(resolve => { entered = resolve }), hold = new Promise<void>(resolve => { release = resolve })
  const lane = withInstanceBillingMutation(instance.id, async () => { entered(); await hold })
  await ready
  try { assert.equal((await get()).json().code, 'RENEWAL_PRICE_BUSY') } finally { release(); await lane }
  const sharedRevision = (await get()).json().revision
  const simultaneous = await Promise.all([put(sharedRevision), put(sharedRevision)])
  assert.deepEqual(simultaneous.map(r => r.statusCode).sort(), [200, 409])
  console.log('PASS maintenance/task/retention/advisory lock/billing lane fences and concurrent edits')
  await reset()
  const paid = await read(), beforeRefund = await billing.calculateInstanceRefund(paid)
  await put((await get()).json().revision, '0')
  const zero = await read()
  assert.equal((await billing.calculateInstanceRefund(zero)).isPaid, true, 'a future zero price does not make the paid period free')
  const preview = await app.inject({ method: 'POST', url: `/api/hosts/${host.id}/instances/batch-delete-preview`, headers: authHeaders(), payload: { instanceIds: [instance.id] } })
  assert.equal(preview.statusCode, 200, preview.body)
  assert.ok(preview.body.includes(beforeRefund.refundAmount.toString()), 'host refund preview retains paid value after a future zero price')
  assert.equal((await billing.calculateInstanceRefund(zero)).refundAmount, beforeRefund.refundAmount)
  console.log('PASS future zero price: original paid ledger and actual host refund preview remain intact')
  // A final price has no AFF dependency: contention on an old coupon must not
  // block the customer's renewal or change its final amount.
  await reset(); await put((await get()).json().revision, '12.34')
  let releaseAff!: () => void, affReady!: () => void
  const affHeld = new Promise<void>(resolve => { releaseAff = resolve }), readyAff = new Promise<void>(resolve => { affReady = resolve })
  const affBlocker = prisma.$transaction(async tx => {
    await advisoryTransactionLock(tx, USER_AFF_BALANCE_LOCK_NAMESPACE, other.id)
    await tx.$queryRaw`SELECT id FROM aff_codes WHERE id=${aff.id} FOR UPDATE`
    affReady(); await affHeld
  }, { timeout: 10000 })
  await readyAff
  try {
    const response = await app.inject({ method: 'POST', url: `/api/instances/${instance.id}/renew`,
      headers: { ...authHeaders(token(buyer.id, 'user')), 'idempotency-key': randomUUID() }, payload: { months: 1, expectedAmount: 12.34 } })
    assert.equal(response.statusCode, 200, 'final-price renewal must ignore busy historical AFF: ' + response.body)
    assert.equal(response.json().amount, 12.34)
  } finally { releaseAff(); await affBlocker }
  console.log('PASS final renewal price is independent of a locked historical AFF code')
  await prisma.systemConfig.upsert({ where: { key: 'user_vip_metric' }, create: { key: 'user_vip_metric', value: 'totalConsume' }, update: { value: 'totalConsume' } })
  const vipConfig = JSON.stringify({ levels: Object.fromEntries([1, 2, 3, 4, 5].map(level => [String(level), { orderDiscountPercent: 50, extraTrafficPercent: 0, resourcePoolBonusPercent: 0 }])) })
  await prisma.systemConfig.upsert({ where: { key: 'vip_benefits_config' }, create: { key: 'vip_benefits_config', value: vipConfig }, update: { value: vipConfig } })
  await prisma.vipLevelRule.upsert({ where: { type_level: { type: 'user', level: 5 } }, create: { type: 'user', level: 5, minConsume: 1 },
    update: { enabled: true, minConsume: 1 } })
  invalidateAllConfigCache()
  for (const price of [12.34, 0]) {
    await reset(); await put((await get()).json().revision, String(price))
    await prisma.balanceLog.create({ data: { userId: buyer.id, type: 'consume', amount: -10, balanceBefore: 1010, balanceAfter: 1000, remark: 'isolated VIP eligibility' } })
    const { getUserContinuousVipBenefit } = await import('../src/services/vip-benefits.js')
    const vip = await getUserContinuousVipBenefit(buyer.id)
    assert.equal(vip.level, 5); assert.equal(vip.benefit.orderDiscountPercent, 50)
    const info = await billing.getInstanceBillingInfo(instance.id)
    assert.equal(info.renewPreview.find(p => p.months === 1)?.discountedAmount, price, 'AFF and VIP cannot discount the final price')
    const buyerHeaders = authHeaders(token(buyer.id, 'user'))
    const renew = (amount: number | undefined, key = randomUUID()) => app.inject({ method: 'POST', url: `/api/instances/${instance.id}/renew`,
      headers: { ...buyerHeaders, 'idempotency-key': key }, payload: { months: 1, ...(amount !== undefined ? { expectedAmount: amount } : {}) } })
    const before = await finances()
    assert.equal((await renew(undefined)).statusCode, 409)
    assert.equal((await renew(price + 1)).json().code, 'RENEWAL_PRICE_CHANGED')
    assert.deepEqual(await finances(), before, 'missing/stale expected price cannot charge')
    const key = randomUUID(), successful = await renew(price, key)
    assert.equal(successful.statusCode, 200, successful.body); assert.equal(successful.json().amount, price)
    const after = await finances(); assert.equal(Number(after.balances.find(u => u.id === buyer.id)!.balance), 1000 - price)
    assert.equal(after.bills.filter(b => b.instanceId === instance.id && b.type === 'renew').length, 1)
    assert.equal((await renew(price, key)).json().amount, price); assert.deepEqual(await finances(), after)
    await put((await get()).json().revision, '8.76')
    assert.equal((await renew(8.76, key)).json().amount, price, 'a lost response followed by a new quote still replays the original charge')
    assert.deepEqual(await finances(), after)
    assert.equal(Number((await prisma.affCode.findUniqueOrThrow({ where: { id: aff.id } })).totalEarnings), 0)
  }
  console.log('PASS actual manual renewal: final/zero price, real VIP/AFF ignored, stale quote refusal, exact debit/ledger, durable retry and no AFF commission')
  await reset(); await put((await get()).json().revision, '12.34')
  const batchHeaders = { ...authHeaders(token(buyer.id, 'user')), 'idempotency-key': randomUUID() }
  const batch = (expectedAmounts: Record<string, number> | undefined) => app.inject({ method: 'POST', url: '/api/instances/batch/renew', headers: batchHeaders,
    payload: { instanceIds, months: 1, ...(expectedAmounts ? { expectedAmounts } : {}) } })
  const mixed = await batch({ [instance.id]: 11, [second.id]: 10 })
  assert.equal(mixed.statusCode, 200, mixed.body); assert.equal(mixed.json().successCount, 1); assert.equal(mixed.json().failedCount, 1)
  assert.equal(mixed.json().results.find((r: { id: number }) => r.id === instance.id).reason, '续费价格已变化，请重新打开续费窗口确认')
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), 990)
  const mixedMoney = await finances(); await batch({ [instance.id]: 12.34, [second.id]: 10 }); assert.deepEqual(await finances(), mixedMoney)
  // The final-price route must supersede the old settlement-capable editor.
  const old = await app.inject({ method: 'POST', url: `/api/admin/instances/${instance.id}/update-price`, headers: authHeaders(), payload: { newPrice: 1, settleBalance: true, expectedVersion: (await read()).version } })
  assert.equal(old.statusCode, 409, old.body)
  const oldBatch = await app.inject({ method: 'POST', url: '/api/admin/instances/batch-update-price', headers: authHeaders(), payload: { instanceIds: [instance.id], newPrice: 1, settleBalance: false,
    expectations: [{ instanceId: instance.id, version: (await read()).version }] } })
  assert.equal(oldBatch.statusCode, 400, oldBatch.body)
  assert.ok(oldBatch.json().preview.items[0].error.includes('最终续费价'))
  const oldHost = await app.inject({ method: 'PATCH', url: `/api/hosts/${host.id}/instances/${instance.id}/renewal-price`, headers: authHeaders(), payload: { newPrice: 1 } })
  assert.equal(oldHost.statusCode, 409, oldHost.body); assert.deepEqual(await finances(), mixedMoney)
  console.log('PASS batch final/stale pricing gives specific per-instance failure and durable partial replay; old admin/host settlement editors cannot overwrite final price')
  await reset(); await put((await get()).json().revision, '22.22')
  const stale = await read(); await put((await get()).json().revision, '3.21')
  const before = await finances()
  await assert.rejects(billing.performRenewal(buyer.id, stale, 1, { expiryThreshold: new Date(now + 30 * 86400000) }), /实例状态已变更/)
  assert.deepEqual(await finances(), before)
  await prisma.instance.update({ where: { id: instance.id }, data: { expiresAt: new Date(Date.now() + 3600000) } })
  const originalInterval = globalThis.setInterval
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => { const timer = originalInterval(...args); timer.unref(); return timer }) as typeof setInterval
  const { processAutoRenew } = await import('../src/services/billing-scheduler.js')
  globalThis.setInterval = originalInterval
  await processAutoRenew(stale)
  const renewed = await prisma.instanceBillingRecord.findFirstOrThrow({ where: { instanceId: instance.id, type: 'renew' } })
  assert.equal(Number(renewed.amount), 3.21); assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), 996.79)
  console.log('PASS automatic scheduler reloads newest final price after stale selection, exactly one new-price debit')
  await reset(); const auditTrigger = 'renew_price_audit_' + randomUUID().replaceAll('-', '')
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${auditTrigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.instance_id=${instance.id} AND NEW.action='instance.renewal_price_update' THEN RAISE EXCEPTION 'isolated audit failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${auditTrigger} BEFORE INSERT ON logs FOR EACH ROW EXECUTE FUNCTION ${auditTrigger}()`)
  try { assert.equal((await put((await get()).json().revision)).statusCode, 500); assert.equal((await read()).renewalPrice, null) }
  finally { await prisma.$executeRawUnsafe(`DROP TRIGGER ${auditTrigger} ON logs`); await prisma.$executeRawUnsafe(`DROP FUNCTION ${auditTrigger}()` ) }
  const holdPath = join(stateRoot, 'recovery-hold.json'); writeFileSync(holdPath, '{}')
  try {
    const heldResponse = await put(revision)
    assert.equal(heldResponse.statusCode, 401, heldResponse.body)
    const { adminInstanceRenewalPrice } = await import('../src/services/admin-instance-renewal-price.js')
    await assert.rejects(adminInstanceRenewalPrice(instance.id, { id: admin.id, ...session }), /RENEWAL_PRICE_RECOVERY_HELD/)
    const beforeHold = await finances()
    await assert.rejects(billing.performRenewal(buyer.id, await read(), 1, undefined, session), /PLATFORM_RECOVERY_HELD/,
      'manual renewal must recheck recovery protection after initial API authentication')
    assert.deepEqual(await finances(),beforeHold)
  } finally { unlinkSync(holdPath) }
  // Protection can become active after authentication while renewal waits for
  // an account row. Observe that real blocking edge, then activate the marker.
  await reset()
  const beforeRace = await finances(), pendingInstance = await read()
  let releaseBalance!: () => void, balanceReady!: (pid: number) => void
  const balanceHeld = new Promise<void>(resolve => { releaseBalance = resolve }), readyBalance = new Promise<number>(resolve => { balanceReady = resolve })
  const balanceBlocker = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM users WHERE id=${buyer.id} FOR UPDATE`
    const [row] = await tx.$queryRaw<Array<{pid:number}>>`SELECT pg_backend_pid() AS pid`
    balanceReady(row.pid);await balanceHeld
  },{timeout:10000})
  const balancePid = await readyBalance
  const protectedRenewal = billing.performRenewal(buyer.id,pendingInstance,1,undefined,session)
    .then(value=>({value,error:null as Error|null}),error=>({value:null,error:error as Error}))
  let observedWait=false
  try {
    const until=Date.now()+2000
    while(Date.now()<until){
      const [blocked]=await prisma.$queryRaw<Array<{count:bigint}>>`SELECT count(*) FROM pg_stat_activity WHERE ${balancePid}=ANY(pg_blocking_pids(pid))`
      if(Number(blocked.count)){observedWait=true;break};await delay(15)
    }
    assert.ok(observedWait,'manual renewal must reach the actual account lock before fault injection')
    writeFileSync(holdPath,'{}')
  }finally{releaseBalance();await balanceBlocker}
  try {
    const result=await protectedRenewal
    assert.match(result.error?.message || '',/PLATFORM_RECOVERY_HELD/)
    assert.deepEqual(await finances(),beforeRace,'late recovery hold rolls back balance, ledger and expiry')
  }finally{unlinkSync(holdPath)}
  console.log('PASS recovery hold activated during manual renewal account-lock wait: no debit, bill or expiry mutation')
  console.log('PASS audit failure rolls back price and revision; recovery protection refuses mutation')
} catch (error) { failure = error } finally {
  await app.close()
  await prisma.log.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.inboxMessage.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.renewalRequest.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.instance.deleteMany({ where: { id: { in: instanceIds } } })
  await prisma.package.delete({ where: { id: pkg.id } }); await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  for (const key of configKeys) {
    const old = savedConfig.find(item => item.key === key)
    if (old) await prisma.systemConfig.upsert({ where: { key }, create: old, update: { value: old.value, description: old.description } })
    else await prisma.systemConfig.deleteMany({ where: { key } })
  }
  if (savedVipRule) await prisma.vipLevelRule.update({ where: { id: savedVipRule.id }, data: { enabled: savedVipRule.enabled, minConsume: savedVipRule.minConsume } })
  else await prisma.vipLevelRule.deleteMany({ where: { type: 'user', level: 5 } })
  invalidateAllConfigCache()
  await closePrismaDatabase(); rmdirSync(stateRoot)
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
