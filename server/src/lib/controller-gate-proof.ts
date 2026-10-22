import { createHash, createPublicKey, sign, verify, type KeyObject } from 'node:crypto'
import { ControllerConfigError } from './controller-config.js'
import type { ControllerLeaseBinding } from './controller-write-lease.js'

const PREFIX = 'payincus/controller-gate-proof/v1\n'
const SPKI = Buffer.from('302a300506032b6570032100', 'hex')
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
export interface ControllerGateProof {
  schemaVersion: 1; purpose: 'controller-gate-proof'
  platformId: string; nodeId: string; controllerId: string; requestId: string
  epoch: string; sequence: string; candidateSha256: string; receiptSha256: string
  bootId: string; gateId: string; holderKeyId: string; issuedAt: number; expiresAt: number
}
function require(condition: unknown): asserts condition {
  if (!condition) throw new ControllerConfigError('CONTROLLER_GATE_PROOF_INVALID')
}
function canonical(input: unknown): ControllerGateProof {
  require(input && typeof input === 'object' && !Array.isArray(input))
  const row = input as Record<string, unknown>
  const fields = ['schemaVersion', 'purpose', 'platformId', 'nodeId', 'controllerId', 'requestId', 'epoch', 'sequence',
    'candidateSha256', 'receiptSha256', 'bootId', 'gateId', 'holderKeyId', 'issuedAt', 'expiresAt']
  require(Object.keys(row).length === fields.length && fields.every(key => Object.hasOwn(row, key)))
  require(row.schemaVersion === 1 && row.purpose === 'controller-gate-proof')
  for (const field of ['platformId', 'nodeId', 'controllerId', 'requestId', 'bootId', 'gateId']) require(typeof row[field] === 'string' && UUID.test(row[field]))
  for (const field of ['epoch', 'sequence']) require(typeof row[field] === 'string' && /^[1-9][0-9]{0,18}$/.test(row[field]) && BigInt(row[field]) <= 9223372036854775807n)
  for (const field of ['candidateSha256', 'receiptSha256']) require(typeof row[field] === 'string' && /^[a-f0-9]{64}$/.test(row[field]))
  require(typeof row.holderKeyId === 'string' && /^key_[a-f0-9]{64}$/.test(row.holderKeyId))
  require(Number.isSafeInteger(row.issuedAt) && Number(row.issuedAt) > 0 && Number.isSafeInteger(row.expiresAt) &&
    Number(row.expiresAt) > Number(row.issuedAt) && Number(row.expiresAt) - Number(row.issuedAt) <= 30000)
  return Object.fromEntries(fields.map(key => [key, row[key]])) as unknown as ControllerGateProof
}
// Only a maintenance service that owns the node identity and has completed
// physical auditing may produce this proof. The codec never collects facts.
export function signControllerGateProof(input: ControllerGateProof, nodeKey: KeyObject): string {
  require(nodeKey.type === 'private' && nodeKey.asymmetricKeyType === 'ed25519')
  const payload = Buffer.from(JSON.stringify(canonical(input))).toString('base64')
  return JSON.stringify({ schemaVersion: 1, payload, signature: sign(null, Buffer.from(PREFIX + payload), nodeKey).toString('base64') })
}
export function verifyControllerGateProof(encoded: string, binding: Omit<ControllerLeaseBinding, 'witnessId' | 'leaseId'>,
  receipt: string, nodePublicKey: string, now: number): ControllerGateProof {
  require(typeof encoded === 'string' && Buffer.byteLength(encoded) <= 4096 && typeof receipt === 'string' && Buffer.byteLength(receipt) <= 4096 &&
    Number.isSafeInteger(now) && now > 0)
  let envelope: Record<string, unknown>
  try { envelope = JSON.parse(encoded) } catch { throw new ControllerConfigError('CONTROLLER_GATE_PROOF_INVALID') }
  require(envelope && typeof envelope === 'object' && !Array.isArray(envelope) && Object.keys(envelope).length === 3 && envelope.schemaVersion === 1 &&
    typeof envelope.payload === 'string' && typeof envelope.signature === 'string')
  require(encoded === JSON.stringify({ schemaVersion: 1, payload: envelope.payload, signature: envelope.signature }))
  const raw = Buffer.from(envelope.payload, 'base64'), signature = Buffer.from(envelope.signature, 'base64'), publicKey = Buffer.from(nodePublicKey, 'base64')
  require(raw.toString('base64') === envelope.payload && signature.length === 64 && signature.toString('base64') === envelope.signature &&
    publicKey.length === 32 && publicKey.toString('base64') === nodePublicKey)
  require(verify(null, Buffer.from(PREFIX + envelope.payload), createPublicKey({ key: Buffer.concat([SPKI, publicKey]), type: 'spki', format: 'der' }), signature))
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(raw)) } catch { throw new ControllerConfigError('CONTROLLER_GATE_PROOF_INVALID') }
  const proof = canonical(parsed)
  require(raw.equals(Buffer.from(JSON.stringify(proof))) && proof.issuedAt <= now && proof.expiresAt > now)
  require(proof.receiptSha256 === createHash('sha256').update(receipt).digest('hex'))
  const fields = ['platformId', 'nodeId', 'controllerId', 'requestId', 'epoch', 'sequence', 'candidateSha256', 'bootId', 'gateId', 'holderKeyId'] as const
  require(binding && Object.keys(binding).length === fields.length && fields.every(key => Object.hasOwn(binding, key) && binding[key] === proof[key]))
  return proof
}
