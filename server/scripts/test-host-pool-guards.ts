import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hostSshConnection } from '../src/lib/host-ssh.js'
import { poolCapacityReady, unsellableReason } from '../src/lib/pool-stock.js'
import { resolveHostResources } from '../src/lib/onboarding-resources.js'
import { buildPoolPurchaseRegions, localizePoolRegionName, poolPurchaseRegionStock } from '../../client/src/utils/poolRegionCatalog.js'
import { ociMachineShape } from '../../client/src/utils/poolCatalog.js'
import { groupByContinent } from '../../client/src/utils/countryContinent.js'
import { inspectRecoveryBatch, recoverRecoveryBatch, type RecoveryBatchItem } from '../../client/src/utils/hostRecoveryBatch.js'
import { hostLiveStatus } from '../src/lib/host-live-status.js'
import { refreshUnprovisionedSshIdentity, OnboardingError, validateOnboardingInput } from '../src/lib/host-onboarding.js'
import { connectOnboardingSsh } from '../src/services/onboarding-ssh.js'
import { generateKeyPairSync } from 'node:crypto'
import ssh2 from 'ssh2'

const unfinished = { status: 'failed', step: 'checking', hostId: null, managementIp: null, nodePublicKey: null, sshFingerprint: 'previous-system' }
assert.equal(refreshUnprovisionedSshIdentity(unfinished), true, 'retry a failed first SSH connection using the current system after DD')
assert.equal(refreshUnprovisionedSshIdentity({ ...unfinished, status: 'cancelled', step: 'queued' }), true)
for (const step of ['tunnel', 'resources', 'swap']) assert.equal(refreshUnprovisionedSshIdentity({ ...unfinished, step }), true)
for (const change of [{ hostId: 1 }, { managementIp: '10.90.0.2' }, { nodePublicKey: 'registered-peer' },
  { step: 'installing' }, { step: 'done' }, { status: 'running' }, { status: 'queued' }, { status: 'succeeded' }, { sshFingerprint: null }]) {
  assert.equal(refreshUnprovisionedSshIdentity({ ...unfinished, ...change }), false, 'an established or active identity must not be replaced on retry')
}
const sshFixtureKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' })
let authenticated = 0
const sshFixture = new ssh2.Server({ hostKeys: [sshFixtureKey] }, connection => {
  connection.on('error', () => {})
  connection.on('authentication', context => {
    authenticated++
    if (context.method === 'password' && context.password === 'fixture-password') context.accept()
    else context.reject()
  })
})
await new Promise<void>(resolve => sshFixture.listen(0, '127.0.0.1', resolve))
try {
  const port = (sshFixture.address() as { port: number }).port
  const config = { host: '127.0.0.1', port, password: 'fixture-password' }
  await assert.rejects(connectOnboardingSsh(config, async () => false), /SSH_HOST_KEY_CHANGED/)
  assert.equal(authenticated, 0, 'an actual pinned-key mismatch must reject before sending credentials')
  await assert.rejects(connectOnboardingSsh(config, async () => { throw Error('identity store unavailable') }), /SSH_IDENTITY_CHECK_FAILED/)
  await assert.rejects(connectOnboardingSsh(config, async () => { throw new OnboardingError('WORKER_INTERRUPTED') }), /WORKER_INTERRUPTED/)
  await assert.rejects(connectOnboardingSsh({ ...config, password: 'incorrect-fixture' }, async () => true), /SSH_AUTH_FAILED/)
  const connected = await connectOnboardingSsh(config, async () => true)
  connected.end()
} finally { await new Promise<void>(resolve => sshFixture.close(() => resolve())) }

const facts = { occupied: false, reserved: false, singleTenant: true, ready: true, hasPrice: true, resourcePreset: 'E2', customerDiskGiB: 30 }
const now = Date.now()
assert.equal(hostLiveStatus('online', { enabled: true, lastSeenAt: new Date(now - 300000) }, now), 'offline', 'historical online state must not hide expired heartbeats')
assert.equal(hostLiveStatus('online', { enabled: true, lastSeenAt: new Date(now - 30000) }, now), 'online')
assert.equal(hostLiveStatus('maintenance', { enabled: true, lastSeenAt: new Date(now) }, now), 'maintenance')
assert.equal(hostLiveStatus('online', { enabled: false, lastSeenAt: new Date(now) }, now), 'offline')
assert.equal(hostLiveStatus('online', { enabled: true, lastSeenAt: new Date(now - 300000), lastReport: { metrics: { heartbeatIntervalSeconds: 120 } } }, now), 'online', 'configured heartbeat interval must be respected')
assert.equal(hostLiveStatus('online', null, now), 'online', 'legacy hosts without an Agent preserve existing status semantics')
assert.equal(unsellableReason(facts), null)
assert.equal(unsellableReason({ ...facts, occupied: true }), 'assigned')
assert.equal(unsellableReason({ ...facts, reserved: true }), 'reserved')
assert.equal(unsellableReason({ ...facts, quarantined: true, ready: false }), 'quarantined', 'an online quarantined host needs an explicit recovery reason')
assert.equal(unsellableReason({ ...facts, ready: false }), 'not-ready')
assert.equal(unsellableReason({ ...facts, hasPrice: false }), 'no-price')
assert.equal(unsellableReason({ ...facts, capacityReady: false }), 'insufficient-resources')
assert.equal(unsellableReason({ ...facts, resourcePreset: null }), 'no-spec')

