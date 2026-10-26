import assert from 'node:assert/strict'
import { discoverHostPublicIpv6, publicIpv6, orderedPublicIpv6, publicIpv6State, customerIpv6View, dedicatedIpv6Address,
  PublicIpv6SyncError } from '../src/lib/host-public-ipv6.js'
import { ensureDedicatedForward, removeObsoleteDedicatedForwards, removeDedicatedForward } from '../src/lib/incus/dedicated-network.js'
import { reconcileDedicatedIpv6, dedicatedIpv6InstallScript, dedicatedIpv6NetworkDigest, MAX_IPV6_VERIFICATIONS_PER_PASS } from '../src/lib/incus/dedicated-ipv6.js'
import { ipv6BoundedClient } from '../src/lib/incus/ipv6-deadline.js'
import { waitForOperation } from '../src/lib/incus/incus-utils.js'
import { readFileSync } from 'node:fs'
import { applyCustomerInstanceView } from '../src/lib/customer-instance-view.js'
import { PublicIpSyncError } from '../src/lib/host-public-ip.js'
import { dedicatedIpv6ProbeScript, validateDedicatedIpv6Probe } from '../src/lib/incus/dedicated-ipv6-probe.js'

const a = '2603:c020:802a:cc00::1', b = '2603:c020:802a:cc00::2', c = '2603:c020:802a:cc00::3'
assert.equal(publicIpv6('2603:C020:802A:CC00:0000:0000:0000:0001'), a)
for (const value of ['::1', '::', 'fd00::2', 'fe80::1', 'ff02::1', '::ffff:8.8.8.8', '2::1', '2001:db8::1', '3fff::1', 'fe80::1%eth0', 'not-an-ip']) {
  assert.equal(publicIpv6(value), null, `${value} is not an assignable public address`)
}
assert.deepEqual(orderedPublicIpv6([b, a, a.toUpperCase()], a), [a, b], 'primary survives discovery ordering and equivalent text')
assert.deepEqual(orderedPublicIpv6([b, c], a), [b, c], 'removed primary is replaced deterministically')
assert.deepEqual(publicIpv6State(null).addresses, [])

let failedRead = false
const discovery: any = { request: async (_method: string, path: string) => {
  if (path === '/1.0/networks?recursion=1') return [
    { name: 'eth0', managed: false, type: 'physical' }, { name: 'eth1', managed: false, type: 'physical' },
    { name: 'incusbr0', managed: true, type: 'bridge' }, { name: 'wg0', managed: false, type: 'unknown' }
  ]
  assert.ok(!path.includes('incusbr0') && !path.includes('wg0'), 'managed/internal interfaces cannot supply public inventory')
  if (failedRead) throw new Error('connection lost')
  return { state: path.includes('eth0') ? 'up' : 'down', addresses: [
    { family: 'inet6', scope: 'global', address: path.includes('eth0') ? a : c, netmask: '128' },
    { family: 'inet6', scope: 'global', address: b }, { family: 'inet6', scope: 'global', address: 'fd00::1' },
    { family: 'inet6', scope: 'link', address: 'fe80::1' }
  ] }
} }
assert.deepEqual(await discoverHostPublicIpv6(discovery, a), [a, b], 'only actual addresses are assigned; /128 is not expanded into a pool')
failedRead = true
await assert.rejects(discoverHostPublicIpv6(discovery), /connection lost/, 'an unreadable interface is not a successful empty inventory')

