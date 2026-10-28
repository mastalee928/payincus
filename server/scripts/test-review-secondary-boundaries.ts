import assert from 'node:assert/strict'
import { parseConnections, parseProcesses, analyzeAuditData } from '../src/lib/instance-audit.js'

process.env.DATABASE_URL = 'postgresql://fixture:fixture@127.0.0.1:1/payincus_pool_test'
const { weightedRandomSelect } = await import('../src/db/lottery.js')
const { verifyTurnstileToken } = await import('../src/lib/turnstile.js')
const { closePrismaDatabase } = await import('../src/db/prisma.js')
const ss = parseConnections('Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port Process\ntcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=42,fd=3))')
assert.equal(ss.length, 1)
assert.deepEqual([ss[0]!.local, ss[0]!.peer, ss[0]!.state, ss[0]!.pid], ['0.0.0.0:22', '0.0.0.0:*', 'LISTEN', 42])
const netstat = parseConnections('Proto Recv-Q Send-Q Local Address Foreign Address State PID/Program name\ntcp 0 0 0.0.0.0:22 0.0.0.0:* LISTEN 42/sshd\nudp6 0 0 :::53 :::* 77/dns')
assert.equal(netstat.length, 2)
assert.deepEqual([netstat[0]!.local, netstat[0]!.peer, netstat[0]!.state, netstat[0]!.pid], ['0.0.0.0:22', '0.0.0.0:*', 'LISTEN', 42])
assert.deepEqual([netstat[1]!.local, netstat[1]!.peer, netstat[1]!.state, netstat[1]!.pid], [':::53', ':::*', '', 77])
const auditProcesses = () => parseProcesses('42 1 root S 0.0 0.0 00:01 hping3 hping3 --flood fixture')
assert.equal(analyzeAuditData({ processes: auditProcesses(), connections: [], startupItems: [], rules: [] }).findings.length, 0, 'explicit empty rules means all disabled')
assert.ok(analyzeAuditData({ processes: auditProcesses(), connections: [], startupItems: [] }).findings.length > 0)

const originalRandom = Math.random
try {
  Math.random = () => 0.1
  const exhausted = { id: 1, type: 'balance' as const, probability: 50, remainQuantity: 0 }
  const available = { id: 2, type: 'balance' as const, probability: 50, remainQuantity: 1 }
  assert.throws(() => weightedRandomSelect([exhausted, available]), /LOTTERY_CONFIG_ERROR/)
  const nothing = { id: 3, type: 'nothing' as const, probability: 0, remainQuantity: null }
  assert.equal(weightedRandomSelect([exhausted, available, nothing]).id, 3)
  Math.random = () => 0.7
  assert.equal(weightedRandomSelect([exhausted, available, nothing]).id, 2)
} finally { Math.random = originalRandom }

const originalFetch = globalThis.fetch
try {
  globalThis.fetch = (async (_url, options) => {
    assert.ok(options?.signal, 'Turnstile requests must have a deadline signal')
    assert.equal(options.signal.aborted, false)
    assert.equal(options.method, 'POST')
    assert.ok(String(options.body).includes('response=fixture'))
    return new Response(JSON.stringify({ success: true }), { headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  assert.equal((await verifyTurnstileToken('fixture', 'fixture-secret')).success, true)
  globalThis.fetch = (async () => { throw new DOMException('The operation timed out', 'TimeoutError') }) as typeof fetch
  assert.equal((await verifyTurnstileToken('fixture', 'fixture-secret')).success, false)
} finally { globalThis.fetch = originalFetch }
await closePrismaDatabase()
console.log('PASS secondary boundaries: netstat/ss parsing, explicit disabled rules, exhausted lottery probability and Turnstile deadline failure')
process.exit(0)
