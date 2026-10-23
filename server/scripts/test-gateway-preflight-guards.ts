import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { GatewayTaskError } from '../src/lib/gateway-task-plan.js'
import { parseGatewayPreflightReport, validateGatewayPreflightRequest } from '../src/services/gateway-preflight.js'
const request = { schemaVersion: 1, platformId: randomUUID(), gatewayId: randomUUID(), slot: 'a', expectedMachineId: null,
  network: '10.249.80.0/24', address: '10.249.80.1', listenPort: 51980, consolePort: 18480 }
assert.deepEqual(validateGatewayPreflightRequest(request), request)
for (const changed of [{ password: 'unusable-test-value' }, { slot: 'c' }, { network: '8.8.8.0/24' },
  { network: '10.249.80.1/24' }, { address: '10.249.80.0' }, { address: '10.249.80.255' },
  { address: '010.249.80.1' }, { listenPort: true }, { consolePort: 51980 }, { expectedMachineId: '0'.repeat(32) }]) {
  assert.throws(() => validateGatewayPreflightRequest({ ...request, ...changed }), GatewayTaskError)
}
const report = { schemaVersion: 1, machineId: 'a'.repeat(32), osId: 'debian', architecture: 'arm64',
  memoryMiB: 1024, diskAvailableMiB: 2048, tools: { wg: true, ip: true, ss: true, systemctl: true, node: true, python3: true },
  facts: { interface: { exists: false, owned: false, addressMatches: false }, routeConflicts: [], portConflicts: [], services: {} },
  blockers: ['GATEWAY_INSPECTION_INCOMPLETE'], observedStateHash: 'b'.repeat(64), inspectedAt: Date.now() }
assert.deepEqual(parseGatewayPreflightReport(JSON.stringify(report)), report)
for (const changed of [{ password: 'unusable-test-value' }, { machineId: '0'.repeat(32) }, { tools: {} },
  { facts: { ...report.facts, services: null } }, { blockers: ['unexpected output'] },
  { inspectedAt: Date.now() - 61000 }, { observedStateHash: 'wrong' }]) {
  assert.throws(() => parseGatewayPreflightReport(JSON.stringify({ ...report, ...changed })), GatewayTaskError)
}
// CI invokes preflight/SSH guards without database configuration. Exercise a
// fresh module graph so the root suite's placeholder cannot hide an eager DB import.
const isolatedEnv = { ...process.env }
delete isolatedEnv.DATABASE_URL
isolatedEnv.ENV_FILE = new URL('./missing-preflight-guard.env', import.meta.url).pathname
const isolated = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
  `const { validateGatewayPreflightRequest } = await import(${JSON.stringify(new URL('../src/services/gateway-preflight.ts', import.meta.url).href)}); validateGatewayPreflightRequest(${JSON.stringify(request)});`],
{ env: isolatedEnv, encoding: 'utf8', timeout: 15000 })
assert.equal(isolated.status, 0, `standalone preflight must load without DATABASE_URL: ${isolated.stderr || isolated.error?.message}`)
console.log('Gateway preflight request/report identity, conflicts, strict fields and no-secret guards passed')