let forwards: any[] = [], writes = 0
const client: any = { request: async (method: string, path: string, body?: any) => {
  if (method === 'GET') return structuredClone(forwards)
  writes++
  if (method === 'POST') forwards.push(structuredClone(body))
  const address = decodeURIComponent(path.split('/').pop()!)
  if (method === 'PUT') Object.assign(forwards.find(item => item.listen_address === address), structuredClone(body))
  if (method === 'DELETE') forwards = forwards.filter(item => item.listen_address !== address)
} }
const gateway = 'fd42:1:2:3::1'
const verified: string[] = [], guestAddresses: string[][] = []
let failure: string | null = null, guestFailure = false
let guestVerifications = 0
const deps = {
  guestVerify: async () => { guestVerifications++ },
  bridge: async () => gateway,
  network: async () => {},
  guest: async (_client: any, _name: string, _gateway: string | null, addresses: string[]) => {
    if (guestFailure) throw new PublicIpv6SyncError('IPV6_GUEST_CONFIG_FAILED')
    guestAddresses.push(addresses)
  },
  fingerprints: async () => ['SHA256:fixture'],
  verify: async (address: string, port: number, fingerprints: string[]) => {
    assert.equal(port, 22); assert.deepEqual(fingerprints, ['SHA256:fixture'])
    verified.push(address)
    if (address === failure) throw new Error('public route blocked')
  }
}
const input = { hostId: 4, instanceId: 22, name: 'u1-ipv6', addresses: [] as string[], previous: null as unknown, sshPort: 22, force: false }
await ensureDedicatedForward(client, input.name, '10.0.0.85', '10.10.0.2')
forwards.push({ listen_address: c, description: 'unrelated-owner', config: { target_address: 'fd99::1' }, ports: [] })
const absent = await reconcileDedicatedIpv6(client, input, deps)
assert.equal(absent.status, 'none')
assert.equal(guestAddresses.length, 0, 'an IPv4-only machine needs no IPv6 guest changes')
input.addresses = [a, b]
const initial = await reconcileDedicatedIpv6(client, input, deps)
assert.equal(initial.status, 'ready')
assert.deepEqual(customerIpv6View(initial)?.addresses, [a, b])
assert.equal(new Set(initial.mappings.map(mapping => mapping.privateIp)).size, 2, 'each public source has a separate internal address')
assert.equal(dedicatedIpv6Address(gateway, 22, a), initial.mappings[0]!.privateIp, 'mapping remains stable over restarts')
for (const address of [a, b]) {
  const forward = forwards.find(item => item.listen_address === address)
  assert.deepEqual(forward.ports.map((port: any) => [port.protocol, port.listen_port, port.snat]), [['tcp', '1-65535', true], ['udp', '1-65535', true]])
  const mapping = initial.mappings.find(mapping => mapping.publicIp === address)!
  assert.equal(forward.config.target_address, mapping.fallbackIp, 'non-port protocols still reach the same guest')
  assert.ok(forward.ports.every((port: any) => port.target_address === mapping.privateIp && port.target_address !== forward.config.target_address), 'Incus port and default targets must differ')
}
const before = writes
input.previous = initial; input.addresses.reverse()
const repeated = await reconcileDedicatedIpv6(client, input, deps)
assert.equal(writes, before, 'repeated reconciliation does not recreate or rewrite owned forwards')
assert.deepEqual(repeated.mappings, initial.mappings)
assert.equal(verified.length, 2, 'customer SSH changes do not invalidate unchanged, verified paths')
await removeObsoleteDedicatedForwards(client, input.name, '10.0.0.85', '10.10.0.2')
assert.equal(forwards.filter(item => item.listen_address === a || item.listen_address === b).length, 2, 'IPv4 reconciliation preserves IPv6 forwards')

input.addresses = [b, c]; failure = b; input.force = true
const conflicted = await reconcileDedicatedIpv6(client, input, deps)
assert.equal(conflicted.status, 'failed')
assert.deepEqual(customerIpv6View(conflicted)?.addresses, [], 'failed new paths are not advertised')
assert.equal(forwards.find(item => item.listen_address === c).description, 'unrelated-owner', 'a public address owned elsewhere is never stolen')
assert.ok(!forwards.some(item => item.listen_address === a), 'withdrawn address no longer forwards to this customer')
forwards = forwards.filter(item => item.listen_address !== c)
input.previous = conflicted; failure = null
const recovered = await reconcileDedicatedIpv6(client, input, deps)
assert.equal(recovered.status, 'ready', 'retry completes once the conflict and reachability failure are resolved')
assert.deepEqual(customerIpv6View(recovered)?.addresses, [b, c])
assert.deepEqual(customerIpv6View(recovered, { hostId: 9 })?.addresses, [], 'replacement cannot leak former-host addresses')
assert.deepEqual(customerIpv6View(recovered, { instanceName: 'u1-rebuilt' })?.addresses, [])
assert.deepEqual(customerIpv6View(recovered, { networkReady: false })?.addresses, [], 'in-progress replacement cannot advertise old working IPv6')

