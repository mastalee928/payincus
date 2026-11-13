import assert from 'node:assert/strict'
import { acceptHostProvisioningStatus, hostProvisioningToolsReady, hostProvisioningToolsReadyWhere, HOST_PROVISIONING_CAPABILITY } from '../src/lib/host-provisioning-tools.js'
process.env.DATABASE_URL||='postgresql://fixture:fixture@127.0.0.1:59999/host_tools_pool_test'
const {hostMaintenanceBlocked}=await import('../src/lib/host-maintenance-gate.js')

const now = Date.now()
const report = { version: 1, ready: true, checkedAt: new Date(now - 14000).toISOString() }
const accepted = acceptHostProvisioningStatus(report, now - 14000, now)!
assert.equal(accepted.ready, true, 'signed host clock skew does not flap stock')
const agent = { enabled: true, lastSeenAt: new Date(now), capabilities: [HOST_PROVISIONING_CAPABILITY], lastReport: { hostProvisioningStatus: accepted } }
assert.equal(hostProvisioningToolsReady(agent, now), true)
for (const input of [null, [], {}, { ...report, ready: 'true' }, { ...report, checkedAt: 'bad' }]) assert.equal(acceptHostProvisioningStatus(input, now, now), null)
for (const [signed, checked] of [[now - 60001, now - 60001], [now, now - 180000], [now, now + 5001]]) {
  assert.equal(acceptHostProvisioningStatus({ ...report, checkedAt: new Date(checked).toISOString() }, signed, now)?.ready, false)
}
for (const change of [{ lastReport: {} }, { enabled: false }, { capabilities: [] }, { lastSeenAt: new Date(now - 180000) },
  { lastReport: { hostProvisioningStatus: { ...accepted, checkedAt: new Date(now - 180000).toISOString() } } }]) {
  assert.equal(hostProvisioningToolsReady({ ...agent, ...change }, now), false)
}
assert.equal(acceptHostProvisioningStatus(report, now, NaN), null)
assert.ok(JSON.stringify(hostProvisioningToolsReadyWhere(new Date(now))).includes(HOST_PROVISIONING_CAPABILITY))
const compat={...report,incusCompat:'needed',compatHash:'a'.repeat(64)}
assert.equal(acceptHostProvisioningStatus(compat,now,now)?.incusCompat,'needed')
assert.equal(acceptHostProvisioningStatus({...compat,compatHash:'invalid'},now,now)?.incusCompat,undefined)
assert.equal(hostMaintenanceBlocked({incusCompat:{version:1,phase:'prepared'}}),true)
assert.equal(hostMaintenanceBlocked({incusCompat:{version:1,phase:'verified'}}),false)
console.log('PASS host tool receipts: old/malformed/stale/disabled rejected; signed clock and fresh readiness accepted')
