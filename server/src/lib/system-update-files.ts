import { cp, lstat, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

// Database dumps belong to the retained backup, never the restored code tree.
// Preserving literal symlink targets keeps the root helper's sealed link set
// identical and avoids dependencies pointing back into staging or a backup.
export async function restoreSystemUpdateApplication(backup: string, destination: string): Promise<void> {
  const root = resolve(backup)
  await cp(root, destination, {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
    filter: source => dirname(resolve(source)) !== root || !/^db-pre-migrate-v[A-Za-z0-9._-]+-\d{14}\.sql(?:\.tmp)?$/.test(basename(source))
  })
}

export async function ensureSystemUpdateEnvironmentDefaults(path: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('Unsupported update environment file')
  const source = await readFile(path, 'utf8')
  const matches = [...source.matchAll(/^\s*(?:export\s+)?PAYMENT_CALLBACK_SKIP_IP_WHITELIST=(.*)$/gm)]
  const current = matches.at(-1)?.[1].split('#')[0].trim().replace(/^(['"])(.*)\1$/, '$2') || ''
  // The runtime only skips IP checks for literal true. Fill its safe false
  // default for old environments; explicit nonempty settings remain subject
  // to the production gate, never silently overridden.
  if (!current) await writeFile(path, `${source.replace(/\n?$/, '\n')}PAYMENT_CALLBACK_SKIP_IP_WHITELIST=false\n`)
}

export async function backupSystemUpdateApplication(source: string, destination: string): Promise<void> {
  const root = resolve(source)
  const disposable = new Set(['.incudal-update-downloads', '.npm', '.cache', 'update-logs'])
  await cp(root, destination, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true,
    filter: path => dirname(resolve(path)) !== root || !disposable.has(basename(path)) })
}
