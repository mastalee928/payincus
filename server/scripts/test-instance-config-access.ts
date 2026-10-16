/** Exercise the real routes without a database, remote host, or resource mutation. */
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import Fastify from 'fastify'
import { Pool } from 'pg'

// Never fall back to a developer's configured database.
process.env.DATABASE_URL = 'postgresql://guard:guard@127.0.0.1:1/instance_config_guard'
process.env.JWT_SECRET = 'instance-config-access-test-only-secret'
const databaseConnect = mock.method(Pool.prototype, 'connect', () => {
  throw new Error('This test must not connect to a database')
})
const instance = {
  id: 42, userId: 20, hostId: 10, name: 'config-access-fixture', incusId: 'config-access-fixture',
  packageId: null, packagePlanId: null, status: 'running', cpu: 100, memory: 512, disk: 10240,
  createdAt: new Date(0), updatedAt: new Date(0), swapEnabled: false, swapSize: 0,
  host: { name: 'fixture-host', countryCode: 'us', natPublicIp: '192.0.2.10', storageDriver: 'btrfs' },
  limitsRead: null, limitsWrite: null, limitsReadIops: null, limitsWriteIops: null,
  limitsIngress: null, limitsEgress: null, limitsProcesses: null, limitsCpuPriority: null,
  bootAutostart: null, bootAutostartPriority: null, bootAutostartDelay: null, bootHostShutdownTimeout: null
}
const instanceRead = mock.fn(async () => instance)
const instanceWrite = mock.fn(async () => {
  throw new Error('Access checks must run before any resource write')
})
const previousPrisma = Reflect.get(globalThis, 'prisma')
Reflect.set(globalThis, 'prisma', {
  instance: { findUnique: instanceRead, update: instanceWrite },
  host: { findUnique: async () => ({
    id: 10, userId: 10, name: 'fixture-host', status: 'online',
    createdAt: new Date(0), updatedAt: new Date(0)
  }) },
  $disconnect: async () => {}
})
const { closePrismaDatabase } = await import('../src/db/prisma.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const { default: instanceRoutes } = await import('../src/routes/instances.js')
const { default: batchConfigRoutes } = await import('../src/routes/batch-config.js')

const identities = {
  buyer: { id: 20, username: 'buyer', role: 'user' },
  stranger: { id: 30, username: 'stranger', role: 'user' },
  hostOwner: { id: 10, username: 'host-owner', role: 'user' },
  admin: { id: 1, username: 'admin', role: 'admin' }
} as const
const app = Fastify()
// JWT/session verification is covered by auth-session-status-guards. Supply its
// authenticated identities here to test each real route's authorization boundary.
app.decorate('authenticate', async (request, reply) => {
  const identity = identities[request.headers['x-test-identity'] as keyof typeof identities]
  if (!identity) {
    reply.code(401).send({ code: 'UNAUTHORIZED' })
    return
  }
  request.user = identity
})
app.decorate('authenticateAdmin', async (request, reply) => {
  await app.authenticate(request, reply)
  if (reply.sent) return
  if (request.user.role !== 'admin') reply.code(403).send({ code: 'ADMIN_REQUIRED' })
})
app.decorate('authenticateUser', async (request, reply) => {
  await app.authenticate(request, reply)
  if (!reply.sent && request.user.role === 'admin') reply.code(403).send({ code: 'USER_REQUIRED' })
})
await app.register(instanceRoutes, { prefix: '/instances' })
await app.register(batchConfigRoutes, { prefix: '/hosts' })

const endpoints = [
  { method: 'GET', suffix: '/config' },
  { method: 'HEAD', suffix: '/config' },
  { method: 'POST', suffix: '/boost-processes', payload: {} },
  { method: 'POST', suffix: '/swap/enable', payload: {} },
  { method: 'POST', suffix: '/swap/disable', payload: {} },
  { method: 'PATCH', suffix: '/advanced-config', payload: { limitsProcesses: 1000 } }
] as const

try {
  for (const identity of [undefined, 'buyer', 'stranger', 'hostOwner'] as const) {
    for (const { suffix, ...options } of endpoints) {
      for (const id of ['42', '9999', 'invalid']) {
        const response = await app.inject({
          ...options, url: `/instances/${id}${suffix}?tab=config&role=admin`,
          headers: { ...(identity ? { 'x-test-identity': identity } : {}), 'x-admin': 'true' }
        })
        assert.equal(response.statusCode, identity ? 403 : 401, `${identity ?? 'anonymous'}: ${options.method} ${id}${suffix}`)
      }
    }
  }
  assert.equal(instanceRead.mock.callCount(), 0, 'rejected requests must not read instance configuration')
  assert.equal(instanceWrite.mock.callCount(), 0, 'rejected requests must not write resource settings')

  const adminConfig = await app.inject({ method: 'GET', url: '/instances/42/config', headers: { 'x-test-identity': 'admin' } })
  assert.equal(adminConfig.statusCode, 200)
  assert.equal(adminConfig.json().config.limits_processes, 500, 'admin still sees effective configuration')
  for (const { suffix, ...options } of endpoints.filter(endpoint => endpoint.method !== 'GET' && endpoint.method !== 'HEAD')) {
    const response = await app.inject({ ...options, url: `/instances/invalid${suffix}`, headers: { 'x-test-identity': 'admin' } })
    assert.equal(response.statusCode, suffix === '/advanced-config' ? 403 : 400, 'admin reaches existing validation without mutating a fixture')
    if (suffix === '/advanced-config') assert.equal(response.json().code, 'FEATURE_DISABLED')
  }

  // A buyer cannot use the host owner's resource-edit endpoints as an alternative.
  const resourceEdit = await app.inject({ method: 'PATCH', url: '/instances/42/config',
    headers: { 'x-test-identity': 'buyer' }, payload: { cpu: 200, limitsProcesses: 1000 } })
  assert.equal(resourceEdit.statusCode, 403)
  const batchEdit = await app.inject({ method: 'POST', url: '/hosts/10/instances/batch-config',
    headers: { 'x-test-identity': 'buyer' }, payload: { instanceIds: [42], config: { limitsProcesses: 1000 } } })
  assert.equal(batchEdit.statusCode, 403)
  for (const [key, value] of Object.entries({
    swapEnabled: false, swapSize: 0, limitsRead: null, limitsWrite: '100MB', limitsReadIops: 0,
    limitsWriteIops: 500, limitsIngress: null, limitsEgress: '300Mbit', limitsProcesses: 1000,
    limitsCpuPriority: 10, bootAutostart: false, bootAutostartPriority: 0,
    bootAutostartDelay: 5, bootHostShutdownTimeout: 30
  })) {
    const response = await app.inject({ method: 'POST', url: '/hosts/10/instances/batch-config',
      headers: { 'x-test-identity': 'hostOwner' }, payload: { instanceIds: [42], config: { [key]: value } } })
    assert.equal(response.statusCode, 403, `non-admin host owners cannot bypass advanced configuration restrictions via ${key}`)
  }
  assert.equal(instanceWrite.mock.callCount(), 0)
  assert.equal(databaseConnect.mock.callCount(), 0)
  console.log('Instance configuration access tests passed: anonymous/customer denial, alternate endpoints, admin read and validation, zero mutations')
} finally {
  await app.close()
  await closeAllClients()
  await closePrismaDatabase()
  Reflect.set(globalThis, 'prisma', previousPrisma)
  mock.restoreAll()
}

// Shared security modules have maintenance timers; this standalone check is done.
process.exit(0)