const capacity = { resourcePreset: 'E2', customerDiskGiB: 30, architecture: 'x86_64', cpuAllowanceMax: 200, memoryMax: 768, storageSize: 34, cpuUsed: 0, memoryUsed: 0, diskUsed: 0, natPortStart: 20000, natPortEnd: 20999, natPortsUsedCount: 0 }
assert.ok(poolCapacityReady(capacity))
assert.ok(poolCapacityReady({ ...capacity, natPortStart: null, natPortEnd: null }), "dedicated capacity does not depend on NAT port quota")
for (const changed of [{ cpuUsed: 1 }, { memoryMax: 767 }, { storageSize: 29 }, { architecture: 'aarch64' }]) {
  assert.equal(poolCapacityReady({ ...capacity, ...changed }), false)
}

const manual = { managementSshHost: null, managementSshPort: null, managementSshUser: null, onboardingNode: null }
assert.equal(hostSshConnection(manual).command, null, 'unknown SSH ports must not be guessed')
const direct = hostSshConnection({ ...manual, managementSshHost: '192.0.2.20', managementSshPort: 2222, managementSshUser: 'admin' })
assert.match(direct.command!, /2222.*admin@192\.0\.2\.20/)
const tunnel = hostSshConnection({ ...manual, onboardingNode: { managementIp: '10.90.0.2', sshPort: 2200 } }, { host: 'gateway.example.com' })
assert.ok(tunnel.viaGateway)
assert.match(tunnel.command!, /incudal-host-management.*2200.*10\.90\.0\.2/)
assert.match(tunnel.gatewayCommand!, /gateway\.example\.com/)

const probe = { architecture: 'x86_64' as const, cpuCount: 2, memoryMiB: 1024, diskTotalBytes: String(60n * 1073741824n), diskAvailableBytes: String(50n * 1073741824n), diskSwapMiB: 0 }
const defaults = { countryCode: 'us', resourcePreset: 'E2' as const, customerDiskGiB: 30 }
const onboardingInput = { requestId: '11111111-1111-4111-8111-111111111111', name: 'protocol-fixture', accountLabel: '',
  defaults, credentials: { password: 'fixture-only' }, nodes: [{ name: 'protocol-host', publicIp: '8.8.8.8' }] }
for (const portProtocol of [undefined, 'tcp', 'tcp_udp']) validateOnboardingInput({ ...onboardingInput, defaults: { ...defaults, portProtocol } })
assert.throws(() => validateOnboardingInput({ ...onboardingInput, defaults: { ...defaults, portProtocol: 'udp' } }), /BATCH_DEFAULTS_INVALID/)
assert.equal(resolveHostResources(probe, defaults).memoryMax, 768)
assert.throws(() => resolveHostResources({ ...probe, cpuCount: 1 }, defaults), /RESOURCE_CPU_INSUFFICIENT/)
assert.throws(() => resolveHostResources({ ...probe, memoryMiB: 800 }, defaults), /RESOURCE_MEMORY_INSUFFICIENT/)
assert.throws(() => resolveHostResources(probe, { ...defaults, customerDiskGiB: 60 }), /RESOURCE_DISK_INSUFFICIENT/)

