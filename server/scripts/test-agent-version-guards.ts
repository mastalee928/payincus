import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compareAgentVersions, shouldUpgradeAgent } from '../src/lib/agent-version.js'

for (const [current, target, needed] of [
  ['v1.0.3-ipv6.1', 'v1.0.2', false],
  ['v1.0.3-ipv6.1', 'v1.0.3', true],
  ['v1.0.3', 'v1.0.3-ipv6.2', false],
  ['v1.0.9', 'v1.0.10', true],
  ['v2.0.0', 'v1.99.99', false],
  ['1.0.3', 'v1.0.3', false],
  ['v1.0.3+build.1', 'v1.0.3+build.2', false],
  ['v1.0.3-alpha.9', 'v1.0.3-alpha.10', true],
  ['v1.0.3-alpha.1', 'v1.0.3-alpha.beta', true],
  ['v1.0.3-beta', 'v1.0.3-beta.1', true],
  ['v1.0.3-rc.1', 'v1.0.3-beta.11', false],
  ['v9007199254740993.0.0', 'v9007199254740992.0.0', false],
  ['dev', 'v1.0.3', true],
  ['dev', 'dev', false],
  [null, 'v1.0.3', true],
  ['v1.0.3', null, false]
] as const) {
  assert.equal(shouldUpgradeAgent(current, target), needed, `${current} -> ${target}`)
}
assert.equal(compareAgentVersions('v1.0.3-alpha.01', 'v1.0.3'), null)
assert.equal(compareAgentVersions('v01.0.3', 'v1.0.3'), null)
const route = readFileSync(new URL('../src/routes/agent.ts', import.meta.url), 'utf8')
assert.ok(route.includes('if (!shouldUpgradeAgent(currentVersion, manifestVersion))'), 'heartbeats must not issue downgrade instructions')
assert.ok(route.includes("return shouldUpgradeAgent(agentVersion, latestVersion) ? 'outdated' : 'latest'"), 'the upgrade button must agree with automatic upgrade eligibility')
console.log('Agent version and downgrade guard tests passed')
