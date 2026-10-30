import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mock } from 'node:test'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = randomBytes(32).toString('hex')
const intervals: Array<{ callback: () => void; timer: ReturnType<typeof setInterval>; source: string }> = []
const originalInterval = globalThis.setInterval
mock.method(globalThis, 'setInterval', ((callback: (...args: any[]) => void, milliseconds?: number, ...args: any[]) => {
  const timer = originalInterval(callback, milliseconds, ...args)
  timer.unref(); intervals.push({ callback: () => callback(...args), timer, source: String(callback) })
  return timer
}) as typeof setInterval)
const security = await import('../src/lib/security.js')
const { closePrismaDatabase } = await import('../src/db/prisma.js')
const cleanup = (name: string) => {
  const matches = intervals.filter(item => item.source.includes(name))
  assert.equal(matches.length, 1, 'Find the original nonce cleanup callback: ' + name)
  return matches[0].callback
}
const stateCleanup = cleanup('usedNonces'), codeCleanup = cleanup('usedLoginCodeNonces')
let now = Date.now()
mock.method(Date, 'now', () => now)
const initial = now
const cases = [
  { name: 'state', ttl: 600000, cleanup: stateCleanup, issue: () => security.generateOAuthState('login', '/dashboard'), consume: security.verifyAndConsumeOAuthState },
  { name: 'login-code', ttl: 60000, cleanup: codeCleanup, issue: () => security.generateOAuthLoginCode({ userId: 1, username: 'fixture', role: 'user' }), consume: security.verifyAndConsumeOAuthLoginCode }
]
let failure: unknown
try {
  const boundaryErrors: string[] = []
  for (const item of cases) {
    now = initial
    const old = await item.issue(); assert.ok(await item.consume(old))
    now = initial + item.ttl - 100
    const recent = await item.issue(); assert.ok(await item.consume(recent))
    now = initial + item.ttl + 1; item.cleanup()
    assert.equal(await item.consume(old), null, 'Expired entries stay invalid after cleanup')
    assert.equal(await item.consume(recent), null, 'Cleanup must retain a consumed entry still within TTL')
    const concurrent = await item.issue()
    const results = await Promise.all(Array.from({ length: 20 }, () => item.consume(concurrent)))
    assert.equal(results.filter(Boolean).length, 1)
    const intact = await item.issue()
    const parts = intact.split('.'); parts[0] = Buffer.from('{"nonce":"tampered"}').toString('base64url')
    assert.equal(await item.consume(parts.join('.')), null)
    assert.ok(await item.consume(intact), 'Invalid signature must not consume the original nonce')
    console.log('PASS', item.name, 'cleanup retains unexpired consumed entries, expired entries reject, concurrent consume is unique and tampering preserves original')
    now = initial + item.ttl * 3
    const boundary = await item.issue(); assert.ok(await item.consume(boundary))
    now += item.ttl; item.cleanup()
    if (await item.consume(boundary) !== null) boundaryErrors.push(item.name + ': consumed token replays at exact cleanup expiry')
    const unused = await item.issue(); now += item.ttl
    if (await item.consume(unused) !== null) boundaryErrors.push(item.name + ': unused token accepts at exact expiry')
    now += 1; assert.equal(await item.consume(unused), null)
  }
  assert.deepEqual(boundaryErrors, [], 'Expiry and cleanup boundaries must agree for both token types')
  console.log('PASS both exact TTL boundaries reject used and unused tokens with or without cleanup')
} catch (error) { failure = error }
finally {
  for (const item of intervals) clearInterval(item.timer)
  mock.restoreAll(); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
