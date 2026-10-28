import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bash = process.env.REVIEW_BASH || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash')
if (process.platform === 'win32' && !existsSync(bash)) throw new Error('Set REVIEW_BASH to an installed Bash executable')
mkdirSync(join(root, 'logs'), { recursive: true })
const work = mkdtempSync(join(root, 'logs', 'review-init-env-fixture-'))
const required = ['NODE_ENV', 'HOST', 'PORT', 'TRUST_PROXY', 'DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'COOKIE_SECRET',
  'ENCRYPTION_KEY', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'SERVE_STATIC_CLIENT', 'VITE_API_BASE_URL',
  'SYSTEM_UPDATE_RELEASE_REPOSITORY', 'INCUDAL_AGENT_RELEASE_REPOSITORY', 'LOG_LEVEL', 'DISABLE_REQUEST_LOG']

function readValues(file) {
  const values = new Map()
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line)
    if (match) values.set(match[1], match[2])
  }
  return values
}

function execute(folder) {
  // Explicit fixture path and a minimal child environment: never load the real
  // repository .env or forward ambient release/database credentials.
  const childEnv = {
    PATH: process.platform === 'win32' ? `C:/Program Files/Git/usr/bin;${process.env.PATH || ''}` : process.env.PATH,
    ENV_FILE: 'fixture.env', INCUDAL_AGENT_RELEASE_TOKEN: 'fixture_release_token_not_a_credential',
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
  }
  for (const key of ['SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
    if (process.env[key]) childEnv[key] = process.env[key]
  }
  const result = spawnSync(bash, [join(root, 'scripts', 'init-env.sh')], {
    cwd: folder, env: childEnv, encoding: 'utf8', timeout: 60000, windowsHide: true,
  })
  assert.equal(result.status, 0, `init-env failed (${result.error?.message || result.status})`)
  const file = join(folder, 'fixture.env')
  const values = readValues(file)
  for (const key of required) assert.ok(values.get(key)?.trim(), `${key} must have a nonempty effective value`)
  for (const key of ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'COOKIE_SECRET', 'ENCRYPTION_KEY', 'ADMIN_PASSWORD', 'INCUDAL_AGENT_RELEASE_TOKEN']) {
    assert.ok(!(result.stdout + result.stderr).includes(values.get(key)), `${key} must not be printed`)
  }
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600, 'generated environment must be private')
  return { file, values }
}

function fixture(name, text) {
  const folder = join(work, name)
  mkdirSync(folder)
  if (text !== undefined) writeFileSync(join(folder, 'fixture.env'), text)
  return folder
}

try {
  const fresh = fixture('fresh')
  const first = execute(fresh)
  const initial = readFileSync(first.file, 'utf8')
  execute(fresh)
  assert.equal(readFileSync(first.file, 'utf8'), initial, 'repeating initialization must preserve every byte and generated identity')
  assert.equal(first.values.get('PORT'), '3001')
  assert.equal(first.values.get('SERVE_STATIC_CLIENT'), 'false')
  assert.equal(first.values.get('INCUDAL_AGENT_RELEASE_TOKEN'), 'fixture_release_token_not_a_credential')
  assert.equal(first.values.get('JWT_SECRET').length, 48)
  assert.equal(first.values.get('COOKIE_SECRET').length, 48)
  assert.equal(Buffer.from(first.values.get('ENCRYPTION_KEY'), 'base64').length, 32)
  console.log('PASS fresh creation, generated identity, secret output boundary and repeat idempotence')

  const duplicates = fixture('duplicates', '# fixture comment\nJWT_SECRET=\nJWT_SECRET=\nJWT_SECRET=\nPORT=19001\nPORT=\nUNRELATED=left=right\n# PORT=do-not-touch\n')
  const deduped = execute(duplicates)
  const content = readFileSync(deduped.file, 'utf8')
  for (const key of ['JWT_SECRET', 'PORT']) assert.equal(content.split('\n').filter(line => line.startsWith(`${key}=`)).length, 1, `${key} blank duplicates must collapse`)
  assert.equal(deduped.values.get('PORT'), '3001')
  assert.ok(content.includes('UNRELATED=left=right\n# PORT=do-not-touch\n'), 'unrelated records and comments must remain unchanged')
  console.log('PASS all blank duplicates and a final empty duplicate become one effective configured value')

  const preserved = fixture('preserved', 'JWT_SECRET=fixture-old\nJWT_SECRET=fixture-current-A1!\nCOOKIE_SECRET=fixture-cookie-A1!\nDATABASE_URL=postgresql://fixture:pass@localhost/fixture?option=one=two\nPORT=19009\n')
  const existing = execute(preserved)
  assert.equal(existing.values.get('JWT_SECRET'), 'fixture-current-A1!')
  assert.equal(existing.values.get('COOKIE_SECRET'), 'fixture-cookie-A1!')
  assert.equal(existing.values.get('DATABASE_URL'), 'postgresql://fixture:pass@localhost/fixture?option=one=two')
  assert.equal(existing.values.get('PORT'), '19009')
  console.log('PASS effective nonempty settings and values containing equals signs are preserved')

  const crlf = fixture('crlf', 'JWT_SECRET=\r\nJWT_SECRET=\r\nPORT=\r\nPORT=\r\nCOOKIE_SECRET=fixture-crlf-cookie-A1!\r\n')
  const windowsFile = execute(crlf)
  assert.equal(windowsFile.values.get('COOKIE_SECRET'), 'fixture-crlf-cookie-A1!')
  for (const key of ['JWT_SECRET', 'PORT']) assert.equal(readFileSync(windowsFile.file, 'utf8').split(/\r?\n/).filter(line => line.startsWith(`${key}=`)).length, 1)
  console.log('PASS CRLF empty duplicates are filled while nonempty settings are preserved')
  console.log('init-env execution fixtures passed; Windows does not establish Linux permission enforcement')
} finally {
  // This is the unique test-owned directory, never a repository or user path.
  rmSync(work, { recursive: true, force: true })
}
