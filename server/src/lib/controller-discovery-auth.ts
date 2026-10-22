import { createPublicKey, verify } from 'node:crypto'
import { ControllerConfigError } from './controller-config.js'

const PREFIX = 'payincus/controller-config-read/v1\n'
const PATH = '/v1/controller-config'
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
const WINDOW_MS = 30000

export interface ControllerReadProof {
  platformId: string; nodeId: string; timestamp: string; nonce: string; signature: string
}
export interface ControllerReadTrust {
  platformId: string; nodeId: string; nodePublicKey: string; authority: string; now: number
  path?: '/v1/controller-config' | '/v1/management-channels'
  // The service must persistently reserve the nonce before returning data.
  // Returning false rejects replay; storage failure must propagate as failure.
  claimNonce: (claim: { platformId: string; nodeId: string; nonce: string; expiresAt: number }) => Promise<boolean>
}
function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw new ControllerConfigError(code)
}

export async function verifyControllerReadProof(proof: ControllerReadProof, trust: ControllerReadTrust): Promise<void> {
  check(proof && typeof proof === 'object' && !Array.isArray(proof) && Object.keys(proof).length === 5 &&
    ['platformId', 'nodeId', 'timestamp', 'nonce', 'signature'].every(key => Object.hasOwn(proof, key)), 'CONTROLLER_DISCOVERY_IDENTITY_INVALID')
  check(typeof trust.platformId === 'string' && typeof trust.nodeId === 'string' && typeof proof.platformId === 'string' && typeof proof.nodeId === 'string' &&
    UUID.test(trust.platformId) && UUID.test(trust.nodeId) && UUID.test(proof.platformId) && UUID.test(proof.nodeId) &&
    proof.platformId === trust.platformId && proof.nodeId === trust.nodeId, 'CONTROLLER_DISCOVERY_IDENTITY_INVALID')
  check(Number.isSafeInteger(trust.now) && trust.now > 0 && typeof proof.timestamp === 'string' && /^[1-9][0-9]{0,15}$/.test(proof.timestamp), 'CONTROLLER_DISCOVERY_TIMESTAMP_INVALID')
  const timestamp = Number(proof.timestamp)
  check(Number.isSafeInteger(timestamp) && String(timestamp) === proof.timestamp && Math.abs(timestamp - trust.now) <= WINDOW_MS, 'CONTROLLER_DISCOVERY_TIMESTAMP_INVALID')
  check(typeof proof.nonce === 'string' && /^[A-Za-z0-9_-]{32}$/.test(proof.nonce) &&
    Buffer.from(proof.nonce, 'base64url').length === 24 && Buffer.from(proof.nonce, 'base64url').toString('base64url') === proof.nonce, 'CONTROLLER_DISCOVERY_NONCE_INVALID')
  check(typeof trust.authority === 'string' && trust.authority.length <= 300 && /^[a-z0-9.[\]:-]+$/.test(trust.authority) &&
    !trust.authority.endsWith(':'), 'CONTROLLER_DISCOVERY_ENDPOINT_INVALID')
  check(typeof trust.nodePublicKey === 'string' && trust.nodePublicKey.length === 44 &&
    typeof proof.signature === 'string' && proof.signature.length === 88, 'CONTROLLER_DISCOVERY_IDENTITY_INVALID')
  const key = Buffer.from(trust.nodePublicKey, 'base64'), signature = Buffer.from(proof.signature, 'base64')
  check(key.length === 32 && key.toString('base64') === trust.nodePublicKey && signature.length === 64 && signature.toString('base64') === proof.signature, 'CONTROLLER_DISCOVERY_IDENTITY_INVALID')
  const publicKey = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, key]), format: 'der', type: 'spki' })
  const path = trust.path ?? PATH
  check(path === PATH || path === '/v1/management-channels', 'CONTROLLER_DISCOVERY_ENDPOINT_INVALID')
  const payload = PREFIX + ['GET', trust.authority, path, proof.platformId, proof.nodeId, proof.timestamp, proof.nonce].join('\n')
  check(verify(null, Buffer.from(payload), publicKey, signature), 'CONTROLLER_DISCOVERY_SIGNATURE_INVALID')
  check(typeof trust.claimNonce === 'function', 'CONTROLLER_DISCOVERY_NONCE_STORAGE_REQUIRED')
  check(await trust.claimNonce({ platformId: proof.platformId, nodeId: proof.nodeId, nonce: proof.nonce,
    expiresAt: timestamp + WINDOW_MS + 1 }), 'CONTROLLER_DISCOVERY_NONCE_REPLAY')
}
