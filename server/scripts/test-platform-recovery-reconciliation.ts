import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'

process.env.DATABASE_URL ||= 'postgresql://recovery_guard:unused@localhost:5432/recovery_guard'
process.env.NODE_ENV = 'test'
const folder = await mkdtemp(join(tmpdir(), 'incudal-reconciliation-'))
process.env.PLATFORM_BACKUP_STATE_DIR = folder
process.env.ADMIN_FRONTEND_URL = 'https://admin.example.test'
const { normalizeRecoveryCorrection } = await import('../src/services/platform-recovery-reconciliation.js')
const routes = (await import('../src/routes/admin-aliyun-oss.js')).default
const input = { id: randomUUID(), holdTaskId: randomUUID(), userId: 2, reference: 'statement-20261024', observedAt: '2026-10-24T00:00:00.000Z',
  expectedBalance: '137.25', targetBalance: '127.25', expectedLatestLogId: null,
  instances: [{ id: 3, expectedVersion: 7, expectedExpiresAt: '2026-10-01T00:00:00.000Z', targetExpiresAt: '2026-11-01T00:00:00.000Z' }], recharges: [] }
assert.deepEqual(normalizeRecoveryCorrection(input), input)
for (const targetBalance of ['-1.00', '1.001', '1e3', '001.00', '100000000.00', 1, 'NaN', '0']) {
  assert.throws(() => normalizeRecoveryCorrection({ ...input, targetBalance }), /OSS_RECONCILIATION_INVALID/)
}
assert.throws(() => normalizeRecoveryCorrection({ ...input, password: 'must-not-be-journaled' }), /OSS_RECONCILIATION_INVALID/)
assert.throws(() => normalizeRecoveryCorrection({ ...input, userId: -1 }), /OSS_RECONCILIATION_INVALID/)
assert.throws(() => normalizeRecoveryCorrection({ ...input, reference: 'https://example.invalid/?token=private' }), /OSS_RECONCILIATION_INVALID/)
assert.throws(() => normalizeRecoveryCorrection({ ...input, observedAt: '2026-02-30T00:00:00.000Z' }), /OSS_RECONCILIATION_INVALID/)
assert.throws(() => normalizeRecoveryCorrection({ ...input, observedAt: '2026-10-24T00:00:00Z' }), /OSS_RECONCILIATION_INVALID/)
assert.throws(() => normalizeRecoveryCorrection({ ...input, instances: [{ ...input.instances[0], targetExpiresAt: input.instances[0].expectedExpiresAt }] }), /OSS_RECONCILIATION_INVALID/)
assert.throws(() => normalizeRecoveryCorrection({ ...input, instances: [input.instances[0], input.instances[0]] }), /OSS_RECONCILIATION_INVALID/)
assert.throws(() => normalizeRecoveryCorrection({ ...input, instances: Array.from({ length: 21 }, (_, i) => ({ ...input.instances[0], id: i + 1 })) }), /OSS_RECONCILIATION_INVALID/)
assert.throws(() => normalizeRecoveryCorrection({ ...input, targetBalance: input.expectedBalance, instances: [] }), /OSS_RECONCILIATION_EMPTY/)
const recharge = { id: 8, orderNo: 'external_123', expectedStatus: 'pending', expectedAmount: '10.00' }
assert.equal(normalizeRecoveryCorrection({ ...input, recharges: [recharge] }).recharges[0].expectedStatus, 'pending')
assert.throws(() => normalizeRecoveryCorrection({ ...input, recharges: [{ ...recharge, expectedStatus: 'completed' }] }), /OSS_RECONCILIATION_INVALID/)
assert.throws(() => normalizeRecoveryCorrection({ ...input, recharges: [{ ...recharge, expectedAmount: '0.00' }] }), /OSS_RECONCILIATION_INVALID/)
assert.throws(() => normalizeRecoveryCorrection({ ...input, recharges: [{ ...recharge, callbackData: {} }] }), /OSS_RECONCILIATION_INVALID/)
const supplied = structuredClone(input), detached = normalizeRecoveryCorrection(supplied)
supplied.instances[0].expectedVersion = 99
assert.equal(detached.instances[0].expectedVersion, 7)
const bill = { reference: 'receipt-renewal-001', amount: '10.00', months: 1, periodStart: input.instances[0].expectedExpiresAt,
  periodEnd: input.instances[0].targetExpiresAt, completedAt: input.observedAt }
