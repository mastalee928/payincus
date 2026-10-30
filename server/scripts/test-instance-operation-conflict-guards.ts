import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const instancesSource = readFileSync(resolve(__dirname, '../src/routes/instances.ts'), 'utf8')
const dbInstancesSource = readFileSync(resolve(__dirname, '../src/db/instances.ts'), 'utf8')
const hostsSource = readFileSync(resolve(__dirname, '../src/routes/hosts.ts'), 'utf8')
const statusSchedulerSource = readFileSync(resolve(__dirname, '../src/services/status-scheduler.ts'), 'utf8')
const taskDatabase = readFileSync(resolve(__dirname, '../src/db/instance-tasks.ts'), 'utf8')
assert.ok(taskDatabase.includes("if (data.taskType === 'rebuild' || data.taskType === 'recreate') await authorizeSensitiveTaskAdmission(tx, data)") &&
  taskDatabase.includes('authorizeUserWrite(tx, data.userId, authorization.actor)') &&
  taskDatabase.includes('transferHostIdentity(host) !== authorization.expectedHostIdentity') &&
  taskDatabase.includes('claimOperationVerificationRequirement(data.userId, operation, instance.id, authorization.actor, tx)') &&
  taskDatabase.includes("authorization.entry === 'user' ? instance.userId !== data.userId : host.userId !== data.userId && !admin"),
  'destructive task admission must authorize the current actor/resource and atomically consume user verification before queue insertion while preserving the maintenance scope')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const userConflictGuard = sectionBetween(
  instancesSource,
  'async function rejectActiveInstanceWorkflowConflict(',
  'function isUniqueConstraintError('
)

assert.ok(
  userConflictGuard.includes('prisma.restoreTask.findFirst') &&
    userConflictGuard.includes('prisma.backupUploadTask.findFirst') &&
    userConflictGuard.includes('getActiveTaskForInstance(instanceId)'),
  'user instance operation guard must check restore, backup upload, and instance tasks'
)
assert.ok(
  userConflictGuard.includes("code: 'RESTORE_IN_PROGRESS'") &&
    userConflictGuard.includes("code: 'UPLOAD_IN_PROGRESS'") &&
    userConflictGuard.includes('sendActiveTaskConflict(reply, activeInstanceTask)'),
  'user instance operation guard must return explicit 409 conflicts for each active workflow'
)

const guardedUserRoutes = [
  ['start', '// 启动实例', '// 停止实例'],
  ['stop', '// 停止实例', '// 重启实例'],
  ['restart', '// 重启实例', '// 封停实例'],
  ['rebuild', '// 重装系统', '// 重建实例'],
  ['recreate', '// 重建实例', '// 删除实例'],
  ['clone', '// ==================== 复制实例 ====================', '// ==================== 重命名实例 ====================']
]

for (const [name, startMarker, endMarker] of guardedUserRoutes) {
  const routeSection = sectionBetween(instancesSource, startMarker, endMarker)
  assert.ok(
    routeSection.includes('rejectActiveInstanceWorkflowConflict(reply, instanceId)'),
    `${name} route must reject active restore/upload/instance workflows before queueing an instance task`
  )
}

const hostConflictGuard = sectionBetween(
  hostsSource,
  'async function rejectActiveHostInstanceWorkflowConflict(',
  'async function createHostInstanceTaskOrConflict('
)

assert.ok(
  hostConflictGuard.includes('prisma.restoreTask.findFirst') &&
    hostConflictGuard.includes('prisma.backupUploadTask.findFirst') &&
    hostConflictGuard.includes('getActiveTaskForInstance(instanceId)'),
  'host dangerous-action guard must check restore, backup upload, and instance tasks'
)
assert.ok(
  hostsSource.includes('error instanceof InstanceTaskConflictError') &&
    hostsSource.includes('sendHostActiveTaskConflict(reply, error.activeTask)'),
  'host dangerous-action task creation must convert concurrent instance task conflicts to 409'
)

