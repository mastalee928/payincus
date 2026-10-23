import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { GatewayTaskError, gatewayTaskHash, validateGatewayTaskPlan, validateGatewayTaskTarget,
  validateGatewayStepReceipt, type GatewayTaskPlan } from '../src/lib/gateway-task-plan.js'
await import('./test-gateway-preflight-guards.js')

const target = { mode: 'local' as const, machineId: 'a'.repeat(32), ssh: null }
const plan: GatewayTaskPlan = { schemaVersion: 1, taskId: randomUUID(), gatewayId: randomUUID(), platformId: randomUUID(),
  kind: 'install', basedOnRevision: '0', target, configurationHash: 'b'.repeat(64), componentHash: 'c'.repeat(64), observedStateHash: 'd'.repeat(64) }
let passed = 0
function test(name: string, work: () => void) { work(); passed++; console.log(`ok ${name}`) }
const rejects = (work: () => void) => assert.throws(work, GatewayTaskError)
test('strict plan round trip', () => assert.deepEqual(validateGatewayTaskPlan(plan), plan))
test('canonical hash independent of key insertion order', () => assert.equal(gatewayTaskHash(plan), gatewayTaskHash(Object.fromEntries(Object.entries(plan).reverse()))))
test('target snapshot detached from caller mutation', () => {
  const supplied = structuredClone(plan), snapshot = validateGatewayTaskPlan(supplied)
  supplied.target.machineId = 'e'.repeat(32)
  assert.equal(snapshot.target.machineId, target.machineId)
})
test('local target forbids SSH credentials and connection', () => {
  rejects(() => validateGatewayTaskTarget({ ...target, ssh: { address: '10.1.1.1' } }))
  rejects(() => validateGatewayTaskTarget({ ...target, password: 'unusable-test-value' }))
})
const remote = { mode: 'remote', machineId: target.machineId, ssh: { address: '10.1.1.1', port: 22, username: 'root', fingerprint: 'SHA256:' + Buffer.alloc(32, 7).toString('base64').replace(/=+$/, '') } }
test('remote pins literal private management target and canonical fingerprint', () => assert.deepEqual(validateGatewayTaskTarget(remote), remote))
test('remote rejects DNS drift, URL, loopback and metadata', () => {
  for (const address of ['gateway.example.com', 'https://10.1.1.1', '127.0.0.1', '0.0.0.0', '169.254.169.254', '224.1.1.1']) rejects(() => validateGatewayTaskTarget({ ...remote, ssh: { ...remote.ssh, address } }))
})
test('remote rejects missing or noncanonical SSH identity', () => {
  for (const fingerprint of ['', 'SHA256:' + 'A'.repeat(42) + 'B']) rejects(() => validateGatewayTaskTarget({ ...remote, ssh: { ...remote.ssh, fingerprint } }))
  rejects(() => validateGatewayTaskTarget({ ...remote, ssh: { ...remote.ssh, username: 'owner' } }))
})
test('machine identity and exact revision range required', () => {
  for (const machineId of ['', '0'.repeat(32), 'a'.repeat(33)]) rejects(() => validateGatewayTaskTarget({ ...target, machineId }))
  for (const basedOnRevision of ['01', '-1', '9223372036854775807', '9223372036854775808', 0]) rejects(() => validateGatewayTaskPlan({ ...plan, basedOnRevision }))
})
test('unregistered actions and secret-bearing plans rejected', () => {
  for (const kind of ['delete', 'shell', 'toString', '__proto__']) rejects(() => validateGatewayTaskPlan({ ...plan, kind }))
  for (const field of ['password', 'privateKey', 'leaseToken', 'command']) rejects(() => validateGatewayTaskPlan({ ...plan, [field]: 'unusable-test-value' }))
})
const operationId = randomUUID(), receipt = { schemaVersion: 1, taskId: plan.taskId, operationId, step: 'verify-installation',
  planHash: gatewayTaskHash(plan), targetHash: gatewayTaskHash(target), evidenceHash: 'e'.repeat(64), configurationHash: plan.configurationHash, issuedAt: Date.now(), outcome: 'verified' }
test('receipt bound to plan, target, step, operation and actual configuration', () => assert.deepEqual(validateGatewayStepReceipt(receipt, plan, receipt.step, operationId), receipt))
test('cross-task, stale plan, wrong target and wrong configuration rejected', () => {
  for (const field of ['taskId', 'operationId', 'step', 'planHash', 'targetHash', 'configurationHash', 'outcome']) rejects(() => validateGatewayStepReceipt({ ...receipt, [field]: 'incorrect' }, plan, receipt.step, operationId))
  rejects(() => validateGatewayStepReceipt({ ...receipt, configurationHash: null }, plan, receipt.step, operationId))
})
test('raw output, future or invalid time never saved as receipt', () => {
  rejects(() => validateGatewayStepReceipt({ ...receipt, output: 'unusable-test-value' }, plan, receipt.step, operationId))
  for (const issuedAt of [Date.now() + 60000, NaN, 0, 1.5]) rejects(() => validateGatewayStepReceipt({ ...receipt, issuedAt }, plan, receipt.step, operationId))
})
test('public task select excludes credentials and execution lease', () => {
  const source = readFileSync(new URL('../src/services/gateway-task-journal.ts', import.meta.url), 'utf8')
  const selection = source.slice(source.indexOf('export const gatewayTaskPublicSelect'), source.indexOf('async function lock'))
  assert.ok(!/credentials|leaseToken|leaseUntil/.test(selection))
})
test('database reserves interrupted physical identities and protects receipts', () => {
  const sql = readFileSync(new URL('../prisma/migrations/202610230001_management_gateway_journal/migration.sql', import.meta.url), 'utf8')
  assert.match(sql, /"machine_id" TEXT NOT NULL UNIQUE/)
  assert.match(sql, /one_active_target[\s\S]*'queued', 'running', 'needs_review'/)
  assert.match(sql, /"receipt" IS NOT NULL AND "receipt_hash" IS NOT NULL/)
  assert.match(sql, /ON DELETE RESTRICT/)
})
console.log(`Gateway task plan and journal guards passed: ${passed}`)
