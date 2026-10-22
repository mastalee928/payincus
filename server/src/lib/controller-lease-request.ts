import { createHash, sign, type KeyObject } from 'node:crypto'
import { ControllerConfigError } from './controller-config.js'
import type { ControllerLeasePermission } from './controller-write-lease.js'

export interface ControllerLeaseRequest {
  leaseSha256: string; permission: ControllerLeasePermission; bodySha256: string
  timestamp: string; nonce: string; signature: string
}
// Caller sends these proofs only to the authenticated host endpoint. Exact
// body bytes, lease hash and scope are signed; no bearer-only write requests.
export function signControllerLeaseRequest(lease: string, permission: ControllerLeasePermission, body: Uint8Array,
  now: number, nonce: string, holderKey: KeyObject): ControllerLeaseRequest {
  if (typeof lease !== 'string' || Buffer.byteLength(lease) > 4096 || body.byteLength > 65536 ||
    !['inspect', 'instance-power', 'management-channel'].includes(permission) || !Number.isSafeInteger(now) || now <= 0 ||
    !/^[A-Za-z0-9_-]{32}$/.test(nonce) || Buffer.from(nonce, 'base64url').toString('base64url') !== nonce ||
    holderKey.type !== 'private' || holderKey.asymmetricKeyType !== 'ed25519') throw new ControllerConfigError('CONTROLLER_LEASE_REQUEST_INVALID')
  const leaseSha256 = createHash('sha256').update(lease).digest('hex'), bodySha256 = createHash('sha256').update(body).digest('hex')
  const timestamp = String(now)
  const message = 'payincus/controller-lease-request/v1\n' + [leaseSha256, permission, bodySha256, timestamp, nonce].join('\n')
  return { leaseSha256, permission, bodySha256, timestamp, nonce, signature: sign(null, Buffer.from(message), holderKey).toString('base64') }
}
