import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { request as httpRequest } from 'node:http'
import { getTrustProxyConfig, getTrustProxyEnabled } from '../src/lib/trust-proxy-config.js'

const originalTrustProxy = process.env.TRUST_PROXY
const originalTrustProxyHops = process.env.TRUST_PROXY_HOPS
const originalNodeEnv = process.env.NODE_ENV

function setTrustProxy(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.TRUST_PROXY
  } else {
    process.env.TRUST_PROXY = value
  }
}

async function verifyClientAddresses(): Promise<void> {
  setTrustProxy('true')
  delete process.env.TRUST_PROXY_HOPS
  const app = Fastify({ trustProxy: getTrustProxyConfig() })
  await app.register(rateLimit, { global: false })
  app.get('/', request => ({ ip: request.ip }))
  app.get('/limited', { config: { rateLimit: { max: 1, timeWindow: 60000 } } }, request => ({ ip: request.ip }))
  let cases = 0
  try {
    const check = async (peer: string, forwarded: string | undefined, expected: string) => {
      const response = await app.inject({
        method: 'GET', url: '/', remoteAddress: peer,
        headers: {
          ...(forwarded === undefined ? {} : { 'x-forwarded-for': forwarded }),
          'x-real-ip': '192.0.2.99', 'cf-connecting-ip': '192.0.2.99'
        }
      })
      assert.equal(response.statusCode, 200)
      assert.equal(response.json().ip, expected, `peer ${peer}, XFF ${forwarded}`)
      cases++
    }
    // Real client is rightmost before the local proxy suffix, even if a client
    // supplied additional XFF or provider-specific headers before reaching it.
    await check('127.0.0.1', '198.51.100.24, 127.0.0.1', '198.51.100.24')
    await check('127.0.0.1', '198.51.100.24', '198.51.100.24')
    await check('127.0.0.1', '192.0.2.99, 198.51.100.24, 127.0.0.1', '198.51.100.24')
    await check('127.0.0.1', '192.0.2.99, 198.51.100.24', '198.51.100.24')
    await check('127.0.0.1', '198.51.100.24, 127.0.0.2, ::1', '198.51.100.24')
    await check('::ffff:127.0.0.1', '2001:db8::24, ::ffff:127.0.0.1', '2001:db8::24')
    await check('::1', '2001:db8::24, ::1', '2001:db8::24')
    await check('198.51.100.24', '192.0.2.99, 127.0.0.1', '198.51.100.24')
    await check('::ffff:198.51.100.24', '192.0.2.99', '::ffff:198.51.100.24')
    await check('2001:db8::24', '192.0.2.99', '2001:db8::24')
    await check('10.0.0.12', '192.0.2.99', '10.0.0.12')
    await check('127.0.0.1', '192.0.2.99, 10.0.0.12', '10.0.0.12')
    await check('127.0.0.1', undefined, '127.0.0.1')
    await check('127.0.0.1', '', '127.0.0.1')

    const limited = (forwarded: string) => app.inject({ method: 'GET', url: '/limited', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': forwarded } })
    assert.equal((await limited('198.51.100.24, 127.0.0.1')).statusCode, 200)
    assert.equal((await limited('192.0.2.99, 198.51.100.24, 127.0.0.1')).statusCode, 429, 'spoofed leading XFF cannot reset the real client limit')
    assert.equal((await limited('198.51.100.25, 127.0.0.1')).statusCode, 200, 'different Tunnel users must not share the loopback limit')

    // Also exercise a real HTTP socket with the same headers Nginx sends.
    const address = await app.listen({ host: '127.0.0.1', port: 0 })
    const payload = await new Promise<string>((resolve, reject) => {
      const req = httpRequest(address, { headers: { 'x-forwarded-for': '192.0.2.99, 198.51.100.24, 127.0.0.1' } }, res => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', chunk => { body += chunk })
        res.on('end', () => resolve(body))
        res.on('error', reject)
      })
      req.setTimeout(5000, () => req.destroy(new Error('HTTP proxy regression timed out')))
      req.on('error', reject)
      req.end()
    })
    assert.equal(JSON.parse(payload).ip, '198.51.100.24')
    console.log(`PASS ${cases} client IP and spoofed-header cases, per-client rate limits and real HTTP socket`)
  } finally {
    await app.close()
  }
}

try {
  process.env.NODE_ENV = 'production'
  delete process.env.TRUST_PROXY_HOPS

  setTrustProxy(undefined)
  assert.equal(getTrustProxyEnabled(), false, 'production must not trust proxy headers implicitly')
  assert.equal(getTrustProxyConfig(), false)

  for (const enabledValue of ['true', '1', 'yes', 'on']) {
    setTrustProxy(enabledValue)
    const config = getTrustProxyConfig()
    assert.deepEqual(config, ['127.0.0.0/8', '::1/128'], `${enabledValue} must trust only loopback proxies by default`)
    assert.notEqual(config, true, `${enabledValue} must never trust the entire proxy chain`)
    assert.equal(getTrustProxyEnabled(), true)
  }

  process.env.TRUST_PROXY_HOPS = '3'
  setTrustProxy('true')
  assert.equal(getTrustProxyConfig(), 3)

  process.env.TRUST_PROXY_HOPS = 'invalid'
  assert.deepEqual(getTrustProxyConfig(), ['127.0.0.0/8', '::1/128'], 'invalid TRUST_PROXY_HOPS must fall back to loopback addresses')
  delete process.env.TRUST_PROXY_HOPS

  setTrustProxy('2')
  assert.equal(getTrustProxyConfig(), 2)
  process.env.TRUST_PROXY_HOPS = '3'
  assert.equal(getTrustProxyConfig(), 2, 'explicit numeric trust config retains precedence over HOPS')
  delete process.env.TRUST_PROXY_HOPS

  setTrustProxy('127.0.0.1, 10.0.0.0/8')
  assert.deepEqual(getTrustProxyConfig(), ['127.0.0.1', '10.0.0.0/8'])

  for (const disabledValue of [undefined, '', 'false', '0', 'no', 'off']) {
    setTrustProxy(disabledValue)
    assert.equal(getTrustProxyConfig(), false)
  }

  setTrustProxy('invalid')
  assert.equal(getTrustProxyConfig(), false, 'invalid TRUST_PROXY must fail closed')

  const appSource = readFileSync(fileURLToPath(new URL('../src/app.ts', import.meta.url)), 'utf8')
  assert.match(appSource, /trustProxy:\s*getTrustProxyConfig\(\)/, 'app must use the constrained trust proxy config')
  assert.doesNotMatch(appSource, /trustProxy:\s*getTrustProxyEnabled\(\)/)

  await verifyClientAddresses()
  console.log('trust proxy config tests passed')
} finally {
  if (originalTrustProxy === undefined) {
    delete process.env.TRUST_PROXY
  } else {
    process.env.TRUST_PROXY = originalTrustProxy
  }

  if (originalTrustProxyHops === undefined) {
    delete process.env.TRUST_PROXY_HOPS
  } else {
    process.env.TRUST_PROXY_HOPS = originalTrustProxyHops
  }

  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = originalNodeEnv
  }
}