const invoiced = { ...input, instances: [{ ...input.instances[0], expectedLatestBillingRecordId: null, renewals: [bill] }] }
assert.deepEqual(normalizeRecoveryCorrection(invoiced), invoiced)
assert.equal(normalizeRecoveryCorrection({ ...invoiced, instances: [{ ...invoiced.instances[0], renewals: [{ ...bill, amount: '0.00' }] }] }).instances[0].renewals![0].amount, '0.00')
for (const change of [{ months: 0 }, { months: 25 }, { months: 1.5 }, { amount: '-1.00' }, { amount: '1.001' },
  { periodStart: bill.periodEnd }, { periodEnd: bill.periodStart }, { completedAt: '2026-10-25T00:00:00.000Z' }, { credentials: 'omitted' }]) {
  assert.throws(() => normalizeRecoveryCorrection({ ...invoiced, instances: [{ ...invoiced.instances[0], renewals: [{ ...bill, ...change }] }] }), /OSS_RECONCILIATION_INVALID/)
}
assert.throws(() => normalizeRecoveryCorrection({ ...input, instances: [{ ...input.instances[0], renewals: [bill] }] }), /OSS_RECONCILIATION_INVALID/)
assert.throws(() => normalizeRecoveryCorrection({ ...input, instances: [{ ...input.instances[0], expectedLatestBillingRecordId: null }] }), /OSS_RECONCILIATION_INVALID/)
assert.throws(() => normalizeRecoveryCorrection({ ...invoiced, instances: [{ ...invoiced.instances[0], renewals: [] }] }), /OSS_RECONCILIATION_INVALID/)
const secondBill = { ...bill, reference: 'receipt-renewal-002', periodStart: bill.periodEnd, periodEnd: '2026-12-01T00:00:00.000Z' }
const chained = { ...invoiced, instances: [{ ...invoiced.instances[0], targetExpiresAt: secondBill.periodEnd, renewals: [bill, secondBill] }] }
assert.equal(normalizeRecoveryCorrection(chained).instances[0].renewals!.length, 2)
assert.throws(() => normalizeRecoveryCorrection({ ...chained, instances: [{ ...chained.instances[0], renewals: [bill, { ...secondBill, reference: bill.reference }] }] }), /OSS_RECONCILIATION_INVALID/)
assert.throws(() => normalizeRecoveryCorrection({ ...chained, instances: [{ ...chained.instances[0], renewals: [bill, { ...secondBill, periodStart: bill.periodStart }] }] }), /OSS_RECONCILIATION_INVALID/)
const settlement = { creditedAmount: '8.50', completedAt: input.observedAt, tradeNo: 'source_trade_001' }
assert.equal(normalizeRecoveryCorrection({ ...input, recharges: [{ ...recharge, settlement }] }).recharges[0].settlement!.creditedAmount, '8.50')
for (const change of [{ creditedAmount: '0.00' }, { creditedAmount: '-1.00' }, { creditedAmount: '1.001' },
  { completedAt: '2026-10-25T00:00:00.000Z' }, { tradeNo: '' }, { tradeNo: '?secret' }, { password: 'omitted' }]) {
  assert.throws(() => normalizeRecoveryCorrection({ ...input, recharges: [{ ...recharge, settlement: { ...settlement, ...change } }] }), /OSS_RECONCILIATION_INVALID/)
}

