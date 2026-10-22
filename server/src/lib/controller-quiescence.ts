import { ControllerConfigError } from './controller-config.js'

export interface ControllerQuiescenceReport {
  // True means the observed work is quiescent, never a write lease. An
  // authenticated epoch-bound local receipt and witness are still required.
  canActivate: boolean
  activeOperationIds: string[]
  blockers: Array<'old-connections' | 'legacy-credentials' | 'ssh-processes' | 'local-jobs' | 'active-incus-operations'>
}
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
const statuses: Record<string, number> = { 'operation created': 100, pending: 105, running: 103, cancelling: 104, success: 200, failure: 400, cancelled: 401 }

// Read-only final gate, after actual host-side fencing. It never cancels an
// operation or infers success from an unreachable old controller. Callers must
// collect these facts locally on the host and authenticate the bound receipt.
export function inspectControllerQuiescence(operations: unknown, facts: {
  oldConnectionsBlocked: boolean; legacyCredentialsBlocked: boolean
  outstandingSshProcesses: number; outstandingLocalJobs: number
}): ControllerQuiescenceReport {
  const fail = (): never => { throw new ControllerConfigError('CONTROLLER_QUIESCENCE_INVALID') }
  if (!facts || typeof facts.oldConnectionsBlocked !== 'boolean' || typeof facts.legacyCredentialsBlocked !== 'boolean' ||
    !Number.isSafeInteger(facts.outstandingSshProcesses) || facts.outstandingSshProcesses < 0 ||
    !Number.isSafeInteger(facts.outstandingLocalJobs) || facts.outstandingLocalJobs < 0) fail()
  // The actual Incus recursion response is status -> operation[], not a flat
  // map of operations. Reject nonrecursive URLs and unknown/new shapes.
  if (!operations || typeof operations !== 'object' || Array.isArray(operations)) fail()
  const groups = Object.entries(operations as Record<string, unknown>)
  if (groups.length > Object.keys(statuses).length) fail()
  const seen = new Set<string>(), activeOperationIds: string[] = []
  let count = 0
  for (const [group, entries] of groups) {
    if (!Object.hasOwn(statuses, group) || !Array.isArray(entries)) fail()
    const operationList = entries as unknown[]
    count += operationList.length
    if (count > 1024) fail()
    for (const value of operationList) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
      const op = value as Record<string, unknown>
      if (typeof op.id !== 'string' || !UUID.test(op.id) || seen.has(op.id) || typeof op.status !== 'string' ||
        op.status.toLowerCase() !== group || op.status_code !== statuses[group]) fail()
      const id = op.id as string
      seen.add(id)
      // Any active operation blocks activation, including unknown resources,
      // uncancellable operations, imports and already accepted exec tasks.
      if (statuses[group] < 200) activeOperationIds.push(id)
    }
  }
  activeOperationIds.sort()
  const blockers: ControllerQuiescenceReport['blockers'] = []
  if (!facts.oldConnectionsBlocked) blockers.push('old-connections')
  if (!facts.legacyCredentialsBlocked) blockers.push('legacy-credentials')
  if (facts.outstandingSshProcesses) blockers.push('ssh-processes')
  if (facts.outstandingLocalJobs) blockers.push('local-jobs')
  if (activeOperationIds.length) blockers.push('active-incus-operations')
  return { canActivate: blockers.length === 0, activeOperationIds, blockers }
}
