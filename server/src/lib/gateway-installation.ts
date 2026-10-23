import { isIPv4 } from 'node:net'
import { GatewayTaskError, gatewayTaskHash, validateGatewayTaskPlan, type GatewayTaskPlan } from './gateway-task-plan.js'
import { verifyGatewayTransport } from './gateway-transport.js'
import { controllerSigningKeyId } from './controller-config.js'
import { validateGatewayPreflightRequest } from '../services/gateway-preflight.js'

function require(value: unknown): asserts value { if (!value) throw new GatewayTaskError('GATEWAY_INSTALLATION_INVALID') }
const fields = (value: unknown, keys: string[]) => {
  require(value && typeof value === 'object' && !Array.isArray(value))
  const row = value as Record<string, unknown>
  require(Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key)))
  return row
}
export interface GatewayInstallationDesired {
  slot: 'a' | 'b'; network: string; address: string; listenPort: number; consolePort: number; consoleOrigin: string
}
export interface GatewayInstallationRequest {
  task: GatewayTaskPlan
  configuration: GatewayInstallationDesired & { signedTransport: string }
  expiresAt: number
}
export interface GatewayInstallationReceipt {
  schemaVersion: 1; taskId: string; planHash: string; targetHash: string; configurationHash: string; componentHash: string
  gatewayId: string; publicKey: string; consoleCertificateSha256: string; installed: true; transportReady: true
  canWrite: false; bootstrapAvailable: true; blockers: string[]
}
export interface GatewayBootstrapMaterial {
  username: string; password: string; role: 'operator'; totpSeed: string; recoveryCodes: string[]
}
export interface GatewayInstallationPreview {
  schemaVersion: 1; task: GatewayTaskPlan; planHash: string; expiresAt: number
  package: { verified: true; architecture: 'amd64' | 'arm64'; version: string; sourceCommit: string; files: number; manifestHash: string; canWrite: false }
  target: { machineId: string; osId: string; architecture: 'amd64' | 'arm64' }
  configuration: GatewayInstallationDesired
  transport: { epoch: '1'; sequence: '1'; mtu: number; peerCount: 0 }
  changes: { packageDirectory: string; stateDirectory: string; services: string[]; interface: string; newIndependentIdentity: true
    consoleCertificate: 'independently-pinned'; businessBackendRestart: false; consoleListenAddress: '0.0.0.0'; existingFilesOverwritten: false; customerRoutesChanged: false }
  blockers: string[]; installable: boolean; canWrite: false
}
export function validateGatewayInstallationPreview(input: unknown, request: GatewayInstallationRequest): GatewayInstallationPreview {
  const row = fields(input, ['schemaVersion', 'task', 'planHash', 'expiresAt', 'package', 'target', 'configuration', 'transport', 'changes', 'blockers', 'installable', 'canWrite'])
  const task = request.task
  require(row.schemaVersion === 1 && gatewayTaskHash(row.task) === gatewayTaskHash(task) && row.planHash === gatewayTaskHash(task) && row.expiresAt === request.expiresAt && row.canWrite === false)
  const artifact = fields(row.package, ['verified', 'architecture', 'version', 'sourceCommit', 'files', 'manifestHash', 'canWrite'])
  require(artifact.verified === true && ['amd64', 'arm64'].includes(String(artifact.architecture)) && artifact.manifestHash === task.componentHash && artifact.canWrite === false &&
    typeof artifact.version === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(artifact.version) &&
    typeof artifact.sourceCommit === 'string' && /^[a-f0-9]{40}$/.test(artifact.sourceCommit) && artifact.files === 20)
  const target = fields(row.target, ['machineId', 'osId', 'architecture'])
  require(target.machineId === task.target.machineId && target.architecture === artifact.architecture && typeof target.osId === 'string' && /^[a-z0-9._-]{1,40}$/.test(target.osId))
  const { signedTransport: _signed, ...desired } = request.configuration
  require(gatewayTaskHash(row.configuration) === gatewayTaskHash(desired))
  const transport = fields(row.transport, ['epoch', 'sequence', 'mtu', 'peerCount'])
  require(transport.epoch === '1' && transport.sequence === '1' && transport.peerCount === 0 && Number.isInteger(transport.mtu) && Number(transport.mtu) >= 1280 && Number(transport.mtu) <= 1420)
  const changes = fields(row.changes, ['packageDirectory', 'stateDirectory', 'services', 'interface', 'newIndependentIdentity', 'consoleCertificate', 'businessBackendRestart', 'consoleListenAddress', 'existingFilesOverwritten', 'customerRoutesChanged'])
  require(changes.packageDirectory === '/opt/incudal-gateway/components/' + task.componentHash && changes.stateDirectory === '/var/lib/incudal-management-gateway/' + task.gatewayId &&
    gatewayTaskHash(changes.services) === gatewayTaskHash(['incudal-gateway.service', 'incudal-gateway-console.service']) && changes.interface === 'incudal-gw-' + desired.slot &&
    changes.newIndependentIdentity === true && changes.consoleCertificate === 'independently-pinned' && changes.businessBackendRestart === false &&
    changes.consoleListenAddress === '0.0.0.0' && changes.existingFilesOverwritten === false && changes.customerRoutesChanged === false)
  const allowed = ['GATEWAY_TARGET_IDENTITY_CHANGED', 'GATEWAY_SYSTEM_UNSUPPORTED', 'GATEWAY_SERVICE_MANAGER_UNSUPPORTED', 'GATEWAY_MEMORY_INSUFFICIENT',
    'GATEWAY_DISK_INSUFFICIENT', 'GATEWAY_DEPENDENCIES_MISSING', 'GATEWAY_INTERFACE_CONFLICT', 'GATEWAY_ADDRESS_CHANGE_REQUIRES_MIGRATION', 'GATEWAY_MANAGEMENT_ROUTE_CONFLICT',
    'GATEWAY_SERVICE_OWNERSHIP_CONFLICT', 'GATEWAY_PORT_CONFLICT', 'GATEWAY_INSPECTION_INCOMPLETE', 'GATEWAY_INSTALL_EXISTING_REQUIRES_ATTACH', 'GATEWAY_INSTALL_EXECUTABLE_CONFLICT']
  require(Array.isArray(row.blockers) && row.blockers.every(value => allowed.includes(value)) && new Set(row.blockers).size === row.blockers.length && row.installable === (row.blockers.length === 0))
  return structuredClone(row) as unknown as GatewayInstallationPreview
}
export function validateGatewayInstallationDesired(input: unknown, identity: { platformId: string; gatewayId: string; machineId: string }): GatewayInstallationDesired {
  const row = fields(input, ['slot', 'network', 'address', 'listenPort', 'consolePort', 'consoleOrigin'])
  const request = validateGatewayPreflightRequest({ schemaVersion: 1, platformId: identity.platformId, gatewayId: identity.gatewayId,
    expectedMachineId: identity.machineId, slot: row.slot, network: row.network, address: row.address, listenPort: row.listenPort, consolePort: row.consolePort })
  require(request.address.startsWith('10.') && !/^10\.10\.[0-3]\./.test(request.address))
  require(typeof row.consoleOrigin === 'string' && row.consoleOrigin.length <= 300)
  let origin: URL
  try { origin = new URL(row.consoleOrigin) } catch { throw new GatewayTaskError('GATEWAY_INSTALLATION_INVALID') }
  require(origin.protocol === 'https:' && origin.origin === row.consoleOrigin && !origin.username && !origin.password &&
    origin.port === String(request.consolePort) && /^[a-z0-9.-]+$/.test(origin.hostname))
  require(isIPv4(origin.hostname) || origin.hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))
  return { slot: request.slot, network: request.network, address: request.address, listenPort: request.listenPort,
    consolePort: request.consolePort, consoleOrigin: row.consoleOrigin }
}
export function validateGatewayInstallationRequest(input: unknown, platformSigningKey: string, now = Date.now()): GatewayInstallationRequest {
  const row = fields(input, ['task', 'configuration', 'expiresAt']), task = validateGatewayTaskPlan(row.task)
  require(task.kind === 'install' && task.basedOnRevision === '0' && task.target.mode !== 'existing')
  const configuration = fields(row.configuration, ['slot', 'network', 'address', 'listenPort', 'consolePort', 'consoleOrigin', 'signedTransport'])
  const { signedTransport, ...desiredInput } = configuration
  const desired = validateGatewayInstallationDesired(desiredInput, { ...task, machineId: task.target.machineId })
  require(typeof signedTransport === 'string' && Buffer.byteLength(signedTransport) <= 49152 && Number.isSafeInteger(row.expiresAt) &&
    Number(row.expiresAt) > now && Number(row.expiresAt) <= now + 600000)
  const transport = verifyGatewayTransport(signedTransport, { platformId: task.platformId, gatewayId: task.gatewayId,
    now, trustedKeys: { [controllerSigningKeyId(platformSigningKey)]: platformSigningKey } }).config
  require(transport.epoch === '1' && transport.sequence === '1' && transport.peers.length === 0 && transport.slot === desired.slot &&
    transport.address === desired.address && transport.listenPort === desired.listenPort && Number(row.expiresAt) <= transport.expiresAt)
  const result = { task, configuration: { ...desired, signedTransport }, expiresAt: Number(row.expiresAt) }
  require(gatewayTaskHash(result.configuration) === task.configurationHash)
  return result
}
export function validateGatewayInstallationReceipt(input: unknown, request: GatewayInstallationRequest): GatewayInstallationReceipt {
  const row = fields(input, ['schemaVersion', 'taskId', 'planHash', 'targetHash', 'configurationHash', 'componentHash', 'gatewayId',
    'publicKey', 'consoleCertificateSha256', 'installed', 'transportReady', 'canWrite', 'bootstrapAvailable', 'blockers'])
  const task = request.task
  require(row.schemaVersion === 1 && row.taskId === task.taskId && row.planHash === gatewayTaskHash(task) && row.targetHash === gatewayTaskHash(task.target) &&
    row.configurationHash === task.configurationHash && row.componentHash === task.componentHash && row.gatewayId === task.gatewayId &&
    row.installed === true && row.transportReady === true && row.canWrite === false && row.bootstrapAvailable === true)
  require(typeof row.publicKey === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(row.publicKey) && Buffer.from(row.publicKey, 'base64').toString('base64') === row.publicKey &&
    Buffer.from(row.publicKey, 'base64').some(byte => byte !== 0) && typeof row.consoleCertificateSha256 === 'string' && /^[a-f0-9]{64}$/.test(row.consoleCertificateSha256))
  require(Array.isArray(row.blockers) && row.blockers.length === 3 &&
    ['backup-not-configured', 'host-write-service-not-ready', 'public-certificate-maintenance-required'].every((value, index) => (row.blockers as unknown[])[index] === value))
  return structuredClone(row) as unknown as GatewayInstallationReceipt
}
export function validateGatewayBootstrapMaterial(input: unknown): GatewayBootstrapMaterial {
  const row = fields(input, ['username', 'password', 'role', 'totpSeed', 'recoveryCodes'])
  require(typeof row.username === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$/.test(row.username) && row.role === 'operator')
  require(typeof row.password === 'string' && row.password.length >= 12 && Buffer.byteLength(row.password) <= 256)
  require(typeof row.totpSeed === 'string' && /^[A-Za-z0-9+/]{27}=$/.test(row.totpSeed) && Buffer.from(row.totpSeed, 'base64').toString('base64') === row.totpSeed)
  require(Array.isArray(row.recoveryCodes) && row.recoveryCodes.length >= 4 && row.recoveryCodes.length <= 8 &&
    row.recoveryCodes.every(code => typeof code === 'string' && /^[A-Za-z0-9_-]{24,64}$/.test(code)) && new Set(row.recoveryCodes).size === row.recoveryCodes.length)
  return structuredClone(row) as unknown as GatewayBootstrapMaterial
}
