// Explicit Linux drill: isolated databases and release fixtures only.
// Never switches the live application database or uses customer credentials in output.
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, symlink, chmod, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'

assert.equal(process.platform, 'linux')
assert.equal(process.getuid(), 0)
assert.equal(process.env.RUN_BACKUP_COMPATIBILITY_DRILL, '1')
const require = createRequire('/opt/incudal/server/package.json')
Object.assign(process.env, require('dotenv').parse(await readFile('/opt/incudal/.env')))
const originalUrl = process.env.DATABASE_URL, originalApp = process.env.INCUDAL_APP_DIR
const modules = process.env.BACKUP_COMPATIBILITY_MODULE_DIR || '/opt/incudal/server/dist/services'
const db = await import(join(modules, 'platform-backup-database.js'))
const { verifyBackupCompatibility } = await import(join(modules, 'platform-backup-worker.js'))
const id = randomUUID().replaceAll('-', ''), target = `incudal_check_${id}`, restored = `incudal_restore_${id}`
const directory = await mkdtemp('/var/tmp/incudal-compatibility-')
await chmod(directory, 0o755)
const app = join(directory, 'app'), migrations = join(app, 'server/prisma/migrations')
const q = db.quoteIdentifier, hash = value => createHash('sha256').update(value).digest('hex')
const initial = '20260101000000_initial', later = '20260102000000_extra'
const initialSql = 'CREATE TABLE ledger (id integer PRIMARY KEY, amount numeric(20,8) NOT NULL);\n'
const laterSql = 'ALTER TABLE ledger ADD COLUMN note text;\n'
let targetCreated = false, restoredCreated = false
try {
  for (const [name, sql] of [[initial, initialSql], [later, laterSql]]) {
    await mkdir(join(migrations, name), { recursive: true })
    await writeFile(join(migrations, name, 'migration.sql'), sql)
  }
  await writeFile(join(migrations, 'migration_lock.toml'), 'provider = "postgresql"\n')
  await writeFile(join(app, 'version.json'), JSON.stringify({ version: '1.7.1' }))
  await writeFile(join(app, 'package.json'), JSON.stringify({ version: '1.7.1' }))
  await writeFile(join(app, 'server/prisma/schema.prisma'), 'datasource db {\n provider = "postgresql"\n}\nmodel ledger {\n id Int @id\n amount Decimal\n note String?\n}\n')
  await writeFile(join(app, 'server/prisma.config.ts'), "import { defineConfig, env } from 'prisma/config'; export default defineConfig({schema:'prisma/schema.prisma',migrations:{path:'prisma/migrations'},datasource:{url:env('DATABASE_URL')}});\n")
  await symlink('/opt/incudal/server/node_modules', join(app, 'server/node_modules'))
  // The parent smoke runner uses umask 077. Prisma migrates as the incudal
  // account, so this non-secret release fixture must be traversable/readable.
  const readableFixture = async path => {
    await chmod(path, 0o755)
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) await readableFixture(join(path, entry.name))
      else await chmod(join(path, entry.name), 0o644)
    }
  }
  await readableFixture(app)
  await db.localDatabaseAdmin(`CREATE DATABASE ${q(target)} OWNER ${q(db.postgresConnection().user)} TEMPLATE template0;`); targetCreated = true
  await db.localDatabaseAdmin(`CREATE DATABASE ${q(restored)} OWNER ${q(db.postgresConnection().user)} TEMPLATE template0;`); restoredCreated = true
  await db.migrateBackupDatabase(app, target)
  const nextUrl = new URL(originalUrl); nextUrl.pathname = `/${target}`
  process.env.DATABASE_URL = nextUrl.toString(); process.env.INCUDAL_APP_DIR = app
  await db.pgQuery('CREATE TABLE "_prisma_migrations" (id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz, migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0); ' + initialSql, [], restored)
  await db.pgQuery('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$3,now());', [randomUUID(), hash(initialSql.replaceAll('\n', '\r\n')), initial], restored)
  await db.pgQuery('INSERT INTO ledger VALUES(1,0.12345678)', [], restored)
  const metadata = await db.databaseMetadata(restored)
  const manifest = { version: '1.6.8', migrationHash: metadata.migrationHash, postgresMajor: metadata.postgresMajor }
  const compatibility = await verifyBackupCompatibility(manifest, restored, directory)
  assert.equal((await db.pgQuery('SELECT amount::text,note FROM ledger WHERE id=1', [], restored))[0].amount, '0.12345678')
  assert.equal((await db.appliedBackupMigrations(restored)).length, 2)
  console.log('PASS: older release and verified CRLF history migrate in isolation; exact financial values survive')
  const compatibleMetadata = await db.databaseMetadata(restored)
  const currentManifest = { ...manifest, migrationHash: compatibleMetadata.migrationHash }
  await assert.rejects(verifyBackupCompatibility({ ...currentManifest, version: '1.7.2' }, restored, directory), /OSS_BACKUP_VERSION_NEWER/)
  await assert.rejects(verifyBackupCompatibility({ ...currentManifest, postgresMajor: metadata.postgresMajor + 1 }, restored, directory), /OSS_POSTGRES_VERSION_MISMATCH/)
  await db.pgQuery('ALTER TABLE ledger ADD COLUMN unexpected text', [], restored)
  await assert.rejects(verifyBackupCompatibility(currentManifest, restored, directory), /OSS_BACKUP_SCHEMA_MISMATCH/)
  await db.pgQuery('ALTER TABLE ledger DROP COLUMN unexpected', [], restored)
  await db.pgQuery('ALTER TABLE ledger ADD COLUMN target_change text')
  await assert.rejects(verifyBackupCompatibility(currentManifest, restored, directory, compatibility), /OSS_PREVIEW_TARGET_CHANGED/)
  await db.pgQuery('ALTER TABLE ledger DROP COLUMN target_change')
  await db.pgQuery('UPDATE "_prisma_migrations" SET checksum=$1 WHERE migration_name=$2', ['f'.repeat(64), initial], restored)
  const changed = await db.databaseMetadata(restored)
  await assert.rejects(verifyBackupCompatibility({ ...manifest, migrationHash: changed.migrationHash }, restored, directory), /OSS_MIGRATION_HISTORY_MISMATCH/)
  console.log('PASS: newer backup, PostgreSQL mismatch, schema drift, destination change and unknown migration checksum are refused')
} finally {
  process.env.DATABASE_URL = originalUrl
  if (originalApp === undefined) delete process.env.INCUDAL_APP_DIR; else process.env.INCUDAL_APP_DIR = originalApp
  if (restoredCreated) await db.localDatabaseAdmin(`DROP DATABASE ${q(restored)} WITH (FORCE);`)
  if (targetCreated) await db.localDatabaseAdmin(`DROP DATABASE ${q(target)} WITH (FORCE);`)
  await rm(directory, { recursive: true, force: true })
}
