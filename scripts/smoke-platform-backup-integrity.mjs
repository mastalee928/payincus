// Explicit, isolated Linux drill. Creates only UUID-named fixture/verification databases.
// No live application database is restored or changed; no row values or credentials are printed.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

assert.equal(process.platform, 'linux')
assert.equal(process.getuid(), 0)
assert.equal(process.env.RUN_BACKUP_INTEGRITY_DRILL, '1', 'Explicit isolated drill authorization required')
await import('/opt/incudal/server/dist/config/env.js')
const db = await import(process.env.INTEGRITY_DATABASE_MODULE || '/opt/incudal/server/dist/services/platform-backup-database.js')
const exec = promisify(execFile)
const originalUrl = process.env.DATABASE_URL
const connection = db.postgresConnection()
const suffix = randomUUID().replace(/-/g, '')
const source = `incudal_integrity_${suffix}`, restored = `incudal_integrity_copy_${suffix}`
const role = `incudal_integrity_role_${suffix.slice(0, 16)}`
const directory = await mkdtemp('/var/tmp/incudal-integrity-')
const q = db.quoteIdentifier
let sourceCreated = false, restoredCreated = false, roleCreated = false
try {
  await db.localDatabaseAdmin(`CREATE ROLE ${q(role)} NOLOGIN;`); roleCreated = true
  await db.localDatabaseAdmin(`CREATE DATABASE ${q(source)} OWNER ${q(connection.user)} TEMPLATE template0;`); sourceCreated = true
  const fixtureUrl = new URL(originalUrl); fixtureUrl.pathname = `/${source}`; process.env.DATABASE_URL = fixtureUrl.toString()
  await db.pgQuery(`
    CREATE TABLE _prisma_migrations (migration_name text, checksum text, finished_at timestamptz, rolled_back_at timestamptz);
    INSERT INTO _prisma_migrations VALUES ('fixture',repeat('a',64),now(),NULL);
    CREATE TABLE ledger (id bigint, amount numeric(30,8), note text, payload jsonb, bytes bytea, happened_at timestamptz, labels integer[], raw_json json);
    INSERT INTO ledger VALUES (9223372036854775807,0.00000001,'中文😀 '' "', '{"a":[1,null,"中"]}',decode('0001ff','hex'),'2026-10-20 13:14:15.123456+08','[2:3]={1,2}'::integer[], '{ "x": 1, "x": 2 }'::json);
    INSERT INTO ledger SELECT * FROM ledger;
    INSERT INTO ledger VALUES (NULL,99999999999999999999.12345678,NULL,NULL,NULL,NULL,NULL,NULL);
    CREATE SCHEMA "edge schema";
    CREATE TYPE "edge schema".state AS ENUM ('new','paid');
    CREATE TABLE "edge schema"."quoted.table" (id bigserial PRIMARY KEY, state "edge schema".state DEFAULT 'paid');
    INSERT INTO "edge schema"."quoted.table" DEFAULT VALUES;
    CREATE VIEW ledger_view AS SELECT amount FROM ledger;
    CREATE MATERIALIZED VIEW ledger_summary AS SELECT count(*) AS records FROM ledger;
    CREATE TABLE partitioned (id integer, amount numeric) PARTITION BY RANGE (id);
    CREATE TABLE partition_leaf PARTITION OF partitioned FOR VALUES FROM (0) TO (10);
    INSERT INTO partitioned VALUES (1,1.01),(2,2.02);
    CREATE TABLE concurrent_ledger (id bigserial PRIMARY KEY, amount numeric NOT NULL DEFAULT 0.01);
  `)
  await exec('/usr/sbin/runuser', ['-u', 'postgres', '--', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-p', connection.url.port || '5432', '-d', source, '-c', `GRANT SELECT ON public.ledger TO ${q(role)};`])
  const [{ oid }] = await db.pgQuery("SELECT lo_from_bytea(0,decode(repeat('ab',5000),'hex')) AS oid")
  let writing = true
  const writer = (async () => {
    while (writing) { await db.pgQuery('INSERT INTO concurrent_ledger DEFAULT VALUES'); await new Promise(resolve => setTimeout(resolve, 40)) }
  })()
  const dump = join(directory, 'database.dump')
  let captured
  try { captured = await db.captureDatabaseBackup(dump, directory) } finally { writing = false; await writer }
  const concurrent = captured.report.tables.find(table => table.name === 'concurrent_ledger')
  const [{ count }] = await db.pgQuery('SELECT count(*)::text AS count FROM concurrent_ledger')
  assert.ok(BigInt(count) > BigInt(concurrent.rows), 'fixture must commit writes after the exported snapshot')
  assert.equal(captured.report.tables.find(table => table.name === 'ledger').rows, '3')
  assert.equal(captured.report.largeObjects.objects, '1')
  const globals = await readFile(captured.globals, 'utf8')
  assert.ok(globals.includes(role), 'global role definitions must be preserved')
  const schemaSql = join(directory, 'archive-schema.sql')
  await exec('pg_restore', ['--schema-only', '--file', schemaSql, dump])
  assert.ok((await readFile(schemaSql, 'utf8')).includes(`TO ${role}`), 'table grants must be preserved in the full archive')
  await db.verifyDatabaseBackup(dump, captured.report, directory, randomUUID())
  const readableSql = await db.exportReadableDatabase(dump, captured.report, directory)
  assert.equal(readableSql.filter(file => file.name.startsWith('tables/')).length, captured.report.tables.length)
  assert.ok(readableSql.some(file => file.name === 'tables/edge%20schema/quoted%2Etable.sql'))
  const fullSql = readableSql.find(file => file.name === 'database.sql')
  assert.ok((await readFile(fullSql.path, 'utf8')).includes('CREATE TABLE public.ledger'))
  // Restore the human-readable full SQL to another disposable database, without the live CREATE DATABASE/role mapping.
  const sqlDatabase = `incudal_sql_${suffix}`
  await db.localDatabaseAdmin(`CREATE DATABASE ${q(sqlDatabase)} OWNER ${q(connection.user)} TEMPLATE template0;`)
  try {
    await db.restoreDatabaseSql(fullSql.path, sqlDatabase)
    const compareDir = await mkdtemp(join(directory, 'sql-verify-'))
    await db.verifyRestoredDatabase(sqlDatabase, captured.report, compareDir, 'sql')
  } finally { await db.localDatabaseAdmin(`DROP DATABASE ${q(sqlDatabase)} WITH (FORCE);`) }
  console.log('PASS: every table has readable SQL derived from the same archive; full SQL restores into an isolated database with matching integrity.')
  console.log('PASS: full shared-snapshot backup restores despite concurrent fixture writes; schema, every table, duplicate rows, numeric/Unicode/binary values, partitions, materialized view, large objects and authorization archive verified.')
  {
    const archive = await import(process.env.INTEGRITY_ARCHIVE_MODULE || '/opt/incudal/server/dist/services/platform-backup-archive.js')
    const report = join(directory, 'database-integrity.json'), env = join(directory, 'runtime.env')
    await writeFile(report, JSON.stringify(captured.report), { mode: 0o600 })
    await writeFile(env, 'ENCRYPTION_KEY=isolated-drill-placeholder\n', { mode: 0o600 })
    const encrypted = join(directory, 'payload.enc'), password = randomUUID()
    const manifest = await archive.encryptBackup([{ name: 'database.dump', path: dump }, { name: 'database-globals.sql', path: captured.globals }, { name: 'database-integrity.json', path: report }, { name: 'runtime.env', path: env }], { format: 1, id: randomUUID(), installationId: randomUUID(), version: '1.6.8', createdAt: new Date().toISOString(), migrationHash: captured.metadata.migrationHash, postgresMajor: captured.metadata.postgresMajor, databaseBytes: captured.metadata.bytes }, password, encrypted)
    const decoded = await archive.decryptBackup(encrypted, password, join(directory, 'decoded'))
    assert.deepEqual(decoded.manifest, manifest)
    assert.ok(decoded.zipPath)
    assert.equal((await readFile(decoded.zipPath)).readUInt32LE(0), 0x04034b50)
    const verification = await mkdtemp(join(directory, 'zip-verify-'))
    await db.verifyDatabaseBackup(decoded.files.get('database.dump'), JSON.parse(await readFile(decoded.files.get('database-integrity.json'), 'utf8')), verification, randomUUID())
    console.log('PASS: encrypted ZIP/ZIP64 decrypts to a standard ZIP and its complete database restores with all integrity checks matched.')
  }

  await db.localDatabaseAdmin(`CREATE DATABASE ${q(restored)} OWNER ${q(connection.user)} TEMPLATE template0;`); restoredCreated = true
  await db.restoreDatabase(dump, restored)
  await db.pgQuery('UPDATE ledger SET amount=amount+1 WHERE id IS NULL', [], restored)
  await assert.rejects(db.verifyRestoredDatabase(restored, captured.report, directory, 'tampered-rows'), /OSS_DATABASE_INTEGRITY_MISMATCH/)
  console.log('PASS: changed financial value with unchanged row count is rejected.')
  await db.pgQuery('UPDATE ledger SET amount=amount-1 WHERE id IS NULL', [], restored)
  await db.pgQuery('UPDATE ledger SET labels=ARRAY[1,2] WHERE id IS NOT NULL', [], restored)
  await assert.rejects(db.verifyRestoredDatabase(restored, captured.report, directory, 'tampered-array-bounds'), /OSS_DATABASE_INTEGRITY_MISMATCH/)
  console.log('PASS: changed array lower bounds with identical elements are rejected.')
  await db.pgQuery("UPDATE ledger SET labels='[2:3]={1,2}'::integer[] WHERE id IS NOT NULL", [], restored)
  const sequence = captured.report.sequences.find(item => item.schema === 'edge schema')
  await db.pgQuery('SELECT setval($1::regclass,$2::bigint,true)', [sequence.reference, '999999999'], restored)
  await assert.rejects(db.verifyRestoredDatabase(restored, captured.report, directory, 'tampered-sequence'), /OSS_DATABASE_INTEGRITY_MISMATCH/)
  console.log('PASS: incorrect sequence counter is rejected.')
  await db.pgQuery('SELECT setval($1::regclass,$2::bigint,$3::boolean)', [sequence.reference, sequence.lastValue, sequence.isCalled], restored)
  await db.pgQuery("SELECT lo_put($1,0,decode('ff','hex'))", [oid], restored)
  await assert.rejects(db.verifyRestoredDatabase(restored, captured.report, directory, 'tampered-large-object'), /OSS_DATABASE_INTEGRITY_MISMATCH/)
  console.log('PASS: damaged large-object content is rejected.')
  await db.pgQuery('DROP TABLE "edge schema"."quoted.table"', [], restored)
  await assert.rejects(db.verifyRestoredDatabase(restored, captured.report, directory, 'missing-table'), /OSS_DATABASE_INTEGRITY_MISMATCH/)
  console.log('PASS: missing table is rejected.')
  await exec('/usr/sbin/runuser', ['-u', 'postgres', '--', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-p', connection.url.port || '5432', '-d', source, '-c', 'CREATE FOREIGN DATA WRAPPER fixture_fdw; CREATE SERVER fixture_server FOREIGN DATA WRAPPER fixture_fdw; CREATE FOREIGN TABLE foreign_fixture (id integer) SERVER fixture_server;'])
  const foreign = await mkdtemp(join(directory, 'foreign-'))
  await assert.rejects(db.captureDatabaseBackup(join(foreign, 'database.dump'), foreign), /OSS_DATABASE_FOREIGN_TABLE_UNSUPPORTED/)
  console.log('PASS: unsupported foreign-table data is refused before publishing a backup.')
} finally {
  process.env.DATABASE_URL = originalUrl
  if (restoredCreated) await db.localDatabaseAdmin(`DROP DATABASE ${q(restored)} WITH (FORCE);`)
  if (sourceCreated) await db.localDatabaseAdmin(`DROP DATABASE ${q(source)} WITH (FORCE);`)
  if (roleCreated) await db.localDatabaseAdmin(`DROP ROLE ${q(role)};`)
  assert.ok(directory.startsWith('/var/tmp/incudal-integrity-'))
  await rm(directory, { recursive: true, force: true })
}
