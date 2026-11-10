/** Only operations with original identity/remote journal replay guards may
 * resume automatically. Unknown installer errors must not rerun an installer. */
export const ONBOARDING_RETRY_CODES = [
  'SSH_CONNECT_FAILED', 'SSH_DISCONNECTED', 'SSH_COMMAND_TIMEOUT',
  'HOST_DEPENDENCIES_PENDING', 'HOST_TIME_SYNC_PENDING', 'HOST_BBR_PENDING', 'HOST_SWAP_PENDING',
  'INSTALL_DOWNLOAD_FAILED', 'INSTALL_DEPENDENCIES_PENDING', 'INSTALL_BUSY', 'MANAGEMENT_UNREACHABLE', 'AGENT_NOT_READY'
] as const
export function onboardingRetryDelay(attempt: number): number {
  return Math.min(300000, 15000 * 2 ** Math.min(Math.max(attempt - 1, 0), 5))
}
export function canAutomaticallyResumeOnboarding(node: {
  errorCode?: string | null; credentialsEncrypted: string | null; credentialsExpireAt: Date;
  deletedAt: Date | null; status: string
}, code: string): boolean {
  return !node.deletedAt && node.status === 'running' && Boolean(node.credentialsEncrypted) &&
    node.credentialsExpireAt > new Date() && (ONBOARDING_RETRY_CODES as readonly string[]).includes(code)
}
