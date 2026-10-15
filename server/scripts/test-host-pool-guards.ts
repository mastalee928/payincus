import assert from 'node:assert/strict'
import { hostSshConnection } from '../src/lib/host-ssh.js'
import { poolCapacityReady, unsellableReason } from '../src/lib/pool-stock.js'
import { resolveHostResources } from '../src/lib/onboarding-resources.js'

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
console.log('Host pool resource, availability and SSH checks passed')
