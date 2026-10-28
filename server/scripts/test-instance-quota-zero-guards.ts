import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/instances.ts'), 'utf8')

const resourceSelectionStart = source.indexOf('// 2. 确定请求的资源')
assert.notEqual(resourceSelectionStart, -1, 'missing instance resource selection section')
const resourceSelectionEnd = source.indexOf('// 3. 验证认证方式', resourceSelectionStart)
assert.notEqual(resourceSelectionEnd, -1, 'missing instance resource selection section end marker')
const resourceSelection = source.slice(resourceSelectionStart, resourceSelectionEnd)

assert.ok(
  resourceSelection.includes('if (!selectedPlan) {'),
  'package resource maximums must only be enforced for free instances without a selected plan'
)

for (const [resource, packageMax] of [
  ['requestedCpu', 'pkg.cpu_max'],
  ['requestedMemory', 'pkg.memory_max'],
  ['requestedDisk', 'pkg.disk_max']
] as const) {
  assert.ok(
    resourceSelection.includes(`if (${resource} > ${packageMax})`) &&
      resourceSelection.includes('return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS'),
    `free instance ${resource} must be rejected when it exceeds ${packageMax}`
  )
}

const routeStart = source.indexOf("}>('/:id/quota'")
assert.notEqual(routeStart, -1, 'missing instance quota update route')
const routeEnd = source.indexOf('// ==================== 修改实例资源配置 ====================', routeStart)
assert.notEqual(routeEnd, -1, 'missing instance quota update route end marker')
const quotaRoute = source.slice(routeStart, routeEnd)
const quotaMutation = readFileSync(resolve(__dirname, '../src/db/instance-quota-mutations.ts'), 'utf8')

for (const field of ['portLimit', 'snapshotLimit', 'backupLimit', 'siteLimit']) {
  assert.ok(
    quotaMutation.includes(`if (patch.${field} !== undefined)`),
    `quota mutation must validate submitted ${field}=0/null and preserve omitted fields`
  )
}

for (const unsafePattern of [
  'portLimit || null',
  'snapshotLimit || null',
  'backupLimit || null',
  'siteLimit || null',
  'siteLimit === 0 ? 0 :'
] as const) {
  assert.ok(
    !quotaRoute.includes(unsafePattern) && !quotaMutation.includes(unsafePattern),
    `quota route must not collapse explicit zero through ${unsafePattern}`
  )
}

assert.ok(
  quotaRoute.includes("snapshotLimit: { type: ['integer', 'null'], minimum: 0, maximum: 1000 }") &&
    quotaRoute.includes("backupLimit: { type: ['integer', 'null'], minimum: 0, maximum: 1000 }") &&
    quotaRoute.includes("siteLimit: { type: ['integer', 'null'], minimum: 0, maximum: 1000 }"),
  'quota schemas must allow explicit zero (no snapshot/backup quota; unlimited sites)'
)

assert.ok(
  quotaMutation.includes('(patch.snapshotLimit ?? 0) < used') &&
    quotaMutation.includes('(patch.backupLimit ?? 0) < used') &&
    quotaMutation.includes('(patch.portLimit ?? 0) < used'),
  'null and explicit zero must not bypass effective below-used validation'
)

assert.ok(
  quotaMutation.includes("[['portLimit', 1], ['snapshotLimit', 0], ['backupLimit', 0], ['siteLimit', 0]]") &&
    quotaMutation.includes('!Number.isInteger(value) || value < minimum || value > 1000'),
  'mutation must enforce integer ranges even outside route schema validation'
)

assert.ok(
  quotaRoute.includes('await updateInstanceQuotaAuthorized(instance, host.user_id, user, { portLimit, snapshotLimit, backupLimit, siteLimit })') &&
    quotaMutation.includes('await tx.instance.update({ where: { id: instanceId }, data: patch })') &&
    !quotaMutation.includes('?? undefined'),
  'quota persistence must keep explicit zero while still allowing null to clear the override'
)

for (const required of ['tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, expected.id)',
  'FOR UPDATE', 'FOR SHARE', 'authorizeUserWrite(tx, actor.id, actor)', 'instance.userId !== expected.user_id',
  'instance.hostId !== expected.host_id', 'instance.incusId !== expected.incus_id', 'host.userId !== hostOwnerId',
  'hasActiveTransferWorkflow(instance.id, tx)', 'hasPendingSnapshotOperation(instance.id, tx)',
  'hasPendingProxySiteOperations(instance.id, tx)', 'provisioningCleanupPending', 'deletionBillingPending',
  'systemManaged: false', "status: { in: ['creating', 'ready'] }", 'await tx.proxySite.count',
  'limit !== 0 && limit < used', 'limit ??= 10']) {
  assert.ok(quotaMutation.includes(required), `missing atomic quota guard: ${required}`)
}
assert.ok(quotaRoute.includes('getInstancePortMappingLockKey(instanceId)') &&
  quotaRoute.includes('acquireLock(portLockKey, PORT_MAPPING_LOCK_OPTIONS)') &&
  quotaRoute.includes('await releaseLock(portLockKey, portLock.ownerId)'), 'quota changes serialize with manual port mutations')

console.log('instance quota zero guard tests passed')
