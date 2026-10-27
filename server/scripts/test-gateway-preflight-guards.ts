import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { GatewayTaskError, gatewayExecutorFailureCode } from '../src/lib/gateway-task-plan.js'
assert.equal(gatewayExecutorFailureCode('{"code":"GATEWAY_INSTALL_TRANSPORT_MISMATCH","canWrite":false}', 'fallback'), 'GATEWAY_INSTALL_TRANSPORT_MISMATCH')
for (const raw of ['null', '[]', '{"code":"password is private","canWrite":false}',
  '{"code":"GATEWAY_INSTALL_TIMEOUT","canWrite":true}', '{"code":"GATEWAY_INSTALL_TIMEOUT","canWrite":false,"password":"private"}', 'x'.repeat(16385)]) {
  assert.equal(gatewayExecutorFailureCode(raw,'fallback'),'fallback')
}
import { parseGatewayPreflightReport, validateGatewayPreflightRequest } from '../src/services/gateway-preflight.js'
import { parseRemoteGatewayPreparation, planRemoteGatewayConfiguration, remoteGatewayInspectionId, remoteGatewayNetworksOverlap } from '../src/lib/remote-gateway-setup.js'
const preparation = { requestId: randomUUID(), gatewayId: randomUUID(), actorId: 1, name: 'Gateway check', purpose: 'backup',
  address: '8.8.4.4', hostname: 'gateway.example.com', state: 'failed', step: 'validate-domain', code: 'GATEWAY_DNS_LOOKUP_FAILED', updatedAt: new Date().toISOString() }
assert.deepEqual(parseRemoteGatewayPreparation(JSON.stringify(preparation)), preparation)
assert.deepEqual(parseRemoteGatewayPreparation(JSON.stringify({ ...preparation, password: 'never-public', token: 'never-public' })), preparation)
for (const patch of [{ name: 'a\npassword' }, { address: 'https://user:password@example.com' }, { hostname: '8.8.4.4' },
  { actorId: 0 }, { updatedAt: 'yesterday' }, { code: 'stderr contains credentials' }, { state: 'unexpected' }]) {
  assert.equal(parseRemoteGatewayPreparation(JSON.stringify({ ...preparation, ...patch })), null)
}
for (const raw of ['null', '[]', 'invalid', JSON.stringify({ state: 'failed', password: 'never-public' }), 'x'.repeat(4097)]) {
  assert.equal(parseRemoteGatewayPreparation(raw), null)
}
const independent = planRemoteGatewayConfiguration('independent', '8.8.4.4', [])
const standby = planRemoteGatewayConfiguration('backup', 'gateway.example.com', [independent.network])
assert.equal(independent.network, '10.252.0.0/20'); assert.equal(standby.network, '10.252.16.0/20')
assert.equal(standby.consoleOrigin, 'https://gateway.example.com:18443')
const movedPorts = planRemoteGatewayConfiguration('backup','gateway.example.com',[],[{protocol:'udp',port:51820},{protocol:'tcp',port:18443}])
assert.equal(movedPorts.listenPort,51821); assert.equal(movedPorts.consolePort,18444)
assert.equal(movedPorts.consoleOrigin,'https://gateway.example.com:18444')
assert.equal(remoteGatewayNetworksOverlap('10.252.0.0/20','10.252.10.0/24'),true)
assert.equal(remoteGatewayNetworksOverlap('10.252.0.0/20','10.252.16.0/20'),false)
assert.throws(()=>planRemoteGatewayConfiguration('backup','8.8.4.4',[],Array.from({length:65},(_,i)=>({protocol:'tcp' as const,port:18443+i}))),/PORT_EXHAUSTED/)
assert.equal(2 ** 12 - 3, 4093)
assert.equal(planRemoteGatewayConfiguration('independent', '8.8.4.4', ['10.252.0.1/24']).network, '10.252.32.0/20')
assert.throws(() => planRemoteGatewayConfiguration('backup', '8.8.4.4', ['10.252.0.0/16']), /EXHAUSTED/)
assert.throws(() => planRemoteGatewayConfiguration('backup', '8.8.4.4', ['broken']), /NETWORK_INVALID/)
assert.throws(() => planRemoteGatewayConfiguration('backup', 'http://gateway.example.com', []))
const installId = randomUUID(), inspectId = remoteGatewayInspectionId(installId)
assert.equal(inspectId, remoteGatewayInspectionId(installId)); assert.notEqual(inspectId, installId)
assert.notEqual(inspectId,remoteGatewayInspectionId(installId,1));assert.throws(()=>remoteGatewayInspectionId(installId,17))
assert.match(inspectId, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/)
const request = { schemaVersion: 1, platformId: randomUUID(), gatewayId: randomUUID(), slot: 'a', expectedMachineId: null,
  network: '10.249.80.0/24', address: '10.249.80.1', listenPort: 51980, consolePort: 18480 }
assert.deepEqual(validateGatewayPreflightRequest(request), request)
assert.equal(validateGatewayPreflightRequest({ ...request, network: '10.252.0.0/20', address: '10.252.0.1' }).network, '10.252.0.0/20')
assert.throws(() => validateGatewayPreflightRequest({ ...request, network: '10.252.0.0/19', address: '10.252.0.1' }), GatewayTaskError)
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
for (const code of ['GATEWAY_MACHINE_ID_UNAVAILABLE', 'GATEWAY_PREFLIGHT_FAILED', 'GATEWAY_DEPENDENCIES_MISSING',
  'GATEWAY_INSPECTION_TIMEOUT', 'GATEWAY_INSPECTION_COMMAND_FAILED', 'GATEWAY_INSPECTION_RESPONSE_INVALID']) {
  assert.throws(() => parseGatewayPreflightReport(JSON.stringify({ code })), new RegExp(code))
}
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
