import { isIPv4 } from 'node:net'
import { createHash } from 'node:crypto'
import { Client } from 'ssh2'
import { isOnboardingPublicIPv4 } from './host-onboarding.js'
import { publicIpv6 } from './host-public-ipv6.js'

export type PublicIpSettings = { mode: 'auto' | 'manual'; publicIp: string | null; bindIp: string | null; sshPort: number }
export type PublicIpSyncState = {
  settings: PublicIpSettings
  status: 'idle' | 'synced' | 'pending' | 'failed'
  candidateIp: string | null
  candidateBindIp: string | null
  bindAddresses: string[]
  checkedAt: string | null
  changedAt: string | null
  previousIp: string | null
  observedIp: string | null
  managementCheckedAt: string | null
  verifiedAt: string | null
  nextCheckAt: string | null
  retryAttempts: number
  error: string | null
}
export class PublicIpSyncError extends Error {
  constructor(public code: string) { super(code) }
}

/** Preserve identity failures even when a transport wraps them as socket errors. */
export function publicIpFailureCode(error: unknown): string {
  const errors: Array<{ code?: unknown; name?: unknown; message?: unknown; statusCode?: unknown; cause?: unknown }> = []
  const seen = new Set<unknown>()
  for (let current = error; current && typeof current === 'object' && !seen.has(current) && errors.length < 8;) {
    seen.add(current)
    const entry = current as typeof errors[number]
    errors.push(entry); current = entry.cause
  }
  if (errors.some(entry => ['INCUS_CERTIFICATE_MISMATCH', 'INCUS_FINGERPRINT_MISMATCH', 'IP_IDENTITY_MISMATCH'].includes(String(entry.code)))) return 'IP_IDENTITY_MISMATCH'
  // Expiry/trust failures are not evidence that the registered identity changed.
  if (errors.some(entry => ['CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'ERR_TLS_CERT_ALTNAME_INVALID', 'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(String(entry.code)) ||
    [401, 403].includes(Number(entry.statusCode)))) return 'IP_CHECK_FAILED'
  const syncError = errors.find(entry => entry instanceof PublicIpSyncError)
  if (syncError) return String(syncError.code)
  if (errors.some(entry => ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE',
    'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
    'UND_ERR_ABORTED', 'ABORT_ERR'].includes(String(entry.code)) || entry.name === 'TimeoutError' ||
    /^Incus request timeout \(\d+ ms\)$/.test(String(entry.message)) || [502, 503, 504].includes(Number(entry.statusCode)))) return 'IP_MANAGEMENT_OFFLINE'
  return 'IP_CHECK_FAILED'
}

/** Persistent bounded polling, without a tight retry loop or automatic identity changes. */
export function publicIpRetryPolicy(code: string, attempts: number): { status: 'pending' | 'failed'; delayMs: number } {
  const waiting = ['IP_INSTANCE_BUSY', 'IP_INSTANCE_STOPPED', 'IP_PROTOCOL_PENDING', 'IP_HOST_QUARANTINED', 'IP_INSTANCE_NOT_READY', 'IP_SYNC_BUSY'].includes(code)
  const transient = ['IP_GATEWAY_UNAVAILABLE', 'IP_PUBLIC_UNDETECTED', 'IP_MANAGEMENT_OFFLINE', 'IP_SSH_UNREACHABLE', 'IP_SYNC_DEADLINE'].includes(code)
  const exponent = Math.max(0, Math.min(Number.isSafeInteger(attempts) ? attempts - 1 : 0, 5))
  return { status: waiting || transient ? 'pending' : 'failed',
    delayMs: waiting ? 60000 : Math.min(transient ? 300000 : 1800000, 60000 * 2 ** exponent) }
}

export function publicIpSettings(value: unknown): PublicIpSettings {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const mode = input.mode ?? 'auto'
  const publicIp = input.publicIp || null
  const bindIp = input.bindIp || null
  const sshPort = input.sshPort ?? 22
  if (!['auto', 'manual'].includes(String(mode)) ||
      (mode === 'manual' && !isOnboardingPublicIPv4(publicIp)) ||
      (bindIp !== null && (typeof bindIp !== 'string' || !validBindIp(bindIp))) ||
      !Number.isInteger(sshPort) || Number(sshPort) < 1 || Number(sshPort) > 65535) throw new PublicIpSyncError('IP_SETTINGS_INVALID')
  return { mode: mode as PublicIpSettings['mode'], publicIp: mode === 'manual' ? publicIp as string : null,
    bindIp: bindIp as string | null, sshPort: Number(sshPort) }
}

