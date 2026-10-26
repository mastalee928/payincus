import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import type { IncusClient } from './incus/incus-client.js'

export class PublicIpv6SyncError extends Error {
  constructor(public code: string) { super(code) }
}
export const MAX_PUBLIC_IPV6_ADDRESSES = 256

export type PublicIpv6State = {
  version: 1
  addresses: string[]
  primary: string | null
  status: 'idle' | 'synced' | 'pending' | 'failed'
  checkedAt: string | null
  changedAt: string | null
  error: string | null
}
export type DedicatedIpv6Mapping = { publicIp: string; privateIp: string; fallbackIp?: string; ready: boolean; checkedAt?: string | null; verification?: 'public-ssh' | 'guest-network' }
export type DedicatedIpv6State = {
  version: 1
  hostId: number
  instanceName: string
  mappings: DedicatedIpv6Mapping[]
  configured?: boolean
  primary: string | null
  status: 'none' | 'ready' | 'pending' | 'failed'
  checkedAt: string | null
  error: string | null
}

export function normalizeIpv6(value: unknown): string | null {
  if (typeof value !== 'string' || isIP(value) !== 6 || value.includes('%')) return null
  return new URL(`http://[${value}]/`).hostname.slice(1, -1)
}

export function privateIpv6(value: unknown): string | null {
  const address = normalizeIpv6(value)
  const first = address ? parseInt(address.split(':')[0]!, 16) : 0
  return first >= 0xfd00 && first <= 0xfdff ? address : null
}

/** Only assigned global unicast addresses; never infer an allocation from a route/prefix. */
export function publicIpv6(value: unknown): string | null {
  const address = normalizeIpv6(value)
  if (!address) return null
  const first = parseInt(address.split(':')[0]!, 16)
  if (!Number.isFinite(first) || first < 0x2000 || first > 0x3fff || address.startsWith('2001:db8:') ||
      address.startsWith('2001:2:') || /^3fff:[0-9a-f]{0,3}:/.test(address)) return null
  return address
}

export function orderedPublicIpv6(values: unknown[], previousPrimary?: string | null): string[] {
  const addresses = [...new Set(values.map(publicIpv6).filter((v): v is string => v !== null))].sort()
  const primary = publicIpv6(previousPrimary)
  return primary && addresses.includes(primary) ? [primary, ...addresses.filter(ip => ip !== primary)] : addresses
}

export function publicIpv6State(value: unknown): PublicIpv6State {
  const input = (value && typeof value === 'object' ? value : {}) as Partial<PublicIpv6State>
  const addresses = orderedPublicIpv6(Array.isArray(input.addresses) ? input.addresses : [], input.primary)
  return { version: 1, addresses, primary: addresses[0] ?? null,
    status: ['idle', 'synced', 'pending', 'failed'].includes(input.status!) ? input.status! : 'idle',
    checkedAt: input.checkedAt ?? null, changedAt: input.changedAt ?? null, error: input.error ?? null }
}

export function dedicatedIpv6State(value: unknown): DedicatedIpv6State | null {
  const input = value as Partial<DedicatedIpv6State> | null
  if (!input || input.version !== 1 || !Number.isInteger(input.hostId) || typeof input.instanceName !== 'string') return null
  const mappings = (Array.isArray(input.mappings) ? input.mappings : []).filter(mapping =>
    publicIpv6(mapping?.publicIp) && privateIpv6(mapping?.privateIp) && (!mapping.fallbackIp || privateIpv6(mapping.fallbackIp)))
    .map(mapping => ({ publicIp: publicIpv6(mapping.publicIp)!, privateIp: privateIpv6(mapping.privateIp)!,
      ...(mapping.fallbackIp ? { fallbackIp: privateIpv6(mapping.fallbackIp)! } : {}), ready: mapping.ready === true,
      ...(['public-ssh', 'guest-network'].includes(mapping.verification || '') ? { verification: mapping.verification } : {}),
      checkedAt: typeof mapping.checkedAt === 'string' && Number.isFinite(Date.parse(mapping.checkedAt)) ? mapping.checkedAt : null }))
  return { version: 1, hostId: input.hostId!, instanceName: input.instanceName, mappings, configured: input.configured === true || mappings.length > 0,
    primary: publicIpv6(input.primary), status: input.status ?? 'pending', checkedAt: input.checkedAt ?? null, error: input.error ?? null }
}

export function customerIpv6View(value: unknown, identity?: { hostId?: number; instanceName?: string; networkReady?: boolean }) {
  const state = dedicatedIpv6State(value)
  if (!state) return null
  // A restored/replaced instance must never advertise its former host's addresses.
  if ((identity?.networkReady === false && state.status !== 'none') ||
      (identity?.hostId !== undefined && identity.hostId !== state.hostId) ||
      (identity?.instanceName !== undefined && identity.instanceName !== state.instanceName)) {
    return { addresses: [] as string[], primary: null, status: 'pending' as const }
  }
  const addresses = orderedPublicIpv6(state.mappings.filter(mapping => mapping.ready).map(mapping => mapping.publicIp), state.primary)
  return { addresses, primary: addresses[0] ?? null, status: state.status }
}

export async function discoverHostPublicIpv6(client: Pick<IncusClient, 'request'>, previousPrimary?: string | null): Promise<string[]> {
  const networks = await client.request<Array<{ name: string; type: string; managed: boolean }>>('GET', '/1.0/networks?recursion=1')
  const physical = networks.filter(network => !network.managed && network.type === 'physical')
  if (!physical.length || physical.length > 32) throw new PublicIpv6SyncError('IPV6_INTERFACES_UNAVAILABLE')
  // A failed interface read is NOT an empty inventory: retain the last good state and retry.
  const states = await Promise.all(physical.map(network => client.request<{
    state: string; addresses?: Array<{ address: string; family: string; scope: string }>
  }>('GET', `/1.0/networks/${encodeURIComponent(network.name)}/state`)))
  const addresses = orderedPublicIpv6(states.filter(state => state.state === 'up').flatMap(state =>
    (state.addresses ?? []).filter(address => address.family === 'inet6' && address.scope === 'global').map(address => address.address)), previousPrimary)
  if (addresses.length > MAX_PUBLIC_IPV6_ADDRESSES) throw new PublicIpv6SyncError('IPV6_TOO_MANY_ADDRESSES')
  return addresses
}

export function dedicatedIpv6Gateway(hostId: number): string {
  const hash = createHash('sha256').update(`payincus-ipv6:${hostId}`).digest('hex')
  return `fd${hash.slice(0, 2)}:${hash.slice(2, 6)}:${hash.slice(6, 10)}:${hash.slice(10, 14)}::1`
}

export function dedicatedIpv6Address(gateway: string, instanceId: number, publicAddress: string): string {
  const normalized = normalizeIpv6(gateway)
  if (!normalized || !privateIpv6(normalized)) throw new PublicIpv6SyncError('IPV6_BRIDGE_CONFLICT')
  const parts = normalized.split('::')
  const left = parts[0]!.split(':').filter(Boolean)
  const right = (parts[1] ?? '').split(':').filter(Boolean)
  const words = parts.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left
  const hash = createHash('sha256').update(`${instanceId}:${publicAddress}`).digest('hex')
  return normalizeIpv6(`${words.slice(0, 4).join(':')}:${hash.slice(0, 4)}:${hash.slice(4, 8)}:${hash.slice(8, 12)}:${hash.slice(12, 16)}`)!
}
