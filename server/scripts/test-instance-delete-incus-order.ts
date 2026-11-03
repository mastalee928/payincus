import { readFileSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'node:url'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

function indexOfOrThrow(source: string, pattern: string, label: string): number {
  const index = source.indexOf(pattern)
  assert(index >= 0, `Missing ${label}: ${pattern}`)
  return index
}

function section(source: string, startPattern: string, endPattern: string): string {
  const start = indexOfOrThrow(source, startPattern, startPattern)
  const end = indexOfOrThrow(source.slice(start), endPattern, endPattern)
  return source.slice(start, start + end)
}

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const instancesSource = readFileSync(resolve(repoRoot, 'server/src/routes/instances.ts'), 'utf8')
const hostsSource = readFileSync(resolve(repoRoot, 'server/src/routes/hosts.ts'), 'utf8')

const configUpdateSection = section(
  instancesSource,
  '// 更新宿主机资源使用量',
  '// 记录日志'
)
assert(
  configUpdateSection.includes('await db.calculateHostResourcesFromInstances(instance.host_id)') &&
    configUpdateSection.includes('cpuUsed: usedResources.cpuUsed') &&
    configUpdateSection.includes('memoryUsed: usedResources.memoryUsed') &&
    configUpdateSection.includes('diskUsed: usedResources.diskUsed'),
  'config updates must recalculate host usage from the persisted instance set'
)
assert(
  !configUpdateSection.includes('host.cpu_used + cpuDelta') &&
    !configUpdateSection.includes('host.memory_used + memoryDelta') &&
    !configUpdateSection.includes('host.disk_used + diskDelta'),
  'config updates must not overwrite host usage from stale host values'
)

const deletion = readFileSync(resolve(repoRoot, 'server/src/services/instance-deletion.ts'), 'utf8')
assert(instancesSource.includes('await requestInstanceDeletion(') && hostsSource.includes('await requestInstanceDeletion('), 'all full deletion routes must persist intent')
assert(!instancesSource.includes('restoreClaimedInstanceForDelete') && !hostsSource.includes('restoreHostBatchDeleteClaim'), 'remote failures cannot resurrect possibly deleted guests')
const stop = indexOfOrThrow(deletion, "{ action: 'stop', force: true", 'actual-state stop')
const remove = indexOfOrThrow(deletion, 'await deleteInstance(incus, state.name)', 'remote deletion')
const refund = indexOfOrThrow(deletion, 'let refundAmount = 0, refundPending = false', 'settlement')
const release = indexOfOrThrow(deletion, 'deletionBillingPending: false, provisioningCleanupPending: false', 'resource release')
assert(stop < remove && remove < refund && refund < release, 'confirm remote deletion before settlement and release')
assert(deletion.includes('deletionIntent: asJson(state)') && deletion.includes('state.uuid') && deletion.includes('state.absent'), 'persist original target and reject same-name recreation')
assert(deletion.includes('await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, instance.userId)'), 'refund must serialize balance changes')
assert(deletion.includes('previous') && deletion.includes("'节点实例删除退款'"), 'refund must have a durable duplicate fence')
assert(deletion.includes('refundBillingRecordId = refundBill.id') && deletion.includes('refundBillingRecordId = previous.id'), 'retain the exact settlement bill for new and resumed deletions')
assert(deletion.includes('HOST_OCCUPIED_INSTANCE_WHERE') && deletion.includes('tx.instance.aggregate'), 'release must recompute occupied inventory')
assert(hostsSource.includes("kind: 'manual', reason: 'database_only'"), 'records-only removal must retain remote inventory quarantine')
console.log('instance delete durable intent, remote ordering, refund and inventory guards passed')
