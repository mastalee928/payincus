import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { assertCustomerIsolation, assertCustomerProfiles, readCustomerIsolation, rejectCustomerPrivilege } from '../src/lib/incus/customer-isolation.js'
import { buildInstanceConfig, createInstance, updateInstance, startInstance, addDevice, removeDevice } from '../src/lib/incus/incus-instances.js'
import { restoreSnapshot } from '../src/lib/incus/incus-snapshots.js'
import type { IncusClient } from '../src/lib/incus/incus-client.js'

const options = { name: 'customer-fixture', image: 'images:debian/13', cpu: 100, memory: 512, disk: 1024, password: 'fixture-original-password' }
for (const value of [true, 'true', '1', 1, 'yes', 'on', 'TRUE', {}, []]) {
  assert.throws(() => rejectCustomerPrivilege(value), /禁止特权/)
}
for (const value of [false, 0, undefined, null, '', 'false', '0']) rejectCustomerPrivilege(value)
assertCustomerIsolation({ config: { 'security.privileged': 0 } })
assert.throws(() => buildInstanceConfig({ ...options, privileged: true }), /禁止特权/)
const generated = buildInstanceConfig(options) as any
assert.deepEqual(generated.profiles, [])
assert.equal(generated.config['security.privileged'], 'false')
assert.equal(generated.devices.eth0.network, 'incusbr0', 'Legacy creation gets an explicit NIC without profile inheritance')
assert.match(generated.config['user.user-data'], /fixture-original-password/, 'Customer password initialization is preserved')
assertCustomerIsolation(generated)
const nested = buildInstanceConfig({ ...options, nested: true }) as any
assert.equal(nested.config['security.nesting'], 'true')
assert.equal(nested.config['security.privileged'], 'false')
assertCustomerIsolation(nested)
assertCustomerIsolation(buildInstanceConfig({ ...options, instanceType: 'vm' }))
for (const config of [
  { 'security.privileged': 'true' }, { 'raw.lxc': 'lxc.apparmor.profile=unconfined' },
  { 'raw.idmap': 'both 0 0' }, { 'raw.apparmor': 'mount,' }, { 'raw.seccomp': '2\nwhitelist' },
  { 'security.syscalls.allow': 'all' }, { 'security.syscalls.deny_default': 'false' },
  { 'security.devlxd.images': 'true' }, { 'volatile.idmap.current': '[{"Hostid":0,"Maprange":65536}]' },
  { 'security.idmap.base': '0' }, { 'security.syscalls.intercept.mount': 'true' }, { 'security.syscalls.intercept.bpf': 'true' },
  { 'volatile.idmap.next': 'invalid' }
]) assert.throws(() => assertCustomerIsolation({ config }), /禁止特权|隔离检查/)
assertCustomerIsolation({ config: { 'volatile.idmap.current': '[{"Hostid":1000000,"Maprange":65536}]' } })
for (const device of [
  { type: 'disk', source: '/', path: '/host' }, { type: 'disk', source: '/var/lib/incus/unix.socket', path: '/socket' },
  { type: 'unix-char', source: '/dev/kmsg' }, { type: 'unix-block', source: '/dev/sda' },
  { type: 'gpu' }, { type: 'pci' }, { type: 'nic', nictype: 'physical' },
  { type: 'proxy', listen: 'tcp:0.0.0.0:22', connect: 'unix:/var/lib/incus/unix.socket' },
  { type: 'proxy', bind: 'container', listen: 'tcp:0.0.0.0:22', connect: 'tcp:127.0.0.1:8443' }
]) assert.throws(() => assertCustomerIsolation({ devices: { dangerous: device } }), /隔离检查/)