const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } })
app.decorate('authenticateAdmin', async (request, reply) => {
  const role = request.headers['x-test-role']
  if (role !== 'admin') return reply.code(403).send({ code: 'ADMIN_REQUIRED' })
  request.user = { id: 1, username: request.headers['x-backup-denied'] ? 'other-admin' : 'admin', role: 'admin', sid: request.headers['x-no-session'] ? undefined : 'fixture-session' }
})
await app.register(routes, { prefix: '/api/admin/aliyun-oss' })
const headers = { 'x-test-role': 'admin', authorization: 'Bearer fixture', origin: 'https://admin.example.test' }
const body = { correction: input, password: 'fixture-password' }
try {
  for (const route of ['reconcile', 'reconciliations', 'accounts/2']) {
    const method = route === 'reconcile' ? 'POST' : 'GET'
    const url = `/api/admin/aliyun-oss/recovery-review/${route}`
    for (const denied of [{ ...headers, 'x-test-role': 'user' }, { ...headers, 'x-backup-denied': '1' },
      { ...headers, 'x-no-session': '1' }, { ...headers, origin: 'https://other.example.test' }, { ...headers, 'sec-fetch-site': 'cross-site' }]) {
      const response = await app.inject({ method, url, headers: denied, ...(method === 'POST' ? { payload: body } : {}) })
      assert.equal(response.statusCode, 403)
      assert.ok(!response.body.includes(body.password))
    }
    const absentHold = await app.inject({ method, url, headers, ...(method === 'POST' ? { payload: body } : {}) })
    assert.equal(absentHold.statusCode, 409)
    assert.equal(absentHold.json().code, 'OSS_RECOVERY_NOT_HELD')
  }
  const url = '/api/admin/aliyun-oss/recovery-review/reconcile'
  const largeCorrection = { ...input,
    instances: Array.from({ length: 20 }, (_, i) => ({ ...invoiced.instances[0], id: i + 1,
      renewals: [{ ...bill, reference: 'receipt_' + 'r'.repeat(108) + String(i).padStart(2, '0') }] })),
    recharges: Array.from({ length: 20 }, (_, i) => ({ ...recharge, id: i + 1, orderNo: 'o'.repeat(98) + String(i).padStart(2, '0'),
      settlement: { ...settlement, tradeNo: 't'.repeat(98) + String(i).padStart(2, '0') } })) }
  const largeBody = { ...body, correction: largeCorrection }
  assert.ok(Buffer.byteLength(JSON.stringify(largeBody)) > 16384, 'the bounded new receipt payload exceeds the old body limit')
  assert.equal((await app.inject({ method: 'POST', url, headers, payload: largeBody })).statusCode, 409, 'a valid bounded receipt payload reaches the hold gate instead of failing body parsing')
  assert.equal((await app.inject({ method: 'POST', url, headers: { 'x-test-role': 'admin', authorization: 'Bearer fixture' }, payload: body })).statusCode, 403)
  for (const payload of [{ ...body, command: 'shell' }, { ...body, totpCode: '1' }, { ...body, correction: { ...input, privateKey: 'secret' } }]) {
    assert.equal((await app.inject({ method: 'POST', url, headers, payload })).statusCode, 400)
  }
  const service = await readFile(new URL('../src/services/platform-recovery-reconciliation.ts', import.meta.url), 'utf8')
  const migration = await readFile(new URL('../prisma/migrations/202610240001_platform_recovery_reconciliation/migration.sql', import.meta.url), 'utf8')
  assert.ok(service.includes('authorizeGatewayAdministration(tx, actorId, credentials)'), 'password/MFA proof must be checked in the same transaction')
  assert.ok(service.includes('FOR UPDATE') && service.includes('USER_BALANCE_LOCK_NAMESPACE'), 'administrator credentials and the existing account balance lock are required')
  assert.ok(service.includes('expectedLatestLogId') && service.includes('instance.version === item.expectedVersion'), 'stale and ABA account/expiry snapshots must fail')
  assert.ok(service.includes('changeBalanceInTransaction') && service.includes("status: 'completed'"), 'confirmed recharges must use the normal money ledger and prevent later callback credit')
  assert.ok(service.includes('tx.instanceBillingRecord.create') && service.includes('balanceLogId: log.id') && service.includes("type: 'consume'"), 'recovered paid renewals must link their normal bill to the evidenced consume entry')
  assert.ok(service.includes('expectedLatestBillingRecordId') && service.includes('jsonb_path_exists'), 'existing bills and reused source receipts must prevent duplicate recovery')
  assert.ok(service.includes('payload: correction') && !service.includes('payload: credentials'), 'reauthentication secrets must never enter the evidence journal')
  assert.ok(migration.includes('CREATE UNIQUE INDEX "platform_recovery_evidence_key"') && migration.includes('"payload" JSONB NOT NULL'), 'evidence deduplication and durable journal must be enforced by the database')
  const form = await readFile(new URL('../../client/src/components/backup/OssRecoveryReconcile.vue', import.meta.url), 'utf8')
  assert.ok(form.includes('showModal()') && form.includes('@cancel="cancel"'), 'financial correction uses a native modal with keyboard cancellation')
  assert.ok(form.includes('const requestId = crypto.randomUUID()') && form.includes('id: requestId'), 'a failed response must retain the same idempotency identity')
  assert.ok(form.includes("password.value = ''; totpCode.value = ''") && !form.includes('localStorage'), 'reauthentication values must be cleared and never stored in browser persistence')
  assert.ok(form.includes('expectedLatestLogId: account.account.latestBalanceLogId') && form.includes('expectedVersion: row.version'), 'the form must bind the exact read snapshot instead of overriding a stale account')
  const view = await readFile(new URL('../../client/src/views/admin/AliyunOssView.vue', import.meta.url), 'utf8')
  assert.ok(view.includes('activeTask.value = result.activeTask') && !view.includes('tasks.value.some(task => task.status'), 'historical interrupted checkpoints must not block a current recovery review')
  console.log('Recovery reconciliation guards passed: strict money/evidence, stale identities, Web permissions, hold and transactional journal boundaries.')
} finally { await app.close(); await rm(folder, { recursive: true, force: true }) }
process.exit(0)
