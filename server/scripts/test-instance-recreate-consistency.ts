import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/workers/instanceTaskWorker.ts'), 'utf8').replace(/\r\n/g, '\n')
const restoreWorkerSource = readFileSync(resolve(__dirname, '../src/workers/restoreTaskWorker.ts'), 'utf8').replace(/\r\n/g, '\n')
const portMappingsSource = readFileSync(resolve(__dirname, '../src/db/port-mappings.ts'), 'utf8')

function indexOfOrThrow(sourceText: string, pattern: string, label: string): number {
  const index = sourceText.indexOf(pattern)
  assert.ok(index >= 0, `Missing ${label}: ${pattern}`)
  return index
}

function section(sourceText: string, startPattern: string, endPattern: string): string {
  const start = indexOfOrThrow(sourceText, startPattern, startPattern)
  const end = indexOfOrThrow(sourceText.slice(start), endPattern, endPattern)
  return sourceText.slice(start, start + end)
}

const cleanupSection = section(
  source,
  'async function cleanupRecreatedInstanceRecords(',
  '/**\n * 服务启动时清理僵尸任务'
)

assert.ok(
  cleanupSection.includes('const deletedPortMappings = await tx.portMapping.deleteMany({ where: { instanceId } })') &&
    cleanupSection.includes('natPortsUsedCount: { decrement: deletedPortMappings.count }') &&
    cleanupSection.includes('data: { natPortsUsedCount: 0 }'),
  'recreate cleanup must delete port mappings and release host NAT port counters defensively'
)

const recreateSection = section(
  source,
  'async function executeRecreateTask(',
  '/**\n * 执行改节点任务'
)

assert.ok(
  recreateSection.includes('let oldInstanceDeleted = false') &&
    recreateSection.includes('let newInstanceCreated = false') &&
    recreateSection.includes('let databaseSwitched = false'),
  'recreate must track old/new/database switch state for failure compensation'
)

const deleteOld = indexOfOrThrow(recreateSection, 'await deleteInstance(client, oldIncusId)', 'old Incus delete')
const clearSnapshots = indexOfOrThrow(recreateSection, "await clearRebuildSnapshots(client, oldIncusId, task.instanceId, '重建')", 'confirmed snapshot cleanup')
const resetInitialization = indexOfOrThrow(recreateSection, 'await resetInstanceCloudInitState(task.instanceId)', 'initialization reset')
assert.ok(clearSnapshots < resetInitialization && resetInitialization < deleteOld && !recreateSection.includes('删除快照失败，继续执行'),
  'recreate must confirm snapshot cleanup before initialization reset and original deletion without swallowing failures')
assert.ok(recreateSection.includes('await getInstance(client, oldIncusId)') &&
  recreateSection.includes('error instanceof IncusApiError && error.statusCode === 404 && error.path === `/1.0/instances/${oldIncusId}`') &&
  recreateSection.includes('if (!confirmedMissing) throw new Error('),
  'state-endpoint absence requires a second exact original-instance absence confirmation before forgetting snapshots')
const markOldDeleted = indexOfOrThrow(recreateSection, 'oldInstanceDeleted = true', 'old deleted marker')
const createNew = indexOfOrThrow(recreateSection, 'await createInstance(client, incusConfig)', 'new Incus create')
const markNewCreated = indexOfOrThrow(recreateSection, 'newInstanceCreated = true', 'new created marker')
const cleanupRecords = indexOfOrThrow(recreateSection, 'await cleanupRecreatedInstanceRecords(task.instanceId, instance.host_id, tx)', 'transactional recreate DB cleanup')
const updateDb = indexOfOrThrow(recreateSection, 'await reinstall.complete({', 'atomic instance and identity DB switch')
const markDbSwitched = indexOfOrThrow(recreateSection, 'databaseSwitched = true', 'database switched marker')

assert.ok(deleteOld < markOldDeleted, 'recreate must mark old deleted only after strict old Incus delete succeeds')
const cleanupSites = indexOfOrThrow(recreateSection, 'await prepareInstanceTaskSiteCleanup(task.id, instance)', 'durable source Caddy cleanup')
assert.ok(cleanupSites < deleteOld && cleanupSites < recreateSection.indexOf('await stopInstance('),
  'recreate must confirm durable source Caddy deletes before stopping or deleting the original instance')
const changeHostSection = section(source, 'async function executeChangeHostTask(', 'async function executeCloneTask(')
assert.ok(changeHostSection.indexOf('await prepareInstanceTaskSiteCleanup(task.id, instance)') < changeHostSection.indexOf("'checking_capacity'"),
  'change-host must complete durable source cleanup before reserving or creating any target resources')
assert.ok(!cleanupSection.includes('tx.proxySite.deleteMany(') && !changeHostSection.includes('tx.proxySite.deleteMany(') &&
  !changeHostSection.includes('caddyClient.deleteSite(') && changeHostSection.includes('INSTANCE_SITE_CLEANUP_UNCONFIRMED'),
  'lifecycle finalization must not forget source Caddy routes or swallow cleanup failures after switching database identity')
