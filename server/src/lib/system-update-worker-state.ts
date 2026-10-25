// A oneshot unit remains activating while the root helper verifies the sealed
// installation. That work can exceed the API's short observation window.
export function systemUpdateUnitStillStarting(props: Record<string, string>): boolean | null {
  if (['active', 'activating', 'reloading'].includes(props.ActiveState)) return true
  const job = /^(\d+)(?:\s|$)/.exec(props.Job || '')
  if (job && Number(job[1]) > 0) return true
  if (props.LoadState === 'not-found') return false
  if (['inactive', 'failed', 'deactivating'].includes(props.ActiveState)) return false
  // Failure to observe a unit is not evidence that the worker stopped.
  return null
}
