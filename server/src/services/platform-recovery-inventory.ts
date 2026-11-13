import { ensure } from './platform-backup-core.js'
import { ProxyStrategyFactory } from '../lib/proxy/index.js'
import { allowanceToCores } from '../lib/cpu-allowance.js'

export interface RecoveryGuestIdentity {
  name: string; uuid?: string; createdAt?: string; project?: string; ownerId: number
  status: string; storagePoolName: string | null
}
export interface LiveRecoveryGuest {
  name: string; project?: string; created_at?: string; status: string; type?: string
  config?: Record<string, string>; expanded_config?: Record<string, string>; expanded_devices?: Record<string, Record<string, string>>; devices?: Record<string, Record<string, string>>
}
export function assertRecoveryGuestResources(expected:{cpu:number;memory:number;disk:number;instanceType?:string},live:LiveRecoveryGuest) {
  const config=live.expanded_config || live.config || {}
  const roots=Object.values(live.expanded_devices || live.devices || {}).filter(device=>device.type==='disk' && device.path==='/')
  // Current resource units are MiB; keep exact legacy decimal-MB pairs valid
  // for existing backups, without accepting mixed, missing or unlimited limits.
  const bytes=(value:string|undefined) => {
    const match=/^(\d+)(B|kB|MB|GB|TB|KiB|MiB|GiB|TiB)?$/.exec(value || '')
    if(!match)return -1n
    const units:Record<string,bigint>={B:1n,kB:1000n,MB:1000000n,GB:1000000000n,TB:1000000000000n,
      KiB:1024n,MiB:1048576n,GiB:1073741824n,TiB:1099511627776n}
    return BigInt(match[1])*units[match[2] || 'B']
  }
  ensure([expected.cpu,expected.memory,expected.disk].every(value=>Number.isSafeInteger(value)&&value>0) &&
    ['container','virtual-machine'].includes(live.type || '') &&
    (!expected.instanceType || live.type===(expected.instanceType==='vm'?'virtual-machine':expected.instanceType)) &&
    config['limits.cpu']===String(allowanceToCores(expected.cpu)) && config['limits.cpu.allowance']===`${expected.cpu}%` &&
    roots.length===1 && [1000000n,1048576n].some(unit => bytes(config['limits.memory'])===BigInt(expected.memory)*unit && bytes(roots[0].size)===BigInt(expected.disk)*unit),'OSS_REVIEW_RESOURCE_MISMATCH',409)
}
export function recoveryGuestStateMatches(saved: string, current: string, snapshotRestore = false) {
  if(snapshotRestore && ['running','stopped'].includes(saved))return ['Running','Stopped'].includes(current)
  return ['running','stopped','suspended'].includes(saved) && current===(saved==='running'?'Running':'Stopped')
}
export function compareRecoveryIdentities(expected: RecoveryGuestIdentity[], actual: LiveRecoveryGuest[], snapshotRestore = false) {
  ensure(actual.length <= 10000 && new Set(actual.map(row => `${row.project || 'default'}/${row.name}`)).size === actual.length, 'OSS_REVIEW_INVENTORY_INVALID')
  const missing: string[] = [], unexpected: string[] = [], conflicts: Array<{ name: string; reason: string }> = []
  for (const saved of expected) {
    const live = actual.find(row => row.name === saved.name && (row.project || 'default') === (saved.project || 'default'))
    if (!live) { missing.push(saved.name); continue }
    if (!saved.uuid || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(saved.uuid)) conflicts.push({ name: saved.name, reason: 'original-identity-missing' })
    else if (live.config?.['volatile.uuid'] !== saved.uuid) conflicts.push({ name: saved.name, reason: 'uuid-changed' })
    // Older deliveries persisted the remote UUID but not created_at. The same
    // UUID still pins the original guest; never substitute a name for that pin.
    if (saved.createdAt && (!live.created_at || !Number.isFinite(Date.parse(saved.createdAt)) || Date.parse(live.created_at) !== Date.parse(saved.createdAt))) conflicts.push({ name: saved.name, reason: 'creation-time-changed' })
    const owner = live.config?.['user.payincus.user-id']
    if (owner !== undefined && owner !== String(saved.ownerId)) conflicts.push({ name: saved.name, reason: 'owner-changed' })
    if (!recoveryGuestStateMatches(saved.status,live.status,snapshotRestore)) conflicts.push({ name: saved.name, reason: 'state-changed' })
    const roots = Object.values(live.expanded_devices || live.devices || {}).filter(device => device.type === 'disk' && device.path === '/')
    if (!saved.storagePoolName || roots.length !== 1 || roots[0].pool !== saved.storagePoolName) conflicts.push({ name: saved.name, reason: 'system-volume-changed' })
  }
  for (const live of actual) if (!expected.some(saved => live.name === saved.name && (live.project || 'default') === (saved.project || 'default'))) unexpected.push(`${live.project || 'default'}/${live.name}`)
  return { expectedCount: expected.length, actualCount: actual.length, missing, unexpected, conflicts,
    inventoryMatched: !missing.length && !unexpected.length && !conflicts.length }
}

