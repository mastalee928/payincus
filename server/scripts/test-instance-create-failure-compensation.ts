import { prepareNewContainerCloudInit } from '../src/lib/new-container-cloud-init.js'
import { IncusApiError } from '../src/lib/incus/incus-client.js'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const readSource = (path: string) => readFileSync(resolve(__dirname, path), 'utf8').replace(/\r\n/g, '\n')
const instancesSource = readSource('../src/routes/instances.ts')
const adminBillingSource = readSource('../src/routes/admin-billing.ts')
const managedProvisionSource = readSource('../src/lib/managed-instance-provision.ts')
const managedCleanupSource = readSource('../src/lib/managed-cleanup-identity.ts')
const appSource = readSource('../src/app.ts')
const compensationSource = readSource('../src/db/instance-provisioning-compensation.ts')

function indexOfOrThrow(source: string, pattern: string, label: string): number {
  const index = source.indexOf(pattern)
  assert.ok(index >= 0, `Missing ${label}: ${pattern}`)
  return index
}

function section(source: string, startPattern: string, endPattern: string): string {
  const start = indexOfOrThrow(source, startPattern, startPattern)
  const relativeEnd = indexOfOrThrow(source.slice(start), endPattern, endPattern)
  return source.slice(start, start + relativeEnd)
}

const compensationSection = compensationSource
assert.ok(compensationSection.includes("if (instance.status === 'deleted')"), 'late failure compensation must defer to claimed destroy settlement')
const checkoutSource = readSource('../src/services/checkout-orders.ts')
assert.ok(compensationSection.includes('await creditFailedCheckoutRefundToBalance(') &&
  checkoutSource.includes('resolution: `balance-log:${ledger.id}`') &&
  checkoutSource.includes("await tx.user.update({ where: { id: current.userId }, data: { balance: { increment: amount } } })") &&
  checkoutSource.includes('await creditFailedCheckoutRefundToBalance(tx, current, null, current.totalCents'),
  'failed third-party delivery refunds its verified original receipt to the payer wallet in the same transaction, including pre-materialization failure')

const failureSection = section(
  instancesSource,
  '  } catch (error) {\n    const errorMessage = error instanceof Error ? error.message : String(error)',
  '    throw error\n  } finally { poolProvision?.finish() }\n}'
)

const createInstanceAsyncSection = instancesSource.slice(
  indexOfOrThrow(instancesSource, 'async function createInstanceAsync(', 'createInstanceAsync')
)

const staticIpAllocationSection = section(
  instancesSource,
  '    if (networkModeNeedsNatIpv4(networkMode)) {',
  '    console.log(`[Provisioning] IP 分配完成: IPv4=${staticIPv4}, IPv6=${staticIPv6}`)'
)

const postTransactionPreparationSection = section(
  instancesSource,
  '    // 事务成功后，完成 IP 分配和存储池选择',
  '    // ==================== 阶段六: 异步执行创建 ===================='
)

const compensationHelperSection = section(
  instancesSource,
  'async function compensateFailedInstanceCreation(',
  '\n}\n\n/**\n * 异步创建实例'
)

assert.ok(
  staticIpAllocationSection.includes('staticIpAllocationError = `NAT 内网 IPv4 分配失败') &&
    staticIpAllocationSection.includes("staticIpAllocationError ||= '宿主机未配置 routed IPv6 子网'") &&
    staticIpAllocationSection.includes('staticIpAllocationError ||= `routed IPv6 分配失败') &&
    staticIpAllocationSection.includes('throw new Error(staticIpAllocationError)') &&
    !staticIpAllocationSection.includes('实例将使用动态 IP') &&
    !staticIpAllocationSection.includes('将使用动态分配'),
  'fatal NAT IPv4 and routed IPv6 allocation failures must enter provisioning compensation and return an explicit failure'
)

assert.ok(
  postTransactionPreparationSection.includes('try {') &&
    postTransactionPreparationSection.includes('db.reservePublicIpv4ForInstance') &&
    postTransactionPreparationSection.includes('await db.resolveStoragePoolForNewInstance') &&
    postTransactionPreparationSection.includes('} catch (error) {') &&
    postTransactionPreparationSection.includes('await compensateFailedInstanceCreation({') &&
    postTransactionPreparationSection.includes('return reply.code(503).send(apiError(ErrorCode.HOST_RESOURCES_INSUFFICIENT, errorMessage))'),
  'all synchronous post-transaction IP and storage preparation failures must be compensated immediately'
)

const lifecycleSource = readSource('../src/lib/managed-provisioning-lifecycle.ts')
assert.ok(failureSection.includes('await compensateFailedInstanceCreation({') &&
  compensationHelperSection.includes('await failManagedProvision(instanceId, host, input.beforeRemoteCreate)'))
assert.ok(appSource.includes('createCleanupRunning') && appSource.includes('await failManagedProvision(instance.id, host)') &&
  appSource.includes('Target remains pending') && !appSource.includes('await rollbackResources({'),
  'timeout scan isolates each target and uses pending cleanup rather than premature resource rollback')
