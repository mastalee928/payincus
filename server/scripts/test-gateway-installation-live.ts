/** Explicit isolated DB + actual local gateway installation through HTTP services.
 * The outer session is a test fixture; password/MFA, workers and target operations
 * are real. No business app.ts, billing or customer instance worker is started.
 */
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import Fastify from 'fastify'
import bcrypt from 'bcryptjs'
import { authenticator } from 'otplib'
const url = new URL(process.env.DATABASE_URL || 'postgresql://localhost/invalid')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.pathname.endsWith('_gateway_test'))
assert.equal(process.env.GATEWAY_INSTALL_LIVE_TEST, '1')
assert.equal(process.getuid?.(), 0)
assert.ok(process.env.GATEWAY_CONTROLLER_CONFIG)
const controller = JSON.parse(await readFile(process.env.GATEWAY_CONTROLLER_CONFIG, 'utf8'))
process.env.GATEWAY_PLATFORM_ID = controller.platformId
process.env.ADMIN_FRONTEND_URL = 'https://admin.example.test'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { registerGatewayManagementRoutes } = await import('../src/routes/gateway-management.js')
const basic = await import('../src/services/gateway-management.js')
const manage = await import('../src/services/gateway-installation-management.js')
const { runGatewayInstallationTask } = await import('../src/services/gateway-installation-worker.js')
const { encryptGatewayTaskSecret } = await import('../src/services/gateway-admin-authorization.js')
const taskId = randomUUID(), gatewayId = randomUUID(), password = randomBytes(24).toString('base64url'), seed = authenticator.generateSecret()
const admin = await prisma.user.create({ data: { username: 'gateway-live-' + taskId, passwordHash: await bcrypt.hash(password, 4), role: 'admin',
  twoFactorEnabled: true, twoFactorSecret: encryptGatewayTaskSecret(seed) } })
const sessionId = randomBytes(16).toString('hex')
const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } })
app.decorate('authenticateAdmin', async request => { request.user = { id: admin.id, username: admin.username, role: 'admin', sid: sessionId } })
const jobs = new Map<string, Promise<unknown>>()
const dispatch = { available: () => true, launch: async (id: string) => {
  const work = runGatewayInstallationTask(id)
  // The production dispatcher starts the same entry in its sealed systemd unit.
  jobs.set(id, work); void work.catch(() => {})
} }
await registerGatewayManagementRoutes(app, { list: basic.listManagementGateways, task: basic.getManagementGatewayTask, inspect: basic.inspectManagementGateway,
  install: (input, actor) => manage.requestGatewayInstallation(input, actor, dispatch),
  confirm: (id, input, actor, sid) => manage.confirmGatewayInstallation(id, input, actor, sid, dispatch),
  cancel: manage.cancelGatewayInstallation, bootstrap: manage.retrieveGatewayBootstrap })
const headers = { authorization: 'Bearer local-fixture-session', origin: process.env.ADMIN_FRONTEND_URL }
const configuration = { slot: 'a', network: '10.249.90.0/24', address: '10.249.90.1', listenPort: 51990, consolePort: 19490 }
try {
  const inspected = await app.inject({ method: 'POST', url: '/management-gateways/inspect', headers, payload: {
    requestId: randomUUID(), gatewayId, name: 'Actual local gateway installation', mode: 'local', target: null, configuration } })
  assert.equal(inspected.statusCode, 200, 'live inspection accepted')
  const submitted = await app.inject({ method: 'POST', url: '/management-gateways/installations', headers, payload: {
    requestId: taskId, gatewayId, configuration: { ...configuration, consoleOrigin: process.env.GATEWAY_TEST_CONSOLE_ORIGIN || 'https://127.0.0.1:19490' } } })
  assert.equal(submitted.statusCode, 202, 'installation intent accepted')
  assert.ok(jobs.has(taskId)); await jobs.get(taskId)
  const planned = await app.inject({ method: 'GET', url: '/management-gateways/tasks/' + taskId })
  const task = planned.json()
  assert.equal(task.preparationState, 'ready')
  assert.ok(task.installationPreview.installable, 'live target must be installable')
  assert.ok(!('installation' in task) && !('credentialsEncrypted' in task) && !('leaseToken' in task))
  const confirmation = { planHash: task.planHash, confirmation: 'CONFIRM ' + taskId, password, totpCode: authenticator.generate(seed) }
  const denied = await app.inject({ method: 'POST', url: `/management-gateways/tasks/${taskId}/confirm`, headers,
    payload: { ...confirmation, password: 'incorrect' } })
  assert.equal(denied.statusCode, 400)
  const accepted = await app.inject({ method: 'POST', url: `/management-gateways/tasks/${taskId}/confirm`, headers, payload: confirmation })
  assert.equal(accepted.statusCode, 202, 'confirmed installation accepted')
  await jobs.get(taskId)
  const completed = (await app.inject({ method: 'GET', url: '/management-gateways/tasks/' + taskId })).json()
  assert.equal(completed.status, 'succeeded')
  assert.equal(completed.installationReceipt.installed, true)
  assert.equal(completed.installationReceipt.canWrite, false)
  assert.ok(completed.steps.every((step: { status: string }) => step.status === 'succeeded'))
  const material = await app.inject({ method: 'POST', url: `/management-gateways/tasks/${taskId}/bootstrap`, headers, payload: {} })
  assert.equal(material.statusCode, 200)
  assert.equal(material.headers['cache-control'], 'no-store')
  const data = material.json()
  assert.ok(data.password.length >= 12 && data.recoveryCodes.length >= 4 && data.totpSeed.length === 28)
  const repeated = await app.inject({ method: 'POST', url: `/management-gateways/tasks/${taskId}/bootstrap`, headers, payload: {} })
  assert.equal(repeated.statusCode, 400)
  const stored = await prisma.managementGatewayTask.findUniqueOrThrow({ where: { id: taskId } })
  assert.equal(stored.bootstrapEncrypted, null)
  assert.equal(stored.credentialsEncrypted, null)
  assert.equal((await prisma.managementGateway.findUniqueOrThrow({ where: { id: gatewayId } })).revision, 1n)
  process.stdout.write(JSON.stringify({ passed: true, taskId, gatewayId, platformId: controller.platformId, outerSessionFixture: true,
    actualPasswordAndMfa: true, persistedPlan: true, realRootWorker: true, actualLocalInstallation: true, allStepsVerified: true,
    bootstrapOneTime: true, privateMaterialNotInTask: true, gatewayRevision: '1', canWrite: false }) + '\n')
} catch (error) {
  process.stderr.write('Gateway live installation failed: ' + ((error as { code?: string }).code || 'verification') + '\n')
  process.exitCode = 1
} finally {
  await app.close()
  await Promise.allSettled(jobs.values())
  // Preserve the isolated task and physical installation for review and follow-up.
  await closePrismaDatabase()
}
