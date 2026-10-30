import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Pool, type PoolClient } from 'pg'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol) &&
  ['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) &&
  database.pathname.endsWith('_pool_test') && !database.search && !database.hash,
  'requires an isolated local *_pool_test database')
const applicationName = `transaction-start-${randomUUID()}`
const pool = new Pool({ connectionString: database.href, max: 8, min: 0,
  application_name: applicationName, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000 })
const connections = new Map<number, PoolClient>()
pool.on('connect', connection => { connections.set((connection as PoolClient & { processID: number }).processID, connection) })
const observer = new Pool({ connectionString: database.href, max: 1, connectionTimeoutMillis: 3000 })
const factory = new PrismaPg(pool)
const connect = factory.connect.bind(factory)
let holdStartup = false, releaseStartup: (() => void) | undefined, startupReached: (() => void) | undefined
let rollbacks = 0, releases = 0
factory.connect = async () => {
  const adapter = await connect()
  const startTransaction = adapter.startTransaction.bind(adapter)
  adapter.startTransaction = async isolation => {
    const transaction = await startTransaction(isolation)
    if (holdStartup) {
      const execute = transaction.executeRaw.bind(transaction), rollback = transaction.rollback.bind(transaction)
      transaction.executeRaw = async query => {
        if (query.sql === 'ROLLBACK') rollbacks++
        return execute(query)
      }
      transaction.rollback = async () => { releases++; await rollback() }
      await new Promise<void>(resolve => { releaseStartup = resolve; startupReached?.() })
    }
    return transaction
  }
  return adapter
}
const client = new PrismaClient({ adapter: factory })
const held = new Set<PoolClient>()
let callbacks = 0, failure: unknown
const sessions = () => observer.query<{ pid: number; state: string; query: string }>(
  'SELECT pid, state, query FROM pg_stat_activity WHERE datname = current_database() AND application_name = $1', [applicationName])
