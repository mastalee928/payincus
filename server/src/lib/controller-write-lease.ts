import { createPublicKey, sign, verify, type KeyObject } from 'node:crypto'
import { ControllerConfigError, controllerSigningKeyId } from './controller-config.js'

const PREFIX = 'payincus/controller-write-lease/v1\n'
const SPKI = Buffer.from('302a300506032b6570032100', 'hex')
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
const HASH = /^[a-f0-9]{64}$/
const KEY_ID = /^key_[a-f0-9]{64}$/
const PERMISSIONS = ['inspect', 'instance-power', 'management-channel'] as const
export type ControllerLeasePermission = typeof PERMISSIONS[number]
export interface ControllerWriteLease {
  schemaVersion: 1; purpose: 'controller-write-lease'; witnessId: string
  platformId: string; nodeId: string; controllerId: string; requestId: string
  epoch: string; sequence: string; candidateSha256: string
  leaseId: string; leaseSequence: string; bootId: string; gateId: string; holderKeyId: string
  issuedAt: number; expiresAt: number; permissions: ControllerLeasePermission[]
}
export interface ControllerLeaseBinding {
  witnessId: string; platformId: string; nodeId: string; controllerId: string; requestId: string
  epoch: string; sequence: string; candidateSha256: string
  leaseId: string; bootId: string; gateId: string; holderKeyId: string
}
function require(condition: unknown): asserts condition {
  if (!condition) throw new ControllerConfigError('CONTROLLER_WRITE_LEASE_INVALID')
}
function canonical(input: unknown): ControllerWriteLease {
  require(input && typeof input === 'object' && !Array.isArray(input))
  const row = input as Record<string, unknown>
  const fields = ['schemaVersion', 'purpose', 'witnessId', 'platformId', 'nodeId', 'controllerId', 'requestId',
    'epoch', 'sequence', 'candidateSha256', 'leaseId', 'leaseSequence', 'bootId', 'gateId', 'holderKeyId', 'issuedAt', 'expiresAt', 'permissions']
  require(Object.keys(row).length === fields.length && fields.every(key => Object.hasOwn(row, key)))
  require(row.schemaVersion === 1 && row.purpose === 'controller-write-lease')
  for (const key of ['witnessId', 'platformId', 'nodeId', 'controllerId', 'requestId', 'leaseId', 'bootId', 'gateId']) require(typeof row[key] === 'string' && UUID.test(row[key]))
  for (const key of ['epoch', 'sequence', 'leaseSequence']) require(typeof row[key] === 'string' && /^[1-9][0-9]{0,18}$/.test(row[key]) && BigInt(row[key]) <= 9223372036854775807n)
  require(typeof row.candidateSha256 === 'string' && HASH.test(row.candidateSha256) && typeof row.holderKeyId === 'string' && KEY_ID.test(row.holderKeyId))
  require(Number.isSafeInteger(row.issuedAt) && Number(row.issuedAt) > 0 && Number.isSafeInteger(row.expiresAt) &&
    Number(row.expiresAt) > Number(row.issuedAt) && Number(row.expiresAt) - Number(row.issuedAt) <= 30000)
  require(Array.isArray(row.permissions) && row.permissions.length > 0 && row.permissions.length <= PERMISSIONS.length)
  const permissions = row.permissions as unknown[]
  require(permissions.every((permission, index) => typeof permission === 'string' &&
    PERMISSIONS.includes(permission as ControllerLeasePermission) && (index === 0 || PERMISSIONS.indexOf(permission as ControllerLeasePermission) > PERMISSIONS.indexOf(permissions[index - 1] as ControllerLeasePermission))))
  return Object.fromEntries(fields.map(key => [key, row[key]])) as unknown as ControllerWriteLease
}
// Protocol codec only. Signing a lease here never changes witness state or
// enables a host writer; issuance must follow verified physical fencing.
export function signControllerWriteLease(input: ControllerWriteLease, key: KeyObject): string {
  require(key.type === 'private' && key.asymmetricKeyType === 'ed25519')
  const publicKey = createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(12).toString('base64')
  const keyId = controllerSigningKeyId(publicKey), payload = Buffer.from(JSON.stringify(canonical(input))).toString('base64')
  const signature = sign(null, Buffer.from(PREFIX + keyId + '\n' + payload), key).toString('base64')
  return JSON.stringify({ schemaVersion: 1, keyId, payload, signature })
}
export function verifyControllerWriteLease(encoded: string, trust: {
  binding: ControllerLeaseBinding; witnessKeys: Readonly<Record<string, string>>; now: number
}): ControllerWriteLease {
  require(typeof encoded === 'string' && Buffer.byteLength(encoded) <= 4096 && Number.isSafeInteger(trust.now) && trust.now > 0)
  let env: Record<string, unknown>
  try { env = JSON.parse(encoded) } catch { throw new ControllerConfigError('CONTROLLER_WRITE_LEASE_INVALID') }
  require(env && typeof env === 'object' && !Array.isArray(env) && Object.keys(env).length === 4 && env.schemaVersion === 1 &&
    typeof env.keyId === 'string' && KEY_ID.test(env.keyId) && typeof env.payload === 'string' && typeof env.signature === 'string')
  require(encoded === JSON.stringify({ schemaVersion: 1, keyId: env.keyId, payload: env.payload, signature: env.signature }))
  require(Object.hasOwn(trust.witnessKeys, env.keyId))
  const publicKey = trust.witnessKeys[env.keyId]
  require(typeof publicKey === 'string' && controllerSigningKeyId(publicKey) === env.keyId)
  const raw = Buffer.from(env.payload, 'base64'), signature = Buffer.from(env.signature, 'base64')
  require(raw.toString('base64') === env.payload && signature.length === 64 && signature.toString('base64') === env.signature)
  require(verify(null, Buffer.from(PREFIX + env.keyId + '\n' + env.payload),
    createPublicKey({ key: Buffer.concat([SPKI, Buffer.from(publicKey, 'base64')]), type: 'spki', format: 'der' }), signature))
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(raw)) } catch { throw new ControllerConfigError('CONTROLLER_WRITE_LEASE_INVALID') }
  const lease = canonical(parsed)
  require(raw.equals(Buffer.from(JSON.stringify(lease))))
  // No positive clock skew is granted to a writer: a future issue time cannot
  // increase the lifetime at the host. Gate enforcement uses monotonic time.
  require(lease.issuedAt <= trust.now && lease.expiresAt > trust.now)
  const fields = ['witnessId', 'platformId', 'nodeId', 'controllerId', 'requestId', 'epoch', 'sequence',
    'candidateSha256', 'leaseId', 'bootId', 'gateId', 'holderKeyId'] as const
  require(trust.binding && typeof trust.binding === 'object' && Object.keys(trust.binding).length === fields.length &&
    fields.every(key => Object.hasOwn(trust.binding, key) && trust.binding[key] === lease[key]))
  return lease
}
