import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { validateStableGatewayEndpoint } from '../src/lib/onboarding-gateway-endpoint.js'
import { registerGatewayEndpointRoutes } from '../src/routes/onboarding-gateway-endpoint.js'
import { verifyRemoteGatewayDomain } from '../src/services/onboarding-gateway-endpoint.js'
import { OnboardingError } from '../src/lib/host-onboarding.js'

assert.equal(await verifyRemoteGatewayDomain('8.8.4.4', 'Gateway.Example.com', async () => '8.8.4.4'), 'gateway.example.com')
await assert.rejects(verifyRemoteGatewayDomain('8.8.4.4', 'gateway.example.com', async host => host === '8.8.4.4' ? host : '8.8.8.8'), /TARGET_MISMATCH/)
await assert.rejects(verifyRemoteGatewayDomain('8.8.4.4', '8.8.4.4', async () => '8.8.4.4'), /DNS_REQUIRED/)
await assert.rejects(verifyRemoteGatewayDomain('8.8.4.4', 'gateway.example.com', async () => { throw new Error('DNS outage') }), /GATEWAY_DNS_LOOKUP_FAILED/)
await assert.rejects(verifyRemoteGatewayDomain('8.8.4.4', 'gateway.example.com', async () => '127.0.0.1'), /GATEWAY_DNS_LOOKUP_FAILED/)

