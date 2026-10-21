import assert from 'node:assert/strict'
import { ensureDedicatedForward, removeDedicatedForward, removeObsoleteDedicatedForwards } from '../src/lib/incus/dedicated-network.js'
import { applyCustomerInstanceView, publicInstanceIpv6 } from '../src/lib/customer-instance-view.js'
import { readFileSync } from 'node:fs'
import { generateIncusConfig } from '../src/lib/incus-config-generator.js'

const forwards: Array<any> = []
const calls: string[] = []
const client = { request: async (method: string, path: string, body?: any) => {
  calls.push(`${method} ${path}`)
  if (method === 'GET') return forwards
  if (method === 'POST') forwards.push(body)
  if (method === 'DELETE') forwards.splice(forwards.findIndex(row => path.endsWith(row.listen_address)), 1)
} } as any
await ensureDedicatedForward(client, 'u1-test', '10.0.0.13', '10.10.1.2')
await ensureDedicatedForward(client, 'u1-test', '10.0.0.13', '10.10.1.2')
assert.equal(calls.filter(call => call.startsWith('POST')).length, 1, 'retries reuse their owned full-address forward')
assert.deepEqual(forwards[0].ports, [], 'all ports use one address forward')
await assert.rejects(ensureDedicatedForward(client, 'u2-other', '10.0.0.13', '10.10.1.3'), /already assigned/)
await assert.rejects(ensureDedicatedForward(client, 'u1-test', '::1', '10.10.1.2'), /Invalid/)
await removeDedicatedForward(client, 'u2-other')
assert.equal(forwards.length, 1, 'another instance cannot remove this address')
await removeDedicatedForward(client, 'u1-test')
assert.equal(forwards.length, 0)
await ensureDedicatedForward(client, 'u1-test', '10.0.0.13', '10.10.1.2')
await ensureDedicatedForward(client, 'u1-test', '10.0.0.14', '10.10.1.2')
await ensureDedicatedForward(client, 'another-system', '10.0.0.15', '10.10.1.3')
await removeObsoleteDedicatedForwards(client, 'u1-test', '10.0.0.14', '10.10.1.2')
assert.deepEqual(forwards.map(row => row.listen_address), ['10.0.0.14', '10.0.0.15'], 'address changes keep the new binding and other owners intact')
const legacyClient = { request: async (_method: string, path: string) => {
  if (path === '/1.0/networks') return ['/1.0/networks/other-bridge']
  throw new Error('Network not found')
} } as any
await removeDedicatedForward(legacyClient, 'legacy-instance')
const brokenForwardClient = { request: async (_method: string, path: string) => {
  if (path === '/1.0/networks') return ['/1.0/networks/incusbr0']
  throw new Error('Forward cleanup unavailable')
} } as any
await assert.rejects(removeDedicatedForward(brokenForwardClient, 'u1-test'), /unavailable/)
const data: Record<string, any> = { host: { name: 'internal-host-secret', ip_address: '10.253.240.2' },
  ipv4: '10.10.1.2', ipv6: 'fd00::2', nat_public_ip: '192.0.2.1', hostIpAddress: '10.253.240.2',
  monthlyTrafficLimit: '1152921504606846976', limitsIngress: '300Mbit', port_mappings: [{ public_port: 29048 }] }
