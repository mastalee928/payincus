import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
process.env.DATABASE_URL = 'postgresql://guard:guard@127.0.0.1:1/gateway_guard'
const { parseGatewayDomainReceipt } = await import('../src/services/gateway-domain-driver.js')
const { registerGatewayManagementRoutes } = await import('../src/routes/gateway-management.js')
const request = { schemaVersion: 1 as const, operation: 'apply' as const, platformId: randomUUID(), gatewayId: randomUUID(),
  machineId: 'a'.repeat(32), requestId: randomUUID(), expectedRevision: '1', expectedOrigin: 'https://old.example.com:18480',
  expectedCertificateSha256: 'a'.repeat(64), expectedTlsKeySha256: 'b'.repeat(64), origin: 'https://new.example.com:18480' }
const receipt = { schemaVersion: 1 as const, gatewayId: request.gatewayId, requestId: request.requestId, revision: '2', origin: request.origin,
  certificateSha256: 'c'.repeat(64), tlsKeySha256: request.expectedTlsKeySha256, verified: true as const, transportPreserved: true as const }
assert.deepEqual(parseGatewayDomainReceipt(JSON.stringify(receipt), request), receipt)
for (const changed of [{ gatewayId: randomUUID() }, { requestId: randomUUID() }, { revision: '3' }, { revision: 2 },
  { origin: request.expectedOrigin }, { certificateSha256: 'wrong' }, { tlsKeySha256: 'd'.repeat(64) }, { verified: false },
  { transportPreserved: false }, { extra: true }]) {
  assert.throws(() => parseGatewayDomainReceipt(JSON.stringify({ ...receipt, ...changed }), request), /RECEIPT_INVALID/)
}
for (const raw of ['null', '[]', '{}', '{broken', ' '.repeat(8193)]) assert.throws(() => parseGatewayDomainReceipt(raw, request), /RECEIPT_INVALID/)
assert.throws(() => parseGatewayDomainReceipt('{"code":"GATEWAY_DOMAIN_BUSY","canWrite":false}', request), /GATEWAY_DOMAIN_BUSY/)
const status = { ...request, operation: 'status' as const, expectedTlsKeySha256: null, origin: request.expectedOrigin }
assert.equal(parseGatewayDomainReceipt(JSON.stringify({ ...receipt, revision: '1', origin: status.origin, certificateSha256: request.expectedCertificateSha256 }), status).tlsKeySha256, receipt.tlsKeySha256)
assert.throws(() => parseGatewayDomainReceipt(JSON.stringify({ ...receipt, revision: '1', origin: status.origin }), status), /IDENTITY_CHANGED/)

const previousOrigin = process.env.ADMIN_FRONTEND_URL
process.env.ADMIN_FRONTEND_URL = 'https://admin.example.com'
const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } })
app.decorate('authenticateAdmin', async (incoming, reply) => {
  const identity = incoming.headers['x-test-identity']
  if (!identity) { reply.code(401).send({ code: 'UNAUTHORIZED' }); return }
  if (identity === 'user') { reply.code(403).send({ code: 'ADMIN_REQUIRED' }); return }
  incoming.user = { id: 7, username: 'fixture', role: 'admin', sid: identity === 'admin' ? 'domain-session' : undefined, iat: 123456 }
})
let written = 0
const view = { gatewayId: request.gatewayId, purpose: 'independent' as const, scope: 'console' as const, hostname: 'old.example.com',
  desiredHostname: 'new.example.com', revision: '1', requestId: request.requestId, state: 'queued', step: 'queued', errorCode: null,
  attempt: 0, retryAt: null, channelReady: true, credentialsRequired: false }
await registerGatewayManagementRoutes(app, {
  list: async () => ({ configured: true, platformId: request.platformId, preparations: [], gateways: [] }), task: async () => ({}),
  inspect: async () => ({ task: {}, report: null, canWrite: false, duplicate: false }),
  domain: async () => view,
  updateDomain: async (id, input, actor) => {
    assert.equal(id, request.gatewayId); assert.equal(input.requestId, request.requestId)
    assert.deepEqual({ id: actor.id, sid: actor.sid, iat: actor.iat }, { id: 7, sid: 'domain-session', iat: 123456 })
    written++; return view
  }
})
try {
  const url = `/management-gateways/${request.gatewayId}/domain`
  const headers = { 'x-test-identity': 'admin', authorization: 'Bearer fixture', origin: 'https://admin.example.com' }
  const payload = { requestId: request.requestId, hostname: 'new.example.com', expectedHostname: 'old.example.com' }
  assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401)
  assert.equal((await app.inject({ method: 'GET', url, headers: { 'x-test-identity': 'user' } })).statusCode, 403)
  assert.equal((await app.inject({ method: 'GET', url, headers })).headers['cache-control'], 'no-store')
  for (const changed of [{ 'x-test-identity': 'user' }, { 'x-test-identity': 'no-session' }, { authorization: '' }, { origin: '' },
    { origin: 'https://user.example.com' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await app.inject({ method: 'PUT', url, headers: { ...headers, ...changed }, payload })).statusCode, 403)
  }
  for (const changed of [{ extra: 'shell' }, { requestId: 'broken' }, { credentials: { privateKey: 'unaccepted' } },
    { credentials: { password: '' } }, { credentials: { password: 'x'.repeat(1025) } }]) {
    assert.equal((await app.inject({ method: 'PUT', url, headers, payload: { ...payload, ...changed } })).statusCode, 400)
  }
  assert.equal(written, 0)
  const accepted = await app.inject({ method: 'PUT', url, headers, payload })
  assert.equal(accepted.statusCode, 202); assert.equal(accepted.headers['cache-control'], 'no-store'); assert.equal(written, 1)
  console.log('Gateway domain guards passed: receipt identity/key/revision binding and real admin/session/origin/strict route validation')
} finally {
  await app.close()
  if (previousOrigin === undefined) delete process.env.ADMIN_FRONTEND_URL; else process.env.ADMIN_FRONTEND_URL = previousOrigin
}
