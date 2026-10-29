// Incus shared/units.ParseByteSizeString accepts integer quantities with these
// case-sensitive suffixes. Keep its signed 64-bit byte limit without JS rounding.
const multipliers: Readonly<Record<string, bigint>> = {
  '': 1n, B: 1n, ' bytes': 1n,
  kB: 1000n, MB: 1000n ** 2n, GB: 1000n ** 3n, TB: 1000n ** 4n, PB: 1000n ** 5n, EB: 1000n ** 6n,
  KiB: 1024n, MiB: 1024n ** 2n, GiB: 1024n ** 3n, TiB: 1024n ** 4n, PiB: 1024n ** 5n, EiB: 1024n ** 6n,
}

export function normalizeStorageSize(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null
  const text = value.trim()
  const match = /^(\d+)(B| bytes|kB|MB|GB|TB|PB|EB|KiB|MiB|GiB|TiB|PiB|EiB)?$/.exec(text)
  if (!match) return null
  const amount = BigInt(match[1]), multiplier = multipliers[match[2] ?? '']
  if (amount < 1n || amount * multiplier > 9223372036854775807n) return null
  return text
}
