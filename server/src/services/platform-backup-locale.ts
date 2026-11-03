import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ensure, BackupError } from './platform-backup-core.js'

const exec = promisify(execFile)
type LocaleRuntime = { list(): Promise<string[]>; generate(source: string, name: string): Promise<void> }
const key = (value: string) => value.toLowerCase().replace(/utf-8/g, 'utf8')
const system: LocaleRuntime = {
  async list() {
    try { return (await exec('/usr/bin/locale', ['-a'], { timeout: 10000, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } })).stdout.split(/\r?\n/) }
    catch { throw new BackupError('OSS_DATABASE_LOCALE_UNAVAILABLE', 409) }
  },
  async generate(source, name) {
    try {
      // Only system definitions are used. No shell, archived locale files,
      // global locale change, package install or postgres restart is involved.
      await exec('/usr/bin/localedef', ['-i', source, '-f', 'UTF-8', name], {
        timeout: 120000, maxBuffer: 65536, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }
      })
    } catch { throw new BackupError('OSS_DATABASE_LOCALE_UNAVAILABLE', 409) }
  }
}

export async function ensureBackupLocales(required: string[], runtime: LocaleRuntime = system) {
  let installed = await runtime.list()
  for (const name of required) {
    ensure(typeof name === 'string' && name.length <= 80 && !/[\x00-\x20/\\]/.test(name), 'OSS_DATABASE_LOCALE_UNSUPPORTED', 409)
    if (installed.some(value => key(value) === key(name))) continue
    // Supported platform databases use libc UTF-8. Reject option/path injection
    // and never silently substitute C for the original collation.
    const match = /^([a-z]{2,3}_[A-Z]{2})\.(?:UTF-8|utf8)(@[a-z0-9]{1,20})?$/.exec(name)
    ensure(match, 'OSS_DATABASE_LOCALE_UNSUPPORTED', 409)
    await runtime.generate(match[1] + (match[2] || ''), name)
    installed = await runtime.list()
    ensure(installed.some(value => key(value) === key(name)), 'OSS_DATABASE_LOCALE_UNAVAILABLE', 409)
  }
}
