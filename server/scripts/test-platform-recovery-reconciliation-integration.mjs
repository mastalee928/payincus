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
  portLimit: 1, snapshotLimit: 1, backupLimit: 1, siteLimit: 1, trafficLimit: 0n, price: '10.00' } })
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
  await prisma.$executeRawUnsafe('DROP TRIGGER test_recovery_journal_failure ON platform_recovery_reconciliations')
  await prisma.$executeRawUnsafe('DROP FUNCTION test_recovery_journal_failure()')

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
    businessAndRemoteResourcesUntouched: true, realOssRestoreHold: false }
  if (process.env.RECOVERY_RECONCILIATION_RESULT) await writeFile(process.env.RECOVERY_RECONCILIATION_RESULT, JSON.stringify(result))
  console.log(JSON.stringify(result))
} catch (error) { console.error(JSON.stringify({ passed: false, phase, code: error.code || 'ASSERTION_OR_RUNTIME' })); process.exitCode = 1 }
finally {
  await app.close(); await closePrismaDatabase()
  assert.equal(dirname(resolve(folder)), resolve(tmpdir())); assert.ok(folder.split(/[\\/]/).at(-1).startsWith('incudal-recovery-finance-'))
  await rm(folder, { recursive: true, force: true })
}
process.exit(process.exitCode || 0)
