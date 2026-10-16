type Version = { core: string[]; prerelease: string[] }
const versionPattern = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const numeric = /^\d+$/

function parseVersion(value: string): Version | null {
  if (value.length > 128) return null
  const match = versionPattern.exec(value)
  if (!match) return null
  const prerelease = match[4]?.split('.') ?? []
  if (prerelease.some(part => numeric.test(part) && part.length > 1 && part[0] === '0')) return null
  return { core: [match[1]!, match[2]!, match[3]!], prerelease }
}

function compareNumeric(a: string, b: string): number {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1
  return a === b ? 0 : a < b ? -1 : 1
}

/** SemVer precedence; build metadata does not make an installed version older. */
export function compareAgentVersions(a: string, b: string): number | null {
  const left = parseVersion(a), right = parseVersion(b)
  if (!left || !right) return null
  for (let i = 0; i < 3; i++) {
    const compared = compareNumeric(left.core[i]!, right.core[i]!)
    if (compared) return compared
  }
  if (!left.prerelease.length || !right.prerelease.length) {
    return left.prerelease.length ? -1 : right.prerelease.length ? 1 : 0
  }
  for (let i = 0; i < Math.max(left.prerelease.length, right.prerelease.length); i++) {
    const x = left.prerelease[i], y = right.prerelease[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const xn = numeric.test(x), yn = numeric.test(y)
    return xn && yn ? compareNumeric(x, y) : xn !== yn ? xn ? -1 : 1 : x < y ? -1 : 1
  }
  return 0
}

export function shouldUpgradeAgent(current: string | null, target: string | null): boolean {
  if (!target || current === target) return false
  // Preserve bootstrapping from legacy/dev versions, but never downgrade a
  // recognised installed release to an older manifest from a panel or cache.
  const compared = current ? compareAgentVersions(current, target) : null
  return compared === null || compared < 0
}
