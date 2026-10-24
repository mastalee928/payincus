import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

assert.equal(process.env.INCUDAL_RECOVERY_RECONCILIATION_INTEGRATION, '1', 'explicit isolated PostgreSQL opt-in is required')
const connection = new URL(process.env.DATABASE_URL || '')
assert.equal(connection.hostname, '127.0.0.1')
assert.ok(connection.pathname.endsWith('_recovery_test'))
assert.notEqual(connection.port || '5432', '5432')
const appDir = resolve(process.env.INCUDAL_APP_DIR || join(import.meta.dirname, '..', '..'))
const require = createRequire(join(appDir, 'server/package.json'))
const Fastify = require('fastify'), bcrypt = require('bcryptjs'), { authenticator } = require('otplib')
const folder = await mkdtemp(join(tmpdir(), 'incudal-recovery-finance-'))
Object.assign(process.env, { NODE_ENV: 'test', PLATFORM_BACKUP_STATE_DIR: folder, ENV_FILE: join(folder, 'absent.env'),
  ADMIN_FRONTEND_URL: 'https://admin.example.test', ENCRYPTION_KEY: randomUUID() + randomUUID() })
const load = path => import(pathToFileURL(join(appDir, 'server/dist', path)).href)
const { prisma, closePrismaDatabase } = await load('db/prisma.js')
const { changeBalance } = await load('db/balance.js')
const { encryptGatewayTaskSecret } = await load('services/gateway-admin-authorization.js')
const routes = (await load('routes/admin-aliyun-oss.js')).default
const password = randomUUID() + randomUUID(), hash = await bcrypt.hash(password, 4), suffix = randomUUID()
const actor = await prisma.user.create({ data: { username: 'recovery-operator-' + suffix, passwordHash: hash, role: 'admin', status: 'active' } })
const customer = await prisma.user.create({ data: { username: 'recovery-customer-' + suffix, passwordHash: hash, balance: '100.00' } })
const other = await prisma.user.create({ data: { username: 'recovery-other-' + suffix, passwordHash: hash } })
process.env.PLATFORM_BACKUP_ALLOWED_ADMIN_IDS = `${actor.id},${customer.id}`
const host = await prisma.host.create({ data: { userId: actor.id, name: 'recovery-finance-' + suffix, url: 'https://10.251.90.2:8443' } })
const pkg = await prisma.package.create({ data: { userId: actor.id, name: 'recovery-finance-' + suffix, cpuMax: 300, memoryMax: 1024, diskMax: 1024 } })
const plan = await prisma.packagePlan.create({ data: { packageId: pkg.id, name: 'paid', cpu: 100, memory: 64, disk: 1024,
  portLimit: 1, snapshotLimit: 1, backupLimit: 1, siteLimit: 1, trafficLimit: 0n, price: '1000.00' } })
const expired = new Date(Date.now() - 86400000), extended = new Date(Date.now() + 30 * 86400000)
const instanceData = { userId: customer.id, hostId: host.id, packageId: pkg.id, packagePlanId: plan.id, image: 'test', cpu: 1, memory: 64, disk: 1,
  status: 'running', expiresAt: expired, version: 4, billingPrice: '10.00', billingCycle: 1, autoRenew: true }
const instance = await prisma.instance.create({ data: { ...instanceData, incusId: 'kept-' + suffix, name: 'kept-' + suffix } })
const untouched = await prisma.instance.create({ data: { ...instanceData, incusId: 'untouched-' + suffix, name: 'untouched-' + suffix } })
const foreign = await prisma.instance.create({ data: { ...instanceData, userId: other.id, incusId: 'foreign-' + suffix, name: 'foreign-' + suffix } })
const provider = await prisma.paymentProvider.create({ data: { name: 'recovery-finance-test', type: 'manual', config: {} } })
const recharge = await prisma.rechargeRecord.create({ data: { userId: customer.id, providerId: provider.id, orderNo: 'recovery_' + suffix.replaceAll('-', ''), amount: '40.00' } })
const secondRecharge = await prisma.rechargeRecord.create({ data: { userId: customer.id, providerId: provider.id, orderNo: 'second_' + suffix.replaceAll('-', ''), amount: '5.00' } })
const holdId = randomUUID(), observedAt = new Date(Date.now() - 1000).toISOString()
await writeFile(join(folder, 'recovery-hold.json'), JSON.stringify({ taskId: holdId, mode: 'restore', createdAt: observedAt,
  snapshot: { createdAt: new Date(Date.now() - 3600000).toISOString(), version: '1.7.1' } }))
