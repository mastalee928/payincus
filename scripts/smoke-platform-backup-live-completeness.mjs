// Read-only capture of the configured application DB; restore only to new UUID verification databases.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

assert.equal(process.platform, 'linux')
assert.equal(process.getuid(), 0)
assert.equal(process.env.RUN_BACKUP_LIVE_COMPLETENESS_CHECK, '1')
await import('/opt/incudal/server/dist/config/env.js')
const db = await import(process.env.INTEGRITY_DATABASE_MODULE || '/opt/incudal/server/dist/services/platform-backup-database.js')
const archive = await import(process.env.INTEGRITY_ARCHIVE_MODULE || '/opt/incudal/server/dist/services/platform-backup-archive.js')
const directory = await mkdtemp('/var/tmp/incudal-live-integrity-')
try {
  const dump = join(directory, 'database.dump')
  const captured = await db.captureDatabaseBackup(dump, directory)
  await db.verifyDatabaseBackup(dump, captured.report, directory, randomUUID())
  const report = join(directory, 'database-integrity.json'), env = join(directory, 'runtime.env')
  await writeFile(report, JSON.stringify(captured.report), { mode: 0o600 })
  await copyFile('/opt/incudal/.env', env); await chmod(env, 0o600)
  const password = randomUUID(), encrypted = join(directory, 'payload.enc')
  await archive.encryptBackup([{ name: 'database.dump', path: dump }, { name: 'database-globals.sql', path: captured.globals }, { name: 'database-integrity.json', path: report }, { name: 'runtime.env', path: env }], { format: 1, id: randomUUID(), installationId: randomUUID(), version: '1.6.8', createdAt: new Date().toISOString(), migrationHash: captured.metadata.migrationHash, postgresMajor: captured.metadata.postgresMajor, databaseBytes: captured.metadata.bytes }, password, encrypted)
  const decoded = await archive.decryptBackup(encrypted, password, join(directory, 'decoded'))
  assert.ok(decoded.zipPath)
  const verification = await mkdtemp(join(directory, 'zip-verify-'))
  await db.verifyDatabaseBackup(decoded.files.get('database.dump'), JSON.parse(await readFile(decoded.files.get('database-integrity.json'), 'utf8')), verification, randomUUID())
  console.log(JSON.stringify({ tableCount: captured.report.tables.length, rows: captured.report.tables.reduce((sum, table) => sum + BigInt(table.rows), 0n).toString(), sequenceCount: captured.report.sequences.length, largeObjects: captured.report.largeObjects.objects, schemaAndDataMatched: true, rolesArchived: true, standardZipVerified: true }))
} finally {
  assert.ok(directory.startsWith('/var/tmp/incudal-live-integrity-'))
  await rm(directory, { recursive: true, force: true })
}
