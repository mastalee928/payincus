import { createPublicKey, sign, verify, type KeyObject } from 'node:crypto'
import { ControllerConfigError, controllerSigningKeyId } from './controller-config.js'
import type { ControllerFenceReceiptBinding } from './controller-fence-receipt.js'

const PREFIX = 'payincus/host-fence-prepare/v1\n'
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
export interface ControllerPreparePermit extends ControllerFenceReceiptBinding {
  schemaVersion: 1; purpose: 'host-fence-prepare'; witnessId: string; issuedAt: number; expiresAt: number
}
function require(condition: unknown): asserts condition {
  if (!condition) throw new ControllerConfigError('CONTROLLER_PREPARE_PERMIT_INVALID')
}
function canonical(input: unknown): ControllerPreparePermit {
  require(input && typeof input === 'object' && !Array.isArray(input))
  const row = input as Record<string, unknown>
  const fields = ['schemaVersion', 'purpose', 'witnessId', 'platformId', 'nodeId', 'controllerId', 'requestId',
    'epoch', 'sequence', 'candidateSha256', 'challenge', 'issuedAt', 'expiresAt']
  require(Object.keys(row).length === fields.length && fields.every(key => Object.hasOwn(row, key)))
  require(row.schemaVersion === 1 && row.purpose === 'host-fence-prepare')
  for (const key of ['witnessId', 'platformId', 'nodeId', 'controllerId', 'requestId']) require(typeof row[key] === 'string' && UUID.test(row[key]))
  for (const key of ['epoch', 'sequence']) require(typeof row[key] === 'string' && /^[1-9][0-9]{0,18}$/.test(row[key]) && BigInt(row[key]) <= 9223372036854775807n)
  require(typeof row.candidateSha256 === 'string' && /^[a-f0-9]{64}$/.test(row.candidateSha256))
  require(typeof row.challenge === 'string' && /^[A-Za-z0-9_-]{32}$/.test(row.challenge) && Buffer.from(row.challenge, 'base64url').toString('base64url') === row.challenge)
  require(Number.isSafeInteger(row.issuedAt) && Number(row.issuedAt) > 0 && Number.isSafeInteger(row.expiresAt) &&
    Number(row.expiresAt) > Number(row.issuedAt) && Number(row.expiresAt) - Number(row.issuedAt) <= 60000)
  return Object.fromEntries(fields.map(key => [key, row[key]])) as unknown as ControllerPreparePermit
}
export function signControllerPreparePermit(permit: ControllerPreparePermit, privateKey: KeyObject): string {
  require(privateKey.type === 'private' && privateKey.asymmetricKeyType === 'ed25519')
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(12).toString('base64')
  const keyId = controllerSigningKeyId(publicKey), payload = Buffer.from(JSON.stringify(canonical(permit))).toString('base64')
  const signature = sign(null, Buffer.from(PREFIX + keyId + '\n' + payload), privateKey).toString('base64')
  return JSON.stringify({ schemaVersion: 1, keyId, payload, signature })
}
export function verifyControllerPreparePermit(encoded: string, context: {
  binding: ControllerFenceReceiptBinding; witnessId: string; trustedWitnessKeys: Readonly<Record<string, string>>; now: number
}): ControllerPreparePermit {
  require(typeof encoded === 'string' && Buffer.byteLength(encoded) <= 4096 && Number.isSafeInteger(context.now) && context.now > 0)
  let env: Record<string, unknown>
  try { env = JSON.parse(encoded) } catch { throw new ControllerConfigError('CONTROLLER_PREPARE_PERMIT_INVALID') }
  require(env && typeof env === 'object' && !Array.isArray(env) && Object.keys(env).length === 4 && env.schemaVersion === 1 &&
    typeof env.keyId === 'string' && /^key_[a-f0-9]{64}$/.test(env.keyId) && typeof env.payload === 'string' && typeof env.signature === 'string')
  require(encoded === JSON.stringify({ schemaVersion: 1, keyId: env.keyId, payload: env.payload, signature: env.signature }))
  require(Object.hasOwn(context.trustedWitnessKeys, env.keyId))
  const publicKey = context.trustedWitnessKeys[env.keyId]
  require(typeof publicKey === 'string' && controllerSigningKeyId(publicKey) === env.keyId)
  const raw = Buffer.from(env.payload, 'base64'), signature = Buffer.from(env.signature, 'base64')
  require(raw.toString('base64') === env.payload && signature.length === 64 && signature.toString('base64') === env.signature)
  require(verify(null, Buffer.from(PREFIX + env.keyId + '\n' + env.payload),
    createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKey, 'base64')]), format: 'der', type: 'spki' }), signature))
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) } catch { throw new ControllerConfigError('CONTROLLER_PREPARE_PERMIT_INVALID') }
  const permit = canonical(parsed)
  require(raw.equals(Buffer.from(JSON.stringify(permit))))
  require(permit.witnessId === context.witnessId && permit.issuedAt <= context.now + 5000 && permit.expiresAt > context.now)
  const keys = ['platformId', 'nodeId', 'controllerId', 'requestId', 'epoch', 'sequence', 'candidateSha256', 'challenge'] as const
  require(context.binding && Object.keys(context.binding).length === keys.length && keys.every(key => Object.hasOwn(context.binding, key) && permit[key] === context.binding[key]))
  return permit
}