assert.ok(markOldDeleted < createNew, 'recreate must create replacement only after old Incus is gone')
assert.ok(createNew < markNewCreated, 'recreate must mark replacement created only after Incus create succeeds')
assert.ok(markNewCreated < cleanupRecords, 'recreate must not delete old DB associations before replacement exists')
assert.ok(updateDb < cleanupRecords && cleanupRecords < markDbSwitched && recreateSection.includes('}, async tx => {'),
  'recreate must clean associations in the same completion transaction before publishing success')
assert.ok(updateDb < markDbSwitched, 'recreate must mark DB switched only after instance update succeeds')

const catchIndex = indexOfOrThrow(recreateSection, '} catch (err) {', 'recreate catch')
const catchSection = recreateSection.slice(catchIndex)

assert.ok(
  catchSection.includes('if (!databaseSwitched && (newInstanceCreated || creationStarted))') &&
    catchSection.includes('await cleanupManagedInstanceRemote(client, newIncusId, creationAttempt!)'),
  'recreate failure must clean up replacement Incus instance before DB switch'
)

assert.ok(
  catchSection.includes('if (!databaseSwitched && oldInstanceDeleted && replacementCleaned)') &&
    catchSection.includes("status: 'error'") &&
    catchSection.includes('await prisma.ipAddress.deleteMany({ where: { instanceId: task.instanceId } })') &&
    catchSection.includes('await prisma.ipv6Subnet.deleteMany({ where: { instanceId: task.instanceId } })'),
  'recreate failure after old deletion must mark DB instance error and clear stale address records'
)

const cloneSection = section(
  source,
  'async function executeCloneTask(',
  '/**\n * 启动 Worker'
)
assert.ok(
  portMappingsSource.includes('excludedPorts: number[] = []') &&
    portMappingsSource.includes('for (const port of excludedPorts)') &&
    portMappingsSource.includes('usedPorts.add(port)'),
  'allocatePort must support excluding caller-reserved ports from the available pool'
)
assert.ok(
  cloneSection.includes('newPortMappings.filter(m => m.protocol === protocol).map(m => m.publicPort), tx)') &&
    cloneSection.includes('`ports:host:${host.id}`') && cloneSection.includes('targetPorts: newPortMappings'),
  'clone port allocation must exclude selected protocol ports and persist its reservation under the host lock'
)
const cloneCatchSection = cloneSection.slice(cloneSection.lastIndexOf('  } catch (error) {'))
const cleanupSource = readFileSync(resolve(__dirname, '../src/services/instance-reinstall-identity.ts'), 'utf8')
assert.ok(cloneSection.indexOf('db.selectAndReserveHostWithLock(tx') < cloneSection.indexOf("client.request('POST', '/1.0/instances'"),
  'clone must reserve resources and durable cleanup proof before copying')
assert.ok(cloneSection.includes('const newInstanceId = await prisma.$transaction') && cloneSection.includes("status: 'COMPLETED'") &&
  cloneSection.includes('await tx.portMapping.create') && cloneSection.includes('await tx.ipAddress.create'),
  'clone identity, mappings and task completion must commit atomically')
assert.ok(cloneCatchSection.includes("current.status === 'COMPLETED'") && cloneCatchSection.includes("setCopyPhase(task.id, 'cleanup_pending')") &&
  !cloneCatchSection.includes('deleteInstance('), 'notification errors cannot delete a delivered clone; failed copies retain a cleanup fence')
assert.ok(cleanupSource.includes('cleanupManagedInstanceRemote(guarded') && cleanupSource.includes('await deleteInstance(sourceGuard') &&
  cleanupSource.indexOf('cleanupManagedInstanceRemote(guarded') < cleanupSource.indexOf('const totals = await tx.instance.aggregate'),
  'cleanup must confirm original target/source and remote storage before releasing counters')
assert.ok(!changeHostSection.includes("includes('not found')") && !cloneCatchSection.includes("includes('not found')"),
  'text mentioning not found is not verified deletion')

const restoreCatchSection = section(
  restoreWorkerSource,
  '    } catch (err) {',
  '    } finally {'
)
assert.ok(
  !restoreCatchSection.includes('deleteInstance(') && restoreCatchSection.includes("status: manualInterventionReason ? 'PROCESSING' : 'FAILED'"),
  'restore failure must preserve every copy and retain the lifecycle fence until remote recovery is confirmed'
)
assert.ok(
  restoreCatchSection.includes("progress: 'manual_intervention'") &&
    restoreCatchSection.includes('已保留临时实例') &&
    restoreCatchSection.includes('需要人工介入'),
  'restore failure after original deletion must keep the temp instance and mark the failed task for manual intervention'
)

console.log('instance recreate consistency checks passed')
