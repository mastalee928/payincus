import assert from 'node:assert/strict'
import { inspectControllerQuiescence } from '../src/lib/controller-quiescence.js'

const facts = { oldConnectionsBlocked: true, legacyCredentialsBlocked: true, outstandingSshProcesses: 0, outstandingLocalJobs: 0 }
const operation = { id: '11111111-1111-4111-8111-111111111111', status: 'Running', status_code: 103,
  may_cancel: false, resources: {}, metadata: { arbitrary: 'do not trust as authorization' } }
assert.deepEqual(inspectControllerQuiescence({}, facts), { canActivate: true, blockers: [], activeOperationIds: [] })
for (const [status, code] of [['Operation created', 100], ['Pending', 105], ['Running', 103], ['Cancelling', 104]] as const) {
  const result = inspectControllerQuiescence({ [status.toLowerCase()]: [{ ...operation, status, status_code: code }] }, facts)
  assert.equal(result.canActivate, false)
  assert.deepEqual(result.activeOperationIds, [operation.id])
}
for (const [status, code] of [['Success', 200], ['Failure', 400], ['Cancelled', 401]] as const) {
  assert.equal(inspectControllerQuiescence({ [status.toLowerCase()]: [{ ...operation, status, status_code: code }] }, facts).canActivate, true)
}
for (const changed of [{ oldConnectionsBlocked: false }, { legacyCredentialsBlocked: false }, { outstandingSshProcesses: 1 }, { outstandingLocalJobs: 1 }]) {
  assert.equal(inspectControllerQuiescence({}, { ...facts, ...changed }).canActivate, false)
}
for (const invalid of [null, [], { running: ['/1.0/operations/' + operation.id] }, { running: [operation, operation] },
  { strange: [] }, { running: [null] }, { running: [{ ...operation, status_code: 200 }] },
  { success: [operation] }, { running: [{ ...operation, id: '../escape' }] }, { running: Array(1025).fill(operation) }]) {
  assert.throws(() => inspectControllerQuiescence(invalid, facts), /QUIESCENCE_INVALID/)
}
for (const outstandingLocalJobs of [-1, 0.1, NaN, Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(() => inspectControllerQuiescence({}, { ...facts, outstandingLocalJobs }), /QUIESCENCE_INVALID/)
}
console.log('Controller quiescence passed: grouped Incus operations, old credentials/connections and outstanding jobs fail closed')
