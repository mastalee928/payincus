import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stopInstance, deleteInstance } from '../src/lib/incus/incus-instances.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/instance-destroy.ts'), 'utf8')

function section(startMarker: string, endMarker?: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length
  if (endMarker) assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const helperSection = section(
  'async function deleteIncusInstanceForUserDestroy(',
  'async function recordUserDestroyAudit('
)
assert.ok(helperSection.includes('await stopInstance'), 'user destroy helper should stop running instances before delete')
assert.ok(helperSection.includes('await deleteInstance'), 'user destroy helper must require Incus instance deletion')
assert.ok(!helperSection.includes("if (instance.status === 'running')"), 'user destroy must consult actual Incus state even when the database reports error or stopped')
assert.ok(helperSection.indexOf('await stopInstance') < helperSection.indexOf('await deleteInstance'), 'the real-state stop attempt must precede deletion')
assert.ok(!helperSection.includes("logger.error(incusErr, 'Incus 删除实例失败')"), 'helper must not swallow Incus delete failures')

const batchSection = section(
  'async function executeDestroyForUser(',
  "fastify.post<{\n    Body: { instanceIds: number[] }"
)
const batchDeleteIndex = batchSection.indexOf('await deleteIncusInstanceForUserDestroy(instance, logger)')
const batchBillingIndex = batchSection.indexOf('await recordUserDestroyAudit({')
const batchCleanupIndex = batchSection.indexOf('await prisma.snapshot.deleteMany')
assert.ok(batchDeleteIndex !== -1, 'batch user destroy must call strict Incus delete helper')
assert.ok(batchBillingIndex !== -1, 'batch user destroy must retain its nonfinancial audit')
assert.ok(batchCleanupIndex !== -1, 'batch user destroy must still clean database resources')
assert.ok(batchDeleteIndex < batchBillingIndex, 'batch user destroy must delete Incus before recording success')
assert.ok(batchDeleteIndex < batchCleanupIndex, 'batch user destroy must delete Incus before database cleanup')
assert.ok(
  batchSection.includes('await restoreClaimedInstanceStatus(instanceId, user.id, instance.status)'),
  'batch user destroy must restore claimed DB status when Incus deletion fails'
)

const routeSection = section(
  "fastify.post<{ Params: { id: string }; Querystring: { feeWaiver?: string } }>('/:id/destroy'"
)
const routeDeleteIndex = routeSection.indexOf('await deleteIncusInstanceForUserDestroy(instance, request.log)')
const routeBillingIndex = routeSection.indexOf('await recordUserDestroyAudit({')
const routeCleanupIndex = routeSection.indexOf('await prisma.snapshot.deleteMany')
assert.ok(routeDeleteIndex !== -1, 'single user destroy must call strict Incus delete helper')
assert.ok(routeBillingIndex !== -1, 'single user destroy must retain its nonfinancial audit')
assert.ok(routeCleanupIndex !== -1, 'single user destroy must still clean database resources')
assert.ok(routeDeleteIndex < routeBillingIndex, 'single user destroy must delete Incus before recording success')
assert.ok(routeDeleteIndex < routeCleanupIndex, 'single user destroy must delete Incus before database cleanup')
assert.ok(
  routeSection.includes('await restoreClaimedInstanceStatus(instanceId, user.id, instance.status)'),
  'single user destroy must restore claimed DB status when Incus deletion fails'
)

const auditSection = section(
  'async function recordUserDestroyAudit(',
  'async function buildBatchDestroyPreviewItem('
)
assert.ok(auditSection.includes('await tx.userDestroyRecord.create('), 'retain a destruction audit outside money ledgers')
assert.ok(auditSection.includes('const refundAmount = 0') && auditSection.includes('const feeAmount = 0'))
for (const block of [auditSection, batchSection, routeSection]) {
  for (const forbidden of ['balanceLog.create', 'instanceBillingRecord.create', 'user.update', 'deductHostingBalance(',
    'reverseInstanceAffCommissionForRefund({', 'calculateInstanceRemainingRefundQuote(', 'getMaxRefundable(',
    'instance_deleted_refunded', 'sendInstanceDestroyRefundEmail']) {
    assert.ok(!block.includes(forbidden), `user destruction must not perform financial settlement: ${forbidden}`)
  }
}
assert.ok(!source.includes('calculateInstanceRemainingRefundQuote('), 'user previews must not offer a remaining-value refund')
assert.ok(source.includes('export async function reverseInstanceAffCommissionForRefund('), 'administrator refund support must remain available')
for (const block of [batchSection, routeSection]) {
  assert.ok(block.includes('const refundAmount = 0') && block.includes('const feeAmount = 0'), 'user destruction responses must report zero money')
  assert.ok(block.includes("sendNotification(user.id, 'instance_deleted',"), 'use the existing non-refund deletion notification')
}

console.log('user destroy Incus order tests passed')

for (const initialStatus of ['Running', 'Stopped', 'Frozen']) {
  let remoteStatus = initialStatus
  const calls: string[] = []
  const remote = { request: async (method: string, path: string, body?: any) => {
    calls.push(`${method} ${path}`)
    if (method === 'GET' && path.endsWith('/state')) return { status: remoteStatus }
    if (method === 'PUT') { assert.equal(body.action, 'stop'); assert.equal(body.force, true); remoteStatus = 'Stopped'; return {} }
    if (method === 'DELETE') { assert.equal(remoteStatus, 'Stopped', 'Incus must never receive deletion of a running guest'); return {} }
    if (method === 'GET' && path.includes('/forwards')) return []
    throw Error('Unexpected Incus request')
  } } as any
  await stopInstance(remote, 'failed-create-guest', true)
  await deleteInstance(remote, 'failed-create-guest')
  assert.equal(calls.filter(call => call.startsWith('PUT ')).length, initialStatus === 'Stopped' ? 0 : 1)
  assert.ok(calls.includes('DELETE /1.0/instances/failed-create-guest'))
}
console.log('User destroy actual-state checks passed: running/error mismatch, stopped no-op and frozen guest')