export function assertRecoveryProxyDevices(live:LiveRecoveryGuest, networkMode:string, mappings:Array<{protocol:string;publicPort:number;privatePort:number}>,
  host:{natBindIp:string|null;natPublicIp:string|null;natBindIpv6:string|null;natPublicIpv6:string|null}) {
  const devices=live.expanded_devices || live.devices || {}, wanted=new Set<string>()
  for(const mapping of mappings) {
    const result=ProxyStrategyFactory.getStrategy(live.type==='virtual-machine'?'virtual-machine':'container')
      .createProxyDevice(host.natBindIp || host.natPublicIp,host.natBindIpv6 || host.natPublicIpv6,networkMode,mapping.protocol,mapping.publicPort,mapping.privatePort)
    ensure(result.success,'OSS_REVIEW_FORWARD_MISMATCH',409)
    for(const entry of result.deviceConfigs || (result.deviceConfig?[{deviceConfig:result.deviceConfig}]:[])) {
      const name=`proxy-${mapping.protocol}-${mapping.publicPort}${entry.nameSuffix || ''}`
      wanted.add(name)
      ensure(devices[name] && Object.entries(entry.deviceConfig).every(([key,value])=>devices[name][key]===value),'OSS_REVIEW_FORWARD_MISMATCH',409)
    }
  }
  ensure(Object.entries(devices).every(([name,device])=>device.type!=='proxy' || wanted.has(name)),'OSS_REVIEW_FORWARD_MISMATCH',409)
}

export async function verifyRecoveryResources(client: { request<T>(method: string, path: string): Promise<T> }, expected: Array<{
  incusId: string; storagePoolName: string | null; ipv4: string | null; networkMode: string; portMappings: Array<{ protocol: string; publicPort: number; privatePort: number }>
}>, live: LiveRecoveryGuest[], host: { natBindIp: string | null; natPublicIp: string | null; natBindIpv6: string | null; natPublicIpv6: string | null }) {
  const [projects, operations, pools, networks] = await Promise.all([
    client.request<Array<{ name: string }>>('GET','/1.0/projects?recursion=1'),
    client.request<Record<string, unknown[]>>('GET','/1.0/operations?recursion=1'),
    client.request<Array<{ name: string }>>('GET','/1.0/storage-pools?recursion=1'),
    client.request<Array<{ name: string; managed: boolean; type: string }>>('GET','/1.0/networks?recursion=1')
  ])
  ensure(projects.every(project => project.name === 'default') && !['running','pending','cancelling'].some(key => operations[key]?.length), 'OSS_REVIEW_RESOURCE_BUSY', 409)
  for (const pool of pools) {
    const volumes = await client.request<Array<{ name: string; type: string; project?: string }>>('GET',`/1.0/storage-pools/${encodeURIComponent(pool.name)}/volumes?recursion=1&all-projects=true`)
    ensure(volumes.every(volume => (volume.project || 'default') === 'default' && (volume.type === 'image' ||
      ['container','virtual-machine'].includes(volume.type) && expected.some(row => row.storagePoolName === pool.name &&
        (volume.name === row.incusId || volume.name.startsWith(row.incusId+'/'))))), 'OSS_REVIEW_VOLUME_MISMATCH', 409)
    for (const row of expected.filter(row => row.storagePoolName === pool.name)) ensure(volumes.some(volume => volume.name === row.incusId && ['container','virtual-machine'].includes(volume.type)), 'OSS_REVIEW_VOLUME_MISSING', 409)
  }
  for (const row of expected) ensure(pools.some(pool => pool.name === row.storagePoolName), 'OSS_REVIEW_VOLUME_MISSING', 409)
  // Shared NAT instances use proxy devices, not dedicated address forwards.
  // Reuse the delivery strategy to compare exactly the devices we created.
  for (const row of expected) {
    const guest = live.find(item => item.name === row.incusId && (!item.project || item.project === 'default'))
    ensure(guest, 'OSS_REVIEW_VOLUME_MISSING', 409)
    assertRecoveryProxyDevices(guest,row.networkMode,row.portMappings,host)

  }
  for (const network of networks.filter(row => row.managed && row.type === 'bridge')) {
    const forwards = await client.request<Array<{ listen_address: string; config?: Record<string,string>; ports?: Array<{ protocol: string; listen_port: string; target_port: string; target_address: string }> }>>('GET',`/1.0/networks/${encodeURIComponent(network.name)}/forwards?recursion=1`)
    ensure(!forwards.length, 'OSS_REVIEW_FORWARD_MISMATCH', 409)
  }
}
