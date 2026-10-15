import assert from 'node:assert/strict'
import { hostSshConnection } from '../src/lib/host-ssh.js'
import { poolCapacityReady, unsellableReason } from '../src/lib/pool-stock.js'
import { resolveHostResources } from '../src/lib/onboarding-resources.js'
import { buildPoolPurchaseRegions, poolPurchaseRegionStock } from '../../client/src/utils/poolRegionCatalog.js'
import { groupByContinent } from '../../client/src/utils/countryContinent.js'

const facts = { occupied: false, reserved: false, singleTenant: true, ready: true, hasPrice: true, resourcePreset: 'E2', customerDiskGiB: 30 }
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
assert.equal(resolveHostResources(probe, defaults).memoryMax, 768)
assert.throws(() => resolveHostResources({ ...probe, cpuCount: 1 }, defaults), /RESOURCE_CPU_INSUFFICIENT/)
assert.throws(() => resolveHostResources({ ...probe, memoryMiB: 800 }, defaults), /RESOURCE_MEMORY_INSUFFICIENT/)
assert.throws(() => resolveHostResources(probe, { ...defaults, customerDiskGiB: 60 }), /RESOURCE_DISK_INSUFFICIENT/)

const locations = buildPoolPurchaseRegions([])
assert.equal(locations.length, 45, 'the public region picker keeps the complete geographic catalog without listings')
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
console.log('Host pool resource, availability, SSH and public region catalog checks passed')