const response: Record<string, any> = { ipv6: 'fd42::1', dedicatedIpv6: recovered, nat_public_ip: '8.8.8.8' }
applyCustomerInstanceView(response, { dedicated_ipv4: true, dedicated_network_ready: true, dedicated_ipv6: recovered, host_id: 4, incus_id: input.name }, false)
assert.equal(response.ipv6, b)
assert.deepEqual(response.publicIpv6Addresses, [b, c])
assert.ok(!JSON.stringify(response).includes('privateIp') && !JSON.stringify(response).includes('fd42'), 'public responses never include internal mappings')

input.previous = recovered; input.addresses = []; guestFailure = true
const failedRemoval = await reconcileDedicatedIpv6(client, input, deps)
assert.equal(failedRemoval.status, 'failed')
assert.deepEqual(customerIpv6View(failedRemoval)?.addresses, [], 'removed addresses are hidden even if the guest cannot yet be cleaned')
input.previous = failedRemoval; guestFailure = false
const removed = await reconcileDedicatedIpv6(client, input, deps)
assert.equal(removed.status, 'none')
assert.deepEqual(guestAddresses.at(-1), [], 'removal retries clean persisted guest addresses too')
assert.deepEqual(forwards.map(item => item.listen_address), ['10.0.0.85'], 'removing all IPv6 preserves the IPv4 delivery')
await removeDedicatedForward(client, input.name)
assert.equal(forwards.length, 0)
assert.throws(() => dedicatedIpv6InstallScript('fd42::1; command', []), /IPV6_GUEST_CONFIG_INVALID/)
assert.throws(() => dedicatedIpv6InstallScript('fd42::1', ['fd42::2\ncommand']), /IPV6_GUEST_CONFIG_INVALID/)

// A missing host-side source mapping must not be advertised as working IPv6.
input.previous = null; input.addresses = [a]; input.force = false
const networkPending = await reconcileDedicatedIpv6(client, input, { ...deps,
  network: async () => { throw new PublicIpv6SyncError('IPV6_NETWORK_PENDING') }
})
assert.equal(networkPending.status, 'pending')
assert.deepEqual(customerIpv6View(networkPending)?.addresses, [])

