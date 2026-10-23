/** Explicitly opt in against a local isolated DB and Linux read-only probe. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
const database = new URL(process.env.DATABASE_URL || 'postgresql://localhost/invalid')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_gateway_test'), 'use isolated local *_gateway_test database')
assert.equal(process.env.GATEWAY_PREFLIGHT_LIVE_TEST, '1', 'explicit read-only live inspection required')
const platformId = randomUUID(), gatewayId = randomUUID(), requestId = randomUUID()
process.env.GATEWAY_PLATFORM_ID = platformId
process.env.ADMIN_FRONTEND_URL = 'https://admin.example.com'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: gatewayRoutes } = await import('../src/routes/gateway-management.js')
const admin = await prisma.user.create({ data: { username: 'gateway-route-' + requestId, passwordHash: 'unusable-test-hash', role: 'admin' } })
const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } })
app.decorate('authenticateAdmin', async request => { request.user = { id: admin.id, username: admin.username, role: 'admin', sid: 'test-session' } })
await app.register(gatewayRoutes)
const headers = { authorization: 'Bearer unusable-test-value', origin: 'https://admin.example.com' }
const input = { requestId, gatewayId, name: 'Live read-only gateway', mode: 'local', target: null,
  configuration: { slot: 'b', network: '10.249.80.0/24', address: '10.249.80.1', listenPort: 51980, consolePort: 18480 } }
try {
  const first = await app.inject({ method: 'POST', url: '/management-gateways/inspect', headers, payload: input })
  assert.equal(first.statusCode, 200, first.body)
  const result = first.json()
  assert.equal(result.task.status, 'succeeded'); assert.equal(result.task.kind, 'inspect'); assert.equal(result.canWrite, false)
  assert.ok(result.report.machineId); assert.equal(result.task.inspection.report.observedStateHash, result.report.observedStateHash)
  assert.equal(result.task.steps.length, 2)
  const queried = await app.inject({ method: 'GET', url: `/management-gateways/tasks/${requestId}` })
  assert.equal(queried.statusCode, 200); assert.equal(queried.json().inspection.report.machineId, result.report.machineId)
  const duplicate = await app.inject({ method: 'POST', url: '/management-gateways/inspect', headers, payload: input })
  assert.equal(duplicate.statusCode, 200, duplicate.body); assert.equal(duplicate.json().duplicate, true)
  assert.equal(duplicate.json().report.observedStateHash, result.report.observedStateHash)
  assert.equal(await prisma.managementGatewayTask.count({ where: { id: requestId } }), 1)
  const conflict = await app.inject({ method: 'POST', url: '/management-gateways/inspect', headers,
    payload: { ...input, configuration: { ...input.configuration, consolePort: 18481 } } })
  assert.equal(conflict.statusCode, 409); assert.equal(conflict.json().code, 'GATEWAY_TASK_IDEMPOTENCY_CONFLICT')
  const list = await app.inject({ method: 'GET', url: '/management-gateways' })
  assert.equal(list.statusCode, 200); assert.equal(list.json().gateways[0].revision, '0')
  assert.ok(!JSON.stringify(list.json()).includes('credentialsEncrypted'))
  assert.ok(!JSON.stringify(queried.json()).includes('leaseToken'))
  const secondPhysicalIdentity = await app.inject({ method: 'POST', url: '/management-gateways/inspect', headers,
    payload: { ...input, requestId: randomUUID(), gatewayId: randomUUID() } })
  assert.equal(secondPhysicalIdentity.statusCode, 409); assert.equal(secondPhysicalIdentity.json().code, 'GATEWAY_TASK_TARGET_CONFLICT')
  const localSecret = await app.inject({ method: 'POST', url: '/management-gateways/inspect', headers,
    payload: { ...input, credentials: { password: 'unusable-test-value' } } })
  assert.equal(localSecret.statusCode, 400); assert.equal(localSecret.json().code, 'GATEWAY_LOCAL_SSH_FORBIDDEN')
  console.log(JSON.stringify({ result: 'passed', runtime: process.version, machineId: result.report.machineId,
    architecture: result.report.architecture, blockers: result.report.blockers, persistedReport: true,
    idempotent: true, mismatchedInputRejected: true, secondPhysicalIdentityRejected: true, canWrite: false }))
} finally {
  await app.close()
  await prisma.managementGatewayStep.deleteMany({ where: { task: { gatewayId } } })
  await prisma.managementGatewayTask.deleteMany({ where: { gatewayId } })
  await prisma.managementGateway.deleteMany({ where: { id: gatewayId } })
  await prisma.user.delete({ where: { id: admin.id } })
  await closePrismaDatabase()
}
process.exit(0)
