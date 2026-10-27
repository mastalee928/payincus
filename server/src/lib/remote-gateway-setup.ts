import { createHash } from 'node:crypto'
import { isIPv4 } from 'node:net'
import { GatewayTaskError } from './gateway-task-plan.js'
import { normalizeOnboardingAddress } from './host-onboarding.js'
import type { GatewayInstallationDesired } from './gateway-installation.js'

export interface RemoteGatewaySetupInput {
  requestId: string; gatewayId: string; name: string; purpose: 'independent' | 'backup'
  address: string; hostname: string; credentials: { password: string }
}
export interface RemoteGatewayPreparation {
  requestId: string; gatewayId: string; actorId: number; name: string; purpose: 'independent' | 'backup'
  address: string; hostname: string; state: 'running' | 'failed' | 'succeeded'
  step: 'validate-domain' | 'inspect-environment' | 'prepare-installation'; code: string | null; updatedAt: string
}
// Config rows may come from older backups. Never serialize arbitrary stored
// JSON into an administrator response, even if it has a recognized state.
export function parseRemoteGatewayPreparation(raw: string): RemoteGatewayPreparation | null {
  try {
    if (Buffer.byteLength(raw) > 4096) return null
    const row = JSON.parse(raw) as Record<string, unknown>
    if (!row || typeof row !== 'object' || Array.isArray(row) ||
      ![row.requestId, row.gatewayId].every(value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value)) ||
      !Number.isSafeInteger(row.actorId) || Number(row.actorId) < 1 ||
      typeof row.name !== 'string' || !row.name.trim() || row.name.length > 80 || /[\u0000-\u001f\u007f]/.test(row.name) ||
      !['independent', 'backup'].includes(String(row.purpose)) || !['running', 'failed', 'succeeded'].includes(String(row.state)) ||
      !['validate-domain', 'inspect-environment', 'prepare-installation'].includes(String(row.step)) ||
      !(row.code === null || typeof row.code === 'string' && /^(?:GATEWAY|SSH|HOST|PUBLIC)_[A-Z0-9_]{1,80}$/.test(row.code)) ||
      typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt)) || new Date(row.updatedAt).toISOString() !== row.updatedAt) return null
    for (const key of ['address', 'hostname']) {
      if (typeof row[key] !== 'string' || row[key] !== '' && normalizeOnboardingAddress(row[key]) !== row[key]) return null
    }
    if (row.hostname && isIPv4(String(row.hostname))) return null
    // Explicit projection excludes passwords, keys and unrecognized metadata.
    return { requestId: row.requestId as string, gatewayId: row.gatewayId as string, actorId: Number(row.actorId), name: row.name,
      purpose: row.purpose as RemoteGatewayPreparation['purpose'], address: row.address as string, hostname: row.hostname as string,
      state: row.state as RemoteGatewayPreparation['state'], step: row.step as RemoteGatewayPreparation['step'], code: row.code as string | null, updatedAt: row.updatedAt }
  } catch { return null }
}
export function remoteGatewayInspectionId(requestId: string, attempt = 0) {
  if (!Number.isSafeInteger(attempt) || attempt < 0 || attempt > 16) throw new GatewayTaskError('GATEWAY_REMOTE_SETUP_INVALID')
  const hash = createHash('sha256').update('payincus/remote-gateway-inspection/v1\n' + requestId + (attempt ? `\n${attempt}` : '')).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
function networkRange(value: string): [number, number] {
  const [ip, bits] = value.split('/'), prefix = Number(bits)
  if (!isIPv4(ip) || !/^(?:[0-9]|[12][0-9]|3[0-2])$/.test(bits)) throw new GatewayTaskError('GATEWAY_REMOTE_NETWORK_INVALID')
  const number = ip.split('.').reduce((result, byte) => result * 256 + Number(byte), 0), width = 2 ** (32 - prefix)
  return [Math.floor(number / width) * width, Math.floor(number / width) * width + width - 1]
}
export function remoteGatewayNetworksOverlap(left: string, right: string): boolean {
  const a = networkRange(left), b = networkRange(right)
  return a[0] <= b[1] && b[0] <= a[1]
}
export function planRemoteGatewayConfiguration(purpose: RemoteGatewaySetupInput['purpose'], address: string,
  occupiedNetworks: string[], occupiedPorts: Array<{ protocol: 'tcp' | 'udp'; port: number }> = []): GatewayInstallationDesired {
  if (purpose !== 'independent' && purpose !== 'backup') throw new GatewayTaskError('GATEWAY_REMOTE_SETUP_INVALID')
  const slot = purpose === 'backup' ? 'b' : 'a', ranges = occupiedNetworks.map(networkRange)
  const availablePort = (protocol: 'tcp' | 'udp', first: number) => {
    for (let port = first; port <= first + 64; port++) {
      if (!occupiedPorts.some(value => value.protocol === protocol && value.port === port)) return port
    }
    throw new GatewayTaskError('GATEWAY_REMOTE_PORT_EXHAUSTED')
  }
  const listenPort = availablePort('udp', 51820), consolePort = availablePort('tcp', 18443)
  // Separate /20 pools for A and B, including the controller and future hosts.
  // The native read-only probe still checks the target machine's actual routes.
  for (let third = slot === 'a' ? 0 : 16; third < 256; third += 32) {
    const network = `10.252.${third}.0/20`, candidate = networkRange(network)
    if (ranges.some(([start, end]) => candidate[0] <= end && start <= candidate[1])) continue
    const target = normalizeOnboardingAddress(address)
    return { slot, network, address: `10.252.${third}.1`, listenPort, consolePort,
      consoleOrigin: `https://${target}:${consolePort}` }
  }
  throw new GatewayTaskError('GATEWAY_REMOTE_NETWORK_EXHAUSTED')
}
