/** An accepted remote operation survives backend/network timeouts. Wait for
 * its next verified state; never repeat a destructive request to discover it. */
export function lifecycleOperationPending(groups: unknown, name: string): boolean {
  const path = `/1.0/instances/${encodeURIComponent(name)}`
  const touches = (value: unknown): boolean => {
    if (typeof value === 'string') {
      try { const resource = new URL(value, 'https://incus.invalid').pathname; return resource === path || resource.startsWith(path + '/') }
      catch { return true }
    }
    if (Array.isArray(value)) return value.some(touches)
    if (value && typeof value === 'object') return Object.values(value).some(touches)
    return true
  }
  if (!groups || typeof groups !== 'object' || Array.isArray(groups)) return true
  return Object.values(groups).some(group => !Array.isArray(group) || group.some(operation => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return true
    const row = operation as { status?: string; resources?: unknown }
    if (['Success', 'Failure', 'Cancelled', 'Canceled'].includes(row.status || '')) return false
    return !row.resources || typeof row.resources !== 'object' || !Object.keys(row.resources).length || touches(row.resources)
  }))
}
