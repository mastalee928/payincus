import { IncusApiError } from '../lib/incus/incus-client.js'

export interface AutomaticResumeAttempt { sourceHash:string; attempt:number; nextAt:string; status:string }
export function automaticResumeDecision(previous:AutomaticResumeAttempt|null, sourceHash:string, now:number) {
  const same=previous?.sourceHash===sourceHash
  if(previous && Date.parse(previous.nextAt)>now)return null
  if(same && previous.status==='blocked')return null
  return same ? Math.min(previous.attempt+1,1000000) : 1
}

export function automaticResumeRetry(code:string,attempt:number) {
  if (code === 'OSS_RECOVERY_FINAL_HOST_CHECK_PENDING') return {status:'retry' as const,delayMs:15000}
  const transient=['OSS_WORKER_START_FAILED','OSS_WORKER_STOPPED','OSS_TASK_BUSY','OSS_BACKEND_SERVICE_FAILED',
    'OSS_PROTECTED_START_FAILED','OSS_BACKEND_HEALTH_FAILED','OSS_HEALTH_FAILED','OSS_BACKEND_NOT_READY','OSS_RECOVERY_AGENT_HEARTBEAT_PENDING',
    'OSS_DATABASE_UNAVAILABLE','OSS_DATABASE_ADMIN_TIMEOUT','OSS_DATABASE_BUSY','OSS_DATABASE_STORAGE_FULL',
    'ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENOSPC','EIO','57P01','57P02','57P03','53300','08006'].includes(code)
  return {status:transient?'retry' as const:'blocked' as const,
    delayMs:Math.min(1800000,60000*2**Math.min(Math.max(attempt-1,0),5))}
}

// Retry decisions use allowlisted failure codes, never arbitrary remote error text.
// Observation reads the original pinned machine; it does not repair trust or guests.
export type RecoveryHostFailure = { managementVerified: boolean; code?: string | null; inventory?: { inventoryMatched: boolean } }
export function recoveryHostPolicy(result: RecoveryHostFailure, attempts: number, sourceChanged = false) {
  const passed = !sourceChanged && result.managementVerified && result.inventory?.inventoryMatched === true
  if (passed) return { status: 'success' as const, mode: 'verified', nextAction: 'refresh-verification', delayMs: 12 * 3600000 }
  const transient = sourceChanged || ['OSS_REVIEW_HOST_UNREACHABLE', 'OSS_REVIEW_RESOURCE_BUSY',
    'OSS_RECOVERY_DELIVERY_SSH_PENDING','OSS_RECOVERY_DELIVERY_UNVERIFIED',
    'OSS_RECOVERY_GUEST_ADDRESSES_MISSING','OSS_RECOVERY_IPV6_NETWORK_PENDING',
    'OSS_RECOVERY_EVIDENCE_STALE', 'OSS_REVIEW_TRANSPORT_TIMEOUT'].includes(result.code || '')
  if (!transient) return { status: 'blocked' as const, mode: 'condition', nextAction: 'observe-original-condition', delayMs: 1800000 }
  return { status: 'retry' as const, mode: attempts >= 8 ? 'observing' : 'retrying', nextAction: 'probe-original-host',
    delayMs: Math.min(1800000, 30000 * 2 ** Math.min(Math.max(0, attempts - 1), 6)) }
}

export function recoveryHostErrorCode(error: unknown): string {
  // Incus and fetch wrap transport errors. Inspect only fixed codes in a bounded
  // cause chain; never classify a private/free-form message as an identity.
  const seen = new Set<unknown>()
  for (let current = error, depth = 0; current && depth < 5 && !seen.has(current); depth++) {
    seen.add(current)
    const code = recoveryErrorCode(current)
    if (code) return code
    current = (current as {cause?: unknown}).cause
  }
  return 'OSS_REVIEW_UNEXPECTED_FAILURE'
}
function recoveryErrorCode(error: unknown): string | undefined {
  if(error instanceof IncusApiError) {
    if([408,429,502,503,504].includes(error.statusCode))return 'OSS_REVIEW_HOST_UNREACHABLE'
    if([401,403].includes(error.statusCode))return 'OSS_REVIEW_INCUS_AUTH_FAILED'
  }
  const code = String((error as { code?: unknown })?.code || '')
  if(code==='INCUS_FILE_TOO_LARGE')return code
  if (/^OSS_(REVIEW|RECOVERY)_[A-Z_]{1,80}$/.test(code)) return code
  if (['SSH_HOST_KEY_CHANGED', 'SSH_IDENTITY_CHECK_FAILED', 'GATEWAY_DNS_HOST_IDENTITY_CHANGED',
    'INCUS_CERTIFICATE_MISMATCH', 'INCUS_FINGERPRINT_MISMATCH', 'ERR_TLS_CERT_ALTNAME_INVALID',
    'DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(code)) return 'OSS_REVIEW_IDENTITY_CHANGED'
  if(code==='CERT_HAS_EXPIRED')return 'OSS_REVIEW_CERTIFICATE_EXPIRED'
  if (['SSH_AUTH_FAILED','GATEWAY_DNS_MANAGEMENT_AUTH_REQUIRED'].includes(code)) return 'OSS_REVIEW_SSH_AUTH_FAILED'
  if (code === 'GATEWAY_NOT_CONFIGURED') return 'OSS_REVIEW_GATEWAY_NOT_CONFIGURED'
  if (code === 'GATEWAY_RECOVERY_BINDING_MISSING') return 'OSS_REVIEW_MANAGEMENT_REQUIRED'
  if (code === 'GATEWAY_RECOVERY_ROUTE_MISMATCH') return 'OSS_REVIEW_GATEWAY_ROUTE_MISMATCH'
  if (code === 'GATEWAY_RECOVERY_SAVED_ROUTE_MISSING') return 'OSS_RECOVERY_GATEWAY_SAVED_ROUTE_MISSING'
  if (code === 'GATEWAY_RECOVERY_REPAIR_CHANGED' || code === 'GATEWAY_RECOVERY_REPAIR_EXPIRED') return 'OSS_RECOVERY_EVIDENCE_STALE'
  if (code === 'GATEWAY_RECOVERY_ADDRESS_CONFLICT') return 'OSS_RECOVERY_GATEWAY_ADDRESS_CONFLICT'
  if (code === 'GATEWAY_RECOVERY_UNKNOWN_PEER') return 'OSS_RECOVERY_GATEWAY_ADDRESS_CONFLICT'
  if (code === 'GATEWAY_RECOVERY_BUSY') return 'OSS_REVIEW_RESOURCE_BUSY'
  if (code === 'GATEWAY_RECOVERY_RUNTIME_UNAVAILABLE') return 'OSS_REVIEW_HOST_UNREACHABLE'
  if (['GATEWAY_RESPONSE_INVALID', 'GATEWAY_MANAGEMENT_KEY_MISSING', 'SSH_COMMAND_FAILED'].includes(code)) return 'OSS_REVIEW_GATEWAY_PROTOCOL_FAILED'
  if (['SSH_COMMAND_TIMEOUT', 'ETIMEDOUT', 'ECONNABORTED','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT','UND_ERR_ABORTED','UND_ERR_DESTROYED'].includes(code)) return 'OSS_REVIEW_TRANSPORT_TIMEOUT'
  if (['SSH_CONNECT_FAILED', 'SSH_DISCONNECTED', 'GATEWAY_DNS_HOST_UNREACHABLE', 'GATEWAY_RECOVERY_HOST_UNREACHABLE',
    'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN','UND_ERR_SOCKET'].includes(code)) return 'OSS_REVIEW_HOST_UNREACHABLE'
  return undefined
}