const correction = { id: randomUUID(), holdTaskId: holdId, userId: customer.id, reference: 'external-ledger-' + suffix, observedAt,
  expectedBalance: '100.00', targetBalance: '130.00', expectedLatestLogId: null,
  instances: [{ id: instance.id, expectedVersion: 4, expectedExpiresAt: expired.toISOString(), targetExpiresAt: extended.toISOString() }],
  recharges: [{ id: recharge.id, orderNo: recharge.orderNo, expectedStatus: 'pending', expectedAmount: '40.00' }] }
const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } })
app.decorate('authenticateAdmin', async request => {
  request.user = { id: Number(request.headers['x-test-actor'] || actor.id), role: 'admin', username: actor.username, sid: 'integration-session' }
})
await app.register(routes, { prefix: '/api/admin/aliyun-oss' })
const base = '/api/admin/aliyun-oss/recovery-review', headers = { origin: process.env.ADMIN_FRONTEND_URL, authorization: 'Bearer fixture' }
let phase = 'atomic-correction'
const apply = (value, credentials = {}) => app.inject({ method: 'POST', url: base + '/reconcile', headers,
  payload: { correction: value, password, ...credentials } })
const balance = async () => (await prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).balance.toFixed(2)
const logs = async () => prisma.balanceLog.count({ where: { userId: customer.id } })
const latest = async () => (await prisma.balanceLog.findFirst({ where: { userId: customer.id }, orderBy: { id: 'desc' } }))?.id || null
const next = async (overrides = {}) => ({ ...correction, id: randomUUID(), reference: 'next-' + randomUUID(), expectedBalance: await balance(),
  targetBalance: '135.00', expectedLatestLogId: await latest(), instances: [], recharges: [], ...overrides })
