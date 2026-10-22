import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readDiscoveryPrivateFile } from './controller-discovery.js'
import { verifyGatewayTransport } from '../lib/gateway-transport.js'
import type { GatewayConsoleStatus } from './gateway-console.js'

const exec = promisify(execFile)
// Only fixed, public WireGuard inspection commands. Never dump/showconf,
// command interpolation, private keys, customer configuration or a remote URL.
export function createGatewayStatusReader(config: {
  platformId: string; gatewayId: string; statePath: string; trustedKeys: Readonly<Record<string, string>>; componentVersion: string
}): () => Promise<GatewayConsoleStatus> {
  const identity = { ...config, trustedKeys: Object.freeze({ ...config.trustedKeys }) }
  return async () => {
    const encoded = await readDiscoveryPrivateFile(identity.statePath, 65536)
    const issuedAt = JSON.parse(Buffer.from(JSON.parse(encoded).payload, 'base64').toString()).issuedAt as number
    const { config: transport } = verifyGatewayTransport(encoded, { platformId: identity.platformId, gatewayId: identity.gatewayId,
      now: issuedAt, trustedKeys: identity.trustedKeys })
    const name = 'incudal-gw-' + transport.slot
    const run = async (tool: string, args: string[]) => {
      const { stdout } = await exec(tool, args, { timeout: 3000, maxBuffer: 65536, env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C' } })
      return stdout.trim()
    }
    const [peers, allowed, handshakes, links, port, routeText, addressText] = await Promise.all([
      run('/usr/bin/wg', ['show', name, 'peers']), run('/usr/bin/wg', ['show', name, 'allowed-ips']),
      run('/usr/bin/wg', ['show', name, 'latest-handshakes']), run('/usr/sbin/ip', ['-j', 'link', 'show', 'dev', name]),
      run('/usr/bin/wg', ['show', name, 'listen-port']),
      run('/usr/sbin/ip', ['-j', '-4', 'route', 'show']),
      run('/usr/sbin/ip', ['-j', '-4', 'address', 'show', 'dev', name])
    ])
    const live = new Set(peers.split(/\s+/).filter(Boolean)), addresses = new Map<string, string>(), times = new Map<string, number>()
    for (const line of allowed.split('\n').filter(Boolean)) { const [key, value] = line.split(/\s+/); addresses.set(key, value) }
    for (const line of handshakes.split('\n').filter(Boolean)) { const [key, value] = line.split(/\s+/); times.set(key, Number(value)) }
    const interfaces = JSON.parse(links) as Array<{ ifname: string; ifalias: string; flags: string[]; mtu: number }>
    const enabled = transport.peers.filter(peer => peer.enabled)
    const routes = JSON.parse(routeText) as Array<{ dst: string; gateway?: string; dev: string }>
    const configuredAddresses = JSON.parse(addressText) as Array<{ addr_info: Array<{ local: string; prefixlen: number }> }>
    const transportReady = live.size === enabled.length && enabled.every(peer => live.has(peer.publicKey) && addresses.get(peer.publicKey) === peer.address + '/32') &&
      port === String(transport.listenPort) && interfaces.length === 1 && interfaces[0].ifname === name && interfaces[0].flags.includes('UP') &&
      interfaces[0].mtu === transport.mtu && interfaces[0].ifalias === `payincus-gateway/v1/${transport.platformId}/${transport.gatewayId}` &&
      configuredAddresses.length === 1 && configuredAddresses[0].addr_info.some(value => value.local === transport.address && value.prefixlen === 32) &&
      enabled.every(peer => routes.some(route => (route.dst === peer.address || route.dst === peer.address + '/32') && route.dev === name && !route.gateway))
    const now = Date.now() / 1000
    return { gatewayId: transport.gatewayId, slot: transport.slot, address: transport.address, componentVersion: identity.componentVersion,
      configurationEpoch: transport.epoch, configurationSequence: transport.sequence, transportReady, canWrite: false,
      blockers: ['host-write-service-not-ready', 'backup-not-configured'], peers: transport.peers.map(peer => {
        const value = times.get(peer.publicKey) || 0
        return { nodeId: peer.nodeId, address: peer.address, enabled: peer.enabled,
          lastHandshakeAt: Number.isSafeInteger(value) && value > 0 && value <= now ? value : 0 }
      }), backup: { ready: false, lastCompletedAt: null } }
  }
}
