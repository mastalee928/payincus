type Node = { id: string; status: string; step: string; deletedAt: Date | null; leaseToken?: string | null; leaseUntil?: Date | null }
/** Scheduling ownership is not remote authority. Every remote action still
 * checks the current lease, administrator, policy and original host identity. */
export function onboardingOwnsHardening(node: Node | null | undefined): boolean {
  return Boolean(node && !node.deletedAt && node.step === 'hardening' && ['queued', 'running'].includes(node.status))
}
export function ownsOnboardingHardeningLease(node: Node | null | undefined, lease: { nodeId: string; leaseToken: string }): boolean {
  return Boolean(onboardingOwnsHardening(node) && node!.id === lease.nodeId && node!.status === 'running' &&
    node!.leaseToken === lease.leaseToken && node!.leaseUntil && node!.leaseUntil > new Date())
}