applyCustomerInstanceView(data, { dedicated_ipv4: true, dedicated_network_ready: true }, false)
assert.equal(data.host.name, '')
assert.equal(data.hostIpAddress, undefined)
assert.equal(data.ipv4, '192.0.2.1')
assert.equal(data.ipv6, null)
assert.equal(data.ssh_port, 22)
assert.equal(data.monthlyTrafficLimit, null)
assert.deepEqual(data.port_mappings, [])
applyCustomerInstanceView(data, { dedicated_ipv4: true, dedicated_network_ready: false }, false)
assert.equal(data.ipv4, null, 'pending setup must not advertise a working SSH address')
assert.equal(data.ssh_port, null)
const updating: Record<string, any> = { host: { nat_public_ip: '192.0.2.1' }, natPublicIp: '192.0.2.1', ipv4: '192.0.2.1' }
applyCustomerInstanceView(updating, { dedicated_ipv4: true, dedicated_network_ready: true, public_ip_sync_blocked: true }, false)
assert.equal(updating.publicIpUpdating, true)
assert.equal(updating.dedicatedNetworkReady, false)
assert.equal(updating.host.nat_public_ip, null)
assert.equal(updating.ipv4, null, 'a detected address change must hide stale customer endpoints until verification')
assert.equal(publicInstanceIpv6('2a01:4f8::2'), '2a01:4f8::2')
assert.equal(publicInstanceIpv6('fe80::1'), null)
const admin: Record<string, any> = { host: { name: 'internal-host-secret' } }
applyCustomerInstanceView(admin, { dedicated_ipv4: true }, true)
assert.equal(admin.host.name, 'internal-host-secret', 'administrators retain the host name')
const fault: Record<string, any> = { status: 'running', host: { name: 'internal-host-secret' }, natPublicIp: '192.0.2.1' }
applyCustomerInstanceView(fault, { dedicated_ipv4: true, dedicated_network_ready: true, service_fault: true }, false)
assert.equal(fault.status, 'running', 'connection failure must not rewrite persisted instance lifecycle or billing state')
assert.equal(fault.serviceFault, true, 'customer list and detail must receive an explicit fault presentation flag')
assert.equal(fault.host.name, '', 'fault responses must not expose infrastructure names')
applyCustomerInstanceView(fault, { dedicated_ipv4: true, dedicated_network_ready: true, service_fault: false }, false)
assert.equal(fault.serviceFault, false, 'a fresh healthy connection must clear the presentation fault')
for (const file of ['InstancesView.vue', 'InstanceDetailView.vue']) {
  const page = readFileSync(new URL(`../../client/src/views/${file}`, import.meta.url), 'utf8')
  assert.ok(page.includes("getStatusInfo(instance.serviceFault ? 'fault' : instance.status, t)"), 'customer list and detail must render fault instead of stale running')
}
const formatters = readFileSync(new URL('../../client/src/utils/formatters.ts', import.meta.url), 'utf8')
assert.ok(formatters.includes("fault: { labelKey: 'instance.status.fault', class: 'badge-error'"), 'fault has a customer-facing translation and failure color')
for (const type of ['container', 'virtual-machine'] as const) {
  const password = 'local-guard-password-123'
  const result = generateIncusConfig({ instanceName: 'rebuild-guard', imageAlias: 'images:debian/12', rootPassword: password, type, networkMode: 'nat' })
  const config = JSON.stringify(result.configPayload)
  assert.ok(config.includes(password) && config.includes('PasswordAuthentication yes') && !config.includes('ssh_authorized_keys:'), 'password-only rebuild configuration must enable root login without a key')
  const withKey = generateIncusConfig({ instanceName: 'rebuild-guard', imageAlias: 'images:debian/12', rootPassword: password, sshKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestOnly guard', type, networkMode: 'nat' })
  assert.ok(JSON.stringify(withKey.configPayload).includes('ssh_authorized_keys:'), 'an explicitly chosen key must be included')
}
const rebuildModal = readFileSync(new URL('../../client/src/components/instance/modals/RebuildModal.vue', import.meta.url), 'utf8')
assert.ok(rebuildModal.includes('sshKeyId: selectedSshKeyId.value ?? undefined') && rebuildModal.includes('rebuildModal.passwordOnly') && !rebuildModal.includes('selectedSshKeyId.value = keys[0].id') && !rebuildModal.includes('loading || !selectedImage || !selectedSshKeyId'), 'rebuild UI must default to password login without requiring saved keys')
const worker = readFileSync(new URL('../src/workers/instanceTaskWorker.ts', import.meta.url), 'utf8')
const rebuild = worker.slice(worker.indexOf('async function executeRebuildTask('), worker.indexOf('async function executeRecreateTask('))
assert.ok(!rebuild.includes('getSSHKeysByUserId') && rebuild.includes('SSH_KEY_NOT_OWNED') && rebuild.indexOf('SSH_KEY_NOT_OWNED') < rebuild.indexOf('deleting_snapshots'), 'rebuild must validate only the selected key before destructive steps and never silently inject another key')
console.log('Dedicated address ownership, idempotency and customer privacy checks passed')
