import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ensure } from './platform-backup-core.js'

export interface BackupMigration { migration_name: string; checksum: string }
export interface ReleaseMigration { name: string; checksum: string; acceptedChecksums: string[]; sql?: string }
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

export function assertBackupVersion(source: string, target: string): void {
  // Disposable release-preview drills have a fixed commit identity. They may
  // restore only their own preview; never compare previews as stable versions.
  if (source === target && /^preview-[a-f0-9]{7,40}$/.test(source)) return
  const parse = (value: string) => {
    const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value)
    ensure(match, 'OSS_APP_VERSION_UNSUPPORTED', 409)
    const parts = match.slice(1).map(Number)
    ensure(parts.every(Number.isSafeInteger), 'OSS_APP_VERSION_UNSUPPORTED', 409)
    return parts
  }
  const a = parse(source), b = parse(target)
  ensure(a[0] === b[0] && (a[0] !== 0 || a[1] === b[1]), 'OSS_APP_VERSION_UNSUPPORTED', 409)
  const difference = a.map((n, i) => n - b[i]).find(n => n !== 0) || 0
  ensure(difference <= 0, 'OSS_BACKUP_VERSION_NEWER', 409)
}

export async function releaseMigrations(app: string): Promise<ReleaseMigration[]> {
  const root = join(app, 'server/prisma/migrations')
  const result: ReleaseMigration[] = []
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (entry.name === 'migration_lock.toml') continue
    ensure(entry.isDirectory() && /^\d{8,14}_[A-Za-z0-9_-]+$/.test(entry.name), 'OSS_RELEASE_MIGRATIONS_INVALID', 503)
    const path = join(root, entry.name, 'migration.sql'), info = await lstat(path)
    ensure(info.isFile() && !info.isSymbolicLink() && info.size <= 4 * 1024 * 1024, 'OSS_RELEASE_MIGRATIONS_INVALID', 503)
    const sql = await readFile(path, 'utf8'), lf = sql.replace(/\r\n/g, '\n')
    // Only byte-exact LF/CRLF encodings of trusted release SQL are equivalent.
    result.push({ name: entry.name, checksum: digest(sql), acceptedChecksums: [...new Set([digest(sql), digest(lf), digest(lf.replace(/\n/g, '\r\n'))])], sql: lf })
  }
  ensure(result.length > 0, 'OSS_RELEASE_MIGRATIONS_INVALID', 503)
  return result
}

export function assertMigrationHistory(rows: BackupMigration[], release: ReleaseMigration[], complete = false): void {
  ensure(rows.length <= release.length && (!complete || rows.length === release.length), 'OSS_MIGRATION_HISTORY_MISMATCH', 409)
  for (const [i, row] of rows.entries()) {
    ensure(row.migration_name === release[i].name && release[i].acceptedChecksums.includes(row.checksum), 'OSS_MIGRATION_HISTORY_MISMATCH', 409)
  }
}

export function releaseMigrationHash(release: ReleaseMigration[]): string {
  return digest(JSON.stringify(release.map(row => ({ name: row.name, checksums: row.acceptedChecksums.slice().sort() }))))
}

export function normalizedReleaseSchema(sql: string, release: ReleaseMigration[]): string {
  const bodies = new Set<string>()
  for (const migration of release) {
    for (const match of (migration.sql || '').matchAll(/\$\$([\s\S]*?)\$\$/g)) bodies.add(match[1])
  }
  // Do not normalize arbitrary SQL/string data. Only known release function
  // bodies differing by CRLF are formatting-equivalent.
  return sql.replace(/(\$[A-Za-z0-9_]*\$)([\s\S]*?)\1/g, (all, delimiter: string, body: string) => {
    const lf = body.replace(/\r\n/g, '\n')
    return bodies.has(lf) ? `${delimiter}${lf}${delimiter}` : all
  })
}
