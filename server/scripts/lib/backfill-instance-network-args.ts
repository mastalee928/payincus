/** Reject malformed filters before database access: an invalid host must never mean all hosts. */
export function parseBackfillInstanceNetworkArgs(argv: string[]): { dryRun: boolean; hostId: number | null } {
  let dryRun = false
  let hostId: number | null = null
  for (const arg of argv) {
    if (arg === '--dry-run' && !dryRun) {
      dryRun = true
    } else if (arg.startsWith('--host-id=') && hostId === null) {
      const value = arg.slice('--host-id='.length)
      const parsed = Number(value)
      if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(parsed) || parsed > 2147483647) {
        throw new Error('Invalid --host-id: expected a positive PostgreSQL integer')
      }
      hostId = parsed
    } else {
      throw new Error('Unknown or duplicate argument; use [--host-id=<positive integer>] [--dry-run]')
    }
  }
  return { dryRun, hostId }
}