async function ledgerFixture() {
  const key = randomUUID(), user = await prisma.user.create({ data: { username: 'ledger-' + key, passwordHash: hash, balance: '100.00' } })
  const instance = await prisma.instance.create({ data: { ...instanceData, userId: user.id, name: 'ledger-' + key, incusId: 'ledger-' + key } })
  const recharge = await prisma.rechargeRecord.create({ data: { userId: user.id, providerId: provider.id, orderNo: 'ledger_' + key.replaceAll('-', ''), amount: '40.00' } })
  return { user, instance, recharge, key }
}
function ledgerCorrection(fixture, overrides = {}) {
  return { ...correction, id: randomUUID(), reference: 'ledger-' + fixture.key, userId: fixture.user.id, expectedBalance: '100.00', targetBalance: '128.00',
    instances: [{ id: fixture.instance.id, expectedVersion: 4, expectedExpiresAt: expired.toISOString(), targetExpiresAt: extended.toISOString(),
      expectedLatestBillingRecordId: null, renewals: [{ reference: 'renew-' + fixture.key, amount: '10.00', months: 1,
        periodStart: expired.toISOString(), periodEnd: extended.toISOString(), completedAt: observedAt }] }],
    recharges: [{ id: fixture.recharge.id, orderNo: fixture.recharge.orderNo, expectedStatus: 'pending', expectedAmount: '40.00',
      settlement: { creditedAmount: '38.00', completedAt: new Date(Date.parse(observedAt) - 500).toISOString(), tradeNo: 'trade_' + fixture.key.replaceAll('-', '') } }], ...overrides }
}
try {
  const first = await apply(correction)
  assert.equal(first.statusCode, 200); assert.equal(first.json().replayed, false)
  assert.equal(await balance(), '130.00'); assert.equal(await logs(), 2)
  assert.equal((await prisma.rechargeRecord.findUniqueOrThrow({ where: { id: recharge.id } })).status, 'completed')
  const changed = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
  assert.equal(changed.version, 5); assert.equal(changed.expiresAt.toISOString(), extended.toISOString())
  assert.equal(changed.status, 'running'); assert.equal(changed.autoRenewAttempts, 0)
  const report = await app.inject({ method: 'GET', url: base, headers })
  assert.equal(report.json().snapshotOnly, false); assert.equal(report.json().reconciliationCount, 1)
  const accountRead = await app.inject({ method: 'GET', url: `${base}/accounts/${customer.id}`, headers })
  assert.equal(accountRead.statusCode, 200); assert.equal(accountRead.json().account.balance, '130.00')
  assert.equal(accountRead.json().account.latestBalanceLogId, await latest())
  assert.ok(accountRead.json().instances.some(row => row.id === instance.id && row.eligible))
  assert.ok(!accountRead.body.includes('passwordHash') && !accountRead.body.includes('callbackData'))

  phase = 'idempotency'
  const retry = await apply(correction)
  assert.equal(retry.statusCode, 200); assert.equal(retry.json().replayed, true)
  assert.equal(await logs(), 2); assert.equal(await balance(), '130.00')
  assert.equal((await apply({ ...correction, targetBalance: '140.00' })).statusCode, 409)
  assert.equal((await apply({ ...correction, id: randomUUID() })).statusCode, 409)

  phase = 'aba-and-stale'
  const aba = await next()
  assert.equal((await changeBalance({ userId: customer.id, type: 'admin_adjust', amount: 5 })).success, true)
  assert.equal((await changeBalance({ userId: customer.id, type: 'admin_adjust', amount: -5 })).success, true)
  assert.equal(await balance(), '130.00')
  assert.equal((await apply(aba)).statusCode, 409)
  assert.equal((await apply(await next({ instances: correction.instances }))).statusCode, 409)
  assert.equal((await apply(await next({ instances: [{ ...correction.instances[0], id: foreign.id }] }))).statusCode, 409)
  assert.equal((await apply(await next({ holdTaskId: randomUUID() }))).statusCode, 409)
  assert.equal((await apply(await next({ observedAt: new Date(Date.now() - 7200000).toISOString() }))).statusCode, 400)

  phase = 'failure-rolls-back-every-write'
  await prisma.$executeRawUnsafe(`CREATE FUNCTION test_recovery_journal_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.reference = 'guard-rollback' THEN RAISE EXCEPTION 'injected persistence failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe('CREATE TRIGGER test_recovery_journal_failure BEFORE INSERT ON platform_recovery_reconciliations FOR EACH ROW EXECUTE FUNCTION test_recovery_journal_failure()')
  const beforeLogs = await logs(), beforeJournals = await prisma.platformRecoveryReconciliation.count()
  const failing = await next({ reference: 'guard-rollback', targetBalance: '140.00', instances: [{ ...correction.instances[0], id: untouched.id }],
    recharges: [{ id: secondRecharge.id, orderNo: secondRecharge.orderNo, expectedStatus: 'pending', expectedAmount: '5.00' }] })
  assert.ok((await apply(failing)).statusCode >= 500)
  assert.equal(await balance(), '130.00'); assert.equal(await logs(), beforeLogs)
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: untouched.id } })).version, 4)
  assert.equal((await prisma.rechargeRecord.findUniqueOrThrow({ where: { id: secondRecharge.id } })).status, 'pending')
  assert.equal(await prisma.platformRecoveryReconciliation.count(), beforeJournals)
  const rollbackLedger = await ledgerFixture(), rollbackInvoice = ledgerCorrection(rollbackLedger, { reference: 'guard-rollback' })
  assert.ok((await apply(rollbackInvoice)).statusCode >= 500)
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: rollbackLedger.user.id } })).balance.toFixed(2), '100.00')
  assert.equal(await prisma.balanceLog.count({ where: { userId: rollbackLedger.user.id } }), 0)
  assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: rollbackLedger.instance.id } }), 0)
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: rollbackLedger.instance.id } })).version, 4)
  assert.equal((await prisma.rechargeRecord.findUniqueOrThrow({ where: { id: rollbackLedger.recharge.id } })).status, 'pending')
  await prisma.$executeRawUnsafe('DROP TRIGGER test_recovery_journal_failure ON platform_recovery_reconciliations')
  await prisma.$executeRawUnsafe('DROP FUNCTION test_recovery_journal_failure()')

  phase = 'normal-renewal-ledger-and-refund-quote'
  const ledger = await ledgerFixture(), invoice = ledgerCorrection(ledger)
  const { getMaxRefundable, calculateInstanceRemainingRefundQuote } = await load('db/billing-operations.js')
  assert.equal((await getMaxRefundable(ledger.instance.id)).maxRefundable, 0)
  const oldEvidence = { ...invoice, instances: [{ ...invoice.instances[0], renewals: [{ ...invoice.instances[0].renewals[0], completedAt: new Date(Date.now() - 7200000).toISOString() }] }] }
  assert.equal((await apply(oldEvidence)).statusCode, 400, 'an existing snapshot-period bill is not a missed post-backup payment')
  const invoiceResult = await apply(invoice)
  assert.equal(invoiceResult.statusCode, 200)
  assert.equal(invoiceResult.json().result.restoredRenewals.length, 1)
  const billRow = await prisma.instanceBillingRecord.findFirstOrThrow({ where: { instanceId: ledger.instance.id } })
  const consume = await prisma.balanceLog.findUniqueOrThrow({ where: { id: billRow.balanceLogId } })
  assert.equal(billRow.type, 'renew'); assert.equal(billRow.amount.toFixed(2), '10.00'); assert.equal(billRow.months, 1)
  assert.equal(billRow.periodStart.toISOString(), expired.toISOString()); assert.equal(billRow.periodEnd.toISOString(), extended.toISOString())
  assert.equal(billRow.createdAt.toISOString(), observedAt); assert.equal(consume.createdAt.toISOString(), observedAt)
  assert.equal(consume.type, 'consume'); assert.equal(consume.amount.toFixed(2), '-10.00')
  assert.equal(consume.balanceBefore.toFixed(2), '138.00'); assert.equal(consume.balanceAfter.toFixed(2), '128.00')
  const settled = await prisma.rechargeRecord.findUniqueOrThrow({ where: { id: ledger.recharge.id } })
  assert.equal(settled.actualAmount.toFixed(2), '38.00'); assert.equal(settled.tradeNo, invoice.recharges[0].settlement.tradeNo)
  assert.equal(settled.completedAt.toISOString(), invoice.recharges[0].settlement.completedAt)
  assert.equal(await prisma.balanceLog.count({ where: { userId: ledger.user.id, type: 'admin_adjust' } }), 0)
  assert.deepEqual(await getMaxRefundable(ledger.instance.id), { maxRefundable: 10, lastPaymentAmount: 10 })
  const updatedLedgerInstance = await prisma.instance.findUniqueOrThrow({ where: { id: ledger.instance.id } })
  const refundQuote = await calculateInstanceRemainingRefundQuote(updatedLedgerInstance)
  assert.equal(refundQuote.maxRefundable, 10); assert.ok(refundQuote.refundableValue > 0 && refundQuote.refundableValue <= 10)
  assert.equal((await apply(invoice)).json().replayed, true)
  assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: ledger.instance.id } }), 1)
  assert.equal(await prisma.balanceLog.count({ where: { userId: ledger.user.id } }), 2)
  const ledgerLatest = (await prisma.balanceLog.findFirstOrThrow({ where: { userId: ledger.user.id }, orderBy: { id: 'desc' } })).id
  const laterEnd = new Date(extended.getTime() + 31 * 86400000).toISOString()
  const reused = { ...invoice, id: randomUUID(), reference: 'reuse-' + randomUUID(), expectedBalance: '128.00', targetBalance: '118.00',
    expectedLatestLogId: ledgerLatest, recharges: [], instances: [{ ...invoice.instances[0], expectedVersion: updatedLedgerInstance.version,
      expectedExpiresAt: extended.toISOString(), targetExpiresAt: laterEnd, expectedLatestBillingRecordId: billRow.id,
      renewals: [{ ...invoice.instances[0].renewals[0], periodStart: extended.toISOString(), periodEnd: laterEnd }] }] }
  assert.equal((await apply(reused)).statusCode, 409, 'the same source receipt cannot be applied to another service period')
  assert.equal((await apply({ ...reused, instances: [{ ...reused.instances[0], expectedLatestBillingRecordId: null,
    renewals: [{ ...reused.instances[0].renewals[0], reference: 'fresh-' + randomUUID() }] }] })).statusCode, 409, 'a changed bill history invalidates the read snapshot')
  const crossAccount = ledgerCorrection({ ...ledger, user: other, instance: foreign }, { id: randomUUID(), reference: 'cross-' + randomUUID(),
    expectedBalance: '0.00', targetBalance: '0.00', recharges: [] })
  assert.equal((await apply(crossAccount)).statusCode, 409, 'a source receipt cannot be assigned to another account')

  phase = 'multiple-and-zero-renewal-evidence'
  const multiple = await ledgerFixture(), firstEnd = extended.toISOString(), finalEnd = new Date(extended.getTime() + 31 * 86400000).toISOString()
  const multiInput = ledgerCorrection(multiple, { recharges: [], targetBalance: '70.00' })
  multiInput.instances[0].targetExpiresAt = finalEnd
  multiInput.instances[0].renewals = [{ ...multiInput.instances[0].renewals[0], completedAt: new Date(Date.parse(observedAt) - 500).toISOString() },
    { reference: 'second-' + multiple.key, amount: '20.00', months: 1, periodStart: firstEnd, periodEnd: finalEnd, completedAt: observedAt }]
  assert.equal((await apply(multiInput)).statusCode, 200)
  assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: multiple.instance.id } }), 2)
  assert.deepEqual(await getMaxRefundable(multiple.instance.id), { maxRefundable: 30, lastPaymentAmount: 20 })
  const zero = await ledgerFixture(), zeroInput = ledgerCorrection(zero, { recharges: [], targetBalance: '100.00' })
  zeroInput.instances[0].renewals[0].amount = '0.00'
  assert.equal((await apply(zeroInput)).statusCode, 200)
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: zero.user.id } })).balance.toFixed(2), '100.00')
  assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: zero.instance.id } }), 1)
  assert.equal((await getMaxRefundable(zero.instance.id)).maxRefundable, 0)
  const existing = await ledgerFixture(), existingInput = ledgerCorrection(existing)
  const existingBill = await prisma.instanceBillingRecord.create({ data: { userId: existing.user.id, instanceId: existing.instance.id, type: 'renew', amount: 10,
    months: 1, periodStart: expired, periodEnd: extended, createdAt: new Date(observedAt) } })
  existingInput.instances[0].expectedLatestBillingRecordId = existingBill.id
  assert.equal((await apply(existingInput)).statusCode, 409, 'an already recorded service period must not be charged or inserted again')
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: existing.user.id } })).balance.toFixed(2), '100.00')
  const ceiling = await ledgerFixture(), ceilingInput = ledgerCorrection(ceiling, { expectedBalance: '99999999.99', targetBalance: '99999999.99' })
  await prisma.user.update({ where: { id: ceiling.user.id }, data: { balance: '99999999.99' } })
  assert.equal((await apply(ceilingInput)).statusCode, 200, 'whole ledger entries may settle without overflowing the wallet')
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: ceiling.user.id } })).balance.toFixed(2), '99999999.99')

  phase = 'reauth-mfa-and-secret-omission'
  assert.equal((await apply(await next(), { password: randomUUID() })).statusCode, 403)
  const secret = authenticator.generateSecret(), encrypted = encryptGatewayTaskSecret(secret)
  await prisma.user.update({ where: { id: actor.id }, data: { twoFactorEnabled: true, twoFactorSecret: encrypted } })
  const mfa = await next(), code = authenticator.generate(secret)
  assert.equal((await apply(mfa)).statusCode, 403)
  assert.equal((await apply(mfa, { totpCode: code })).statusCode, 200)
  assert.equal((await apply(mfa, { totpCode: code })).json().code, 'OSS_RECONCILIATION_MFA_REPLAYED')
  const journals = await app.inject({ method: 'GET', url: base + '/reconciliations', headers })
  assert.equal(journals.statusCode, 200)
  const persisted = JSON.stringify(await prisma.platformRecoveryReconciliation.findMany())
  for (const material of [password, secret, encrypted]) { assert.ok(!journals.body.includes(material)); assert.ok(!persisted.includes(material)) }
  assert.ok(!journals.body.includes('callbackData') && !journals.body.includes('providerConfigSnapshot'))
  phase = 'concurrent-retry'
  await prisma.user.update({ where: { id: actor.id }, data: { twoFactorEnabled: false, twoFactorSecret: null } })
  const concurrent = await next({ targetBalance: '140.00' }), beforeConcurrentLogs = await logs()
  const concurrentResults = await Promise.all([apply(concurrent), apply(concurrent)])
  assert.ok(concurrentResults.every(response => response.statusCode === 200))
  assert.deepEqual(concurrentResults.map(response => response.json().replayed).sort(), [false, true])
  assert.equal(await balance(), '140.00'); assert.equal(await logs(), beforeConcurrentLogs + 1)
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).poolFaulted, false)
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: untouched.id } })).status, 'running')
  const result = { passed: true, realPostgres: true, realFastifyRoute: true, fixtureWebIdentity: true, productionPasswordAndMfaVerification: true,
    atomicBalanceExpiryRechargeAndAudit: true, retryDoesNotDebitAgain: true, evidenceConflictRejected: true, balanceAbaRejected: true,
    staleExpiryAndForeignAccountRejected: true, journalFailureRollsBackAllWrites: true, concurrentRetryDebitsOnce: true, mfaReplayRejected: true, secretsNotJournaled: true,
    businessAndRemoteResourcesUntouched: true, realOssRestoreHold: false, normalRenewalAndConsumeLedgerRecovered: true,
    creditedNetAmountAndSettlementRecovered: true, refundQuoteIncludesRecoveredRenewal: true, renewalReceiptCannotBeReused: true,
    multipleAndZeroRenewalsRecovered: true, journalFailureRollsBackBillingRecords: true }
  if (process.env.RECOVERY_RECONCILIATION_RESULT) await writeFile(process.env.RECOVERY_RECONCILIATION_RESULT, JSON.stringify(result))
  console.log(JSON.stringify(result))
} catch (error) { console.error(JSON.stringify({ passed: false, phase, code: error.code || 'ASSERTION_OR_RUNTIME' })); process.exitCode = 1 }
finally {
  await app.close(); await closePrismaDatabase()
  assert.equal(dirname(resolve(folder)), resolve(tmpdir())); assert.ok(folder.split(/[\\/]/).at(-1).startsWith('incudal-recovery-finance-'))
  await rm(folder, { recursive: true, force: true })
}
process.exit(process.exitCode || 0)
