import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto'
import { isIP } from 'node:net'

export const CONTROLLER_CONFIG_MAX_BYTES = 12288
const MAX_PAYLOAD_BYTES = 6144
const MAX_TTL_MS = 15 * 60 * 1000
const CLOCK_SKEW_MS = 30000
const MAX_COUNTER = 9223372036854775807n
const PREFIX = 'payincus/controller-prepare/v1\n'
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
const keyIdPattern = /^key_[a-f0-9]{64}$/
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

export class ControllerConfigError extends Error {
  constructor(public readonly code: string) { super(code) }
}
function check(condition: unknown, code = 'CONTROLLER_CONFIG_INVALID'): asserts condition {
  if (!condition) throw new ControllerConfigError(code)
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  check(value && typeof value === 'object' && !Array.isArray(value))
  const row = value as Record<string, unknown>
  check(Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key)))
  return row
}
function identifier(value: unknown): string { check(typeof value === 'string' && uuid.test(value)); return value }
function counter(value: unknown): string {
  check(typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= MAX_COUNTER)
  return value
}
function base64(value: unknown, size: number): Buffer {
  check(typeof value === 'string' && value.length === 4 * Math.ceil(size / 3))
  const bytes = Buffer.from(value, 'base64')
  check(bytes.length === size && bytes.toString('base64') === value)
  return bytes
}
function host(value: unknown): string {
  check(typeof value === 'string' && value.length <= 253 && value === value.toLowerCase())
  // Protocol v1 supports DNS and public IPv4. Other transports require a new
  // explicitly tested protocol; never accept arbitrary URLs as UDP endpoints.
  if (isIP(value) === 4) {
    const [a, b, c] = value.split('.').map(Number)
    check(!(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)))
  } else {
    check(!/^[0-9.]+$/.test(value) && value.includes('.') && !value.endsWith('.localhost') && !value.endsWith('.local'))
    check(value.split('.').every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)))
  }
  return value
}
function port(value: unknown): number { check(Number.isInteger(value) && Number(value) > 0 && Number(value) <= 65535); return Number(value) }
function panelUrl(value: unknown): string {
  check(typeof value === 'string' && value.length <= 300 && /^[\x21-\x7e]+$/.test(value))
  let url: URL
  try { url = new URL(value) } catch { throw new ControllerConfigError('CONTROLLER_CONFIG_INVALID') }
  check(url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash)
  host(url.hostname)
  if (url.port) port(Number(url.port))
  check(value === url.origin, 'CONTROLLER_CONFIG_NON_CANONICAL')
  return value
}
function managementIp(value: unknown): string {
  check(typeof value === 'string' && isIP(value) === 4 && value.startsWith('10.'))
  const [, b, c] = value.split('.').map(Number)
  check(!(b === 10 && c < 4)) // Existing Incus network is 10.10.0.0/22.
  return value
}

export interface ControllerPrepareConfig {
  schemaVersion: 1
  purpose: 'controller-prepare'
  platformId: string
  nodeId: string
  controllerId: string
  requestId: string
  epoch: string
  sequence: string
  issuedAt: number
  expiresAt: number
  panelBaseUrl: string
  gateway: {
    gatewayId: string; endpointHost: string; endpointPort: number; publicKey: string
    nodeAddress: string; controlAddress: string
  }
}
export interface ControllerObservedState {
  schemaVersion: 1; platformId: string; nodeId: string; epoch: string; sequence: string; payloadSha256: string
}
export interface ControllerConfigContext {
  platformId: string; nodeId: string; now: number
  // Keys arrive from local, pre-enrolled trust, never from the envelope.
  trustedKeys: Readonly<Record<string, string>>
  previous?: ControllerObservedState
}

export function parseControllerPrepareConfig(input: unknown): ControllerPrepareConfig {
  const row = object(input, ['schemaVersion', 'purpose', 'platformId', 'nodeId', 'controllerId', 'requestId', 'epoch', 'sequence', 'issuedAt', 'expiresAt', 'panelBaseUrl', 'gateway'])
  check(row.schemaVersion === 1 && row.purpose === 'controller-prepare')
  check(Number.isSafeInteger(row.issuedAt) && Number(row.issuedAt) > 0 && Number.isSafeInteger(row.expiresAt) &&
    Number(row.expiresAt) > Number(row.issuedAt) && Number(row.expiresAt) - Number(row.issuedAt) <= MAX_TTL_MS)
  const gateway = object(row.gateway, ['gatewayId', 'endpointHost', 'endpointPort', 'publicKey', 'nodeAddress', 'controlAddress'])
  const publicKey = base64(gateway.publicKey, 32)
  check(publicKey.some(byte => byte !== 0))
  const nodeAddress = managementIp(gateway.nodeAddress), controlAddress = managementIp(gateway.controlAddress)
  check(nodeAddress !== controlAddress)
  return {
    schemaVersion: 1, purpose: 'controller-prepare', platformId: identifier(row.platformId), nodeId: identifier(row.nodeId),
    controllerId: identifier(row.controllerId), requestId: identifier(row.requestId), epoch: counter(row.epoch), sequence: counter(row.sequence),
    issuedAt: Number(row.issuedAt), expiresAt: Number(row.expiresAt), panelBaseUrl: panelUrl(row.panelBaseUrl),
    gateway: { gatewayId: identifier(gateway.gatewayId), endpointHost: host(gateway.endpointHost), endpointPort: port(gateway.endpointPort),
      publicKey: publicKey.toString('base64'), nodeAddress, controlAddress }
  }
}

