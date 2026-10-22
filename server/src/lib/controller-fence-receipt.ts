import { createPublicKey, sign, verify, type KeyObject } from 'node:crypto'
import { ControllerConfigError } from './controller-config.js'

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
const COUNTER = /^[1-9][0-9]{0,18}$/
const HASH = /^[a-f0-9]{64}$/
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const PREFIX = 'payincus/host-fence-receipt/v1\n'
const MAX_BYTES = 4096

export interface ControllerFenceReceipt {
  schemaVersion: 1; purpose: 'host-fence-receipt'
  platformId: string; nodeId: string; controllerId: string; requestId: string
  epoch: string; sequence: string; candidateSha256: string; challenge: string; bootId: string
  issuedAt: number; expiresAt: number
  oldConnectionsBlocked: true; legacyCredentialsBlocked: true
  outstandingSshProcesses: 0; outstandingLocalJobs: 0; activeIncusOperations: 0
}
export interface ControllerFenceReceiptBinding {
  platformId: string; nodeId: string; controllerId: string; requestId: string
  epoch: string; sequence: string; candidateSha256: string; challenge: string
}
function require(condition: unknown): asserts condition {
  if (!condition) throw new ControllerConfigError('CONTROLLER_FENCE_RECEIPT_INVALID')
}
function canonical(input: unknown): ControllerFenceReceipt {
  require(input && typeof input === 'object' && !Array.isArray(input))
  const row = input as Record<string, unknown>
  const fields = ['schemaVersion', 'purpose', 'platformId', 'nodeId', 'controllerId', 'requestId', 'epoch', 'sequence',
    'candidateSha256', 'challenge', 'bootId', 'issuedAt', 'expiresAt', 'oldConnectionsBlocked', 'legacyCredentialsBlocked',
    'outstandingSshProcesses', 'outstandingLocalJobs', 'activeIncusOperations']
  require(Object.keys(row).length === fields.length && fields.every(key => Object.hasOwn(row, key)))
  require(row.schemaVersion === 1 && row.purpose === 'host-fence-receipt')
  for (const key of ['platformId', 'nodeId', 'controllerId', 'requestId', 'bootId']) require(typeof row[key] === 'string' && UUID.test(row[key]))
  for (const key of ['epoch', 'sequence']) require(typeof row[key] === 'string' && COUNTER.test(row[key]) && BigInt(row[key]) <= 9223372036854775807n)
  require(typeof row.candidateSha256 === 'string' && HASH.test(row.candidateSha256))
  require(typeof row.challenge === 'string' && /^[A-Za-z0-9_-]{32}$/.test(row.challenge) &&
    Buffer.from(row.challenge, 'base64url').toString('base64url') === row.challenge)
  require(Number.isSafeInteger(row.issuedAt) && Number(row.issuedAt) > 0 && Number.isSafeInteger(row.expiresAt) &&
    Number(row.expiresAt) > Number(row.issuedAt) && Number(row.expiresAt) - Number(row.issuedAt) <= 30000)
  require(row.oldConnectionsBlocked === true && row.legacyCredentialsBlocked === true && row.outstandingSshProcesses === 0 &&
    row.outstandingLocalJobs === 0 && row.activeIncusOperations === 0)
  // Force exact field ordering in both languages, never sign arbitrary JSON.
  return Object.fromEntries(fields.map(key => [key, row[key]])) as unknown as ControllerFenceReceipt
}
export function signControllerFenceReceipt(receipt: ControllerFenceReceipt, key: KeyObject): string {
  require(key.type === 'private' && key.asymmetricKeyType === 'ed25519')
  const payload = Buffer.from(JSON.stringify(canonical(receipt))).toString('base64')
  return JSON.stringify({ schemaVersion: 1, payload, signature: sign(null, Buffer.from(PREFIX + payload), key).toString('base64') })
}
export function verifyControllerFenceReceipt(encoded: string, binding: ControllerFenceReceiptBinding, nodePublicKey: string, now: number): ControllerFenceReceipt {
  require(typeof encoded === 'string' && Buffer.byteLength(encoded) <= MAX_BYTES && Number.isSafeInteger(now) && now > 0)
  let envelope: Record<string, unknown>
  try { envelope = JSON.parse(encoded) } catch { throw new ControllerConfigError('CONTROLLER_FENCE_RECEIPT_INVALID') }
  require(envelope && typeof envelope === 'object' && !Array.isArray(envelope) && Object.keys(envelope).length === 3 &&
    envelope.schemaVersion === 1 && typeof envelope.payload === 'string' && typeof envelope.signature === 'string')
  require(encoded === JSON.stringify({ schemaVersion: 1, payload: envelope.payload, signature: envelope.signature }))
  const payload = Buffer.from(envelope.payload, 'base64'), signature = Buffer.from(envelope.signature, 'base64'), publicKey = Buffer.from(nodePublicKey, 'base64')
  require(payload.toString('base64') === envelope.payload && signature.length === 64 && signature.toString('base64') === envelope.signature &&
    publicKey.length === 32 && publicKey.toString('base64') === nodePublicKey)
  require(verify(null, Buffer.from(PREFIX + envelope.payload), createPublicKey({ key: Buffer.concat([SPKI_PREFIX, publicKey]), type: 'spki', format: 'der' }), signature))
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(payload)) } catch { throw new ControllerConfigError('CONTROLLER_FENCE_RECEIPT_INVALID') }
  const receipt = canonical(parsed)
  require(payload.equals(Buffer.from(JSON.stringify(receipt))))
  require(receipt.issuedAt <= now + 5000 && receipt.expiresAt > now)
  const bindingKeys = ['platformId', 'nodeId', 'controllerId', 'requestId', 'epoch', 'sequence', 'candidateSha256', 'challenge'] as const
  require(binding && typeof binding === 'object' && Object.keys(binding).length === bindingKeys.length &&
    bindingKeys.every(key => Object.hasOwn(binding, key) && receipt[key] === binding[key]))
  return receipt
}
