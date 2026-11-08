const pad = (value: number) => String(value).padStart(2, '0')
export function expiryLocalInput(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime()) || date.getFullYear() < 2000 || date.getFullYear() > 9999) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
export function expiryUtcInput(value: string): string | null {
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? value + ':00' : value
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized)) return null
  const date = new Date(normalized)
  // Bound the UTC value too: offsets can cross a supported year boundary.
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 9999 || expiryLocalInput(date.toISOString()) !== normalized) return null
  // A datetime-local field cannot distinguish the two occurrences of a clock
  // time during a backward offset transition. Never silently pick the first.
  const later = new Date(date.getTime() + 86400000)
  const overlap = later.getTimezoneOffset() - date.getTimezoneOffset()
  if (overlap > 0 && expiryLocalInput(new Date(date.getTime() + overlap * 60000).toISOString()) === normalized) return null
  return date.toISOString()
}