assert.deepEqual(validateStableGatewayEndpoint({ hostname: 'Gateway.Example.com', port: 51820 }), { hostname: 'gateway.example.com', port: 51820 })
for (const hostname of ['127.0.0.1', '8.8.4.4', 'localhost', 'https://gateway.example.com', 'gateway.example.com:51820', 'gateway.example.com;id']) {
  assert.throws(() => validateStableGatewayEndpoint({ hostname, port: 51820 }))
}
for (const port of [0, 65536, 1.5, '51820']) assert.throws(() => validateStableGatewayEndpoint({ hostname: 'gateway.example.com', port }))
assert.throws(() => validateStableGatewayEndpoint({ hostname: 'gateway.example.com', port: 51820, command: 'sh' }))
const oldOrigin = process.env.ADMIN_FRONTEND_URL
process.env.ADMIN_FRONTEND_URL = 'https://admin.example.com'
const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } })
app.decorate('authenticateAdmin', async (request, reply) => {
  if (request.headers['x-role'] !== 'admin') return reply.code(403).send({ code: 'ADMIN_REQUIRED' })
  request.user = { id: 1, username: 'fixture-admin', role: 'admin', sid: request.headers['x-no-session'] ? undefined : 'fixture-session' }
})
let saved = 0, address = '8.8.4.4', installations = 0
let currentHostname = ''
let needsChannelUpgrade = false, preparations = 0
await registerGatewayEndpointRoutes(app, {
  load: async () => currentHostname ? { hostname: currentHostname, port: 51820 } : null,
  save: async (input, actor, expected) => {
    assert.equal(actor, 1)
    if (expected !== currentHostname) throw new OnboardingError('GATEWAY_DNS_SETTINGS_CONFLICT')
    const endpoint = validateStableGatewayEndpoint(input); currentHostname = endpoint.hostname; saved++; return endpoint
  },
  resolve: async host => host === '8.8.4.4' ? host : address,
  configured: () => true, hosts: async () => [], install: async id => { installations++; return { nodeId: id, dnsRefreshInstalled: true, endpoint: 'gateway.example.com:51820', keysAndRoutesPreserved: true } },
  channel: async () => ({ needsChannelUpgrade, channelTarget: 'remote' as const, channelError: null }),
  prepare: async (_gateway, password) => {
    preparations++
    if (needsChannelUpgrade && !password) throw new OnboardingError('GATEWAY_DNS_HELPER_UPGRADE_REQUIRED')
    if (password) { assert.equal(password, 'fixture-once'); needsChannelUpgrade = false }
  },
  gateway: async () => ({ endpoint: '8.8.4.4:51820', publicKey: 'fixture', controlIp: '10.253.240.1',
    network: '10.253.240.0/24', sshHost: 'fixture', managementSshPublicKey: 'fixture' })
})
const headers = { 'x-role': 'admin', origin: 'https://admin.example.com', authorization: 'Bearer fixture' }
const payload = { hostname: 'gateway.example.com', port: 51820 }
try {
  assert.equal((await app.inject({ method: 'GET', url: '/gateway/endpoint' })).statusCode, 403)
  for (const extra of [{ 'x-role': 'user' }, { origin: 'https://other.example.com' }, { 'x-no-session': '1' }]) {
    assert.equal((await app.inject({ method: 'PUT', url: '/gateway/endpoint', headers: { ...headers, ...extra }, payload })).statusCode, 403)
  }
  assert.equal((await app.inject({ method: 'PUT', url: '/gateway/endpoint', headers, payload: { ...payload, command: 'sh' } })).statusCode, 400)
  assert.equal((await app.inject({ method: 'PUT', url: '/gateway/endpoint', headers, payload: { ...payload, port: 51821 } })).json().code, 'GATEWAY_DNS_PORT_CONFLICT')
  address = '1.1.1.1'
  assert.equal((await app.inject({ method: 'PUT', url: '/gateway/endpoint', headers, payload })).json().code, 'GATEWAY_DNS_TARGET_MISMATCH')
  assert.equal(saved, 0)
  address = '8.8.4.4'
  const response = await app.inject({ method: 'PUT', url: '/gateway/endpoint', headers, payload })
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.equal(response.json().effectiveEndpoint, 'gateway.example.com:51820')
  assert.equal(response.json().existingHostsNeedUpdate, true)
  assert.equal(saved, 1)
  assert.equal((await app.inject({ method: 'PUT', url: '/gateway/endpoint', headers,
    payload: { hostname: 'new.example.com', expectedHostname: 'old.example.com' } })).statusCode, 409)
  assert.equal(saved, 1, 'stale domain forms must not write')
  assert.equal((await app.inject({ method: 'PUT', url: '/gateway/endpoint', headers,
    payload: { hostname: 'new.example.com', expectedHostname: 'gateway.example.com' } })).statusCode, 200)
  assert.equal(currentHostname, 'new.example.com')
  needsChannelUpgrade = true
  assert.equal((await app.inject({ method: 'GET', url: '/gateway/endpoint', headers })).json().needsChannelUpgrade, true)
  const savedBeforeUpgrade = saved
  const upgradePayload = { hostname: 'updated.example.com', expectedHostname: 'new.example.com' }
  assert.equal((await app.inject({ method: 'PUT', url: '/gateway/endpoint', headers, payload: upgradePayload })).json().code, 'GATEWAY_DNS_HELPER_UPGRADE_REQUIRED')
  assert.equal(saved, savedBeforeUpgrade, 'old forced helper must be upgraded before changing desired domain')
  const preparationsBeforeStale = preparations
  assert.equal((await app.inject({ method: 'PUT', url: '/gateway/endpoint', headers,
    payload: { ...upgradePayload, expectedHostname: 'stale.example.com', credentials: { password: 'fixture-once' } } })).statusCode, 409)
  assert.equal(preparations, preparationsBeforeStale, 'stale form must not initiate a remote upgrade')
  assert.equal((await app.inject({ method: 'PUT', url: '/gateway/endpoint', headers,
    payload: { ...upgradePayload, credentials: { password: 'fixture-once' } } })).statusCode, 200)
  assert.equal(currentHostname, 'updated.example.com')
  const stateAfterUpgrade = (await app.inject({ method: 'GET', url: '/gateway/endpoint', headers })).body
  assert.equal(JSON.parse(stateAfterUpgrade).needsChannelUpgrade, false)
  assert.equal(stateAfterUpgrade.includes('fixture-once'), false)
  const url = '/gateway/endpoint/hosts/11111111-1111-4111-8111-111111111111'
  for (const extra of [{ 'x-role': 'user' }, { origin: 'https://other.example.com' }, { 'x-no-session': '1' }]) {
    assert.equal((await app.inject({ method: 'POST', url, headers: { ...headers, ...extra }, payload: {} })).statusCode, 403)
  }
  assert.equal((await app.inject({ method: 'POST', url, headers, payload: { command: 'sh' } })).statusCode, 400)
  assert.equal(installations, 0)
  assert.equal((await app.inject({ method: 'POST', url, headers, payload: {} })).statusCode, 202)
  assert.equal(installations, 1)
} finally {
  await app.close()
  if (oldOrigin === undefined) delete process.env.ADMIN_FRONTEND_URL
  else process.env.ADMIN_FRONTEND_URL = oldOrigin
}
console.log('Stable gateway DNS settings: session/Origin, strict domain and current-target/port verification passed')
// Database imports use existing process-wide timers; this guard never opens a DB connection.
process.exit(0)
