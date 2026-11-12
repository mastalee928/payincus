export type PatrolStep = 'management' | 'accepted-deletions' | 'replacement-sources' | 'pool-cleanup'

/** Existing queues retain current identity, authority and retry gates. A failed
 * scan cannot skip an unrelated accepted lifecycle job in the same patrol. */
export async function runRepairPatrol(operations: {
  held: () => boolean
  management: () => Promise<void>
  deletions: () => Promise<void>
  replacements: () => Promise<void>
  cleanup: () => Promise<void>
  failed: (step: PatrolStep) => void
}, phase: 'before-billing' | 'after-billing') {
  const steps: Array<[PatrolStep, () => Promise<void>]> = phase === 'before-billing'
    ? [['management', operations.management], ['accepted-deletions', operations.deletions], ['replacement-sources', operations.replacements]]
    : [['pool-cleanup', operations.cleanup]]
  for (const [name, action] of steps) {
    if (operations.held()) return
    try { await action() } catch { operations.failed(name) }
  }
}
