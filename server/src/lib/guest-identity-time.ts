/** RFC3339 normalization keeps nanoseconds: it never rounds away identity. */
export function guestIdentityInstant(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/.exec(value)
  if (!match) return null
  const wall=Date.parse(match[1]+'Z')
  if(!Number.isFinite(wall)||new Date(wall).toISOString().slice(0,19)!==match[1])return null
  if(match[3]!=='Z'&&(Number(match[3].slice(1,3))>23||Number(match[3].slice(4,6))>59))return null
  const seconds = Date.parse(match[1] + match[3])
  if (!Number.isFinite(seconds)) return null
  return `${seconds}:${(match[2] || '').padEnd(9, '0')}`
}
export function sameGuestCreationTime(left: unknown, right: unknown): boolean {
  const parsed = guestIdentityInstant(left)
  return parsed !== null && parsed === guestIdentityInstant(right)
}