let state = { ...structuredClone(generated), status: 'Stopped' }, profile: any = { config: {}, devices: {} }
let snapshot: any = structuredClone(state)
const writes: Array<{ method: string; path: string; body: any }> = []
const client = { request: async (method: string, path: string, body?: any) => {
  if (method === 'GET') {
    if (path === '/1.0/profiles/default') return structuredClone(profile)
    if (path.endsWith('/snapshots/safe')) return structuredClone(snapshot)
    return structuredClone(state)
  }
  writes.push({ method, path, body: structuredClone(body) }); return {}
} } as unknown as IncusClient
await createInstance(client, generated)
assert.equal(writes.length, 1)
await assert.rejects(createInstance(client, { ...generated, profiles: undefined }), /显式指定/)
await assert.rejects(createInstance(client, { ...generated, config: { 'security.privileged': 'true' },
  expanded_config: { 'security.privileged': 'false' } }), /禁止特权/, 'Write-supplied expanded config cannot hide actual privilege')
profile = { config: { 'security.privileged': 'true' }, devices: {} }
await assert.rejects(createInstance(client, { ...generated, config: {}, profiles: ['default'] }), /禁止特权/)
await assertCustomerProfiles(client, { ...generated, profiles: ['default'] }) // Explicit false overrides privilege.
for (const value of [null, '']) {
  await assert.rejects(assertCustomerProfiles(client, { ...generated, config: { 'security.privileged': value }, profiles: ['default'] }),
    /禁止特权/, 'Deleting an override must expose and reject inherited privilege')
}
profile = { config: { 'raw.lxc': 'unsafe' }, devices: {} }
await assert.rejects(createInstance(client, { ...generated, profiles: ['default'] }), /隔离检查/)
profile = { config: {}, devices: { host: { type: 'disk', path: '/host', source: '/' } } }
await assert.rejects(createInstance(client, { ...generated, profiles: ['default'] }), /隔离检查/)
assert.equal(writes.length, 1, 'Rejected creations cannot reach Incus')
await assert.rejects(updateInstance(client, options.name, { config: { 'security.privileged': 'true' } }), /禁止特权/)
await assert.rejects(addDevice(client, options.name, 'host', { type: 'disk', path: '/host', source: '/' }), /隔离检查/)
state.expanded_config = { ...state.config, 'security.privileged': 'true' }
await assert.rejects(startInstance(client, options.name), /禁止特权/)
delete state.expanded_config
snapshot.config['security.privileged'] = 'true'
await assert.rejects(restoreSnapshot(client, options.name, 'safe'), /禁止特权/)
assert.equal(writes.length, 1, 'Unsafe update, device, start and snapshot restore dispatch zero mutations')
snapshot = structuredClone(state)
await restoreSnapshot(client, options.name, 'safe')
await startInstance(client, options.name)
assert.equal(writes.length, 3)
await readCustomerIsolation(client, options.name)
state.profiles = ['default']
state.devices.host = { type: 'none' }
profile = { config: {}, devices: { host: { type: 'disk', path: '/host', source: '/' } } }
await readCustomerIsolation(client, options.name)
await assert.rejects(removeDevice(client, options.name, 'host'), /隔离检查/,
  'Removing a local mask must not expose a dangerous inherited host mount')
assert.equal(writes.length, 3, 'Rejected device removal dispatches no write')
profile = { config: {}, devices: {} }
await removeDevice(client, options.name, 'host')
assert.equal(writes.length, 4, 'Safe device removal still works')
assert.doesNotMatch(readFileSync('src/db/init-prisma.ts', 'utf8'), /privileged:\s*true/,
  'The disabled default package initializer must also follow the customer isolation policy')
for (const [file, marker] of [
  ['src/workers/instanceTaskWorker.ts', 'await readCustomerIsolation(client, sourceInstance.incus_id)'],
  ['src/lib/incus/incus-restore.ts', 'await readCustomerIsolation(bounded, targetName)'],
  ['src/lib/incus/restore-identity.ts', 'await assertCustomerProfiles(client, remote)']
]) assert.ok(readFileSync(file, 'utf8').includes(marker), `${file} keeps its isolation boundary`)
console.log('PASS customer isolation: privilege coercion including database numeric zero, profiles, raw config, host device/socket exposure, UID mapping, creation/password/nesting/VM, rejected writes, start/snapshot restore and device removal inheritance')
