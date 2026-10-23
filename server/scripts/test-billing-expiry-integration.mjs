import assert from 'node:assert/strict'
import { readFile, mkdtemp, chmod, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:https'
// Explicit opt-in: this test creates data only in an empty local test database.
const database = new URL(process.env.DATABASE_URL || 'postgresql://localhost/invalid')
assert.equal(process.env.BILLING_EXPIRY_INTEGRATION_TEST, '1', 'explicit integration test opt-in required')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_expiry_test'), 'use a dedicated local *_expiry_test database')
const root = await mkdtemp(join(tmpdir(), 'incudal-expiry-integration-'))
await chmod(root, 0o700)
process.env.NODE_ENV = 'test'
process.env.PLATFORM_BACKUP_STATE_DIR = root
process.env.ENV_FILE = join(root, 'missing.env')
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-keyout', join(root, 'tls.key'), '-out', join(root, 'tls.crt')], { stdio: 'pipe' })
await chmod(join(root, 'tls.key'), 0o600)
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
assert.equal(await prisma.user.count(), 0, 'test database must contain no users')
assert.equal(await prisma.host.count(), 0, 'test database must contain no hosts')
assert.equal(await prisma.instance.count(), 0, 'test database must contain no instances')
const { executeAutoRenew, executeExpiryEnforcement, getExpiryEnforcementStatus, startExpiryEnforcement } = await import('../src/services/billing-scheduler.js')
const { performRenewal } = await import('../src/db/billing-operations.js')
const { withInstanceBillingMutation } = await import('../src/lib/instance-billing-mutation.js')
const cron = await import('node-cron')
const remote = new Map()
let offline = true, failDelete = false, stopCount = 0, deleteCount = 0
const server = createServer({ key: await readFile(root + '/tls.key'), cert: await readFile(root + '/tls.crt') }, async (request, response) => {
  const url = new URL(request.url, 'https://fixture')
  let body = ''; for await (const chunk of request) body += chunk
  const send = (metadata, code = 200) => { response.writeHead(code, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ type: code === 200 ? 'sync' : 'error', metadata, error: code === 200 ? '' : code === 404 ? 'Instance not found' : 'offline fixture' })) }
  if (url.pathname === '/1.0') return send({ api_version: '1.0' })
  if (url.pathname === '/1.0/operations') return send({})
  if (url.pathname.includes('/forwards')) return send([])
  if (offline) return send({}, 503)
  if (url.pathname === '/1.0/instances') return send([...remote.keys()].map(name => '/1.0/instances/' + name))
  const match = /^\/1\.0\/instances\/([^/]+)(\/state)?$/.exec(url.pathname)
  if (!match) return send({}, 404)
  const name = match[1]
  if (!remote.has(name)) return send({}, 404)
  if (request.method === 'GET' && match[2]) return send({ status: remote.get(name) || 'Stopped' })
  if (request.method === 'PUT') { assert.equal(JSON.parse(body).action, 'stop'); stopCount++; remote.set(name, 'Stopped'); return send({}) }
  if (request.method === 'DELETE') { deleteCount++; if (failDelete) { if (failDelete === 'accepted') remote.delete(name); return send({}, 503) } remote.delete(name); return send({}) }
  return send({})
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const owner = await prisma.user.create({ data: { username: 'expiry-fixture-owner', passwordHash: 'unusable', role: 'admin' } })
const user = await prisma.user.create({ data: { username: 'expiry-fixture-buyer', passwordHash: 'unusable', balance: 100 } })
const poor = await prisma.user.create({ data: { username: 'expiry-fixture-insufficient', passwordHash: 'unusable', balance: 0 } })
const pkg = await prisma.package.create({ data: { userId: owner.id, name: 'Expiry fixtures', cpuMax: 100, memoryMax: 128, diskMax: 1024 } })
const plan = await prisma.packagePlan.create({ data: { packageId: pkg.id, name: 'Expiry fixtures', cpu: 100, memory: 128, disk: 1024,
  portLimit: 1, snapshotLimit: 0, backupLimit: 0, siteLimit: 0, trafficLimit: 0n, price: 10 } })
const host = await prisma.host.create({ data: { userId: owner.id, name: 'expiry-fixture-host', url: 'https://127.0.0.1:' + server.address().port,
  certPath: root + '/tls.crt', keyPath: root + '/tls.key', status: 'online', cpuAllowanceMax: 200, memoryMax: 768, storageSize: 34 } })
async function instance(name, data = {}) {
  remote.set(name, 'Running')
  return prisma.instance.create({ data: { userId: user.id, hostId: host.id, name, incusId: name, status: 'running', image: 'fixture',
    cpu: 100, memory: 128, disk: 1024, packageId: pkg.id, packagePlanId: plan.id, billingPrice: 10, billingCycle: 1,
    expiresAt: new Date(Date.now() - 60000), ...data } })
}
const stopTarget = await instance('expiry-stop-retry')
const renewed = await instance('expiry-renew-before-run')
const manual = await instance('expiry-manual', { status: 'suspended', suspendReason: 'manual', suspendedBy: owner.id })
const free = await instance('expiry-free', { packagePlanId: null })
const unexpired = await instance('expiry-stale-suspension', { status: 'suspended', suspendReason: 'expired', suspendedBy: null,
  suspendedAt: new Date(Date.now() - 60000), expiresAt: new Date(Date.now() + 86400000) })
let passed = false
try {
  await executeExpiryEnforcement()
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: stopTarget.id } })).status, 'suspended')
  assert.equal(stopCount, 0); assert.ok((await getExpiryEnforcementStatus()).failureCount > 0)
  const renewSnapshot = await prisma.instance.findUniqueOrThrow({ where: { id: renewed.id } })
  const renewalResults = await Promise.allSettled([performRenewal(user.id, renewSnapshot, 1), performRenewal(user.id, renewSnapshot, 1)])
  assert.equal(renewalResults.filter(item => item.status === 'fulfilled').length, 1)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance), 90)
  offline = false; await executeExpiryEnforcement()
  assert.equal(remote.get(stopTarget.incusId), 'Stopped')
  assert.equal(remote.get(renewed.incusId), 'Running')
  assert.equal(remote.get(manual.incusId), 'Running'); assert.equal(remote.get(free.incusId), 'Running')
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: unexpired.id } })).suspendReason, null)
  assert.equal(remote.get(unexpired.incusId), 'Running')
  const stopped = stopCount; await executeExpiryEnforcement(); assert.equal(stopCount, stopped)
  const deleting = await instance('expiry-delete-retry', { status: 'suspended', suspendReason: 'expired', suspendedBy: null,
    suspendedAt: new Date(Date.now() - 4 * 86400000) })
  failDelete = true; await executeExpiryEnforcement()
  const pending = await prisma.instance.findUniqueOrThrow({ where: { id: deleting.id } })
  assert.equal(pending.status, 'deleted'); assert.equal(pending.deletionBillingPending, true)
  assert.equal(await prisma.instance.count({ where: { hostId: host.id, OR: [{ status: { not: 'deleted' } }, { deletionBillingPending: true }] } }), 6)
  failDelete = 'accepted'; await executeExpiryEnforcement()
  assert.equal(remote.has(deleting.incusId), false)
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: deleting.id } })).deletionBillingPending, true, 'lost DELETE acknowledgement retains allocation until the next verified reconciliation')
  failDelete = false; await executeExpiryEnforcement()
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: deleting.id } })).deletionBillingPending, false)
  assert.equal(remote.has(deleting.incusId), false)
  const deleteCalls = deleteCount; await executeExpiryEnforcement(); assert.equal(deleteCount, deleteCalls)
  assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: renewed.id, type: 'renew' } }), 1)
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: renewed.id } })).expiresAt > new Date(), true)
  const statuses = await Promise.all(Array.from({length: 8}, () => startExpiryEnforcement()))
  assert.ok(statuses.every(status => status.enabled))
  const tasks = [...cron.getTasks().values()].filter(task => task.name === 'instance-expiry-enforcement')
  assert.equal(tasks.length, 1)
  await tasks[0].stop(); assert.equal((await getExpiryEnforcementStatus()).enabled, false)
  await startExpiryEnforcement(); assert.equal((await getExpiryEnforcementStatus()).enabled, true)
  assert.equal([...cron.getTasks().values()].filter(task => task.name === 'instance-expiry-enforcement').length, 1)
  await tasks[0].destroy()
  await withInstanceBillingMutation(stopTarget.id, async () => {})
  const catchup = await instance('expiry-missed-renew-running', { autoRenew: true, expiresAt: new Date(Date.now() - 36 * 3600000) })
  const catchupSuspended = await instance('expiry-missed-renew-suspended', { autoRenew: true, status: 'suspended', suspendReason: 'expired', suspendedBy: null,
    suspendedAt: new Date(Date.now() - 4 * 86400000), expiresAt: new Date(Date.now() - 5 * 86400000) })
  const manualAuto = await instance('expiry-auto-manual', { autoRenew: true, status: 'suspended', suspendReason: 'manual', suspendedBy: owner.id })
  const freeAuto = await instance('expiry-auto-free', { autoRenew: true, packagePlanId: null })
  const farAuto = await instance('expiry-auto-far', { autoRenew: true, expiresAt: new Date(Date.now() + 7 * 86400000) })
  const hold = join(root, 'recovery-hold.json')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(hold, '{}')
  await executeAutoRenew(); await executeExpiryEnforcement()
  assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: catchup.id, type: 'renew' } }), 0, 'recovery protection blocks automatic charges')
  await unlink(hold)
  await Promise.all([executeAutoRenew(), executeAutoRenew(), executeExpiryEnforcement(), executeExpiryEnforcement()])
  for (const target of [catchup, catchupSuspended]) {
    const current = await prisma.instance.findUniqueOrThrow({ where: { id: target.id } })
    assert.ok(current.expiresAt > new Date()); assert.equal(current.suspendReason, null)
    assert.equal(current.lastAutoRenewAttemptAt, null)
    assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: target.id, type: 'renew' } }), 1)
    assert.equal(remote.get(target.incusId), 'Running', 'catchup settles before remote stop/delete')
  }
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance), 70, 'one charge per missed renewal despite overlapping jobs')
  for (const target of [manualAuto, freeAuto, farAuto]) assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: target.id, type: 'renew' } }), 0)
  const disabledDuringWait = await instance('expiry-auto-disabled-in-lane', { autoRenew: true })
  const staleAutomatic = await prisma.instance.findUniqueOrThrow({ where: { id: disabledDuringWait.id } })
  await withInstanceBillingMutation(disabledDuringWait.id, async () => { await prisma.instance.update({ where: { id: disabledDuringWait.id }, data: { autoRenew: false } }) })
  await assert.rejects(performRenewal(user.id, staleAutomatic, 1, { expiryThreshold: new Date(Date.now() + 86400000) }))
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).balance), 70, 'disabled automatic charge rolls back the balance transaction')
  const insufficient = await instance('expiry-auto-insufficient', { userId: poor.id, autoRenew: true })
  await executeExpiryEnforcement(); await executeExpiryEnforcement()
  let failed = await prisma.instance.findUniqueOrThrow({ where: { id: insufficient.id } })
  assert.equal(failed.autoRenewAttempts, 1, 'repeated five-minute runs preserve hourly retries')
  assert.equal(failed.status, 'suspended'); assert.equal(remote.get(insufficient.incusId), 'Stopped')
  for (const expected of [2, 3]) {
    await prisma.instance.update({ where: { id: insufficient.id }, data: { lastAutoRenewAttemptAt: new Date(Date.now() - 61 * 60000), suspendedAt: new Date(Date.now() - 4 * 86400000) } })
    await executeExpiryEnforcement()
    failed = await prisma.instance.findUniqueOrThrow({ where: { id: insufficient.id } })
    assert.equal(failed.autoRenewAttempts, expected)
    if (expected < 3) assert.equal(remote.has(insufficient.incusId), true, 'pending bounded retries retain stopped disk')
  }
  assert.equal(remote.has(insufficient.incusId), false, 'exhausted retries do not retain unpaid expired disks past grace')
  assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: insufficient.id, type: 'renew' } }), 0)
  const result = { passed: true, realPostgres: true, httpIncusFixture: true, realCustomerOperations: false, offlineSuspensionPreserved: true,
    reconnectStopRetried: true, manualAndFreePreserved: true, concurrentRenewChargedOnce: true, renewedNotStopped: true,
    uncertainDeleteKeepsAllocation: true, laterDeleteFinalizesOnce: true, noDuplicateStops: true, restartIdempotent: true,
    missedRenewalCatchup: true, renewalBeforeDeletion: true, recoveryBlocksCharges: true, boundedHourlyRetries: true, staleAutomaticRollsBack: true, stopCount, deleteCount }
  console.log(JSON.stringify(result)); passed = true
} finally {
  for (const task of cron.getTasks().values()) await task.destroy()
  await prisma.instance.deleteMany({ where: { hostId: host.id } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.package.delete({ where: { id: pkg.id } })
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, user.id, poor.id] } } })
  await closePrismaDatabase(); await new Promise(resolve => server.close(resolve))
  await unlink(join(root, 'tls.key')); await unlink(join(root, 'tls.crt'))
  // Existing notifier/security timers are process-wide; the isolated test exits explicitly.
  setTimeout(() => process.exit(passed ? 0 : 1), 50)
}
