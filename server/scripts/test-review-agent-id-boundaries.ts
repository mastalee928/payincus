import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/agent.js')
const tag = 'agent-id-' + randomUUID()
const user = await prisma.user.create({ data: { username: tag, role: 'admin', passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: user.id, name: tag, url: 'https://127.0.0.1:1' } })
const emptyHost = await prisma.host.create({ data: { userId: user.id, name: tag + '-empty', url: 'https://127.0.0.1:1' } })
const agent = await prisma.hostAgent.create({ data: { hostId: host.id, agentId: tag, secretHash: 'unusable-fixture', secretEncrypted: 'unusable-fixture',
  installTokenHash: tag, installTokenExpiresAt: new Date(Date.now() + 3600000) } })
await prisma.hostAgentNonce.create({ data: { agentId: tag, nonce: tag, expiresAt: new Date(Date.now() + 3600000) } })
const app = Fastify()
app.decorate('authenticate', async (request: any) => {
  request.user = { id: user.id, username: user.username, role: 'admin', sid: tag, iat: Math.floor(Date.now() / 1000) + 10 }
})
app.decorate('authenticateAdmin', app.authenticate)
const originalFetch = globalThis.fetch; let externalRequests = 0
globalThis.fetch = (async () => { externalRequests++; throw Error('ID checks must not fetch releases or contact hosts') }) as typeof fetch
const requests = (id: string) => [
  { method: 'GET' as const, url: `/agent/hosts/${id}/status` },
  { method: 'POST' as const, url: `/agent/hosts/${id}/upgrade`, payload: {} },
  { method: 'POST' as const, url: `/agent/hosts/${id}/install-command`, payload: {} },
  { method: 'GET' as const, url: `/agent/admin/hosts/${id}/status` },
  { method: 'POST' as const, url: `/agent/admin/hosts/${id}/credentials`, payload: {} },
  { method: 'POST' as const, url: `/agent/admin/hosts/${id}/install-command`, payload: {} }
]
const capture = async () => ({ host: await prisma.host.findUniqueOrThrow({ where: { id: host.id } }),
  agent: await prisma.hostAgent.findUniqueOrThrow({ where: { id: agent.id } }),
  nonces: await prisma.hostAgentNonce.findMany({ where: { agentId: tag } }),
  audits: await prisma.log.findMany({ where: { userId: user.id } }) })
let failure: unknown
try {
  await app.register(routes, { prefix: '/agent' })
  const before = await capture()
  const overflow = await app.inject(requests('2147483648')[0])
  assert.equal(overflow.statusCode, 400, 'Agent host ID beyond PostgreSQL Int must be rejected before querying')
  const invalid = ['0', '-1', '1.5', '1e3', `${host.id}suffix`, `0${host.id}`, '%2B1', '%201',
    '2147483648', '9007199254740991', '9007199254740992', 'NaN', 'Infinity', '0x10']
  for (const id of invalid) for (const request of requests(id)) {
    const response = await app.inject(request)
    assert.equal(response.statusCode, 400, request.method + ' ' + request.url)
    assert.equal(response.json().code, 'INVALID_HOST_ID')
  }
  for (const request of requests('2147483647')) assert.equal((await app.inject(request)).statusCode, 404, request.url)
  for (const index of [0, 3]) {
    const response = await app.inject(requests(String(emptyHost.id))[index])
    assert.equal(response.statusCode, 200); assert.equal(response.json().host.id, emptyHost.id); assert.equal(response.json().agent, null)
  }
  assert.equal(externalRequests, 0)
  // Compare in memory; never dump installation credentials in assertion output.
  assert.ok(JSON.stringify(await capture()) === JSON.stringify(before), 'host identity, credential/nonce state and audit must be unchanged')
  console.log('PASS 84 invalid/overflow Agent requests reject before reads/rotation, six legal absent bounds return 404; existing host reads work, credentials/nonces unchanged and zero external requests')
} catch (error) { failure = error }
finally {
  globalThis.fetch = originalFetch; await app.close()
  await prisma.log.deleteMany({ where: { userId: user.id } }); await prisma.hostAgent.delete({ where: { id: agent.id } })
  await prisma.host.deleteMany({ where: { id: { in: [host.id, emptyHost.id] } } }); await prisma.user.delete({ where: { id: user.id } })
  await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }; process.exit(0)
