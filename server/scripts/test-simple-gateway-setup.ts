import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { validateSimpleGatewayRequest, simpleGatewayPlanHash } from '../src/lib/local-gateway-setup.js'
import { gatewayDnsRetry, resumeGatewayDnsState } from '../src/lib/gateway-dns-queue.js'
import { registerSimpleGatewaySetupRoutes } from '../src/routes/simple-gateway-setup.js'
import { gatewaySshHost } from '../src/services/onboarding-ssh.js'

const id = '11111111-1111-4111-8111-111111111111', now = 1700000000000
assert.equal(gatewaySshHost('gateway.example.com:51820', { gatewayHost: '127.0.0.1', jumpHost: '8.8.4.4', configuredEndpoint: '8.8.4.4:51820' }), 'gateway.example.com')
assert.equal(gatewaySshHost('gateway.example.com:51820', { gatewayHost: '127.0.0.1', jumpHost: 'bastion.example.com', configuredEndpoint: '8.8.4.4:51820' }), 'bastion.example.com')
assert.equal(gatewaySshHost('gateway.example.com:51820', { gatewayHost: '10.0.0.2', jumpHost: 'bastion.example.com', configuredEndpoint: '8.8.4.4:51820' }), 'bastion.example.com')
const request = { schemaVersion: 1 as const, id, operation: 'prepare' as const, actorId: 1, createdAt: now,
  sshAddress: '8.8.4.4', publicHost: 'gateway.example.com', approvedCredentialHash: 'a'.repeat(64),
  approvedSessionId: 'session-1', passwordEncrypted: 'a'.repeat(32) + ':' + 'b'.repeat(32) + ':abcd' }
assert.deepEqual(validateSimpleGatewayRequest(request, now), request)
for (const patch of [{ command: 'id' }, { sshAddress: '8.8.4.4;id' }, { passwordEncrypted: 'plaintext' },
  { actorId: 0 }, { createdAt: now - 300001 }, { createdAt: now + 5001 }, { approvedSessionId: '../../root' },
  { operation: 'apply' }, { publicHost: 'https://example.com' }, { id: '../../root' }]) {
  assert.throws(() => validateSimpleGatewayRequest({ ...request, ...patch }, now))
}
const hash = simpleGatewayPlanHash(request, 'state-1')
assert.equal(simpleGatewayPlanHash({ ...request, operation: 'apply', planHash: hash }, 'state-1'), hash)
for (const [changed, observed] of [[{ ...request, sshAddress: '1.1.1.1' }, 'state-1'],
  [{ ...request, actorId: 2 }, 'state-1'], [request, 'changed-state']] as const) assert.notEqual(simpleGatewayPlanHash(changed, observed), hash)
assert.equal(gatewayDnsRetry('SSH_CONNECT_FAILED', 1, now), now + 5000)
assert.equal(gatewayDnsRetry('SSH_CONNECT_FAILED', 2, now), now + 20000)
assert.equal(gatewayDnsRetry('SSH_CONNECT_FAILED', 3, now), null)
for (const code of ['SSH_HOST_KEY_CHANGED', 'GATEWAY_DNS_HOST_IDENTITY_CHANGED', 'GATEWAY_DNS_ADMIN_REQUIRED']) assert.equal(gatewayDnsRetry(code, 1, now), null)
const running = { state: 'running', actor: 1, attempt: 1, step: 'install' }
assert.equal(resumeGatewayDnsState(running, true, now), running)
assert.equal(resumeGatewayDnsState(running, false, now).state, 'queued')
assert.equal(resumeGatewayDnsState({ ...running, attempt: 3 }, false, now).state, 'failed')
const thousand = Array.from({ length: 1000 }, (_, index) => resumeGatewayDnsState({ ...running, actor: index + 1 }, false, now))
assert.equal(thousand.filter(item => item.state === 'queued').length, 1000)

const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } })
app.decorate('authenticateAdmin', async (req, reply) => {
  if (req.headers['x-role'] !== 'admin') return reply.code(403).send({ code: 'ADMIN_REQUIRED' })
  req.user = { id: Number(req.headers['x-actor'] || 1), username: 'admin', role: 'admin', sid: req.headers['x-no-session'] ? undefined : 'session-1' }
})
const old = process.env.ADMIN_FRONTEND_URL
process.env.ADMIN_FRONTEND_URL = 'https://admin.example.com'
let writes = 0
const progress = { id, actorId: 1, state: 'queued', step: 'connect', errorCode: null, updatedAt: new Date(now).toISOString() }
await registerSimpleGatewaySetupRoutes(app, { available: () => true, read: async () => progress,
  request: async () => { writes++; return progress }, confirm: async () => { writes++; return progress } })
const headers = { 'x-role': 'admin', origin: 'https://admin.example.com', authorization: 'Bearer fixture' }
try {
  for (const path of ['/gateway/setup', '/gateway/setup/' + id]) assert.equal((await app.inject({ url: path })).statusCode, 403)
  for (const path of ['/gateway/setup', '/gateway/setup/' + id + '/confirm']) {
    const payload = path.endsWith('/confirm') ? { planHash: hash } : { requestId: id, sshAddress: '8.8.4.4', password: 'fixture-only' }
    for (const change of [{ 'x-role': 'user' }, { origin: 'https://evil.example.com' }, { 'x-no-session': '1' },
      { authorization: '' }, { 'sec-fetch-site': 'cross-site' }]) assert.equal((await app.inject({ method: 'POST', url: path, headers: { ...headers, ...change }, payload })).statusCode, 403)
    assert.equal(writes, path.endsWith('/confirm') ? 1 : 0)
    assert.equal((await app.inject({ method: 'POST', url: path, headers, payload: { ...payload, command: 'id' } })).statusCode, 400)
    assert.equal((await app.inject({ method: 'POST', url: path, headers, payload })).statusCode, 202)
  }
  assert.equal((await app.inject({ url: '/gateway/setup/' + id, headers: { ...headers, 'x-actor': '2' } })).statusCode, 403)
  assert.equal((await app.inject({ url: '/gateway/setup/' + id, headers })).headers['cache-control'], 'no-store')
} finally { await app.close(); if (old === undefined) delete process.env.ADMIN_FRONTEND_URL; else process.env.ADMIN_FRONTEND_URL = old }
const worker = readFileSync(fileURLToPath(new URL('../src/scripts/run-simple-gateway-setup.ts', import.meta.url)), 'utf8')
assert.match(worker, /constants\.O_RDWR \| constants\.O_NOFOLLOW/)
assert.match(worker, /info\.nlink !== 1/)
assert.match(worker, /info\.uid !== owner/)
assert.match(worker, /verifiedRequestFile && !keepSecret/)
assert.match(worker, /prisma\.tokenInvalidation\.findFirst/)
assert.match(worker, /select: SIMPLE_GATEWAY_ADMIN_SELECT/)
assert.match(worker, /await observedStateHash\(\) !== observed/)
assert.doesNotMatch(worker, /writeFile\(requestPath/)
const installer = readFileSync(fileURLToPath(new URL('../../scripts/install-local-gateway-worker.sh', import.meta.url)), 'utf8')
assert.match(installer, /\/usr\/bin\/systemctl daemon-reload/)
assert.match(installer, /ReadWritePaths=\/var\/lib\/incudal-local-gateway\/inbox/)
assert.doesNotMatch(installer, /^systemctl /m)
console.log('Simple gateway: strict requests, immutable plans, route authorization, bounded retries and restart recovery passed')
process.exit(0)