async function recovered(): Promise<void> {
  const deadline = Date.now() + 2500
  while (Date.now() < deadline) {
    const rows = (await sessions()).rows
    if (pool.waitingCount === 0 && pool.idleCount === pool.totalCount &&
      rows.every(row => !row.state.startsWith('idle in transaction'))) return
    await delay(10)
  }
  const rows = (await sessions()).rows
  assert.fail(`pool not reclaimed: total=${pool.totalCount}, idle=${pool.idleCount}, waiting=${pool.waitingCount}, sessions=${JSON.stringify(rows)}`)
}
try {
  await client.$connect()
  for (let round = 0; round < 4; round++) {
    for (let index = 0; index < 8; index++) held.add(await pool.connect())
    const rejected = await Promise.allSettled(Array.from({ length: 12 }, () => client.$transaction(async tx => {
      callbacks++
      return tx.$queryRawUnsafe('SELECT 1')
    }, { maxWait: 40, timeout: 1000 })))
    for (const result of rejected) {
      assert.equal(result.status, 'rejected')
      if (result.status === 'rejected') {
        assert.equal(result.reason.code, 'P2028')
        assert.match(result.reason.message, /Unable to start a transaction/)
      }
    }
    assert.equal(callbacks, 0, 'timed-out application callbacks must never execute')
    for (const connection of held) connection.release()
    held.clear()
    await recovered()
    await client.$queryRawUnsafe('SELECT 1')
    console.log(`PASS round ${round + 1}: twelve timed-out starts reclaim all eight connections, no idle transaction or late callback`)
  }
  const connection = await pool.connect()
  held.add(connection)
  for (let index = 0; index < 7; index++) held.add(await pool.connect())
  const successful = client.$transaction(async tx => {
    callbacks++
    return tx.$queryRawUnsafe<{ answer: number }[]>('SELECT 42::int AS answer')
  }, { maxWait: 1500, timeout: 1000 })
  await delay(40)
  connection.release(); held.delete(connection)
  assert.equal((await successful)[0].answer, 42)
  assert.equal(callbacks, 1, 'valid queued transactions must still run once')
  for (const heldConnection of held) heldConnection.release()
  held.clear()
  await assert.rejects(client.$transaction(async tx => {
    await tx.$executeRawUnsafe('CREATE TEMP TABLE rollback_probe (id int)')
    throw new Error('fixture application rollback')
  }), /fixture application rollback/)
  await recovered()
  assert.deepEqual(await client.$queryRawUnsafe<{ count: number }[]>(
    "SELECT count(*)::int AS count FROM pg_tables WHERE tablename = 'rollback_probe' AND schemaname LIKE 'pg_temp_%'"), [{ count: 0 }])
  console.log('PASS valid delayed admission, commit and application rollback retain normal transaction behavior')
  holdStartup = true
  const reached = new Promise<void>(resolve => { startupReached = resolve })
  const abandoned = client.$transaction(async () => { callbacks++; return 'must not run' }, { maxWait: 60, timeout: 1000 })
  const abandonedCheck = assert.rejects(abandoned, /Unable to start a transaction/)
  await reached
  assert.ok((await sessions()).rows.some(row => row.state === 'idle in transaction' && row.query === 'BEGIN'),
    'the delayed adapter must have executed real BEGIN before startup times out')
  await abandonedCheck
  releaseStartup!(); releaseStartup = undefined
  holdStartup = false
  await recovered()
  assert.equal(rollbacks, 1, 'late successful BEGIN must receive SQL ROLLBACK exactly once')
  assert.equal(releases, 1, 'late successful BEGIN must be released exactly once')
  assert.equal(callbacks, 1, 'an abandoned opened transaction cannot reach application work')
  console.log('PASS real BEGIN delayed past maxWait rolls back and releases exactly once with no late callback')
  holdStartup = true
  const failedReached = new Promise<void>(resolve => { startupReached = resolve })
  const failedStartup = assert.rejects(client.$transaction(async () => { callbacks++ }, { maxWait: 60, timeout: 1000 }),
    /Unable to start a transaction/)
  await failedReached
  await failedStartup
  const orphan = (await sessions()).rows.find(row => row.state === 'idle in transaction' && row.query === 'BEGIN')
  assert.ok(orphan, 'rollback failure test must terminate only its actual abandoned transaction')
  const orphanClient = connections.get(orphan.pid)
  assert.ok(orphanClient)
  const disconnected = new Promise<void>(resolve => orphanClient.once('end', resolve))
  await observer.query('SELECT pg_terminate_backend($1)', [orphan.pid])
  await disconnected
  releaseStartup!(); releaseStartup = undefined
  holdStartup = false
  await recovered()
  assert.equal(rollbacks, 2)
  assert.equal(releases, 2, 'failed rollback must still release its dead connection exactly once')
  assert.equal(callbacks, 1)
  console.log('PASS lost backend during discarded rollback still releases once and subsequent queries remain available')
  for (let index = 0; index < 8; index++) held.add(await pool.connect())
  await assert.rejects(client.$transaction(async () => { callbacks++ }, { maxWait: 40, timeout: 1000 }), /Unable to start a transaction/)
  const deadline = Date.now() + 3500
  while (pool.waitingCount > 0 && Date.now() < deadline) await delay(10)
  assert.equal(pool.waitingCount, 0, 'the underlying connection timeout must remove the abandoned waiter')
  for (const connection of held) connection.release()
  held.clear()
  await recovered()
  assert.equal(callbacks, 1)
  await assert.rejects(client.$transaction(async tx => { await tx.$queryRawUnsafe('SELECT 1'); await delay(100) },
    { maxWait: 1000, timeout: 40 }), /expired transaction/)
  await recovered()
  assert.equal((await client.$queryRawUnsafe<{ answer: number }[]>('SELECT 7::int AS answer'))[0].answer, 7)
  console.log('PASS late acquisition rejection and execution timeout reclaim connections without unhandled startup errors')
} catch (error) { failure = error }
finally {
  releaseStartup?.()
  for (const connection of held) connection.release()
  // Each session is confined to this test's random application name and local fixture database.
  const rows = (await sessions()).rows
  for (const row of rows) await observer.query('SELECT pg_terminate_backend($1)', [row.pid])
  await observer.end()
  // Broken historical adapters can retain checked-out dead clients; exit explicitly after fixture cleanup.
  if (!failure) { await client.$disconnect(); await pool.end() }
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
