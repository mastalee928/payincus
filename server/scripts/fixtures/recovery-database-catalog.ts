import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pgQuery, quoteIdentifier } from '../../src/services/platform-backup-database.js'
import { rollbackDatabasePlan, type RestoreJournal } from '../../src/services/platform-recovery-restore-journal.js'

// Exercise PostgreSQL's real JSON encoding, not a hand-written numeric catalog.
// Only these new, empty databases are renamed or removed.
export async function verifyRecoveryDatabaseCatalog() {
  const url = new URL(process.env.DATABASE_URL || '')
  assert.ok(url.hostname === '127.0.0.1' && url.port !== '5432' && url.pathname.endsWith('_test'))
  const source = await readFile(new URL('../../src/services/platform-backup-worker.ts', import.meta.url), 'utf8')
  const sql = source.match(/localDatabaseAdmin\(`(SELECT COALESCE\(json_agg\(json_build_object[^`]+FROM pg_database;)`\)/)?.[1]
  assert.ok(sql, 'actual rollback catalog query must exist')
  const id = randomUUID(), suffix = id.replaceAll('-', '')
  const names = { current: `catalog_test_${suffix}`, staging: `incudal_restore_${suffix}`,
    rollback: `incudal_before_${suffix}`, failed: `incudal_failed_${suffix}` }
  const admin = (query: string) => pgQuery(query, [], 'postgres')
  const catalog = async () => {
    const [row] = await admin(sql)
    // The root psql boundary serializes this value and the worker parses it.
    return JSON.parse(JSON.stringify(Object.values(row)[0])) as Array<{name:string;oid:number}>
  }
  const created = new Set<string>()
  const rename = async (from: string, to: string) => {
    assert.ok(created.has(from) && Object.values(names).includes(to))
    await admin(`ALTER DATABASE ${quoteIdentifier(from)} RENAME TO ${quoteIdentifier(to)}`)
    created.delete(from); created.add(to)
  }
  try {
    for (const name of [names.current, names.staging]) {
      await admin(`CREATE DATABASE ${quoteIdentifier(name)}`); created.add(name)
    }
    const oid = async (database: string) => (await pgQuery<{oid:number}>(
      'SELECT oid::int FROM pg_database WHERE datname=current_database()', [], database))[0].oid
    const record: RestoreJournal = { version: 2, taskId: id, workerPid: process.pid, rollbackBatchId: randomUUID(),
      database: names.current, staging: names.staging, rollback: names.rollback, originalOid: await oid(names.current),
      restoredOid: await oid(names.staging), stage: 'awaiting_review', config: {} as RestoreJournal['config'], files: [] }
    assert.deepEqual(rollbackDatabasePlan(record, await catalog()), [], 'before switching, original database already active')
    await rename(names.current, names.rollback); await rename(names.staging, names.current)
    const switched = await catalog()
    for (const name of [names.current, names.rollback]) assert.equal(typeof switched.find(row => row.name === name)?.oid, 'number')
    assert.throws(() => rollbackDatabasePlan({...record, originalOid: record.originalOid! + 1}, switched), /IDENTITY_CHANGED/)
    assert.throws(() => rollbackDatabasePlan({...record, restoredOid: record.restoredOid! + 1}, switched), /IDENTITY_CHANGED/)
    const steps = rollbackDatabasePlan(record, switched)
    assert.equal(steps.length, 2)
    for (const step of steps) {
      assert.deepEqual(rollbackDatabasePlan(record, await catalog())[0], step, 'each committed rename remains resumable')
      await rename(step.from, step.to)
    }
    assert.equal(await oid(names.current), record.originalOid)
    assert.equal(await oid(names.failed), record.restoredOid, 'restored database remains available after rollback')
    assert.deepEqual(rollbackDatabasePlan(record, await catalog()), [], 'completed rollback is idempotent')
    console.log('PASS real PostgreSQL rollback catalog: numeric OIDs, original/restored identity preserved, both rename boundaries and changed identities rejected')
  } finally {
    for (const name of created) await admin(`DROP DATABASE ${quoteIdentifier(name)}`)
  }
}