export function publicIpState(value: unknown): PublicIpSyncState {
  const state = (value && typeof value === 'object' ? value : {}) as Partial<PublicIpSyncState>
  return { settings: publicIpSettings(state.settings), status: state.status || 'idle',
    candidateIp: state.candidateIp || null, candidateBindIp: state.candidateBindIp || null,
    bindAddresses: Array.isArray(state.bindAddresses) ? state.bindAddresses : [],
    checkedAt: state.checkedAt || null, changedAt: state.changedAt || null, previousIp: state.previousIp || null,
    observedIp: isOnboardingPublicIPv4(state.observedIp) ? state.observedIp! : null,
    managementCheckedAt: state.managementCheckedAt || null, verifiedAt: state.verifiedAt || null,
    nextCheckAt: state.nextCheckAt || null,
    retryAttempts: Number.isSafeInteger(state.retryAttempts) && state.retryAttempts! > 0 ? Math.min(state.retryAttempts!, 1000000) : 0,
    error: state.error || null }
}

/** An authenticated host observation is an address, not proof of public ingress. */
export function observedPublicIp(value: unknown): string | null { return publicIpState(value).observedIp }

export function validBindIp(value: string): boolean {
  if (!isIPv4(value)) return false
  const [a, b] = value.split('.').map(Number)
  return a !== 0 && a !== 127 && a < 224 && !(a === 169 && b === 254)
}

export function chooseBindAddress(addresses: string[], current: string | null, explicit: string | null, publicIp?: string): string {
  const candidates = [...new Set(addresses.filter(validBindIp))]
  if (explicit) {
    if (!candidates.includes(explicit)) throw new PublicIpSyncError('IP_BIND_NOT_LOCAL')
    return explicit
  }
  // A directly assigned public address is stronger evidence than the old bind.
  // Private SNAT mappings still require the existing/unique local binding.
  if (publicIp && candidates.includes(publicIp)) return publicIp
  if (current && candidates.includes(current)) return current
  if (candidates.length !== 1) throw new PublicIpSyncError('IP_BIND_AMBIGUOUS')
  return candidates[0]!
}

/** Verify key exchange completion, not merely a banner or a claimed public key.
 * No password, private key, authentication attempt, or remote command is needed. */
export function verifyPublicSshIdentity(host: string, port: number, fingerprints: string[], timeoutMs = 8000, signal?: AbortSignal): Promise<void> {
  if ((!isOnboardingPublicIPv4(host) && !publicIpv6(host)) || !fingerprints.length) return Promise.reject(new PublicIpSyncError('IP_IDENTITY_UNAVAILABLE'))
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new PublicIpSyncError('IP_SYNC_DEADLINE')); return }
    const client = new Client()
    let finished = false, matched = false
    const connectionError = (error: unknown) => new PublicIpSyncError(publicIpv6(host) &&
      ['ENETUNREACH', 'EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(String((error as { code?: unknown } | null)?.code || ''))
      ? 'IPV6_CONTROLLER_NO_ROUTE' : 'IP_SSH_UNREACHABLE')
    const finish = (error?: Error) => {
      if (finished) return
      finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); client.destroy()
      error ? reject(error) : resolve()
    }
    const timer = setTimeout(() => finish(new PublicIpSyncError('IP_SSH_UNREACHABLE')), timeoutMs)
    const abort = () => finish(new PublicIpSyncError('IP_SYNC_DEADLINE'))
    signal?.addEventListener('abort', abort, { once: true })
    client.on('error', (error: Error) => finish(connectionError(error)))
    client.once('close', () => finish(new PublicIpSyncError('IP_SSH_UNREACHABLE')))
    client.once('handshake', () => finish(matched ? undefined : new PublicIpSyncError('IP_IDENTITY_MISMATCH')))
    try {
      client.connect({ host, port, username: 'root', readyTimeout: timeoutMs,
        authHandler: () => false,
        hostVerifier: (key: Buffer) => {
          const fingerprint = 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
          matched = fingerprints.includes(fingerprint)
          if (!matched) finish(new PublicIpSyncError('IP_IDENTITY_MISMATCH'))
          return matched
        }
      })
    } catch (error) { finish(connectionError(error)) }
  })
}