const locations = buildPoolPurchaseRegions([])
assert.equal(locations.length, 45, 'the public region picker keeps the complete geographic catalog without listings')
assert.ok(locations.every(location => location.nameEn && location.nameZhTW), 'every catalog location must carry English and Traditional Chinese display names')
assert.equal(ociMachineShape('E2', 'x86_64'), 'VM.Standard.E2.1.Micro')
assert.equal(ociMachineShape('ARM2C', 'aarch64'), 'VM.Standard.A1.Flex')
assert.equal(ociMachineShape(null, 'x86_64'), 'VM.Standard.E2.1.Micro', 'architecture alone still resolves the shape')
assert.equal(ociMachineShape(null, null), null)
assert.equal(localizePoolRegionName('美国 · 圣何塞', 'us', 'zh-CN'), '美国西部（圣何塞）', 'zh-CN display also maps to the catalog name')
assert.equal(localizePoolRegionName('美国 · 圣何塞', 'us', 'en'), 'US West (San Jose)')
assert.equal(localizePoolRegionName('E2 · 德国 · 法兰克福', 'DE', 'zh-TW'), '德國中部（法蘭克福）')
assert.equal(localizePoolRegionName('Custom · 新地区', null, 'en'), 'Custom · 新地区', 'unmatched names stay untouched')
assert.deepEqual(groupByContinent(locations).map(group => [group.code, group.items.length]), [
  ['north-america', 8], ['south-america', 5], ['europe', 13], ['middle-east-africa', 7], ['asia-pacific', 12]
])
assert.ok(locations.every(location => location.regions.length === 0 && poolPurchaseRegionStock(location) === 0), 'placeholders must not create purchasable inventory')
const publicProduct = { id: 81, resourcePreset: 'E2', diskGiB: 30, monthlyPrice: 990, setupFee: 0, cpu: 200, memoryMiB: 768, idle: 0, total: 2 }
const publicRegions = [
  { id: 71, name: 'E2 · 德国 · 法兰克福', countryCode: 'DE', products: [publicProduct] },
  { id: 72, name: 'ARM · 德国中部（法兰克福）', countryCode: 'de', products: [{ ...publicProduct, id: 82, resourcePreset: 'ARM2C', idle: 3 }] }
]
const catalogBeforeGrouping = JSON.stringify(publicRegions)
const displayed = buildPoolPurchaseRegions(publicRegions)
const frankfurt = displayed.find(location => location.name === '德国中部（法兰克福）')!
assert.equal(displayed.length, 45, 'E2 and ARM are two configurations in one geographic location')
assert.deepEqual(frankfurt.regions.map(region => [region.id, region.products[0].id]), [[71, 81], [72, 82]], 'selection must retain the actual region and price identifiers')
assert.strictEqual(frankfurt.regions[0], publicRegions[0])
assert.equal(poolPurchaseRegionStock(frankfurt), 3, 'only live idle capacity is displayed')
assert.equal(JSON.stringify(publicRegions), catalogBeforeGrouping, 'display grouping cannot mutate live catalog data')
const madridCatalog = buildPoolPurchaseRegions([
  { id: 73, name: 'E2 · 西班牙中部 2（马德里）', countryCode: 'es', products: [publicProduct] },
  { id: 74, name: 'E2 · 马德里', countryCode: 'es', products: [publicProduct] },
  { id: 75, name: 'E2 · 新加坡', countryCode: 'sg', products: [publicProduct] },
  { id: 76, name: 'Custom · 新地区', countryCode: null, products: [publicProduct] }
])
assert.equal(madridCatalog.find(location => location.name === '西班牙中部 2（马德里）')!.regions[0].id, 73)
assert.equal(madridCatalog.find(location => location.name === '西班牙中部（马德里）')!.regions.length, 0)
assert.deepEqual(madridCatalog.filter(location => location.key.startsWith('custom:')).map(location => location.regions[0].id), [74, 75, 76], 'ambiguous or custom names must remain visible without guessing their geographic identity')
const poolOrderServiceSource = readFileSync(new URL('../src/services/pool-orders.ts', import.meta.url), 'utf8')
assert.ok(!poolOrderServiceSource.includes('一机一卖订单'), 'balance-log remarks must not carry the internal one-machine jargon')
assert.ok(poolOrderServiceSource.includes('购买实例订单'), 'pool checkout ledger remarks must use the customer-facing wording')
const poolRemarkMigration = readFileSync(new URL('../prisma/migrations/202610180003_pool_remark_wording/migration.sql', import.meta.url), 'utf8')
assert.ok(poolRemarkMigration.includes('UPDATE "balance_logs"') && poolRemarkMigration.includes('一机一卖'), 'the migration must rewrite existing balance-log remarks away from the jargon')

