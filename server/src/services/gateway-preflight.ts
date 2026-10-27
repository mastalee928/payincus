import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Client } from 'ssh2'
import { GatewayTaskError } from '../lib/gateway-task-plan.js'
import { sshExec } from './onboarding-ssh.js'

export interface GatewayPreflightRequest {
  schemaVersion: 1
  platformId: string
  gatewayId: string
  slot: 'a' | 'b'
  expectedMachineId: string | null
  network: string
  address: string
  listenPort: number
  consolePort: number
}
export interface GatewayPreflightReport {
  schemaVersion: 1
  machineId: string
  osId: string
  architecture: 'amd64' | 'arm64' | 'unknown'
  memoryMiB: number
  diskAvailableMiB: number
  tools: Record<'wg' | 'ip' | 'ss' | 'systemctl' | 'node' | 'python3', boolean>
  facts: {
    interface: { exists: boolean; owned: boolean; addressMatches: boolean }
    routeConflicts: Array<{ network: string; interface: string }>
    portConflicts: Array<{ protocol: 'tcp' | 'udp'; port: number }>
    services: Record<string, { installed: boolean; owned: boolean; active: boolean; digest: string | null }>
  }
  blockers: string[]
  observedStateHash: string
  inspectedAt: number
}
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
const KEYS = ['schemaVersion', 'platformId', 'gatewayId', 'slot', 'expectedMachineId', 'network', 'address', 'listenPort', 'consolePort']
function check(value: unknown): asserts value { if (!value) throw new GatewayTaskError('GATEWAY_PREFLIGHT_INVALID') }
const object = (value: unknown, keys: string[]) => {
  check(value && typeof value === 'object' && !Array.isArray(value))
  const row = value as Record<string, unknown>
  check(Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key)))
  return row
}
function ipv4Number(value: unknown): number {
  check(typeof value === 'string' && /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(value))
  const octets = value.split('.').map(Number)
  check(octets.every(item => item <= 255) && octets.join('.') === value)
  return octets.reduce((number, octet) => number * 256 + octet, 0)
}
export function validateGatewayPreflightRequest(value: unknown): GatewayPreflightRequest {
  const row = object(value, KEYS)
  check(row.schemaVersion === 1 && typeof row.platformId === 'string' && UUID.test(row.platformId) && typeof row.gatewayId === 'string' && UUID.test(row.gatewayId))
  check(row.slot === 'a' || row.slot === 'b')
  check(row.expectedMachineId === null || (typeof row.expectedMachineId === 'string' && /^[a-f0-9]{32}$/.test(row.expectedMachineId) && !/^0+$/.test(row.expectedMachineId)))
  check(typeof row.network === 'string')
  const parts = row.network.split('/'), network = ipv4Number(parts[0]), prefix = Number(parts[1])
  check(parts.length === 2 && /^(?:20|2[1-9]|30)$/.test(parts[1]))
  const width = 2 ** (32 - prefix), address = ipv4Number(row.address)
  check(network % width === 0 && address > network && address < network + width - 1)
  const first = Math.floor(network / 2 ** 24), second = Math.floor(network / 2 ** 16) % 256
  check(first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168))
  for (const key of ['listenPort', 'consolePort']) check(Number.isInteger(row[key]) && Number(row[key]) >= 1024 && Number(row[key]) <= 65535)
  check(row.listenPort !== row.consolePort)
  return { schemaVersion: 1, platformId: row.platformId, gatewayId: row.gatewayId, slot: row.slot,
    expectedMachineId: row.expectedMachineId as string | null, network: row.network, address: row.address as string,
    listenPort: Number(row.listenPort), consolePort: Number(row.consolePort) }
}
export function parseGatewayPreflightReport(raw: string): GatewayPreflightReport {
  check(Buffer.byteLength(raw) <= 16384)
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new GatewayTaskError('GATEWAY_PREFLIGHT_FAILED') }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length === 1 && 'code' in parsed &&
    ['GATEWAY_MACHINE_ID_UNAVAILABLE', 'GATEWAY_PREFLIGHT_FAILED', 'GATEWAY_DEPENDENCIES_MISSING',
      'GATEWAY_INSPECTION_TIMEOUT', 'GATEWAY_INSPECTION_COMMAND_FAILED', 'GATEWAY_INSPECTION_RESPONSE_INVALID'].includes(String(parsed.code))) {
    throw new GatewayTaskError(String(parsed.code))
  }
  const row = object(parsed, ['schemaVersion', 'machineId', 'osId', 'architecture', 'memoryMiB', 'diskAvailableMiB', 'tools', 'facts', 'blockers', 'observedStateHash', 'inspectedAt'])
  check(row.schemaVersion === 1 && typeof row.machineId === 'string' && /^[a-f0-9]{32}$/.test(row.machineId) && !/^0+$/.test(row.machineId))
  check(typeof row.osId === 'string' && /^[a-z0-9._-]{1,40}$/.test(row.osId))
  check(['amd64', 'arm64', 'unknown'].includes(String(row.architecture)))
  for (const key of ['memoryMiB', 'diskAvailableMiB', 'inspectedAt']) check(Number.isSafeInteger(row[key]) && Number(row[key]) >= 0)
  check(Number(row.inspectedAt) > Date.now() - 60000 && Number(row.inspectedAt) <= Date.now() + 30000)
  const tools = object(row.tools, ['wg', 'ip', 'ss', 'systemctl', 'node', 'python3'])
  check(Object.values(tools).every(value => typeof value === 'boolean'))
  const facts = object(row.facts, ['interface', 'routeConflicts', 'portConflicts', 'services'])
  check(Object.values(object(facts.interface, ['exists', 'owned', 'addressMatches'])).every(value => typeof value === 'boolean'))
  check(Array.isArray(facts.routeConflicts) && facts.routeConflicts.length <= 256 && Array.isArray(facts.portConflicts) && facts.portConflicts.length <= 2)
  for (const conflict of facts.routeConflicts) {
    const item = object(conflict, ['network', 'interface'])
    check(typeof item.network === 'string' && /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}\/(?:[0-9]|[12][0-9]|3[0-2])$/.test(item.network))
    check(typeof item.interface === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(item.interface))
  }
  for (const conflict of facts.portConflicts) {
    const item = object(conflict, ['protocol', 'port'])
    check((item.protocol === 'tcp' || item.protocol === 'udp') && Number.isInteger(item.port) && Number(item.port) > 0 && Number(item.port) <= 65535)
  }
  check(facts.services && typeof facts.services === 'object' && !Array.isArray(facts.services))
  const services = object(facts.services, Object.keys(facts.services))
  check(Object.keys(services).every(key => ['transport', 'console', 'backup'].includes(key)))
  for (const service of Object.values(services)) {
    const item = object(service, ['installed', 'owned', 'active', 'digest'])
    check(['installed', 'owned', 'active'].every(key => typeof item[key] === 'boolean') && (item.digest === null || (typeof item.digest === 'string' && /^[a-f0-9]{64}$/.test(item.digest))))
  }
  check(Array.isArray(row.blockers) && row.blockers.length <= 20 && row.blockers.every(code => typeof code === 'string' && /^GATEWAY_[A-Z_]{1,80}$/.test(code)))
  check(typeof row.observedStateHash === 'string' && /^[a-f0-9]{64}$/.test(row.observedStateHash))
  return row as unknown as GatewayPreflightReport
}
export function bindGatewayPreflightReport(raw: string, request: GatewayPreflightRequest): GatewayPreflightReport {
  const report = parseGatewayPreflightReport(raw)
  const stable = { request, machineId: report.machineId, osId: report.osId, architecture: report.architecture,
    tools: report.tools, facts: report.facts, blockers: report.blockers }
  const canonical = (item: unknown): string => {
    if (Array.isArray(item)) return '[' + item.map(canonical).join(',') + ']'
    if (item && typeof item === 'object') {
      const row = item as Record<string, unknown>
      return '{' + Object.keys(row).sort().map(key => JSON.stringify(key) + ':' + canonical(row[key])).join(',') + '}'
    }
    return JSON.stringify(item)
  }
  check(report.observedStateHash === createHash('sha256').update(canonical(stable)).digest('hex'))
  if (request.expectedMachineId && report.machineId !== request.expectedMachineId) check(report.blockers.includes('GATEWAY_TARGET_IDENTITY_CHANGED'))
  if (report.facts.routeConflicts.length) check(report.blockers.includes('GATEWAY_MANAGEMENT_ROUTE_CONFLICT'))
  if (report.facts.portConflicts.length) check(report.blockers.includes('GATEWAY_PORT_CONFLICT'))
  if (Object.keys(report.facts.services).length !== 3) check(report.blockers.includes('GATEWAY_INSPECTION_INCOMPLETE'))
  return report
}
const probePath = fileURLToPath(new URL('../../../scripts/probe-management-gateway.py', import.meta.url))
export async function inspectLocalManagementGateway(input: unknown): Promise<GatewayPreflightReport> {
  const request = validateGatewayPreflightRequest(input)
  if (process.platform !== 'linux') throw new GatewayTaskError('GATEWAY_SYSTEM_UNSUPPORTED')
  const raw = await new Promise<string>((resolve, reject) => {
    const child = execFile('/usr/bin/python3', [probePath], { timeout: 30000, maxBuffer: 16384,
      env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C' } }, (error, stdout) => {
      if (error) {
        if (error.code === 'ENOENT') reject(new GatewayTaskError('GATEWAY_DEPENDENCIES_MISSING'))
        else if (error.killed) reject(new GatewayTaskError('GATEWAY_INSPECTION_TIMEOUT'))
        else {
          try { parseGatewayPreflightReport(stdout); reject(new GatewayTaskError('GATEWAY_PREFLIGHT_FAILED')) }
          catch (failure) { reject(failure) }
        }
      } else resolve(stdout)
    })
    child.stdin!.end(JSON.stringify(request))
  })
  return bindGatewayPreflightReport(raw, request)
}
export async function inspectRemoteManagementGateway(client: Client, input: unknown): Promise<GatewayPreflightReport> {
  const request = validateGatewayPreflightRequest(input), script = await readFile(probePath, 'utf8')
  const encoded = Buffer.from(JSON.stringify(request)).toString('base64')
  const command = `/bin/sh -c 'if [ -x /usr/bin/python3 ]; then exec /usr/bin/python3 -; else printf "INCUDAL_ERROR:GATEWAY_DEPENDENCIES_MISSING\\n"; exit 1; fi'`
  const raw = await sshExec(client, command, `INCUDAL_PREFLIGHT_REQUEST = '${encoded}'\n${script}`)
  return bindGatewayPreflightReport(raw, request)
}
