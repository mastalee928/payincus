import { spawn, execFile } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { Pool } from 'pg'
import { BackupError, ensure } from './platform-backup-core.js'

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
export async function databaseMetadata(database?: string) {
  const [info] = await pgQuery<{ version: string; bytes: string; superuser: boolean }>("SELECT current_setting('server_version_num') AS version, pg_database_size(current_database())::text AS bytes, rolsuper AS superuser FROM pg_roles WHERE rolname=current_user", [], database)
  ensure(!info.superuser, 'OSS_DATABASE_SUPERUSER_FORBIDDEN', 503)
  const migrations = await pgQuery('SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name', [], database)
  return { postgresMajor: Math.floor(Number(info.version) / 10000), bytes: Number(info.bytes), migrationHash: createHash('sha256').update(JSON.stringify(migrations)).digest('hex') }
}
// Child utilities run as the application OS user; secrets never enter argv or logs.
async function pgProcess(command: 'pg_dump' | 'pg_restore', args: string[], database: string | undefined, input?: string, output?: string) {
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
export async function dumpDatabase(destination: string) {
  await pgProcess('pg_dump', ['--format=custom', '--no-owner', '--no-privileges'], undefined, undefined, destination)
}
export async function restoreDatabase(source: string, target: string) {
  await pgProcess('pg_restore', ['--dbname', target, '--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction'], target, source)
}
export const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`
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
