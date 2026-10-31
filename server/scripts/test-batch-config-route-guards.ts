import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routeSource = readFileSync(resolve(process.cwd(), 'src/routes/batch-config.ts'), 'utf8')
const mutationSource = readFileSync(resolve(process.cwd(), 'src/db/batch-config-mutations.ts'), 'utf8')
assert.ok(routeSource.includes('Number.isSafeInteger(parsed) && parsed <= MAX_POSTGRES_INT_ID') &&
  routeSource.includes('if (instanceId > MAX_POSTGRES_INT_ID) return null'),
  'host and instance IDs must fit PostgreSQL Int before querying or changing a batch')
assert.ok(routeSource.includes('const pooledClient = await getIncusClient(host, tx)'),
  'batch configuration must read host connection identity in its existing transaction without another pool acquisition')

assert.ok(
  routeSource.includes('function parsePositiveRouteId(value: string): number | null') &&
    routeSource.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    routeSource.includes('Number.isSafeInteger(parsed)'),
  'batch config route must use a strict positive safe-integer host ID parser'
)

assert.ok(
  routeSource.includes('function normalizeBatchInstanceIds(instanceIds: number[]): number[] | null') &&
    routeSource.includes('!Number.isSafeInteger(instanceId) || instanceId <= 0 || uniqueIds.has(instanceId)') &&
    routeSource.includes('return [...uniqueIds]'),
  'batch config route must reject invalid, non-positive, unsafe, and duplicate instance IDs'
)

assert.ok(
  routeSource.includes("items: { type: 'integer', minimum: 1 }") &&
    routeSource.includes('uniqueItems: true'),
  'batch config schema must reject non-positive and duplicate instance IDs before handler logic'
)

assert.ok(
  routeSource.includes('const hostId = parsePositiveRouteId(id)') &&
    routeSource.includes('const normalizedInstanceIds = normalizeBatchInstanceIds(instanceIds)') &&
    routeSource.includes("return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid instance IDs'))"),
  'batch config route must validate host and instance IDs before host lookup or mutation'
)

assert.ok(
  routeSource.includes('id: { in: normalizedInstanceIds }') &&
    routeSource.includes('if (instances.length !== normalizedInstanceIds.length)') &&
    routeSource.includes("return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Some instances are not available on this host'))"),
  'batch config route must require every requested instance to be available on the target host'
)

assert.ok(
  routeSource.includes('withBatchInstanceMutation(target, actor, requiresAdmin,') &&
    routeSource.includes('await tx.instance.update(') && routeSource.includes('await tx.host.update(') &&
    routeSource.includes('config.cpu - instance.cpu') && routeSource.includes('config.memory - instance.memory') &&
    routeSource.includes('cpuUsed: { increment: cpuDelta }') &&
    routeSource.includes('memoryUsed: { increment: memoryDelta }') &&
    routeSource.includes('diskUsed: { increment: diskDelta }') &&
    !routeSource.includes('totalCpuDelta') && !routeSource.includes('db.incrementHostResourceUsage('),
  'each instance update and current resource delta must commit in the same transaction'
)
assert.ok(mutationSource.includes('INSTANCE_OPERATION_LOCK_NAMESPACE') && mutationSource.includes("SET LOCAL lock_timeout = '1s'") &&
  mutationSource.includes('instance.userId !== target.userId') && mutationSource.includes('instance.incusId !== target.incusId') &&
  mutationSource.includes('authorizeUserWrite(tx, actor.id, actor)') && mutationSource.includes("currentActor.role !== 'admin'") &&
  mutationSource.includes('hasActiveTransferWorkflow(instance.id, tx)') && mutationSource.includes("status: { in: ['pending', 'processing'] }") &&
  mutationSource.includes('instance.provisioningCleanupPending') && mutationSource.includes('instance.deletionBillingPending'),
  'batch writes must serialize with transfer, re-read ownership/session/eligibility and bound row-lock waiting')
assert.ok(routeSource.includes('requiresReview: remoteMayHaveChanged') && routeSource.includes("'instance.batch_config_failed'") &&
  routeSource.includes('!result.requiresReview') && routeSource.includes('failedItems.filter(i => !i.requiresReview)') &&
  routeSource.includes('Math.min(timeout, remaining)') && routeSource.includes("SET LOCAL lock_timeout = '250ms'") &&
  routeSource.includes('userId: null, instanceId: null'),
  'unknown remote outcomes must be recorded with an error and excluded from automatic retry before the transaction deadline')
assert.ok(
  !routeSource.includes('cpuUsed: host.cpu_used + totalCpuDelta') &&
    !routeSource.includes('memoryUsed: host.memory_used + totalMemoryDelta') &&
    !routeSource.includes('diskUsed: host.disk_used + totalDiskDelta'),
  'batch config route must not overwrite host usage from a stale request-time snapshot'
)

for (const forbiddenPattern of [
  'const hostId = Number(id)',
  'isNaN(hostId)',
  'id: { in: instanceIds }',
  "if (instances.length === 0) {\n      return reply.code(400).send({ error: '没有找到可修改的实例' })"
]) {
  assert.ok(
    !routeSource.includes(forbiddenPattern),
    `batch config route must not keep loose or partial batch behavior: ${forbiddenPattern}`
  )
}

console.log('batch config route guard tests passed')