const batchItems: RecoveryBatchItem[] = [1, 2, 3, 4].map(id => ({ id, name: `host-${id}`, status: 'pending', report: null, error: '' }))
const calls: number[] = [], recoveredIds: number[] = []
const batchApi = {
  inspectRecovery: async (id: number) => {
    calls.push(id)
    if (id === 2) throw { code: 'HOST_RECOVERY_UNREACHABLE' }
    return { hostId: id, quarantined: true, checkedAt: new Date().toISOString(), blockers: id === 3 ? ['assigned'] : [], instances: [], forwardCount: 0, needsCleanup: id === 4, canRecover: id !== 3, confirmation: String(id).repeat(64) }
  },
  recover: async (id: number, options: { confirmation: string; acknowledgeCleanup: boolean }) => {
    assert.equal(options.confirmation, String(id).repeat(64))
    recoveredIds.push(id)
    if (id === 1) throw { code: 'HOST_RECOVERY_CHANGED', report: { hostId: id, quarantined: true, checkedAt: new Date().toISOString(), blockers: ['busy'], instances: [], forwardCount: 0, needsCleanup: false, canRecover: false, confirmation: String(id).repeat(64) } }
    assert.equal(options.acknowledgeCleanup, true)
  }
}
await inspectRecoveryBatch(batchItems, batchApi)
assert.deepEqual(calls, [1, 2, 3, 4], 'one failed inspection must not stop later hosts')
assert.deepEqual(batchItems.map(item => item.status), ['ready', 'failed', 'blocked', 'ready'])
await recoverRecoveryBatch(batchItems, batchApi, false)
assert.deepEqual(recoveredIds, [1], 'blocked and unconfirmed cleanup hosts must never be restored')
assert.deepEqual(batchItems[0].report?.blockers, ['busy'], 'the real API interceptor exposes updated blockers on the top-level error')
await recoverRecoveryBatch(batchItems, batchApi, true)
assert.deepEqual(recoveredIds, [1, 4], 'a failed host cannot hide a later successful recovery')
assert.equal(batchItems[3].status, 'recovered')
await inspectRecoveryBatch(batchItems, batchApi)
assert.equal(batchItems[3].status, 'recovered', 'rechecking failed hosts must preserve successful results')
const batchModal = readFileSync(new URL('../../client/src/components/host/HostRecoveryBatchModal.vue', import.meta.url), 'utf8')
assert.ok(batchModal.includes('item.report.blockers') && batchModal.includes('cleanupNeeded && !acknowledged') && batchModal.includes("dialog.value?.showModal()"), 'batch modal must show per-host blockers, explicit cleanup consent and native focus management')
const recoveryService = readFileSync(new URL('../src/services/host-pool-recovery.ts', import.meta.url), 'utf8')
const preserveBranch = recoveryService.slice(recoveryService.indexOf("if (before.report.mode === 'preserve')"), recoveryService.indexOf('// Log intent'))
assert.ok(preserveBranch.includes('poolFaulted: false') && preserveBranch.includes('return') && !preserveBranch.includes('cpuUsed: 0') && !preserveBranch.includes("'DELETE'"), 'occupied recovery releases quarantine without changing occupied resources or deleting customer systems')
const replacementService = readFileSync(new URL('../src/services/host-replacement.ts', import.meta.url), 'utf8')
assert.equal(replacementService.match(/\.\.\.replacementConfigurationWhere\(instance, allRegions\)/g)?.length, 2, 'candidate listing and transactional reservation must enforce the same configuration and region policy')
assert.ok(replacementService.includes('cpuAllowanceMax: instance.cpu') && replacementService.includes('memoryMax: instance.memory') && replacementService.includes('customerDiskGiB: Math.ceil(instance.disk / 1024)'), 'replacement machines must match all customer resource quotas exactly')
const replacementDetail = readFileSync(new URL('../../client/src/views/InstanceDetailView.vue', import.meta.url), 'utf8')
assert.match(replacementDetail, /const HostReplacementModal = isAdminEntry\s*\? defineAsyncComponent/, 'customer entry must not import admin replacement capabilities')
assert.ok(replacementDetail.includes('isAdminEntry && instance.dedicatedIpv4') && replacementDetail.includes('allow-other-regions'), 'admin dedicated instance detail exposes regional replacement')
const replacementModal = readFileSync(new URL('../../client/src/components/host/HostReplacementModal.vue', import.meta.url), 'utf8')
assert.ok(replacementModal.includes('sequence !== refreshSequence') && replacementModal.includes('replacement.dataBoundary') && replacementModal.includes('dialog.value?.showModal()'), 'replacement dialog rejects stale scope responses and provides data-boundary wording and focus management')
const onboardingView = readFileSync(new URL('../../client/src/views/admin/HostOnboardingView.vue', import.meta.url), 'utf8')
const gatewaysView = readFileSync(new URL('../../client/src/views/admin/GatewaysView.vue', import.meta.url), 'utf8')
assert.ok(onboardingView.includes('onboarding.gatewaySetup') && onboardingView.includes('to="/admin/gateways"') && gatewaysView.includes('<ManagementGatewayPanel />') && onboardingView.includes('role="tab"') && onboardingView.includes('aria-controls="pool-tab-content"'), 'machine pool must link to the complete gateway page and retain accessible host/task tabs')
assert.ok(!onboardingView.includes('pool-tab-gateways') && !onboardingView.includes('<ManagementGatewayPanel'), 'gateway configuration belongs on its dedicated navigation page')
assert.ok(!onboardingView.includes('sudo bash install-panel.sh --configure-host-pool') && !onboardingView.includes('curl -fsSL'), 'normal gateway setup must not ask the administrator to run SSH commands')
console.log('Host pool resource, availability, SSH, public region catalog, replacement and batch recovery checks passed')
