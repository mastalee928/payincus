import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stopInstance, deleteInstance } from '../src/lib/incus/incus-instances.js'
import { IncusApiError } from '../src/lib/incus/incus-client.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/instance-destroy.ts'), 'utf8')

const worker = readFileSync(resolve(__dirname, '../src/services/instance-deletion.ts'), 'utf8')
assert.equal((source.match(/requestInstanceDeletion\(instance, user, \{ mode: 'user_destroy'(?:, deferRemote: true)? \}\)/g) || []).length, 2, 'single and batch user deletion share durable worker')
assert.ok(source.indexOf('for (const instanceId of uniqueIds)') < source.indexOf('await processInstanceDeletion(result.id)'), 'batch admission precedes remote execution')
assert.ok(!source.includes('restoreClaimedInstanceStatus'), 'failed transport must preserve deletion intent and inventory')
assert.ok(worker.includes("if (state.mode === 'user_destroy')") && worker.includes('state.refund = false'), 'user deletion never enables refund')
const userAudit = worker.slice(worker.indexOf("if (state.mode === 'user_destroy' && instance.packagePlanId)"), worker.indexOf('await tx.portMapping.deleteMany'))
assert.ok(userAudit.includes('tx.userDestroyRecord.upsert') && userAudit.includes('refundAmount: 0, feeAmount: 0'), 'destruction audit is idempotent and nonfinancial')
assert.ok(!userAudit.includes('balanceLog.create') && !userAudit.includes('instanceBillingRecord.create'))
assert.ok(source.includes('export async function reverseInstanceAffCommissionForRefund('), 'administrator refund support remains available')
assert.ok(!source.includes('calculateInstanceRemainingRefundQuote('), 'user preview cannot offer refunds')
console.log('user destroy durable queue and nonfinancial settlement guards passed')

for (const initialStatus of ['Running', 'Stopped', 'Frozen']) {
  let remoteStatus = initialStatus
  let deleted = false
  const calls: string[] = []
  const remote = { request: async (method: string, path: string, body?: any) => {
    calls.push(`${method} ${path}`)
    if (method === 'GET' && path.endsWith('/state')) return { status: remoteStatus }
    if (method === 'PUT') { assert.equal(body.action, 'stop'); assert.equal(body.force, true); remoteStatus = 'Stopped'; return {} }
    if (method === 'DELETE') { assert.equal(remoteStatus, 'Stopped', 'Incus must never receive deletion of a running guest'); deleted = true; return {} }
    if (method === 'GET' && path === '/1.0/instances/failed-create-guest' && deleted) throw new IncusApiError('Instance not found', 404, path)
    if (method === 'GET' && (path.startsWith('/1.0/storage-pools?') || path.startsWith('/1.0/networks?'))) return []
    if (method === 'GET' && path.includes('/forwards')) return []
    throw Error('Unexpected Incus request')
  } } as any
  await stopInstance(remote, 'failed-create-guest', true)
  await deleteInstance(remote, 'failed-create-guest')
  assert.equal(calls.filter(call => call.startsWith('PUT ')).length, initialStatus === 'Stopped' ? 0 : 1)
  assert.ok(calls.includes('DELETE /1.0/instances/failed-create-guest'))
}
console.log('User destroy actual-state checks passed: running/error mismatch, stopped no-op and frozen guest')
