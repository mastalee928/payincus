import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { createHash, randomUUID } from 'node:crypto'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { rotateHostAgentCredentials } = await import('../src/lib/host-agent-credentials.js')
const { createAgentBodyHash, createAgentSignature } = await import('../src/lib/agent-auth.js')
const tag = randomUUID(), originalFetch = globalThis.fetch
const user = await prisma.user.create({ data: { username: `heartbeat-upgrade-${tag}`, passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: user.id, name: tag, url: 'https://127.0.0.1:1' } })
const actor = { id: user.id, sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
const bytes = Buffer.from('upgrade deadline test binary'), hash = createHash('sha256').update(bytes).digest('hex')
const version = 'v1.0.999', body = { version: 'v1.0.1', runtime: { goos: 'linux', goarch: 'amd64' }, metrics: { heartbeatIntervalSeconds: 30 } }
const release = [{ tag_name: 'agent-' + version, assets: ['x86_64', 'aarch64'].map((arch, index) => ({ name: `incudal-agent-${arch}-${version}`, size: bytes.length, url: `https://api.github.com/repos/mastalee928/payincus/releases/assets/${index + 1}` })) }]
let app: ReturnType<typeof Fastify> | undefined
try {
  for (const mode of ['headers', 'metadata-body', 'checksum-body']) {
    let releaseGate!: () => void, startedGate!: () => void
    const gate = new Promise<void>(resolve => { releaseGate = resolve }), started = new Promise<void>(resolve => { startedGate = resolve })
    let gated = false
    globalThis.fetch = async (url, options) => {
      assert.ok(options?.signal instanceof AbortSignal, 'external lookup keeps its own bounded fetch timeout')
      if (String(url).endsWith('/releases')) {
        if (mode === 'headers') { gated = true; startedGate(); await gate }
        if (mode === 'metadata-body') return new Response(new ReadableStream({ start(controller) { gated = true; startedGate(); void gate.then(() => { controller.enqueue(new TextEncoder().encode(JSON.stringify(release))); controller.close() }) } }), { headers: { 'content-type': 'application/json' } })
        return new Response(JSON.stringify(release), { headers: { 'content-type': 'application/json' } })
      }
      if (mode === 'checksum-body' && !gated) return new Response(new ReadableStream({ start(controller) { gated = true; startedGate(); void gate.then(() => { controller.enqueue(bytes); controller.close() }) } }))
      return new Response(bytes)
    }
    const routeUrl = new URL('../src/routes/agent.ts', import.meta.url); routeUrl.searchParams.set('deadline', mode)
    const routes = (await import(routeUrl.href)).default
    app = Fastify()
    for (const name of ['authenticate', 'authenticateAdmin']) app.decorate(name, async (request: any) => { request.user = actor })
    await app.register(routes, { prefix: '/agent' })
    const credentials = await rotateHostAgentCredentials(host.id, true, { actor })
    const sign = () => {
      const timestamp = String(Date.now()), nonce = randomUUID(), bodyHash = createAgentBodyHash(body)
      return { 'x-incudal-agent-id': credentials.agentId, 'x-incudal-timestamp': timestamp, 'x-incudal-nonce': nonce, 'x-incudal-body-sha256': bodyHash,
        'x-incudal-signature': createAgentSignature(credentials.agentSecret, { method: 'POST', path: '/agent/heartbeat', timestamp, nonce, bodyHash }) }
    }
    const request = app.inject({ method: 'POST', url: '/agent/heartbeat', headers: sign(), payload: body }).then(response => response)
    try {
      await Promise.race([started, new Promise<never>((_resolve, reject) => setTimeout(() => reject(Error('upgrade lookup did not reach the controlled stall')), 4000))])
      const response = await Promise.race([request, new Promise<null>(resolve => setTimeout(() => resolve(null), 1700))])
      assert.ok(response, 'optional lookup must return the authenticated heartbeat before the external request deadline')
      assert.equal(response.statusCode, 200); assert.equal(response.json().ok, true); assert.equal(response.json().upgrade.available, false)
      assert.equal((await prisma.hostAgent.findUniqueOrThrow({ where: { hostId: host.id } })).status, 'online')
    } finally { releaseGate(); await request }
    // Let the preserved background refresh finish, then verify the verified upgrade still appears.
    await new Promise(resolve => setTimeout(resolve, 60))
    const ready = await app.inject({ method: 'POST', url: '/agent/heartbeat', headers: sign(), payload: body })
    assert.equal(ready.statusCode, 200); assert.equal(ready.json().upgrade.available, true); assert.equal(ready.json().upgrade.sha256, hash)
    await app.close(); app = undefined
  }
  console.log('PASS actual HMAC/PostgreSQL heartbeat optional upgrade deadline for stalled headers/metadata body/checksum body, online records and later verified upgrades; external fetch controlled locally')
} finally {
  globalThis.fetch = originalFetch; await app?.close(); await prisma.host.delete({ where: { id: host.id } }); await prisma.user.delete({ where: { id: user.id } }); await closePrismaDatabase()
}
process.exit(0)
