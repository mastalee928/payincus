import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isIP } from 'node:net'
import { ensure } from './platform-backup-core.js'

const exec = promisify(execFile)
const configPath = '/etc/wireguard/incudal-mgmt.conf'
export interface ArchivedGatewayNode {
  id:string; hostId:number|null; nodePublicKey:string|null; managementIp:string|null; deletedAt:Date|null
}
// An authenticated snapshot can include old reservations after host deletion.
// Keep those reservations as tombstones, but do not reactivate their tunnels on B.
// This prepares a local file only; it never edits an existing external gateway.
export function reconcileArchivedGatewayPeers(config:string, reservations:Map<string,unknown>, nodes:ArchivedGatewayNode[]) {
  const known=new Map(nodes.map(node=>[node.id,node])),keys=new Map<string,{node:ArchivedGatewayNode;address:string}>(),addresses=new Set<string>()
  ensure(known.size===nodes.length,'OSS_RECOVERY_GATEWAY_IDENTITY_CHANGED',409)
  for(const [id,value] of reservations){
    const saved=value as {nodePublicKey:string;managementIp:string},node=known.get(id)
    ensure(saved && Object.keys(saved).sort().join(',')==='managementIp,nodePublicKey' &&
      typeof saved.nodePublicKey==='string' && /^[A-Za-z0-9+/]{43}=$/.test(saved.nodePublicKey) &&
      Buffer.from(saved.nodePublicKey,'base64').toString('base64')===saved.nodePublicKey && isIP(saved.managementIp)===4 &&
      node && node.nodePublicKey===saved.nodePublicKey && node.managementIp===saved.managementIp &&
      !keys.has(saved.nodePublicKey) && !addresses.has(saved.managementIp),'OSS_RECOVERY_GATEWAY_IDENTITY_CHANGED',409)
    keys.set(saved.nodePublicKey,{node,address:saved.managementIp});addresses.add(saved.managementIp)
  }
  const seen=new Set<string>(),removed:string[]=[]
  const starts=[...config.matchAll(/^(?:[ \t]*# incudal-onboarding [^\r\n]+\r?\n)?[ \t]*\[Peer\][ \t]*\r?$/gm)].map(match=>match.index!)
  const sections=[config.slice(0,starts[0]??config.length),...starts.map((start,index)=>config.slice(start,starts[index+1]))]
  const next=sections.map((section,index)=>{
    if(index===0)return section
    const fields=new Map<string,string>()
    for(const raw of section.split(/\r?\n/)){
      const line=raw.trim();if(!line || line.startsWith('#') || line==='[Peer]')continue
      const pair=/^([A-Za-z]+)\s*=\s*(.+)$/.exec(line)
      ensure(pair && !fields.has(pair[1]),'OSS_GATEWAY_CONFIG_UNSUPPORTED',409)
      fields.set(pair[1],pair[2].trim())
    }
    const key=fields.get('PublicKey')||'',saved=keys.get(key)
    ensure(saved && !seen.has(key) && fields.get('AllowedIPs')===`${saved.address}/32`,'OSS_RECOVERY_GATEWAY_IDENTITY_CHANGED',409)
    seen.add(key)
    if(saved.node.deletedAt){removed.push(saved.node.id);return ''}
    ensure(saved.node.hostId!==null,'OSS_RECOVERY_GATEWAY_IDENTITY_CHANGED',409)
    return section
  }).join('')
  for(const node of nodes.filter(node=>node.hostId!==null && !node.deletedAt))ensure(
    node.nodePublicKey && seen.has(node.nodePublicKey),'OSS_RECOVERY_GATEWAY_MISSING_ROUTES',409)
  return {config:next,removedNodeIds:removed}
}
function setting(config: string, name: string) {
  return new RegExp(`^\\s*${name}\\s*=\\s*([^\\r\\n]+)`, 'm').exec(config)?.[1].trim()
}
function ipv4Range(value: string): [number, number] {
  const [address, bits = '32'] = value.split('/')
  ensure(isIP(address) === 4 && /^\d{1,2}$/.test(bits) && +bits <= 32, 'OSS_GATEWAY_NETWORK_INVALID')
  const integer = address.split('.').reduce((sum, part) => sum * 256 + Number(part), 0)
  const size = 2 ** (32 - Number(bits)), start = Math.floor(integer / size) * size
  return [start, start + size - 1]
}
export function assertGatewayNetworkAvailable(config: string, routes: unknown, addresses: unknown) {
  const address = setting(config.split(/(?=^\s*\[Peer\])/m)[0], 'Address')
  ensure(address && Array.isArray(routes) && Array.isArray(addresses), 'OSS_GATEWAY_NETWORK_INVALID')
  const wanted = ipv4Range(address)
  const overlaps = (cidr: string) => { const actual = ipv4Range(cidr); return wanted[0] <= actual[1] && actual[0] <= wanted[1] }
  for (const route of routes) {
    ensure(route && typeof route === 'object', 'OSS_GATEWAY_NETWORK_INVALID')
    const row = route as { dev?: string; dst?: string; nexthops?: Array<{ dev?: string }> }
    if (row.dst === 'default' || row.dst === undefined) continue
    if (row.dev === 'incudal-mgmt' && !row.nexthops?.some(hop => hop.dev !== 'incudal-mgmt')) continue
    ensure(!overlaps(row.dst), 'OSS_GATEWAY_NETWORK_CONFLICT', 409)
  }
  for (const value of addresses) {
    const row = value as { ifname?: string; addr_info?: Array<{ family: string; local: string; prefixlen: number }> }
    ensure(row && Array.isArray(row.addr_info), 'OSS_GATEWAY_NETWORK_INVALID')
    if (row.ifname === 'incudal-mgmt') continue
    for (const entry of row.addr_info) if (entry.family === 'inet') ensure(!overlaps(`${entry.local}/${entry.prefixlen}`), 'OSS_GATEWAY_NETWORK_CONFLICT', 409)
  }
}
export async function checkRestoredGatewayNetwork(config: string) {
  const [routes, addresses] = await Promise.all([
    exec('/usr/sbin/ip', ['-j', '-4', 'route', 'show', 'table', 'all'], { timeout: 10000 }),
    exec('/usr/sbin/ip', ['-j', '-4', 'address', 'show'], { timeout: 10000 })
  ])
  assertGatewayNetworkAvailable(config, JSON.parse(routes.stdout), JSON.parse(addresses.stdout))
}
// Preserve learned endpoints only for peers belonging to the same controller identity.
export function retainGatewayEndpoints(previous: string, next: string, endpoints: string): string {
  const identity = setting(previous, 'PrivateKey')
  if (!identity || identity !== setting(next, 'PrivateKey')) return next
  const oldPeers = new Set([...previous.matchAll(/^\s*PublicKey\s*=\s*([A-Za-z0-9+/]{43}=)\s*$/gm)].map(match => match[1]))
  const known = new Map<string, string>()
  for (const line of endpoints.trim().split('\n')) {
    const [key, endpoint] = line.trim().split(/\s+/)
    const match = /^(?:([0-9.]+)|\[([0-9a-f:]+)\]):(\d{1,5})$/i.exec(endpoint || '')
    if (oldPeers.has(key) && match && isIP(match[1] || match[2]) && Number(match[3]) > 0 && Number(match[3]) <= 65535) known.set(key, endpoint)
  }
  return next.split(/(?=^\s*\[Peer\]\s*$)/m).map(section => {
    if (!/^\s*\[Peer\]/.test(section) || setting(section, 'Endpoint')) return section
    const endpoint = known.get(setting(section, 'PublicKey') || '')
    return endpoint ? section.trimEnd() + `\nEndpoint = ${endpoint}\n` : section
  }).join('')
}
export async function refreshRestoredGateway(previous: string, reconcileNetwork = false) {
  const next = await readFile(configPath, 'utf8')
  await checkRestoredGatewayNetwork(next)
  const active = await exec('/usr/bin/systemctl', ['is-active', 'wg-quick@incudal-mgmt'], { timeout: 10000 }).then(result => result.stdout.trim() === 'active').catch(() => false)
  // An unchanged file does not require restarting the live tunnel or discarding handshakes.
  if (!reconcileNetwork && active && previous === next) return
  const endpoints = active ? await exec('/usr/bin/wg', ['show', 'incudal-mgmt', 'endpoints'], { timeout: 10000 }).then(result => result.stdout) : ''
  // Distribution confinement permits wg/wg-quick to read identity material
  // under /etc/wireguard, not a generic temporary directory. mkdtemp is 0700.
  const directory = await mkdtemp('/etc/wireguard/.incudal-restore-')
  try {
    const temporary = join(directory, 'incudal-mgmt.conf')
    // Interrupted rollback can leave file and live identities different. Do
    // not carry learned endpoints across an identity we cannot establish.
    await writeFile(temporary, retainGatewayEndpoints(reconcileNetwork ? '' : previous, next, endpoints), { mode: 0o600 })
    const sameNetwork = ['Address', 'ListenPort', 'MTU'].every(name => setting(previous, name) === setting(next, name))
    const stripped = await exec('/usr/bin/wg-quick', ['strip', temporary], { timeout: 10000 })
    const input = join(directory, 'sync.conf'); await writeFile(input, stripped.stdout, { mode: 0o600 })
    // Reject unreadable/invalid input before disrupting the current interface.
    if (reconcileNetwork || !active || !sameNetwork) await exec('/usr/bin/systemctl', ['restart', 'wg-quick@incudal-mgmt'], { timeout: 30000 })
    await exec('/usr/bin/wg', ['syncconf', 'incudal-mgmt', input], { timeout: 10000 })
    const result = await exec('/usr/bin/systemctl', ['is-active', 'wg-quick@incudal-mgmt'], { timeout: 10000 })
    ensure(result.stdout.trim() === 'active', 'OSS_GATEWAY_RESTORE_FAILED', 503)
  } finally { await rm(directory, { recursive: true, force: true }) }
}
