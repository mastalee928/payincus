import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import Fastify from 'fastify'
import { withInstanceBillingMutation } from '../src/lib/instance-billing-mutation.js'
import { enforceExpiredStop, type ExpirySuspension } from '../src/services/billing-expiry-enforcement.js'
import { registerExpiryEnforcementRoutes } from '../src/routes/billing-expiry-enforcement.js'
let current: ExpirySuspension | null = { id: 1, hostId: 2, incusId: 'existing-instance', status: 'suspended', suspendReason: 'expired',
  packagePlanId: 3, expiresAt: new Date(Date.now() - 100000), version: 4, suspendedBy: null }
let remoteStatus = 'Running', stops = 0, offline = true
const operations = { load: async () => current, state: async () => { if (offline) throw Error('offline'); return { status: remoteStatus } },
  stop: async () => { stops++; remoteStatus = 'Stopped' } }
await assert.rejects(enforceExpiredStop(operations), /offline/)
assert.equal(stops, 0)
offline = false
assert.equal(await enforceExpiredStop(operations), 'stopped'); assert.equal(stops, 1)
assert.equal(await enforceExpiredStop(operations), 'already-stopped'); assert.equal(stops, 1)
remoteStatus = 'Running'
const expired = { ...current! }
let reads = 0
assert.equal(await enforceExpiredStop({ ...operations, load: async () => ++reads === 1 ? expired : { ...expired, expiresAt: new Date(Date.now() + 100000), version: 5 } }), 'skipped')
assert.equal(stops, 1, 'renewal committed during state read must prevent stop')
current = { ...expired, suspendReason: 'manual' }; assert.equal(await enforceExpiredStop(operations), 'skipped')
current = { ...expired, suspendedBy: 1 }; assert.equal(await enforceExpiredStop(operations), 'skipped')
current = { ...expired, packagePlanId: null }; assert.equal(await enforceExpiredStop(operations), 'skipped')
current = expired; remoteStatus = 'Unknown'; await assert.rejects(enforceExpiredStop(operations), /REMOTE_STATE_UNKNOWN/)
remoteStatus = 'Running'; await assert.rejects(enforceExpiredStop({ ...operations, stop: async () => {} }), /STOP_NOT_VERIFIED/)
let release: () => void = () => {}, entered: () => void = () => {}
const started = new Promise<void>(resolve => { entered = resolve }), gate = new Promise<void>(resolve => { release = resolve })
const order: string[] = []
const stopping = withInstanceBillingMutation(1, async () => { order.push('stop'); entered(); await gate; order.push('stop-complete') })
await started
const renewal = withInstanceBillingMutation(1, async () => { order.push('renewal') })
await withInstanceBillingMutation(2, async () => { order.push('other-instance') })
assert.deepEqual(order, ['stop', 'other-instance']); release(); await Promise.all([stopping, renewal])
assert.deepEqual(order, ['stop', 'other-instance', 'stop-complete', 'renewal'])
await assert.rejects(withInstanceBillingMutation(1, async () => { throw Error('failure') }), /failure/)
assert.equal(await withInstanceBillingMutation(1, async () => 'released'), 'released')

const oldOrigin = process.env.ADMIN_FRONTEND_URL; process.env.ADMIN_FRONTEND_URL = 'https://admin.example.test'
const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } })
app.decorate('authenticateAdmin', async (request, reply) => {
  if (request.headers['x-test-role'] !== 'admin') return reply.code(403).send({ code: 'ADMIN_REQUIRED' })
  request.user = { id: 1, username: 'fixture-admin', role: 'admin', sid: request.headers['x-no-session'] ? undefined : 'fixture-session' }
})
let starts = 0, runs = 0
await registerExpiryEnforcementRoutes(app, { status: () => ({ enabled: starts > 0 }), start: () => { starts++; return {} }, run: async () => { runs++ } })
try {
  const headers = { 'x-test-role': 'admin', origin: 'https://admin.example.test', authorization: 'Bearer fixture' }
  for (const action of ['start', 'run']) {
    const url = '/api/admin/billing/expiry-enforcement/' + action
    assert.equal((await app.inject({ method: 'POST', url, headers: { ...headers, 'x-test-role': 'user' }, payload: {} })).statusCode, 403)
    assert.equal((await app.inject({ method: 'POST', url, headers: { ...headers, origin: 'https://other.example.test' }, payload: {} })).statusCode, 403)
    assert.equal((await app.inject({ method: 'POST', url, headers: { ...headers, 'x-no-session': '1' }, payload: {} })).statusCode, 403)
    assert.equal((await app.inject({ method: 'POST', url, headers, payload: { command: 'fixture' } })).statusCode, 400)
    const result = await app.inject({ method: 'POST', url, headers, payload: {} })
    assert.equal(result.statusCode, 202); assert.equal(result.headers['cache-control'], 'no-store')
  }
  assert.deepEqual([starts, runs], [1, 1])
} finally { await app.close(); if (oldOrigin === undefined) delete process.env.ADMIN_FRONTEND_URL; else process.env.ADMIN_FRONTEND_URL = oldOrigin }
const scheduler = await readFile(new URL('../src/services/billing-scheduler.ts', import.meta.url), 'utf8')
assert.ok(scheduler.includes("schedule('*/5 * * * *'") && scheduler.includes('expiryEnforcementRunning'))
assert.ok(scheduler.includes("status: 'suspended', suspendReason: 'expired'") && scheduler.includes('enforceExpiredStop'))
assert.ok(scheduler.includes('resumingCleanup') && scheduler.includes('deletionBillingPending: true'))
assert.ok(scheduler.indexOf('await deleteIncusInstance') < scheduler.indexOf('await tx.portMapping.deleteMany'))
assert.ok(scheduler.indexOf("names.includes('/1.0/instances/' + instance.incusId)") < scheduler.indexOf('await tx.portMapping.deleteMany'), 'verify remote absence before releasing allocations')
assert.ok(scheduler.includes('withInstanceBillingMutation(instanceId, async () => { if (!recoveryHeld()) await fn() })'), 'queued patrol must recheck recovery protection after acquiring the mutation lane')
const renewalSource = await readFile(new URL('../src/db/billing-operations.ts', import.meta.url), 'utf8')
assert.ok(renewalSource.includes('withInstanceBillingMutation(instance.id, () => performRenewalMutation'))
assert.ok(scheduler.includes('renewedSuspensions') && scheduler.includes('expiresAt: { gt: new Date() }'), 'correct obsolete expiry suspension using current dates')
const adminBilling = await readFile(new URL('../src/routes/admin-billing.ts', import.meta.url), 'utf8')
const extension = adminBilling.slice(adminBilling.indexOf('// POST /api/admin/instances/:id/extend'), adminBilling.indexOf('// ==================== 管理员退款'))
assert.ok(extension.includes('withInstanceBillingMutation(instanceId, async () =>'))
assert.equal((extension.match(/version: \{ increment: 1 \}/g) || []).length, 2, 'paid and free admin extension must invalidate stale renewal snapshots')
console.log('Expiry enforcement passed: reconnect stop retry, renew exclusion, no duplicate/unknown stop, shared mutation lanes and admin session/Origin routes')
