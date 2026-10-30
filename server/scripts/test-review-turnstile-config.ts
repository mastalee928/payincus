import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mock } from 'node:test'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { updateSystemConfigs } = await import('../src/db/system-config.js')
const { invalidateAllConfigCache } = await import('../src/lib/config-cache.js')
const { turnstileVerifier } = await import('../src/lib/turnstile.js')
const { default: authRoutes } = await import('../src/routes/auth.js')
const { default: configRoutes } = await import('../src/routes/system-config.js')
const { stopSessionCleanup } = await import('../src/lib/terminal-proxy.js')
const keys = ['turnstile_enabled', 'turnstile_site_key', 'turnstile_secret_key']
const original = await prisma.systemConfig.findMany({ where: { key: { in: keys } } })
const site = randomBytes(20).toString('hex'), secret = randomBytes(24).toString('hex')
const endpoints = [
  { path: '/login', payload: { username: 'fixture', password: 'unusable-fixture' } },
  { path: '/register', payload: { username: 'fixture', password: 'unusable-fixture', email: 'fixture@example.invalid' } },
  { path: '/send-verification-code', payload: { email: 'fixture@example.invalid' } },
  { path: '/forgot-password/send-code', payload: { email: 'fixture@example.invalid' } },
  { path: '/forgot-password/reset', payload: { email: 'fixture@example.invalid', code: '000000', password: 'unusable-fixture' } }
]
let reached = 0, providerCalls = 0, providerMode: 'valid' | 'rejected' | 'malformed' = 'valid'
const registered = new Set<string>()
const app = Fastify()
app.decorate('authenticate', async () => { throw Error('No protected route should run') })
app.decorate('authenticateAdmin', app.authenticate)
app.addHook('onRoute', options => {
  if (options.method !== 'POST' || !endpoints.some(endpoint => options.url === '/auth' + endpoint.path)) return
  const hooks = Array.isArray(options.preHandler) ? options.preHandler : [options.preHandler]
  assert.deepEqual(hooks, [turnstileVerifier], 'All five real auth routes must use the same verifier')
  registered.add(options.url)
  // Stop after the real preHandler so this test cannot log in, send mail or change passwords.
  options.preHandler = [...hooks as [typeof turnstileVerifier], async (_request, reply) => { reached++; return reply.code(204).send() }]
})
mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
  providerCalls++
  assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify')
  assert.equal(options.method, 'POST'); assert.ok(options.signal)
  const form = new URLSearchParams(String(options.body))
  assert.equal(form.get('secret'), secret); assert.equal(form.get('response'), 'fixture-challenge')
  if (providerMode === 'malformed') return new Response('not-json', { status: 200 })
  return Response.json(providerMode === 'valid' ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] })
})
const post = (endpoint: typeof endpoints[number], token = false) => app.inject({ method: 'POST', url: '/auth' + endpoint.path,
  payload: { ...endpoint.payload, ...(token ? { turnstileToken: 'fixture-challenge' } : {}) } })
let failure: unknown
try {
  for (const key of keys) await prisma.systemConfig.upsert({ where: { key }, create: { key, value: '', type: 'string' }, update: {} })
  await app.register(authRoutes, { prefix: '/auth' }); await app.register(configRoutes, { prefix: '/config' }); await app.ready()
  assert.equal(registered.size, 5)
  for (const enabled of [false, true]) for (const hasSite of [true, false]) for (const hasSecret of [false, true]) {
    await updateSystemConfigs(keys.map((key, index) => ({ key, value: [String(enabled), hasSite ? site : '', hasSecret ? secret : ''][index] })))
    const required = enabled && hasSite && hasSecret
    const publicResponse = await app.inject({ method: 'GET', url: '/config/public' })
    assert.equal(publicResponse.statusCode, 200)
    const config = publicResponse.json()
    assert.equal(config.turnstileEnabled, required, `Public challenge state differs: enabled=${enabled}, site=${hasSite}, secret=${hasSecret}`)
    assert.equal(config.turnstileSiteKey, required ? site : null)
    assert.ok(!publicResponse.body.includes(secret)); assert.ok(!('turnstileSecretKey' in config))
    const beforeReached = reached, beforeCalls = providerCalls
    for (const endpoint of endpoints) {
      const response = await post(endpoint)
      assert.equal(response.statusCode, required ? 400 : 204, endpoint.path + ': ' + response.body)
      if (required) assert.equal(response.json().code, 'TURNSTILE_TOKEN_MISSING')
    }
    assert.equal(providerCalls, beforeCalls)
    assert.equal(reached - beforeReached, required ? 0 : 5)
    if (required) {
      for (const mode of ['valid', 'rejected', 'malformed'] as const) {
        providerMode = mode
        for (const endpoint of endpoints) {
          const response = await post(endpoint, true)
          assert.equal(response.statusCode, mode === 'valid' ? 204 : 403)
          if (mode !== 'valid') assert.equal(response.json().code, 'TURNSTILE_VERIFICATION_FAILED')
        }
      }
      assert.equal(reached - beforeReached, 5); assert.equal(providerCalls - beforeCalls, 15)
    }
  }
  console.log('PASS eight live configuration combinations and five original auth preHandlers agree with public challenge availability; missing/rejected/malformed tokens stop before auth actions, only valid tokens pass, no secret is public')
} catch (error) { failure = error }
finally {
  mock.restoreAll(); await app.close(); stopSessionCleanup()
  for (const key of keys) {
    const saved = original.find(row => row.key === key)
    if (saved) await prisma.systemConfig.update({ where: { key }, data: { value: saved.value, type: saved.type, label: saved.label,
      description: saved.description, updatedAt: saved.updatedAt } })
    else await prisma.systemConfig.deleteMany({ where: { key } })
  }
  invalidateAllConfigCache(); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
