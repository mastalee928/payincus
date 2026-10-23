import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { GatewayTaskError } from '../src/lib/gateway-task-plan.js'
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
let prepared = 0, confirmed = 0, cancelled = 0, delivered = 0
let bootstrapUnavailable = false
const input = { requestId: randomUUID(), gatewayId: randomUUID(), name: 'Guard gateway', mode: 'local', target: null,
  configuration: { slot: 'a', network: '10.249.80.0/24', address: '10.249.80.1', listenPort: 51980, consolePort: 18480 } }
await registerGatewayManagementRoutes(app, {
  list: async () => ({ configured: true, platformId: randomUUID(), gateways: [] }),
  task: async () => ({ id: input.requestId, status: 'succeeded' }),
  inspect: async (_input, actor) => { assert.equal(actor, 1); inspected++; return { task: {}, report: null, canWrite: false, duplicate: false } },
  install: async (_input, actor) => { assert.equal(actor, 1); prepared++; return { id: input.requestId } },
  confirm: async (_id, _input, actor, session) => { assert.equal(actor, 1); assert.equal(session, 'guard-session'); confirmed++; return { id: input.requestId } },
  cancel: async (_id, actor) => { assert.equal(actor, 1); cancelled++; return { id: input.requestId } },
  bootstrap: async (_id, _input, actor, session) => { assert.equal(actor, 1); assert.equal(session, 'guard-session');
    if (bootstrapUnavailable) throw new GatewayTaskError('GATEWAY_BOOTSTRAP_UNAVAILABLE')
    delivered++; return {
    username: 'fixture', password: 'fixture-password', role: 'operator', totpSeed: 'fixture-seed', recoveryCodes: ['fixture-code'] } }
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
  const actions = [
    { url: '/management-gateways/installations', body: { requestId: input.requestId, gatewayId: input.gatewayId, configuration: { ...input.configuration, consoleOrigin: 'https://gateway.example.com:18480' } }, status: 202 },
    { url: `/management-gateways/tasks/${input.requestId}/confirm`, body: { planHash: 'a'.repeat(64), confirmation: `CONFIRM ${input.requestId}`, password: 'fixture-password' }, status: 202 },
    { url: `/management-gateways/tasks/${input.requestId}/cancel`, body: {}, status: 200 },
    { url: `/management-gateways/tasks/${input.requestId}/bootstrap`, body: {}, status: 200 }
  ]
  for (const action of actions) {
    for (const changed of [{ 'x-test-identity': 'user' }, { 'x-test-identity': 'no-session' }, { origin: 'https://other.example.com' }, { authorization: '' }]) {
      assert.equal((await app.inject({ method: 'POST', url: action.url, headers: { ...headers, ...changed }, payload: action.body })).statusCode, 403)
    }
    assert.equal((await app.inject({ method: 'POST', url: action.url, headers, payload: { ...action.body, command: 'unusable-test-value' } })).statusCode, 400)
  }
  assert.deepEqual([prepared, confirmed, cancelled, delivered], [0, 0, 0, 0])
  for (const action of actions) {
    const response = await app.inject({ method: 'POST', url: action.url, headers, payload: action.body })
    assert.equal(response.statusCode, action.status); assert.equal(response.headers['cache-control'], 'no-store')
  }
  assert.deepEqual([prepared, confirmed, cancelled, delivered], [1, 1, 1, 1])
  bootstrapUnavailable = true
  assert.equal((await app.inject({ method: 'POST', url: `/management-gateways/tasks/${input.requestId}/bootstrap`, headers, payload: {} })).statusCode, 400)
  console.log('Gateway management real route guards passed: admin/session/Origin, strict inspect/install/confirm/cancel/bootstrap bodies and fixed worker operations')
} finally { await app.close(); if (previousOrigin === undefined) delete process.env.ADMIN_FRONTEND_URL; else process.env.ADMIN_FRONTEND_URL = previousOrigin }
