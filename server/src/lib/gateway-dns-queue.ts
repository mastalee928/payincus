export interface GatewayDnsQueueState {
  installed?: boolean; state?: string; step?: string; attempt?: number; actor?: number
  code?: string | null; retryAt?: number
}
export const GATEWAY_DNS_MAX_ATTEMPTS = 3
const transient = new Set(['GATEWAY_DNS_HOST_UNREACHABLE', 'SSH_CONNECT_FAILED', 'SSH_DISCONNECTED',
  'SSH_COMMAND_TIMEOUT', 'GATEWAY_DNS_HOST_BUSY', 'GATEWAY_DNS_SERVICE_BUSY', 'GATEWAY_DNS_INTERRUPTED'])
export function gatewayDnsRetry(code: string, attempt: number, now = Date.now()) {
  return transient.has(code) && attempt < GATEWAY_DNS_MAX_ATTEMPTS ? now + 5000 * 4 ** Math.max(0, attempt - 1) : null
}
// A backend restart loses the process-local active set, but retains these rows.
// Installation is idempotent and still checks the original host identity.
export function resumeGatewayDnsState(state: GatewayDnsQueueState, active: boolean, now = Date.now()): GatewayDnsQueueState {
  if (state.state !== 'running' || active) return state
  const retryAt = gatewayDnsRetry('GATEWAY_DNS_INTERRUPTED', state.attempt || 0, now)
  return { ...state, installed: false, state: retryAt === null ? 'failed' : 'queued',
    code: 'GATEWAY_DNS_INTERRUPTED', retryAt: retryAt ?? undefined }
}
