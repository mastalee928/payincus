import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
process.env.DATABASE_URL = 'postgresql://guard:guard@127.0.0.1:1/gateway_guard'
const { registerGatewayManagementRoutes } = await import('../src/routes/gateway-management.js')
const previousOrigin = process.env.ADMIN_FRONTEND_URL
process.env.ADMIN_FRONTEND_URL = 'https://admin.example.com'
const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } })
app.decorate('authenticateAdmin', async (request, reply) => {
  const identity = request.headers['x-test-identity']
  if (!identity) { reply.code(401).send({ code: 'UNAUTHORIZED' }); return }
  if (identity === 'user') { reply.code(403).send({ code: 'ADMIN_REQUIRED' }); return }
  request.user = { id: 1, username: 'guard-admin', role: 'admin', sid: identity === 'admin' ? 'guard-session' : undefined }
})
let inspected = 0
const input = { requestId: randomUUID(), gatewayId: randomUUID(), name: 'Guard gateway', mode: 'local', target: null,
  configuration: { slot: 'a', network: '10.249.80.0/24', address: '10.249.80.1', listenPort: 51980, consolePort: 18480 } }
await registerGatewayManagementRoutes(app, {
  list: async () => ({ configured: true, platformId: randomUUID(), gateways: [] }),
  task: async () => ({ id: input.requestId, status: 'succeeded' }),
  inspect: async (_input, actor) => { assert.equal(actor, 1); inspected++; return { task: {}, report: null, canWrite: false, duplicate: false } }
})
try {
  for (const path of ['/management-gateways', `/management-gateways/tasks/${input.requestId}`]) {
    assert.equal((await app.inject({ method: 'GET', url: path })).statusCode, 401)
    assert.equal((await app.inject({ method: 'GET', url: path, headers: { 'x-test-identity': 'user' } })).statusCode, 403)
    const result = await app.inject({ method: 'GET', url: path, headers: { 'x-test-identity': 'admin' } })
    assert.equal(result.statusCode, 200); assert.equal(result.headers['cache-control'], 'no-store')
  }
  const headers = { 'x-test-identity': 'admin', authorization: 'Bearer unusable-test-value', origin: 'https://admin.example.com' }
  for (const changed of [{ 'x-test-identity': 'user' }, { 'x-test-identity': 'no-session' },
    { origin: 'https://user.example.com' }, { origin: '' }, { origin: 'https://admin.example.com.evil' },
    { authorization: '' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await app.inject({ method: 'POST', url: '/management-gateways/inspect', headers: { ...headers, ...changed }, payload: input })).statusCode, 403)
  }
  assert.equal(inspected, 0, 'access checks precede SSH/privileged probe')
  for (const changed of [{ command: 'unusable-test-value' }, { mode: 'shell' }, { credentials: { privateKey: 'x', extra: 'unusable-test-value' } }]) {
    assert.equal((await app.inject({ method: 'POST', url: '/management-gateways/inspect', headers, payload: { ...input, ...changed } })).statusCode, 400)
  }
  assert.equal(inspected, 0)
  const accepted = await app.inject({ method: 'POST', url: '/management-gateways/inspect', headers, payload: input })
  assert.equal(accepted.statusCode, 200); assert.equal(accepted.json().canWrite, false); assert.equal(inspected, 1)
  assert.equal(accepted.headers['cache-control'], 'no-store')
  assert.equal((await app.inject({ method: 'POST', url: '/management-gateways/execute', headers, payload: input })).statusCode, 404)
  console.log('Gateway management real route guards passed: admin/session/Origin, strict body and no write endpoint')
} finally { await app.close(); if (previousOrigin === undefined) delete process.env.ADMIN_FRONTEND_URL; else process.env.ADMIN_FRONTEND_URL = previousOrigin }
