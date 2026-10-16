import { isIP } from 'node:net'
import type { IncusClient } from './incus-client.js'

const bridge = 'incusbr0'
const endpoint = `/1.0/networks/${bridge}/forwards`
const owner = (name: string) => `payincus-dedicated:${name}`
type ForwardPort = { protocol: string; listen_port: string; target_address: string; target_port?: string; snat?: boolean }
type Forward = { listen_address: string; description: string; config: Record<string, string>; ports?: ForwardPort[] }

/** One persistent address forward, owned by the exact instance, never 65,535 proxy devices. */
export async function ensureDedicatedForward(client: Pick<IncusClient, 'request'>, name: string, listen: string, target: string): Promise<void> {
  if (isIP(listen) !== 4 || isIP(target) !== 4 || listen === target) throw new Error('Invalid dedicated IPv4 configuration')
  const forwards = await client.request<Forward[]>('GET', `${endpoint}?recursion=1`)
  const existing = forwards.find(item => item.listen_address === listen)
  if (existing && existing.description !== owner(name)) throw new Error('Dedicated public address is already assigned')
  const body = { description: owner(name), config: { target_address: target }, ports: [] }
  if (!existing) await client.request('POST', endpoint, { listen_address: listen, ...body })
  else if (existing.config.target_address !== target || existing.ports?.length) {
    await client.request('PUT', `${endpoint}/${encodeURIComponent(listen)}`, body)
  }
}

/** Remove only this instance's obsolete bindings after its new public path is verified. */
export async function removeObsoleteDedicatedForwards(client: Pick<IncusClient, 'request'>, name: string, listen: string, target: string): Promise<void> {
  const forwards = await client.request<Forward[]>('GET', `${endpoint}?recursion=1`)
  for (const item of forwards) {
    if (isIP(item.listen_address) === 4 && item.listen_address !== listen && item.description === owner(name) && item.config.target_address === target) {
      await client.request('DELETE', `${endpoint}/${encodeURIComponent(item.listen_address)}`)
    }
  }
}

/** Each public IPv6 has its own internal source, so outbound connections use that same address. */
export async function ensureDedicatedIpv6Forward(client: Pick<IncusClient, 'request'>, name: string, listen: string, target: string, fallback: string): Promise<void> {
  if (isIP(listen) !== 6 || isIP(target) !== 6 || isIP(fallback) !== 6 || listen === target || target === fallback || listen === fallback) throw new Error('Invalid dedicated IPv6 configuration')
  const forwards = await client.request<Forward[]>('GET', `${endpoint}?recursion=1`)
  const existing = forwards.find(item => item.listen_address === listen)
  if (existing && existing.description !== owner(name)) throw new Error('Dedicated public address is already assigned')
  // Incus requires port targets to differ from the default. Both internal addresses
  // belong to this guest: TCP/UDP use explicit SNAT; ICMP and other protocols use the default.
  const body = { description: owner(name), config: { target_address: fallback }, ports: ['tcp', 'udp'].map(protocol => ({
    protocol, listen_port: '1-65535', target_address: target, snat: true
  })) }
  if (!existing) await client.request('POST', endpoint, { listen_address: listen, ...body })
  else if (existing.config.target_address !== fallback || existing.ports?.length !== 2 || body.ports.some(port =>
    !existing.ports?.some(actual => actual.protocol === port.protocol && actual.listen_port === port.listen_port &&
      actual.target_address === target && !actual.target_port && actual.snat === true))) {
    await client.request('PUT', `${endpoint}/${encodeURIComponent(listen)}`, body)
  }
}

export async function removeObsoleteDedicatedIpv6Forwards(client: Pick<IncusClient, 'request'>, name: string, keep: string[]): Promise<void> {
  const forwards = await client.request<Forward[]>('GET', `${endpoint}?recursion=1`)
  for (const item of forwards) {
    if (isIP(item.listen_address) === 6 && item.description === owner(name) && !keep.includes(item.listen_address)) {
      await client.request('DELETE', `${endpoint}/${encodeURIComponent(item.listen_address)}`)
    }
  }
}

/** Called only after instance deletion. Failure must keep the database host occupied. */
export async function removeDedicatedForward(client: IncusClient, name: string): Promise<void> {
  let forwards: Forward[]
  try {
    forwards = await client.request<Forward[]>('GET', `${endpoint}?recursion=1`)
  } catch (error) {
    // Legacy hosts may use another bridge. Confirm absence over the API;
    // an unreachable server or a failed forward cleanup must still fail deletion.
    const networks = await client.request<string[]>('GET', '/1.0/networks')
    if (!networks.includes(`/1.0/networks/${bridge}`)) return
    throw error
  }
  for (const item of forwards) {
    if (item.description === owner(name)) {
      await client.request('DELETE', `${endpoint}/${encodeURIComponent(item.listen_address)}`)
    }
  }
}