const adminAsyncSection = section(adminBillingSource, 'async function createInstanceAsync(', '\n}\n')
assert.ok(adminAsyncSection.includes('await failManagedProvision(instanceId, host, !lifecycle)') &&
  adminAsyncSection.includes('if (!running) throw new Error') && adminAsyncSection.includes('await lifecycle.complete('))
assert.ok(lifecycleSource.indexOf('await cleanupManagedInstanceRemote(') < lifecycleSource.indexOf('UPDATE hosts SET cpu_used') &&
  lifecycleSource.includes('provisioningCleanupPending: true') && lifecycleSource.includes('await db.releasePublicIpv4ForInstance(tx, instanceId)') &&
  lifecycleSource.includes('await db.compensateFailedInstancePurchase(') && lifecycleSource.includes('Original creation attempt is not recorded'),
  'original attempt absence plus disk/forward verification must precede releasing resources; billing retries independently')

const managedAsyncSection = section(
  managedProvisionSource,
  'export async function provisionManagedInstanceAsync(',
  '\n}\n'
)

assert.ok(
  managedAsyncSection.includes("where: { ...target, status: 'creating', provisioningCleanupPending: false }") &&
    managedAsyncSection.includes("data: { status: 'error', provisioningCleanupPending: true,") &&
    managedAsyncSection.includes('await tx.$queryRaw`SELECT id FROM instances WHERE id = ${instanceId} FOR UPDATE`') &&
    managedAsyncSection.includes('await db.releasePublicIpv4ForInstance(tx, instanceId)') &&
    managedAsyncSection.includes('await db.compensateFailedInstancePurchase(instanceId, instance.userId, instance.hostId)') &&
    managedAsyncSection.includes('if (!billingSettled || current.deletionBillingPending) throw new Error') &&
    managedAsyncSection.includes("data: { status: 'deleted', provisioningCleanupPending: false }") &&
    indexOfOrThrow(managedAsyncSection, 'await cleanupManagedInstanceRemote(transport, config.name, attempt, cleanupDeadline)', 'confirmed remote cleanup') <
      indexOfOrThrow(managedAsyncSection, 'UPDATE hosts SET cpu_used', 'resource release'),
  'managed failures must claim the same target, preserve pending resources until confirmed remote cleanup, and release resources/IP atomically under the instance lock; refunds remain independent'
)

assert.ok(
  instancesSource.includes('宿主机 ${host.name} 没有可用独立 IPv4 地址') &&
    postTransactionPreparationSection.includes('throw new Error(`宿主机 ${host.name} 没有可用独立 IPv4 地址`)'),
  'public IPv4 allocation races must enter the same resource and billing compensation path'
)

assert.ok(
  adminBillingSource.includes('宿主机 ${host.name} 没有可用独立 IPv4 地址') &&
    adminBillingSource.includes('[Admin Create Instance] 独立 IPv4 分配失败后资源回滚失败') &&
    adminBillingSource.includes('[Admin Create Instance] 独立 IPv4 分配失败后计费补偿失败'),
  'admin instance creation must rollback resources and compensate purchase when public IPv4 allocation races to empty'
)

const hostRoutesSource = readSource('../src/routes/hosts.ts')
assert.ok(
  hostRoutesSource.includes('宿主机 ${lockedHost!.name} 没有可用独立 IPv4 地址') &&
    hostRoutesSource.includes('instanceId && lockedHost && !provisioningStarted') &&
    hostRoutesSource.includes('where: { id: instanceId, ...creationTarget }') &&
    hostRoutesSource.includes('if (claimed.count !== 1) return false') &&
    hostRoutesSource.includes('nat_ports_used_count - ${reservedPortCount}') &&
    hostRoutesSource.includes('db.allocateAndReserveNatIpv4(lockedHost!.id, instanceId, tx)') &&
    hostRoutesSource.includes('packageId, client: tx'),
  'host gift preparation must atomically roll back IP writes and release only its claimed resource reservation; zero-price gifts must not generate refunds'
)

assert.ok(
  managedCleanupSource.includes("action: 'stop', force: true, timeout: 20") &&
    managedCleanupSource.includes("await boundedClient.request('DELETE', path)") &&
    managedCleanupSource.includes("if (!absent) throw new Error('Remote deletion not confirmed')") &&
    managedCleanupSource.includes("remote.config?.['user.payincus.provisioning-attempt'] !== attempt") &&
    managedAsyncSection.includes('if (updateResult.count === 0) throw error'),
  'managed cleanup must verify this attempt, stop/delete/absence and defer to the other owner when finalization was already claimed'
)

assert.ok(
  compensationSection.includes('await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, userId)'),
  'failed paid provisioning refund must use a blocking user balance lock'
)

assert.ok(
  compensationSection.includes("type: 'newPurchase'") &&
    compensationSection.includes("type: 'refund'") &&
    compensationSection.includes("remark: { contains: '实例创建失败自动退款' }"),
  'failed paid provisioning refund must be idempotent against existing failure refunds'
)

