import { spawn, execFile } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { BackupError, ensure } from './platform-backup-core.js'
import type { BackupMigration } from './platform-backup-compatibility.js'

const exec = promisify(execFile)
export function postgresConnection() {
  const url = new URL(process.env.DATABASE_URL || '')
  ensure(url.protocol === 'postgresql:' || url.protocol === 'postgres:', 'OSS_DATABASE_INVALID')
  const database = decodeURIComponent(url.pathname.slice(1)), user = decodeURIComponent(url.username)
  ensure(database && user && database.length <= 63 && !/[\x00-\x1f]/.test(database + user), 'OSS_DATABASE_INVALID')
  return { url, database, user }
}
function pgEnv(database?: string) {
  const connection = postgresConnection()
  return { PATH: '/usr/local/bin:/usr/bin:/bin', PGHOST: connection.url.hostname, PGPORT: connection.url.port || '5432',
    PGUSER: connection.user, PGPASSWORD: decodeURIComponent(connection.url.password), PGDATABASE: database || connection.database,
    PGSSLMODE: connection.url.searchParams.get('sslmode') || 'prefer', PGCONNECT_TIMEOUT: '15' }
}
export async function pgQuery<T extends import('pg').QueryResultRow>(sql: string, params: unknown[] = [], database?: string): Promise<T[]> {
  const { url } = postgresConnection(); if (database) url.pathname = `/${database}`
  const pool = new Pool({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 15000, statement_timeout: 60000 })
  try { return (await pool.query<T>(sql, params)).rows } finally { await pool.end() }
}
export async function appliedBackupMigrations(database?: string): Promise<BackupMigration[]> {
  const [unfinished] = await pgQuery<{ count: string }>('SELECT count(*)::text AS count FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL', [], database)
  ensure(unfinished.count === '0', 'OSS_MIGRATION_HISTORY_MISMATCH', 409)
  return pgQuery<BackupMigration>('SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name', [], database)
}
export async function databaseMetadata(database?: string) {
  const [info] = await pgQuery<{ version: string; bytes: string; superuser: boolean }>("SELECT current_setting('server_version_num') AS version, pg_database_size(current_database())::text AS bytes, rolsuper AS superuser FROM pg_roles WHERE rolname=current_user", [], database)
  ensure(!info.superuser, 'OSS_DATABASE_SUPERUSER_FORBIDDEN', 503)
  const migrations = await appliedBackupMigrations(database)
  return { postgresMajor: Math.floor(Number(info.version) / 10000), bytes: Number(info.bytes), migrationHash: createHash('sha256').update(JSON.stringify(migrations)).digest('hex') }
}
// Child utilities run as the application OS user; secrets never enter argv or logs.
async function pgProcess(command: 'pg_dump' | 'pg_restore' | 'psql', args: string[], database: string | undefined, input?: string, output?: string) {
  const uid = Number((await exec('/usr/bin/id', ['-u', 'incudal'])).stdout.trim())
  const gid = Number((await exec('/usr/bin/id', ['-g', 'incudal'])).stdout.trim())
  ensure(uid > 0 && gid > 0, 'OSS_RUNTIME_INVALID', 503)
  const child = spawn(command, args, { uid, gid, env: pgEnv(database), stdio: ['pipe', 'pipe', 'pipe'] })
  const timer = setTimeout(() => child.kill('SIGKILL'), 60 * 60 * 1000)
  // Discard utility output that could include database content or credentials.
  child.stderr.resume()
  const finished = new Promise<void>((resolve, reject) => {
    child.once('error', () => reject(new BackupError('OSS_DATABASE_TOOL_FAILED', 503)))
    child.once('exit', code => code === 0 ? resolve() : reject(new BackupError('OSS_DATABASE_TOOL_FAILED', 503)))
  })
  try {
    const operations: Promise<unknown>[] = [finished]
    if (input) operations.push(pipeline(createReadStream(input), child.stdin))
    else child.stdin.end()
    if (output) operations.push(pipeline(child.stdout, createWriteStream(output, { flags: 'wx', mode: 0o600 })))
    else child.stdout.resume()
    await Promise.all(operations)
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill('SIGKILL') }
}
export async function dumpDatabase(destination: string, snapshot?: string) {
  // Preserve ownership and grants in the archive; restore maps them separately.
  await pgProcess('pg_dump', ['--format=custom', '--create', '--large-objects', ...(snapshot ? [`--snapshot=${validateSnapshot(snapshot)}`] : [])], undefined, undefined, destination)
}
export async function restoreDatabase(source: string, target: string) {
  await pgProcess('pg_restore', ['--dbname', target, '--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction'], target, source)
}

