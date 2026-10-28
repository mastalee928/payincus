import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = (path: string) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const scheduler = source('services/auto-policy-scheduler.ts')
const operation = source('services/auto-snapshot-operations.ts')
assert.ok(scheduler.includes('auto-policy:snapshot:') && scheduler.includes('await acquireLock(lockKey, {') &&
  scheduler.includes('await releaseLock(lockKey, lockResult.ownerId)'), 'new operations share the manual snapshot lock')
assert.ok(scheduler.indexOf('await acquireLock') < scheduler.indexOf('await prepareAutoSnapshotOperation') &&
  scheduler.includes('!recoveringInstances.has(row.instanceId)'), 'prepare under snapshot lock; no duplicate creation during recovery scan')
assert.ok(scheduler.includes('await prisma.autoSnapshotOperation.findMany') && scheduler.includes('applyAutoSnapshotOperation(row.id)'),
  'recover durable operations independently of enabled policies and abandoned distributed leases')
for (const required of ['tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instanceId)',
  'FOR UPDATE', 'FOR SHARE', 'await tx.snapshotPolicy.findUnique', 'policy.nextRunAt > now', 'instance.expiresAt <= now',
  'instance.snapshotLimit <= 0', 'await hasActiveTransferWorkflow(instanceId, tx)', 'await assertNoPendingProxySiteOperations(tx, instanceId)',
  'serverCertificate: host.serverCertificate', 'serverFingerprint: host.serverFingerprint', 'await client.close()',
  'operation.attemptId !== attemptId', 'transferHostIdentity(host) !== operation.identityHash', 'uuid !== operation.remoteUuid',
  "state: 'succeeded'", "stage: 'created'", 'current.attempts >= 5']) assert.ok(operation.includes(required), required)
assert.ok(operation.indexOf('remoteUuid: uuid') < operation.indexOf("client.request('POST'"), 'UUID saved before remote mutation')
assert.ok(operation.indexOf("stage: 'created'") < operation.indexOf("client.request('DELETE'"), 'new snapshot confirmed before old deletion')
for (const path of ['db/instance-tasks.ts', 'db/transfers.ts', 'routes/instances.ts', 'routes/hosts.ts',
  'routes/instance-destroy.ts', 'routes/admin-billing.ts', 'services/host-replacement.ts', 'services/transfer-cleanup.ts']) {
  assert.ok(source(path).includes('await assertNoPendingSnapshotOperations(tx,'), path + ' must fence unfinished automatic snapshots')
}
console.log('auto policy durable recovery guard tests passed')