export function controllerSigningKeyId(publicKeyBase64: string): string { return `key_${hash(base64(publicKeyBase64, 32))}` }
function keyObject(raw: Buffer): KeyObject { return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' }) }
function signingBytes(keyId: string, payload: string): Buffer { return Buffer.from(`${PREFIX}${keyId}\n${payload}`, 'ascii') }

export function signControllerPrepareConfig(config: ControllerPrepareConfig, privateKey: KeyObject | string): string {
  const key = typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey
  check(key.type === 'private' && key.asymmetricKeyType === 'ed25519', 'CONTROLLER_CONFIG_KEY_INVALID')
  const rawPublic = createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(SPKI_PREFIX.length)
  const keyId = controllerSigningKeyId(rawPublic.toString('base64'))
  const bytes = Buffer.from(JSON.stringify(parseControllerPrepareConfig(config)), 'utf8')
  check(bytes.length <= MAX_PAYLOAD_BYTES)
  const payload = bytes.toString('base64'), signature = sign(null, signingBytes(keyId, payload), key).toString('base64')
  return JSON.stringify({ schemaVersion: 1, keyId, payload, signature })
}

export function verifyControllerPrepareConfig(encoded: string, context: ControllerConfigContext): {
  config: ControllerPrepareConfig; observed: ControllerObservedState; duplicate: boolean; canWrite: false
} {
  check(typeof encoded === 'string' && Buffer.byteLength(encoded) <= CONTROLLER_CONFIG_MAX_BYTES)
  check(Number.isSafeInteger(context.now) && context.now > 0)
  identifier(context.platformId); identifier(context.nodeId)
  let input: unknown
  try { input = JSON.parse(encoded) } catch { throw new ControllerConfigError('CONTROLLER_CONFIG_INVALID') }
  const envelope = object(input, ['schemaVersion', 'keyId', 'payload', 'signature'])
  check(envelope.schemaVersion === 1 && typeof envelope.keyId === 'string' && keyIdPattern.test(envelope.keyId))
  const keyId = envelope.keyId
  check(Object.hasOwn(context.trustedKeys, keyId), 'CONTROLLER_CONFIG_UNTRUSTED_KEY')
  const rawKey = base64(context.trustedKeys[keyId], 32)
  check(controllerSigningKeyId(rawKey.toString('base64')) === keyId, 'CONTROLLER_CONFIG_KEY_INVALID')
  const signature = base64(envelope.signature, 64)
  check(typeof envelope.payload === 'string' && envelope.payload.length <= 4 * Math.ceil(MAX_PAYLOAD_BYTES / 3))
  const payload = Buffer.from(envelope.payload, 'base64')
  check(payload.length <= MAX_PAYLOAD_BYTES && payload.toString('base64') === envelope.payload)
  check(encoded === JSON.stringify({ schemaVersion: 1, keyId, payload: envelope.payload, signature: envelope.signature }), 'CONTROLLER_CONFIG_NON_CANONICAL')
  check(verify(null, signingBytes(keyId, envelope.payload), keyObject(rawKey), signature), 'CONTROLLER_CONFIG_SIGNATURE_INVALID')
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload)) } catch { throw new ControllerConfigError('CONTROLLER_CONFIG_INVALID') }
  const config = parseControllerPrepareConfig(parsed)
  // A single exact encoding rejects duplicate keys, alternate numeric/string
  // representations and parser ambiguities after verifying the signed bytes.
  check(payload.equals(Buffer.from(JSON.stringify(config))), 'CONTROLLER_CONFIG_NON_CANONICAL')
  check(config.platformId === context.platformId && config.nodeId === context.nodeId, 'CONTROLLER_CONFIG_IDENTITY_MISMATCH')
  check(config.issuedAt <= context.now + CLOCK_SKEW_MS && config.expiresAt > context.now, 'CONTROLLER_CONFIG_EXPIRED')
  const observed: ControllerObservedState = { schemaVersion: 1, platformId: config.platformId, nodeId: config.nodeId,
    epoch: config.epoch, sequence: config.sequence, payloadSha256: hash(payload) }
  let duplicate = false
  if (context.previous) {
    const previous = object(context.previous, ['schemaVersion', 'platformId', 'nodeId', 'epoch', 'sequence', 'payloadSha256'])
    check(previous.schemaVersion === 1 && previous.platformId === context.platformId && previous.nodeId === context.nodeId &&
      typeof previous.payloadSha256 === 'string' && /^[a-f0-9]{64}$/.test(previous.payloadSha256), 'CONTROLLER_CONFIG_STATE_INVALID')
    const oldEpoch = BigInt(counter(previous.epoch)), oldSequence = BigInt(counter(previous.sequence))
    const epoch = BigInt(config.epoch), sequence = BigInt(config.sequence)
    check(epoch > oldEpoch || epoch === oldEpoch && sequence >= oldSequence, 'CONTROLLER_CONFIG_ROLLBACK')
    if (epoch === oldEpoch && sequence === oldSequence) {
      check(observed.payloadSha256 === previous.payloadSha256, 'CONTROLLER_CONFIG_CONFLICT')
      duplicate = true
    }
  }
  // This is a candidate preparation protocol, never a writer lease or an
  // instruction to activate routes, change Agent URL, or execute commands.
  return { config, observed, duplicate, canWrite: false }
}
