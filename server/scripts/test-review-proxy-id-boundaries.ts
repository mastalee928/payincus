import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mock } from 'node:test'
import Fastify from 'fastify'
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/proxy-sites.js')
const { CaddyClient, closeCaddyClients } = await import('../src/lib/caddy-client.js')
const tag = 'site-id-' + randomUUID()
const user = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: user.id, name: tag, url: 'https://127.0.0.1:1' } })
const instance = await prisma.instance.create({ data: { userId: user.id, hostId: host.id, name: tag, incusId: tag,
  image: 'fixture/debian', status: 'running', cpu: 100, memory: 512, disk: 1024 } })
const site = await prisma.proxySite.create({ data: { instanceId: instance.id, hostId: host.id, domain: tag + '.example', targetPort: 8080,
  remark: 'original', enabled: true, httpsEnabled: false, status: 'pending' } })
const app = Fastify()
app.decorate('authenticate', async (request: any) => {
  request.user = { id: user.id, username: user.username, role: 'user', sid: tag, iat: Math.floor(Date.now() / 1000) + 10 }
})
app.decorate('authenticateUser', app.authenticate)
let remoteCalls = 0
mock.method(CaddyClient.prototype, 'reconcileManagedSite', async () => { remoteCalls++; throw Error('Invalid IDs cannot reach Caddy') })
const requestId = randomUUID()
const siteRequests = (id: string, siteId: string) => {
  const path = `/instances/${id}/sites/${siteId}`, payload = { requestId, expectedRevision: 0 }
  return [
    { method: 'DELETE' as const, url: path, payload },
    { method: 'POST' as const, url: path + '/check-dns', payload },
    { method: 'POST' as const, url: path + '/refresh', payload },
    { method: 'PATCH' as const, url: path, payload: { remark: 'updated' } },
    { method: 'POST' as const, url: path + '/toggle', payload: { ...payload, enabled: false } },
    { method: 'POST' as const, url: path + '/retry', payload },
    { method: 'GET' as const, url: path + '/certificate' }
  ]
}
const requests = (id: string) => [
  { method: 'GET' as const, url: `/instances/${id}/sites` },
  { method: 'POST' as const, url: `/instances/${id}/sites`, payload: { domain: 'fixture.example', targetPort: 8080 } },
  ...siteRequests(id, String(site.id)), ...siteRequests(String(instance.id), id)
]
const capture = async () => ({ instance: await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } }),
  site: await prisma.proxySite.findUniqueOrThrow({ where: { id: site.id } }),
  operations: await prisma.proxySiteOperation.findMany({ where: { instanceId: instance.id } }),
  audits: await prisma.log.findMany({ where: { userId: user.id } }) })
let failure: unknown
try {
  await app.register(routes)
  const before = await capture()
  assert.equal((await app.inject(requests('2147483648')[0])).statusCode, 400, 'Proxy instance IDs beyond PG Int must reject before querying')
  const invalid = ['0', '-1', '1.5', '1e3', `${site.id}suffix`, `0${instance.id}`, '%2B1', '%201', '2147483648',
    '9007199254740991', '9007199254740992', 'NaN', 'Infinity', '0x10']
  for (const id of invalid) for (const request of requests(id)) {
    const response = await app.inject(request)
    assert.equal(response.statusCode, 400, request.method + ' ' + request.url + ': ' + response.body)
    assert.equal(response.json().code, 'INVALID_ID')
  }
  for (const request of requests('2147483647')) {
    const response = await app.inject(request)
    assert.equal(response.statusCode, 404, request.url + ': ' + response.body)
  }
  const list = await app.inject({ method: 'GET', url: `/instances/${instance.id}/sites` })
  assert.equal(list.statusCode, 200); assert.equal(list.json().sites[0].id, site.id)
  const certificate = await app.inject(siteRequests(String(instance.id), String(site.id))[6])
  assert.equal(certificate.statusCode, 200); assert.equal(certificate.json().httpsEnabled, false)
  assert.equal(remoteCalls, 0); assert.deepEqual(await capture(), before)
  console.log('PASS 224 invalid proxy instance/site requests return 400, 16 valid absent bounds return 404; list/disabled certificate reads work, no Caddy dispatch or persistent changes')
} catch (error) { failure = error }
finally {
  mock.restoreAll(); await app.close(); await closeCaddyClients()
  await prisma.proxySiteOperation.deleteMany({ where: { instanceId: instance.id } })
  await prisma.log.deleteMany({ where: { userId: user.id } }); await prisma.proxySite.delete({ where: { id: site.id } })
  await prisma.instance.delete({ where: { id: instance.id } }); await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.delete({ where: { id: user.id } }); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }; process.exit(0)
