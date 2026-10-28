import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { Agent } from 'undici'
import { parsePositivePaymentMoney } from '../src/lib/payment-money.js'
import { IncusClient } from '../src/lib/incus/incus-client.js'
import { waitForOperation } from '../src/lib/incus/incus-utils.js'
import { formatBytes } from '../../client/src/utils/formatters.js'

// The inspected read-only API shares a module with persistence helpers. It must
// never discover or connect to an operator database in this isolated test.
process.env.DATABASE_URL = 'postgresql://fixture:fixture@127.0.0.1:1/unused_review_fixture'
const { containsDangerousChars, removeDangerousChars, validateName } = await import('../src/lib/security.js')
const { execWithOutput, stopInstance } = await import('../src/lib/incus/incus-instances.js')
const { detectCloudInitStatus } = await import('../src/lib/cloud-init-status.js')
const { closePrismaDatabase } = await import('../src/db/prisma.js')

for (let i = 0; i < 8; i++) {
  assert.equal(containsDangerousChars('!'), true)
  assert.equal(validateName('bad!').valid, false)
}
assert.equal(removeDangerousChars('!name!'), 'name')
for (const amount of [undefined, null, '', ' ', 'NaN', 'Infinity', '10junk', '0x10', '1e1', '-1', '0', 0, -1, NaN, Infinity, [], {}]) {
  assert.equal(parsePositivePaymentMoney(amount), undefined, String(amount))
}
for (const amount of [10, '10', '10.00', ' 10.01 ', '0.01']) assert.equal(parsePositivePaymentMoney(amount), Number(amount))
const recharge = readFileSync(new URL('../src/routes/recharge.ts', import.meta.url), 'utf8')
assert.match(recharge, /paidAmount = parsePositivePaymentMoney\(queryResult.money\)/)
assert.match(recharge, /paidAmount === undefined \|\| Math.abs\(paidAmount - orderAmount\)/)
assert.match(recharge, /actualAmount = parsePositivePaymentMoney\(callbackData.money\)/)
assert.equal(formatBytes(1024 ** 5), '1.0 PB')
assert.equal(formatBytes(1024 ** 6), '1.0 EB')
assert.equal(formatBytes(Infinity), '0 B')

for (const status of ['Cancelled', 'Canceled', 'Failure']) {
  let calls = 0
  await assert.rejects(waitForOperation({ request: async () => { calls++; return { status, err: 'specific reason' } } } as any,
    '/1.0/operations/one', 100), /specific reason/)
  assert.equal(calls, 1)
}

let outputStatus = 200, stalled = false
const http = createServer((req, res) => {
  if (stalled) return
  if (req.url?.endsWith('/exec')) {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ type: 'sync', metadata: { return: 0, output: { 1: '/stdout', 2: '/stderr' } } }))
  } else { res.writeHead(outputStatus); res.end(req.url === '/stdout' ? 'command output' : '') }
})
http.listen(0, '127.0.0.1'); await once(http, 'listening')
const client = Object.assign(Object.create(IncusClient.prototype) as IncusClient, {
  baseUrl: `http://127.0.0.1:${(http.address() as { port: number }).port}`, agent: new Agent(), connected: true
})
try {
  assert.equal((await execWithOutput(client, 'one', ['true'], {}, 1000)).stdout, 'command output')
  outputStatus = 500
  await assert.rejects(execWithOutput(client, 'one', ['true'], {}, 1000), /output read failed: HTTP 500/)
  stalled = true
  const start = Date.now()
  await assert.rejects(execWithOutput(client, 'one', ['true'], {}, 80), /timeout|abort/i)
  assert.ok(Date.now() - start < 1000, 'header wait belongs to the command deadline')
} finally {
  await client.agent!.destroy()
  http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve()))
}

// Exercise public stop retry with the recursive Incus payload and neighboring name.
let writes = 0
const deleted: string[] = []
const operation = (id: string, name: string) => ({ id, status: 'Running', description: 'Updating instance', may_cancel: true,
  created_at: new Date(Date.now() - 60000).toISOString(), resources: { instances: [`/1.0/instances/${name}?project=default`] } })
const busyClient = { async request(method: string, path: string) {
  if (method === 'DELETE') { deleted.push(path); return {} }
  if (path === '/1.0/operations?recursion=1') return { running: [operation('target', 'i-1'), [operation('neighbor', 'i-10')]] }
  if (method === 'GET') return { status: 'Running' }
  if (writes++ === 0) throw new Error('busy running a "update" operation')
  return {}
} }
await stopInstance(busyClient as any, 'i-1', false, { allowCancelBusyUpdate: true, busyUpdateCancelAfterMs: 0 })
assert.deepEqual(deleted, ['/1.0/operations/target'])

async function cloud(status: unknown, result?: unknown, bootFinished = false) {
  return detectCloudInitStatus({ readFile: async (path: string) => {
    const decoded = decodeURIComponent(path)
    if (decoded.includes('status.json') && status !== undefined) return { statusCode: 200, content: JSON.stringify(status) }
    if (decoded.includes('result.json') && result !== undefined) return { statusCode: 200, content: JSON.stringify(result) }
    if (decoded.includes('boot-finished') && bootFinished) return { statusCode: 200, content: '' }
    return { statusCode: 404, content: '' }
  } } as any, { id: 1, incus_id: 'one', image: 'debian/13/cloud' })
}
assert.equal((await cloud({ v1: { stage: 'modules-final', 'modules-final': { start: 1, end: null, errors: [] } } }, { v1: { errors: [] } }, true)).ready, false)
assert.equal((await cloud({ v1: { stage: null, 'modules-final': { start: 1, end: 2, errors: [] } } }, { v1: { errors: ['final command failed'] } })).state, 'done_with_errors')
assert.equal((await cloud(undefined, { v1: { errors: [] } })).state, 'done')
assert.equal((await cloud(undefined, undefined, true)).state, 'done')
assert.equal((await cloud({ status: 'disabled' })).state, 'disabled')
await closePrismaDatabase()
console.log('review core boundaries: money, names, units, cancellation, real HTTP deadlines/output and cloud-init passed')
// security.ts owns application cleanup intervals; this standalone process is done.
process.exit(0)
