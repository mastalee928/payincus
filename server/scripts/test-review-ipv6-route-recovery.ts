import assert from 'node:assert/strict'
import type { IncusClient } from '../src/lib/incus/incus-client.js'
import { recoverIpv6RouteAndStart } from '../src/lib/incus/ipv6-route-recovery.js'

const original = { eth0: { type: 'nic', nictype: 'bridged', hwaddr: '00:16:3e:11:22:33' },
  eth1: { type: 'nic', nictype: 'routed', parent: 'ens3', 'ipv6.address': '2001:db8::123', hwaddr: '00:16:3e:44:55:66' },
  root: { type: 'disk', path: '/', pool: 'fixture' } }
let devices: Record<string, Record<string, unknown>>, calls: string[], failStart: boolean, failRestore: boolean
const client = { request: async (method: string, path: string, body?: any) => {
  calls.push(`${method} ${path}`)
  if (method === 'GET') return { name: 'fixture', type: 'container', devices: structuredClone(devices), config: { 'user.fixture': 'preserved' } }
  if (path.endsWith('/state')) {
    assert.equal(devices.eth1, undefined)
    if (failStart) throw new Error('fixture-start-retry-failed')
    return {}
  }
  if (body.devices.eth1 && failRestore) throw new Error('fixture-restore-failed')
  devices = structuredClone(body.devices)
  return {}
} } as unknown as IncusClient
function reset() { devices = structuredClone(original); calls = []; failStart = false; failRestore = false }
reset()
assert.equal(await recoverIpv6RouteAndStart(client, 'fixture', new Error('other failure')), false)
assert.equal(calls.length, 0)
devices.eth1.nictype = 'bridged'
assert.equal(await recoverIpv6RouteAndStart(client, 'fixture', new Error('file exists')), false, 'only routed IPv6 conflict can remove eth1')
assert.equal(calls.length, 1)
reset()
assert.equal(await recoverIpv6RouteAndStart(client, 'fixture', new Error('File exists')), true, 'successful fallback must not rethrow original failure')
assert.deepEqual(devices, original, 'container recovery restores exact network/disk identities')
assert.equal(calls.filter(c => c.endsWith('/state')).length, 1)
reset(); failStart = true
await assert.rejects(recoverIpv6RouteAndStart(client, 'fixture', new Error('file exists')), /fixture-start-retry-failed/)
assert.deepEqual(devices, original, 'retry failure still restores the original IPv6 device')
reset(); failStart = true; failRestore = true
await assert.rejects(recoverIpv6RouteAndStart(client, 'fixture', new Error('file exists')), (error: unknown) => {
  assert.ok(error instanceof AggregateError)
  assert.match(error.message, /fixture.*restore original IPv6 eth1/)
  assert.equal(error.errors.length, 2, 'both failures remain available for diagnosis')
  return true
})
console.log('PASS IPv6 route recovery: container success, exact identity restore, failed restart restore and explicit dual failure')
