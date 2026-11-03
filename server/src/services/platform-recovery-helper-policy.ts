// Only local, documented error codes enter persisted/public recovery results.
// Remote stderr, paths and credentials are never used as user-facing messages.
const helperCodes = new Set([
  'SSH_CONNECT_FAILED', 'SSH_DISCONNECTED', 'SSH_COMMAND_TIMEOUT', 'SSH_COMMAND_FAILED',
  'SSH_AUTH_FAILED', 'SSH_HOST_KEY_CHANGED', 'SSH_IDENTITY_CHECK_FAILED',
  'GATEWAY_NOT_CONFIGURED', 'GATEWAY_RESPONSE_INVALID', 'GATEWAY_MANAGEMENT_KEY_MISSING',
  'GATEWAY_DNS_UPGRADE_TIMEOUT', 'GATEWAY_DNS_UPGRADE_FAILED', 'GATEWAY_DNS_UNSAFE_FILE',
  'GATEWAY_DNS_SERVICE_BUSY', 'GATEWAY_DNS_HOST_IDENTITY_CHANGED',
  'GATEWAY_DNS_LOCAL_HELPER_OUTDATED', 'GATEWAY_DNS_HELPER_UPGRADE_REQUIRED',
  'OSS_WORKER_STOPPED', 'OSS_WORKER_START_FAILED', 'OSS_TASK_BUSY',
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN',
])
export function recoveryHelperErrorCode(error: unknown) {
  const code = (error as { code?: unknown })?.code
  return typeof code === 'string' && helperCodes.has(code) ? code : 'OSS_RECOVERY_HELPER_FAILED'
}
export function recoveryHelperRetry(code: string, attempt: number) {
  const transient = ['SSH_CONNECT_FAILED', 'SSH_DISCONNECTED', 'SSH_COMMAND_TIMEOUT',
    'GATEWAY_DNS_UPGRADE_TIMEOUT', 'GATEWAY_DNS_SERVICE_BUSY', 'OSS_WORKER_STOPPED',
    'OSS_WORKER_START_FAILED', 'OSS_TASK_BUSY', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT',
    'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN'].includes(code)
  return { status: transient && attempt < 8 ? 'retry' as const : 'blocked' as const,
    delay: Math.min(1800000, 30000 * 2 ** Math.min(Math.max(attempt - 1, 0), 6)) }
}