const controllerNoRoute = await reconcileDedicatedIpv6(client, input, { ...deps,
  verify: async () => { throw new PublicIpSyncError('IPV6_CONTROLLER_NO_ROUTE') }
})
assert.equal(controllerNoRoute.status, 'ready', 'an IPv4-only controller verifies through authenticated Incus instead')
assert.equal(controllerNoRoute.error, null)
assert.equal(guestVerifications, 1)
assert.equal(controllerNoRoute.mappings[0].verification, 'guest-network')
assert.deepEqual(customerIpv6View(controllerNoRoute)?.addresses, [a])
const failedGuest = await reconcileDedicatedIpv6(client, input, { ...deps,
  verify: async () => { throw new PublicIpSyncError('IPV6_CONTROLLER_NO_ROUTE') },
  guestVerify: async () => { throw new PublicIpv6SyncError('IPV6_SOURCE_MISMATCH') }
})
assert.equal(failedGuest.status, 'failed')
assert.deepEqual(customerIpv6View(failedGuest)?.addresses, [], 'wrong guest egress source must never be advertised')
assert.equal(failedGuest.error, 'IPV6_SOURCE_MISMATCH')
const wrongIdentity = await reconcileDedicatedIpv6(client, input, { ...deps,
  verify: async () => { throw new PublicIpSyncError('IP_IDENTITY_MISMATCH') }
})
assert.equal(wrongIdentity.error, 'IPV6_IDENTITY_MISMATCH')
assert.equal(wrongIdentity.status, 'failed')
assert.equal(guestVerifications, 1, 'an actual public SSH identity mismatch must never fall back')
assert.equal((await reconcileDedicatedIpv6(client, { ...input, previous: failedGuest }, deps)).status, 'ready', 'automatic retry completes after guest connectivity recovers')
const output = `256 SHA256:fixture key\nSSH_KEY_EXCHANGE_OK\nIPV6_SOURCE:${a}\n`
validateDedicatedIpv6Probe(0, output, a, ['SHA256:fixture'])
for (const [code, value] of [[78, output], [0, output.replace(a, b)], [0, output.replace('fixture', 'changed')], [0, output.replace('SSH_KEY_EXCHANGE_OK', 'SSH_BANNER_ONLY')]] as const) {
  assert.throws(() => validateDedicatedIpv6Probe(code, value, a, ['SHA256:fixture']))
}
const probeScript = dedicatedIpv6ProbeScript({ publicIp: a, privateIp: 'fd42::2', ready: false }, 22)
assert.match(probeScript, /--interface "\$source_ip" --noproxy '\*' --proto '=https'/)
assert.match(probeScript, /StrictHostKeyChecking=yes/)
assert.match(probeScript, /PreferredAuthentications=none/)
assert.match(probeScript, /socket\.AF_INET6/)
assert.match(probeScript, /ssl\.create_default_context\(\)/)
assert.match(probeScript, /channel\.bind\(\(source, 0\)\)/)
assert.doesNotMatch(probeScript, /--insecure|curl.* -k|apt |apk |systemctl |reboot/)
assert.throws(() => dedicatedIpv6ProbeScript({ publicIp: a, privateIp: 'fd42::2;id', ready: false }, 22))

input.addresses = Array.from({ length: MAX_IPV6_VERIFICATIONS_PER_PASS + 2 }, (_, i) => `2603:c020:802a:cc00::${(i + 32).toString(16)}`)
verified.length = 0
const batched = await reconcileDedicatedIpv6(client, input, deps)
assert.equal(verified.length, MAX_IPV6_VERIFICATIONS_PER_PASS)
assert.equal(batched.status, 'pending')
input.previous = batched
assert.equal((await reconcileDedicatedIpv6(client, input, deps)).status, 'ready', 'later addresses are verified in the next bounded batch')

const controller = new AbortController()
let requestCount = 0
const scoped: any = ipv6BoundedClient({ request: async () => { requestCount++; return {} } } as any, controller.signal)
controller.abort()
assert.throws(() => scoped.request('PATCH', '/1.0/networks/incusbr0', {}), /abort/i)
assert.equal(requestCount, 0, 'expired network work cannot send another mutation')
await assert.rejects(waitForOperation(scoped, '/operation/test', 30000, controller.signal), /abort/i)
assert.equal(requestCount, 0, 'async operation polling honors cancellation too')

const script = readFileSync(new URL('../../scripts/configure-oci-node-network.sh', import.meta.url), 'utf8')
assert.ok(script.indexOf('for icmp_type in 135 136') < script.indexOf('ip6tables -w -A INCUDAL_OCI_IN -i "$bridge" -j REJECT'))
assert.ok(script.includes('--hl-eq 255') && script.includes('ip6tables -w -A INCUDAL_OCI_IN -p tcp --dport "$api_port" -j REJECT'))
assert.equal(dedicatedIpv6NetworkDigest([{ publicIp: a, privateIp: 'fd42::2', fallbackIp: 'fd42::3', ready: false }]),
  dedicatedIpv6NetworkDigest([{ publicIp: a, privateIp: 'fd42::3', fallbackIp: 'fd42::2', ready: true }]), 'Agent readiness digest ignores mapping order and readiness flags')
console.log('IPv6 inventory, multi-address delivery, replacement, retirement, retries and customer visibility passed')