const hostDangerousAction = sectionBetween(
  hostsSource,
  "}>('/:id/ops/instances/:instanceId/dangerous-action'",
  "await createLog(user.id, 'host', `host.ops.${action}`"
)
assert.ok(
  hostDangerousAction.includes('rejectActiveHostInstanceWorkflowConflict(reply, instanceId)'),
  'host dangerous-action route must reject active restore/upload/instance workflows before queueing'
)
assert.ok(
  hostDangerousAction.includes('createHostInstanceTaskOrConflict(reply, {') &&
    hostDangerousAction.includes('if (!task) return'),
  'host dangerous-action route must use conflict-safe task creation'
)

const syncStatusRoute = sectionBetween(
  instancesSource,
  "}>('/:id/sync-status'",
  "}>('/:id/change-host-options'"
)
const proxyNetworkSyncSource = readFileSync(resolve(__dirname, '../src/lib/instance-proxy-network-sync.ts'), 'utf8')
const proxyOperationsSource = readFileSync(resolve(__dirname, '../src/db/proxy-site-operations.ts'), 'utf8')
assert.ok(
  syncStatusRoute.includes('await syncInstanceNetworkAndProxySites(') &&
    proxyNetworkSyncSource.includes("currentStatus !== 'suspended' && currentStatus !== incusStatus"),
  'sync-status route must preserve suspended while continuing normal running/stopped status sync'
)
assert.ok(
  proxyNetworkSyncSource.includes('persistResolvedInstanceNetworkAddressesInTransaction(tx,') &&
    proxyNetworkSyncSource.includes('data: { ipv4SyncPending: true,') &&
    proxyNetworkSyncSource.includes('INSTANCE_OPERATION_LOCK_NAMESPACE') &&
    proxyNetworkSyncSource.includes('instance.updatedAt.toISOString() !== observed.updatedAt') &&
    proxyNetworkSyncSource.includes('Math.max(Date.now(), instance.updatedAt.getTime() + 1)') &&
    proxyNetworkSyncSource.includes('updatedAt: saved.updatedAt') &&
    proxyNetworkSyncSource.includes('hostConnectionIdentity(host) !== observed.hostConnectionIdentity') &&
    proxyNetworkSyncSource.includes("if (!site.enabled || site.status !== 'active')") &&
    proxyNetworkSyncSource.includes('await prepareProxySiteOperationInTransaction(') &&
    proxyNetworkSyncSource.includes('await applyProxySiteOperation(outcome.operationId)') &&
    proxyOperationsSource.includes('await client.reconcileManagedSite(') &&
    proxyOperationsSource.includes('operation.attemptId !== attemptId') &&
    proxyOperationsSource.includes("desired.targetIp !== (instance.ipv4 || '')") &&
    proxyOperationsSource.includes('appliedRevision: operation.revision') &&
    !proxyNetworkSyncSource.includes('.deleteSite(') &&
    !syncStatusRoute.includes('.deleteSite('),
  'address sync must persist retry intent with the IP, recheck identity and site state under the shared lock, and update Caddy without deleting first'
)

const updateInstanceStatus = sectionBetween(
  dbInstancesSource,
  'export async function updateInstanceStatus(',
  'export async function updateInstance('
)
assert.ok(
  updateInstanceStatus.includes("status: { notIn: ['deleted', 'suspended'] }") &&
    updateInstanceStatus.includes('await prisma.instance.updateMany({'),
  'database status writes must not overwrite suspended with stopped or running'
)

const hostStatusSync = sectionBetween(hostsSource, "}>('/:id/instances/sync-status'", '// ==================== 资源校对')
const scheduledStatusSync = sectionBetween(statusSchedulerSource, 'export async function syncInstanceStatus(', 'async function executeStatusSyncJob(')
for (const [name, source] of [['host batch', hostStatusSync], ['scheduler', scheduledStatusSync]]) {
  assert.ok(source.includes('recordUnverifiedInstanceObservation(') && !source.includes("updateInstanceStatus(instance.id, 'deleted')") &&
    !source.includes("to: 'deleted'") && !source.includes('rollbackResources('),
    `${name} observation failures must retain resources and report unverified state`)
}

console.log('instance operation conflict guard tests passed')