export async function migrateBackupDatabase(app: string, database: string) {
  const uid = Number((await exec('/usr/bin/id', ['-u', 'incudal'])).stdout.trim())
  const gid = Number((await exec('/usr/bin/id', ['-g', 'incudal'])).stdout.trim())
  ensure(uid > 0 && gid > 0 && /^incudal_(check|restore)_[a-f0-9]{32}$/.test(database), 'OSS_RUNTIME_INVALID', 503)
  const { url } = postgresConnection(); url.pathname = `/${database}`
  // Execute installed release tooling only, with destination credentials in env.
  // Never load archived .env or execute archived migration files.
  try {
    await exec('/usr/bin/node', [join(app, 'server/node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
      cwd: join(app, 'server'), uid, gid, timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024,
      env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/opt/incudal', NODE_ENV: 'production', DATABASE_URL: url.toString() }
    })
  } catch { throw new BackupError('OSS_BACKUP_MIGRATION_FAILED', 409) }
}
export async function restoreDatabaseSql(source: string, target: string) {
  await pgProcess('psql', ['-X', '--set', 'ON_ERROR_STOP=1', '--single-transaction', '--dbname', target], target, source)
}
// Derive SQL from the already verified custom archive, never a second live dump.
export async function exportReadableDatabase(source: string, report: DatabaseIntegrity, directory: string) {
  const folder = join(directory, 'readable-sql'); await mkdir(folder, { mode: 0o700 })
  const sources: Array<{ name: string; path: string }> = []
  const exportSql = async (name: string, args: string[]) => {
    const path = join(folder, `${sources.length}.sql`)
    await exec('/usr/bin/pg_restore', [...args, '--file', path, source], { env: { PATH: '/usr/bin:/bin' }, timeout: 3600000, maxBuffer: 65536 })
    await chmod(path, 0o600); sources.push({ name, path })
  }
  // Portable full SQL restores into an explicitly selected isolated target.
  // The native dump and globals retain original ownership/authorization.
  await exportSql('database.sql', ['--no-owner', '--no-privileges'])
  for (const table of report.tables) {
    // Percent-encode unusual identifier characters so filenames cannot escape their directory.
    const safe = (value: string) => encodeURIComponent(value).replace(/\./g, '%2E')
    await exportSql(`tables/${safe(table.schema)}/${safe(table.name)}.sql`, ['--schema', table.schema, '--table', table.name])
  }
  return sources
}
export const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`
const quoteLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`
function validateSnapshot(value: string) {
  ensure(/^[0-9a-f-]{1,100}$/i.test(value), 'OSS_DATABASE_SNAPSHOT_INVALID')
  return value
}
export interface DatabaseIntegrity {
  format: 1
  dataEncoding: 'postgres-record-text-v1'
  database: Record<string, unknown>
  schemaSha256: string
  tables: Array<{ schema: string; name: string; kind: string; rows: string; sha256: string }>
  sequences: Array<{ schema: string; name: string; reference: string; lastValue: string; isCalled: boolean }>
  largeObjects: { objects: string; pages: string; sha256: string }
}
const integrityQuery = `SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','m','f')
  ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C"`
async function snapshotConnection(database?: string) {
  const { url } = postgresConnection(); if (database) url.pathname = `/${database}`
  const pool = new Pool({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 15000, statement_timeout: 3600000 })
  let client: PoolClient | undefined
  try {
    client = await pool.connect()
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog; SET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO'; SET LOCAL extra_float_digits=3; SET LOCAL bytea_output='hex'; SET LOCAL row_security=off")
    const result = await client.query<{ snapshot: string; captured: Date }>('SELECT pg_export_snapshot() AS snapshot,clock_timestamp() AS captured')
    return { client, pool, snapshot: validateSnapshot(result.rows[0].snapshot), snapshotAt: result.rows[0].captured.toISOString() }
  } catch (error) { client?.release(); await pool.end(); throw error }
}
async function closeSnapshot(connection: Awaited<ReturnType<typeof snapshotConnection>>) {
  try { await connection.client.query('ROLLBACK') } finally { connection.client.release(); await connection.pool.end() }
}
export function normalizedDumpHash(value: string) {
  // Patched pg_dump/pg_dumpall generate a fresh psql restrict key on every run.
  // Only normalize the outer session-control pair; keep all database SQL unchanged.
  const match = /^\\restrict ([A-Za-z0-9]+)\r?$/m.exec(value)
  if (match) {
    value = value.slice(0, match.index) + '\\restrict NORMALIZED' + value.slice(match.index + match[0].length)
    const closing = `\\unrestrict ${match[1]}`; const end = value.lastIndexOf(closing)
    ensure(end >= 0, 'OSS_DATABASE_DUMP_INVALID')
    value = value.slice(0, end) + '\\unrestrict NORMALIZED' + value.slice(end + closing.length)
  }
  return createHash('sha256').update(value).digest('hex')
}
interface DumpToolchain { databaseVersion: string; dumpVersion: string }
export function restoreDumpToolchainHeader(value: string, toolchain: DumpToolchain) {
  for (const version of [toolchain.databaseVersion, toolchain.dumpVersion]) {
    ensure(/^\d+\.\d+(?:\.\d+)?(?: \([^\r\n]{1,200}\))?$/.test(version) && [...version].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) <= 126), 'OSS_DATABASE_DUMP_INVALID')
  }
  // Only the pg_dump prologue is rewritten, using metadata from its authenticated
  // custom archive. Keep SQL, function bodies and legacy integrity hashes exact.
  const header = /^(--\r?\n-- PostgreSQL database dump\r?\n--\r?\n(?:\r?\n|\\restrict [A-Za-z0-9]+\r?\n)*-- Dumped from database version )[^\r\n]+(\r?\n-- Dumped by pg_dump version )[^\r\n]+(\r?\n)/
  ensure(header.test(value), 'OSS_DATABASE_DUMP_INVALID')
  return value.replace(header, (_all, opening: string, middle: string, ending: string) => `${opening}${toolchain.databaseVersion}${middle}${toolchain.dumpVersion}${ending}`)
}
async function archivedDumpToolchain(source: string): Promise<DumpToolchain> {
  const { stdout } = await exec('/usr/bin/pg_restore', ['--list', source], { env: { PATH: '/usr/bin:/bin' }, maxBuffer: 16 * 1024 * 1024 })
  const field = (name: string) => {
    const matches = [...stdout.matchAll(new RegExp(`^;[ \\t]+${name}: ([^\\r\\n]+)\\r?$`, 'gm'))]
    ensure(matches.length === 1, 'OSS_DATABASE_DUMP_INVALID')
    return matches[0][1]
  }
  return { databaseVersion: field('Dumped from database version'), dumpVersion: field('Dumped by pg_dump version') }
}
export async function schemaFingerprint(directory: string, suffix: string, database?: string, snapshot?: string, toolchain?: DumpToolchain) {
  const path = join(directory, `schema-${suffix}.sql`)
  // Verification normalizes destination role/tablespace mapping only. The actual archive keeps this metadata.
  await pgProcess('pg_dump', ['--schema-only', '--no-owner', '--no-privileges', '--no-tablespaces', ...(snapshot ? [`--snapshot=${validateSnapshot(snapshot)}`] : [])], database, undefined, path)
  ensure((await stat(path)).size <= 64 * 1024 * 1024, 'OSS_DATABASE_SCHEMA_TOO_LARGE')
  const value = await readFile(path, 'utf8')
  return normalizedDumpHash(toolchain ? restoreDumpToolchainHeader(value, toolchain) : value)
}
// Fixed local postgres peer connection. Output goes only to a root-private file or a hash.
async function peerUtility(command: 'pg_dumpall' | 'psql', args: string[], database: string, output?: string) {
  const { url } = postgresConnection()
  ensure(['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname), 'OSS_LOCAL_RESTORE_REQUIRED', 409)
  const child = spawn('/usr/sbin/runuser', ['-u', 'postgres', '--', command, ...args], {
    env: { PATH: '/usr/local/bin:/usr/bin:/bin', PGPORT: url.port || '5432', PGDATABASE: database, PGCLIENTENCODING: 'UTF8' }, stdio: ['ignore', 'pipe', 'pipe']
  })
  const timer = setTimeout(() => child.kill('SIGKILL'), 3600000)
  child.stderr.resume()
  const hash = createHash('sha256'); let lines = 0n
  const finished = new Promise<void>((resolve, reject) => {
    child.once('error', () => reject(new BackupError('OSS_DATABASE_TOOL_FAILED', 503)))
    child.once('exit', code => code === 0 ? resolve() : reject(new BackupError('OSS_DATABASE_TOOL_FAILED', 503)))
  })
  try {
    const consume = output ? pipeline(child.stdout, createWriteStream(output, { flags: 'wx', mode: 0o600 })) : (async () => {
      for await (const chunk of child.stdout) { const bytes = Buffer.from(chunk); hash.update(bytes); for (const byte of bytes) if (byte === 10) lines++ }
    })()
    await Promise.all([finished, consume])
    return { pages: lines.toString(), sha256: hash.digest('hex') }
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill('SIGKILL') }
}
async function inventory(connection: Awaited<ReturnType<typeof snapshotConnection>>, directory: string, suffix: string, database?: string, toolchain?: DumpToolchain): Promise<DatabaseIntegrity> {
  const { client, snapshot } = connection
  const relations = (await client.query<{ schema: string; name: string; kind: string }>(integrityQuery)).rows
  ensure(relations.length <= 10000, 'OSS_DATABASE_TOO_MANY_TABLES')
  // pg_dump does not include foreign-server table rows by default; fail rather than silently omit them.
  ensure(!relations.some(row => row.kind === 'f'), 'OSS_DATABASE_FOREIGN_TABLE_UNSUPPORTED', 409)
  for (const row of relations) {
    const target = `${quoteIdentifier(row.schema)}.${quoteIdentifier(row.name)}`
    // PostgreSQL rejects explicit LOCK TABLE on materialized views; a SELECT retains the same read lock.
    await client.query(row.kind === 'm' ? `SELECT 1 FROM ${target} LIMIT 0` : `LOCK TABLE ${target} IN ACCESS SHARE MODE`)
  }
  const tables: DatabaseIntegrity['tables'] = []
  for (const relation of relations) {
    const target = `${quoteIdentifier(relation.schema)}.${quoteIdentifier(relation.name)}`
    // SHA256 each complete row in PostgreSQL, then stream the sorted multiset in bounded batches.
    // This detects edits even when counts match, including duplicate rows and tables without a primary key.
    await client.query(`DECLARE incudal_backup_integrity NO SCROLL CURSOR FOR SELECT hash FROM (SELECT encode(sha256(convert_to(pg_catalog.record_out(t)::text,'UTF8')),'hex') AS hash FROM ONLY ${target} t) fingerprints ORDER BY hash COLLATE "C"`)
    const digest = createHash('sha256'); let rows = 0n
    try {
      while (true) {
        const batch = (await client.query<{ hash: string }>('FETCH FORWARD 1000 FROM incudal_backup_integrity')).rows
        if (!batch.length) break
        for (const row of batch) { ensure(/^[a-f0-9]{64}$/.test(row.hash), 'OSS_DATABASE_FINGERPRINT_INVALID'); digest.update(row.hash + '\n'); rows++ }
      }
    } finally { await client.query('CLOSE incudal_backup_integrity') }
    tables.push({ ...relation, rows: rows.toString(), sha256: digest.digest('hex') })
  }
  const [{ properties }] = (await client.query<{ properties: Record<string, unknown> }>("SELECT to_jsonb(d) || jsonb_build_object('encodingName',pg_encoding_to_char(d.encoding)) AS properties FROM pg_database d WHERE datname=current_database()")).rows
  const [{ objects }] = (await client.query<{ objects: string }>('SELECT count(*)::text AS objects FROM pg_largeobject_metadata')).rows
  const sequenceNames = (await client.query<{ schema: string; name: string; reference: string }>(`SELECT n.nspname AS schema,c.relname AS name,format('%I.%I',n.nspname,c.relname) AS reference FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema' ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"`)).rows
  ensure(sequenceNames.length <= 10000, 'OSS_DATABASE_TOO_MANY_TABLES')
  const sequences: DatabaseIntegrity['sequences'] = []
  for (const sequence of sequenceNames) {
    const [{ value, called }] = (await client.query<{ value: string; called: boolean }>(`SELECT last_value::text AS value,is_called AS called FROM ${quoteIdentifier(sequence.schema)}.${quoteIdentifier(sequence.name)}`)).rows
    sequences.push({ ...sequence, lastValue: value, isCalled: called })
  }
  const pages = await peerUtility('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT ${quoteLiteral(snapshot)}; COPY (SELECT loid,pageno,pg_catalog.encode(pg_catalog.sha256(data),'hex') FROM pg_catalog.pg_largeobject ORDER BY loid,pageno) TO STDOUT; COMMIT;`], database || postgresConnection().database)
  return { format: 1, dataEncoding: 'postgres-record-text-v1', database: properties, schemaSha256: await schemaFingerprint(directory, suffix, database, snapshot, toolchain), tables, sequences, largeObjects: { objects, ...pages } }
}
export function assertDatabaseIntegrity(expected: DatabaseIntegrity, actual: DatabaseIntegrity) {
  ensure(expected?.format === 1 && actual?.format === 1 && expected.dataEncoding === 'postgres-record-text-v1' && actual.dataEncoding === expected.dataEncoding && /^[a-f0-9]{64}$/.test(expected.schemaSha256) && Array.isArray(expected.tables) && expected.tables.length <= 10000 && expected.largeObjects && expected.database, 'OSS_DATABASE_INTEGRITY_INVALID')
  ensure(actual.schemaSha256 === expected.schemaSha256 && JSON.stringify(actual.tables) === JSON.stringify(expected.tables) && JSON.stringify(actual.sequences) === JSON.stringify(expected.sequences) && JSON.stringify(actual.largeObjects) === JSON.stringify(expected.largeObjects), 'OSS_DATABASE_INTEGRITY_MISMATCH', 409)
  for (const key of ['encoding', 'datcollate', 'datctype', 'datlocprovider', 'daticulocale', 'datlocale']) ensure(actual.database[key] === expected.database[key], 'OSS_DATABASE_LOCALE_MISMATCH', 409)
}
async function archivedSequenceStates(source: string, sequences: DatabaseIntegrity['sequences'], directory: string) {
  if (!sequences.length) return []
  // Sequence counters are non-MVCC. Capture their exact dump values, then verify those values after restore.
  // These pg_restore calls only inspect the locally generated archive; no SQL is executed.
  const env = { PATH: '/usr/bin:/bin' }
  const { stdout } = await exec('/usr/bin/pg_restore', ['--list', source], { env, maxBuffer: 16 * 1024 * 1024 })
  const entries = stdout.split('\n').filter(line => /^\d+; .* SEQUENCE SET /.test(line))
  const list = join(directory, 'sequence-list'), sql = join(directory, 'sequence-values.sql')
  await writeFile(list, entries.join('\n') + '\n', { flag: 'wx', mode: 0o600 })
  await exec('/usr/bin/pg_restore', ['--use-list', list, '--file', sql, source], { env, maxBuffer: 1024 * 1024 })
  await chmod(sql, 0o600)
  ensure((await stat(sql)).size <= 4 * 1024 * 1024, 'OSS_DATABASE_TOO_MANY_TABLES')
  const states = new Map<string, { lastValue: string; isCalled: boolean }>()
  for (const match of (await readFile(sql, 'utf8')).matchAll(/^SELECT pg_catalog\.setval\('((?:[^']|'')*)', (-?\d+), (true|false)\);$/gm)) {
    const name = match[1].replace(/''/g, "'"); ensure(!states.has(name), 'OSS_DATABASE_SEQUENCE_INVALID')
    states.set(name, { lastValue: match[2], isCalled: match[3] === 'true' })
  }
  ensure(states.size === sequences.length, 'OSS_DATABASE_SEQUENCE_INVALID')
  return sequences.map(sequence => { const value = states.get(sequence.reference); ensure(value, 'OSS_DATABASE_SEQUENCE_INVALID'); return { ...sequence, ...value } })
}
export async function captureDatabaseBackup(destination: string, directory: string) {
  const connection = await snapshotConnection()
  try {
    const [{ standby }] = (await connection.client.query<{ standby: boolean }>('SELECT pg_is_in_recovery() AS standby')).rows
    ensure(!standby, 'OSS_DATABASE_STANDBY_UNSUPPORTED', 409)
    const globals = join(directory, 'database-globals.sql'), globalsAfter = join(directory, 'database-globals-after.sql')
    await peerUtility('pg_dumpall', ['--globals-only', '--database=postgres'], 'postgres', globals)
    const report = await inventory(connection, directory, 'source')
    await dumpDatabase(destination, connection.snapshot)
    report.sequences = await archivedSequenceStates(destination, report.sequences, directory)
    const [{ version, bytes }] = (await connection.client.query<{ version: string; bytes: string }>("SELECT current_setting('server_version_num') AS version, pg_database_size(current_database())::text AS bytes")).rows
    const migrations = (await connection.client.query('SELECT migration_name, checksum FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows
    await peerUtility('pg_dumpall', ['--globals-only', '--database=postgres'], 'postgres', globalsAfter)
    const digest = async (path: string) => { ensure((await stat(path)).size <= 1024 * 1024, 'OSS_DATABASE_GLOBALS_TOO_LARGE'); return normalizedDumpHash(await readFile(path, 'utf8')) }
    ensure(await digest(globals) === await digest(globalsAfter), 'OSS_DATABASE_GLOBALS_CHANGED', 409)
    return { report, globals, snapshotAt: connection.snapshotAt, metadata: { postgresMajor: Math.floor(Number(version) / 10000), bytes: Number(bytes), migrationHash: createHash('sha256').update(JSON.stringify(migrations)).digest('hex') } }
  } finally { await closeSnapshot(connection) }
}
export async function verifyRestoredDatabase(database: string, expected: DatabaseIntegrity, directory: string, suffix: string, source?: string) {
  const toolchain = source ? await archivedDumpToolchain(source) : undefined
  const connection = await snapshotConnection(database)
  try { assertDatabaseIntegrity(expected, await inventory(connection, directory, suffix, database, toolchain)) } finally { await closeSnapshot(connection) }
}
export async function verifyDatabaseBackup(source: string, expected: DatabaseIntegrity, directory: string, taskId: string) {
  ensure(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(taskId), 'OSS_TASK_INVALID')
  const staging = `incudal_verify_${taskId.replace(/-/g, '')}`
  await createBackupRestoreDatabase(staging, expected)
  try { await restoreDatabase(source, staging); await verifyRestoredDatabase(staging, expected, directory, 'verified', source) }
  finally { await localDatabaseAdmin(`DROP DATABASE ${quoteIdentifier(staging)} WITH (FORCE);`) }
}
export async function createBackupRestoreDatabase(staging: string, expected?: DatabaseIntegrity) {
  ensure(/^incudal_(check|restore|verify)_[a-f0-9]{32}$/.test(staging), 'OSS_RUNTIME_INVALID', 503)
  if (!expected) {
    await localDatabaseAdmin(`CREATE DATABASE ${quoteIdentifier(staging)} OWNER ${quoteIdentifier(postgresConnection().user)} TEMPLATE template0;`)
    return
  }
  const properties = expected.database
  ensure(typeof properties.datcollate === 'string' && typeof properties.datctype === 'string' && typeof properties.encodingName === 'string', 'OSS_DATABASE_INTEGRITY_INVALID')
  const provider = properties.datlocprovider
  ensure(!provider || provider === 'c', 'OSS_DATABASE_LOCALE_UNSUPPORTED', 409)
  const locales = (await exec('/usr/bin/locale', ['-a'], { timeout: 10000 })).stdout.split(/\r?\n/)
  const localeKey = (value: string) => value.toLowerCase().replace(/utf-8/g, 'utf8')
  ensure([properties.datcollate, properties.datctype].every(value => locales.some(locale => localeKey(locale) === localeKey(value))), 'OSS_DATABASE_LOCALE_UNAVAILABLE', 409)
  // Locale differences must not silently change index or text semantics during verification.
  await localDatabaseAdmin(`CREATE DATABASE ${quoteIdentifier(staging)} OWNER ${quoteIdentifier(postgresConnection().user)} TEMPLATE template0 ENCODING ${quoteLiteral(properties.encodingName)} LC_COLLATE ${quoteLiteral(properties.datcollate)} LC_CTYPE ${quoteLiteral(properties.datctype)};`)
}
export async function localDatabaseAdmin(sql: string) {
  const { url } = postgresConnection()
  ensure(['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname), 'OSS_LOCAL_RESTORE_REQUIRED', 409)
  // Fixed local peer-authenticated administrator; never use credentials from the archive.
  const child = spawn('/usr/sbin/runuser', ['-u', 'postgres', '--', 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-p', url.port || '5432', '-d', 'postgres'], {
    env: { PATH: '/usr/bin:/bin', PGCONNECT_TIMEOUT: '15' }, stdio: ['pipe', 'pipe', 'pipe']
  })
  let output = ''
  child.stdout.on('data', chunk => { if (output.length < 65536) output += String(chunk) })
  child.stderr.resume()
  const timer = setTimeout(() => child.kill('SIGKILL'), 60000)
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', () => reject(new BackupError('OSS_DATABASE_ADMIN_FAILED', 503)))
      child.once('exit', code => code === 0 ? resolve() : reject(new BackupError('OSS_DATABASE_ADMIN_FAILED', 503)))
      child.stdin.on('error', () => {}); child.stdin.end(sql)
    })
    return output.trim()
  } finally { clearTimeout(timer) }
}
