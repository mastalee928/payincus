// One historical schema, real PostgreSQL custom dump/restore and trusted
// migrations. Docker supplies only the PG16 utilities on disposable CI.
// This does not switch a controller, use OSS, or start application workers.
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, copyFile, writeFile, readFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { appliedBackupMigrations, pgQuery, quoteIdentifier } from '../src/services/platform-backup-database.js'
import { assertMigrationHistory, releaseMigrations } from '../src/services/platform-backup-compatibility.js'

const root = resolve(import.meta.dirname, '../..')
const release = await releaseMigrations(root)
const historicalEnd = '202610260001_complete_pool_regions' // v1.7.7, verified unchanged prefix
const cut = release.findIndex(row => row.name === historicalEnd) + 1
assert.equal(cut, 218)
assert.ok(release.length > cut)
const databaseSource = await readFile(join(root, 'server/src/services/platform-backup-database.ts'), 'utf8')
const start = databaseSource.indexOf('export async function dumpDatabase(')
const end = databaseSource.indexOf('export async function migrateBackupDatabase(', start)
assert.ok(start >= 0 && end > start)
// Keep the exact production pg_dump/pg_restore options; adapt the OS utility
// boundary to the already running PostgreSQL service container, without root.
const utilitySource = databaseSource.slice(start, end).replace(/^export /gm, '')
const compiled = ts.transpileModule(utilitySource + '\nreturn { dumpDatabase, restoreDatabase }', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText
if (process.argv.includes('--check-fixture')) {
  assert.ok(compiled.includes('--single-transaction') && compiled.includes('--exit-on-error'))
  console.log(`Fixture valid: v1.7.7 prefix ${cut}, current ${release.length}; actual backup utility functions loaded`)
  process.exit(0)
}
assert.equal(process.platform, 'linux')
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Use disposable GitHub CI, never a controller')
const originalUrl = process.env.DATABASE_URL!
const connection = new URL(originalUrl)
assert.ok(['127.0.0.1', 'localhost'].includes(connection.hostname) && connection.pathname.endsWith('_gateway_test'))
const container = process.env.BACKUP_TEST_POSTGRES_CONTAINER || ''
assert.match(container, /^[a-f0-9]{12,64}$/)
const exec = promisify(execFile)
const directory = await mkdtemp(join(tmpdir(), 'payincus-backup-history-'))
const app = join(directory, 'app'), suffix = randomUUID().replaceAll('-', '')
const source = `incudal_check_${suffix}`, restored = `incudal_restore_${suffix}`
const failed = `incudal_failed_${suffix}`
const created: string[] = []
let activeDatabase = source
async function utility(command: string, args: string[], database?: string, input?: string, output?: string) {
  const child = spawn('docker', ['exec', '-i', '-e', 'PGUSER', '-e', 'PGPASSWORD', '-e', 'PGDATABASE', container, command, ...args], {
    env: { ...process.env, PGUSER: decodeURIComponent(connection.username), PGPASSWORD: decodeURIComponent(connection.password), PGDATABASE: database || activeDatabase },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const stdout: Buffer[] = [], stderr: Buffer[] = []
  child.stdout.on('data', chunk => stdout.push(chunk))
  child.stderr.on('data', chunk => stderr.push(chunk))
  child.stdin.on('error', () => {}) // an intentional restore rejection can close stdin
  const complete = new Promise<void>((yes, no) => {
    child.once('error', no)
    child.once('close', code => code === 0 ? yes() : no(new Error(`${command} exited ${code}: ${Buffer.concat(stderr).toString().slice(-1600)}`)))
  })
  const timer = setTimeout(() => child.kill('SIGKILL'), 120000)
  try {
    child.stdin.end(input ? await readFile(input) : undefined)
    await complete
    if (output) await writeFile(output, Buffer.concat(stdout), { flag: 'wx', mode: 0o600 })
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill('SIGKILL') }
}
const backup = new Function('pgProcess', compiled)(utility) as {
  dumpDatabase: (path: string) => Promise<void>
  restoreDatabase: (path: string, target: string) => Promise<void>
}
async function migrate(database: string) {
  const url = new URL(originalUrl); url.pathname = '/' + database
  await exec(process.execPath, [join(root, 'server/node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: join(app, 'server'), env: { ...process.env, DATABASE_URL: url.toString() }, timeout: 180000, maxBuffer: 4 * 1024 * 1024
  })
}
async function installMigration(index: number) {
  const migration = release[index], target = join(app, 'server/prisma/migrations', migration.name)
  await mkdir(target)
  await copyFile(join(root, 'server/prisma/migrations', migration.name, 'migration.sql'), join(target, 'migration.sql'))
}
try {
  for (const name of [source, restored, failed]) {
    await pgQuery(`CREATE DATABASE ${quoteIdentifier(name)} TEMPLATE template0`)
    created.push(name)
  }
  await mkdir(join(app, 'server/prisma/migrations'), { recursive: true })
  await writeFile(join(app, 'server/package.json'), '{"type":"module"}\n')
  await copyFile(join(root, 'server/prisma/schema.prisma'), join(app, 'server/prisma/schema.prisma'))
  await writeFile(join(app, 'server/prisma.config.ts'), "import { defineConfig, env } from 'prisma/config'; export default defineConfig({schema:'prisma/schema.prisma',migrations:{path:'prisma/migrations'},datasource:{url:env('DATABASE_URL')}});\n")
  await writeFile(join(app, 'server/prisma/migrations/migration_lock.toml'), 'provider = "postgresql"\n')
  await symlink(join(root, 'server/node_modules'), join(app, 'server/node_modules'))
  for (let index = 0; index < cut; index++) await installMigration(index)
  await migrate(source)
  assertMigrationHistory(await appliedBackupMigrations(source), release.slice(0, cut), true)
  const legacyFields = ['owner_id', 'actor_sid', 'actor_iat', 'identity_hash', 'attempt_id', 'recovery_state']
  assert.equal((await pgQuery("SELECT column_name FROM information_schema.columns WHERE table_name='restore_tasks' AND column_name=ANY($1)", [legacyFields], source)).length, 0)
  await pgQuery("INSERT INTO users (id,username,password_hash,balance,updated_at) VALUES (910001,'backup_history_fixture','unusable-fixture',1234.56,now())", [], source)
  await pgQuery("INSERT INTO restore_tasks (id,instance_id,host_id,user_id,status,original_instance_name,original_incus_id,retry_count,progress,error) VALUES (910001,910001,910001,910001,'FAILED','original-实例','old-incus-id',3,'old-progress','preserved failure')", [], source)
  const oldTask = (await pgQuery('SELECT row_to_json(t) AS row FROM restore_tasks t WHERE id=910001', [], source))[0].row
  const dump = join(directory, 'legacy.dump')
  await backup.dumpDatabase(dump)
  await backup.restoreDatabase(dump, restored)
  assert.deepEqual((await pgQuery('SELECT row_to_json(t) AS row FROM restore_tasks t WHERE id=910001', [], restored))[0].row, oldTask)
  for (let index = cut; index < release.length; index++) await installMigration(index)
  await migrate(restored)
  assertMigrationHistory(await appliedBackupMigrations(restored), release, true)
  const newTask = (await pgQuery('SELECT row_to_json(t) AS row FROM restore_tasks t WHERE id=910001', [], restored))[0].row
  for (const field of legacyFields) { assert.equal(newTask[field], null); delete newTask[field] }
  assert.deepEqual(newTask, oldTask)
  assert.equal((await pgQuery('SELECT balance::text AS amount FROM users WHERE id=910001', [], restored))[0].amount, '1234.56')
  assert.equal((await appliedBackupMigrations(source)).length, cut, 'the original database is never upgraded or switched')
  console.log('PASS v1.7.7 custom dump restores and migrates: six absent fields become nullable, Unicode/identity/failure/retry state and exact money survive')

  // A late table conflict occurs after earlier schema creation. --single-transaction
  // must roll back all preceding changes, not leave a partially imported schema.
  await pgQuery("CREATE TABLE users (sentinel text); INSERT INTO users VALUES ('do-not-replace')", [], failed)
  await assert.rejects(backup.restoreDatabase(dump, failed), /pg_restore exited .*relation "users" already exists/s)
  assert.deepEqual(await pgQuery('SELECT * FROM users', [], failed), [{ sentinel: 'do-not-replace' }])
  assert.deepEqual(await pgQuery("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename", [], failed), [{ tablename: 'users' }])
  const truncated = join(directory, 'truncated.dump')
  await writeFile(truncated, (await readFile(dump)).subarray(0, 80))
  await assert.rejects(backup.restoreDatabase(truncated, failed), /pg_restore exited/)
  assert.deepEqual(await pgQuery('SELECT * FROM users', [], failed), [{ sentinel: 'do-not-replace' }])
  console.log('PASS conflicting and truncated imports reject without partial schema or sentinel changes')

  // Inject a real, mid-script trusted migration failure into a disposable copy.
  const injected = join(app, 'server/prisma/migrations/20990101000000_injected_failure')
  await mkdir(injected)
  await writeFile(join(injected, 'migration.sql'), 'BEGIN; CREATE TABLE injected_partial(id integer); SELECT 1 / 0; COMMIT;\n')
  await assert.rejects(migrate(restored))
  assert.equal((await pgQuery("SELECT to_regclass('public.injected_partial') AS table_name", [], restored))[0].table_name, null)
  await assert.rejects(appliedBackupMigrations(restored), /OSS_MIGRATION_HISTORY_MISMATCH/)
  assert.equal((await pgQuery('SELECT balance::text AS amount FROM users WHERE id=910001', [], restored))[0].amount, '1234.56')
  assert.equal((await appliedBackupMigrations(source)).length, cut)
  console.log('PASS failed migration leaves a rejected unfinished history in staging; original database and restored records remain intact')
} finally {
  for (const name of created.reverse()) await pgQuery(`DROP DATABASE ${quoteIdentifier(name)} WITH (FORCE)`)
  assert.ok(resolve(directory).startsWith(resolve(tmpdir(), 'payincus-backup-history-')))
  await rm(directory, { recursive: true, force: true })
}