assert.ok(
  compensationSection.includes("data: { balance: { increment: refundAmount } }") &&
    compensationSection.includes("type: 'refund'") &&
    compensationSection.includes('amount: refundAmount') &&
    compensationSection.includes('amount: -refundAmount') &&
    compensationSection.includes('balanceLogId: balanceLog.id'),
  'failed paid provisioning must refund user balance and create matching billing refund record'
)

assert.ok(
  compensationSection.includes('USER_AFF_BALANCE_LOCK_NAMESPACE') &&
    compensationSection.includes("type: 'new_purchase'") &&
    compensationSection.includes('amount: -commissionAmount') &&
    compensationSection.includes("remark: `实例创建失败返利冲正：${instance.name}`") &&
    compensationSection.includes('usedCount: { decrement: 1 }') &&
    compensationSection.includes('totalEarnings: { decrement: commissionAmount }'),
  'failed paid provisioning must reverse AFF commission logs and counters'
)

assert.ok(
  compensationSection.includes('await tx.hostingBalanceLog.deleteMany({') &&
    compensationSection.includes("type: 'income'") &&
    compensationSection.includes("actionType: 'purchase'") &&
    compensationSection.includes('frozen: true'),
  'failed paid provisioning must remove unearned hosted-node frozen purchase income'
)

console.log('instance create failure compensation checks passed')

const cloudInitRequests: Array<{ method: string; path: string }> = []
const cloudInitClient = {
  async request<T>(method: string, path: string): Promise<T> {
    cloudInitRequests.push({ method, path })
    return undefined as T
  }
}
await prepareNewContainerCloudInit(cloudInitClient, 'new-customer', { 'user.user-data': '#cloud-config\n{}' })
assert.deepEqual(cloudInitRequests, [{ method: 'DELETE', path: '/1.0/instances/new-customer/files?path=/etc/cloud/cloud-init.disabled' }])
cloudInitRequests.length = 0
const emptyCloudInitConfigs: Array<Record<string, string> | undefined> = [undefined, {}, { 'user.user-data': '  ' }]
for (const config of emptyCloudInitConfigs) {
  await prepareNewContainerCloudInit(cloudInitClient, 'not-initialized', config)
}
await prepareNewContainerCloudInit(cloudInitClient, 'vm', { 'user.user-data': '#cloud-config\n{}' }, 'vm')
assert.equal(cloudInitRequests.length, 0, 'VMs and creates without requested cloud-init must not touch guest files')
await prepareNewContainerCloudInit(cloudInitClient, 'new-cloud-key', { 'cloud-init.user-data': '#cloud-config\n{}' })
assert.equal(cloudInitRequests.length, 1)
const missingMarkerClient = { async request<T>(_method: string, path: string): Promise<T> { throw new IncusApiError('marker absent', 404, path) } }
await prepareNewContainerCloudInit(missingMarkerClient, 'new-no-marker', { 'user.user-data': '#cloud-config\n{}' })
for (const failure of ['permission denied', 'Incus unavailable', 'open /etc/cloud/cloud-init.disabled: no such file or directory']) {
  const failingClient = { async request<T>(): Promise<T> { throw Error(failure) } }
  await assert.rejects(prepareNewContainerCloudInit(failingClient, 'new-failing', { 'user.user-data': '#cloud-config\n{}' }), new RegExp(failure))
}
for (const source of [createInstanceAsyncSection, adminAsyncSection, managedAsyncSection]) {
  const create = source.indexOf('await createInstance(client, incusConfig)')
  const prepare = source.indexOf('await prepareNewContainerCloudInit(client, config.name, config.cloudInitConfig, config.instanceType)')
  const start = source.indexOf('await startInstance(client, config.name)')
  assert.ok(create >= 0 && prepare > create && start > prepare, 'new container initialization must be prepared after creation and before its first start')
}
for (const path of ['src/workers/restoreTaskWorker.ts', 'src/services/platform-backup-worker.ts', 'src/lib/incus/incus-instances.ts']) {
  assert.ok(!readFileSync(resolve(__dirname, '../', path), 'utf8').includes('prepareNewContainerCloudInit'), 'existing instance restore/move/recreate and generic Incus calls must not initialize customer disks')
}
const taskWorker = readSource('../src/workers/instanceTaskWorker.ts')
assert.equal((taskWorker.match(/await prepareNewContainerCloudInit\(/g) || []).length, 3,
  'only proven fresh rebuild/recreate/change-system targets may remove their disable marker')
assert.ok(taskWorker.includes('await reinstall.targetIdentity()\n  await prepareNewContainerCloudInit') &&
  taskWorker.includes('const rebuiltSpecs = await reinstall.proof(false)') &&
  taskWorker.includes("if ((await getInstanceState(client, instance.incus_id) as { status?: string }).status !== 'Running')") &&
  taskWorker.includes('await readCreatedGuest(targetClient, newIncusId, targetAttempt, instanceType)'),
  'destructive reinstall authorization and exact newly created identity must precede fresh rootfs initialization')
console.log('Fresh container cloud-init preparation passed: disable marker, missing marker, failure, VM/no-config exclusion and existing-disk boundaries')
