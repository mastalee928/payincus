import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoot = resolve(tmpdir())
const work = mkdtempSync(join(temporaryRoot, 'payincus-agent-installer-'))
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
if (process.platform === 'win32' && !existsSync(bash)) throw new Error('Git Bash is required for the isolated installer test')
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith('INCUDAL_') && !['BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS'].includes(key)))
try {
  const result = spawnSync(bash, ['scripts/test-agent-installer.sh', work.replaceAll('\\', '/')], {
    cwd: root, env, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
  })
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Isolated Agent installer test failed (${result.status ?? result.signal})`)
} finally {
  const target = resolve(work)
  if (!target.startsWith(temporaryRoot + sep) || !target.includes('payincus-agent-installer-')) {
    throw new Error('Refusing to clean an unexpected test directory')
  }
  rmSync(target, { recursive: true, force: true })
}
