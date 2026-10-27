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
  error: string | null
}
export class PublicIpSyncError extends Error {
  constructor(public code: string) { super(code) }
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
    error: state.error || null }
}

export function validBindIp(value: string): boolean {
  if (!isIPv4(value)) return false
  const [a, b] = value.split('.').map(Number)
  return a !== 0 && a !== 127 && a < 224 && !(a === 169 && b === 254)
}

export function chooseBindAddress(addresses: string[], current: string | null, explicit: string | null): string {
  const candidates = [...new Set(addresses.filter(validBindIp))]
  if (explicit) {
    if (!candidates.includes(explicit)) throw new PublicIpSyncError('IP_BIND_NOT_LOCAL')
    return explicit
  }
  if (current && candidates.includes(current)) return current
  if (candidates.length !== 1) throw new PublicIpSyncError('IP_BIND_AMBIGUOUS')
  return candidates[0]!
}

/** Verify key exchange completion, not merely a banner or a claimed public key.
 * No password, private key, authentication attempt, or remote command is needed. */
export function verifyPublicSshIdentity(host: string, port: number, fingerprints: string[], timeoutMs = 8000): Promise<void> {
  if ((!isOnboardingPublicIPv4(host) && !publicIpv6(host)) || !fingerprints.length) return Promise.reject(new PublicIpSyncError('IP_IDENTITY_UNAVAILABLE'))
  return new Promise((resolve, reject) => {
    const client = new Client()
    let finished = false, matched = false
    const connectionError = (error: unknown) => new PublicIpSyncError(publicIpv6(host) &&
      ['ENETUNREACH', 'EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(String((error as { code?: unknown } | null)?.code || ''))
      ? 'IPV6_CONTROLLER_NO_ROUTE' : 'IP_SSH_UNREACHABLE')
    const finish = (error?: Error) => {
      if (finished) return
      finished = true; clearTimeout(timer); client.destroy()
      error ? reject(error) : resolve()
    }
    const timer = setTimeout(() => finish(new PublicIpSyncError('IP_SSH_UNREACHABLE')), timeoutMs)
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
