import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const preload = `data:text/javascript,${encodeURIComponent(`import { register } from 'node:module'; register(${JSON.stringify(new URL('./fixtures/seed-safety-loader.mjs', import.meta.url).href)});`)}`
const local = 'postgresql://fixture:fixture@127.0.0.1:5432/incudal_seed_test'
const defaults = { NODE_ENV: 'test', DATABASE_URL: local, ALLOW_LOCAL_SAMPLE_SEED: '1', FORCE_BULK_SEED: '' }
const rejected = [
  ['production', { NODE_ENV: 'production' }],
  ['missing environment', { NODE_ENV: '' }],
  ['unknown environment', { NODE_ENV: 'staging' }],
  ['missing opt-in', { ALLOW_LOCAL_SAMPLE_SEED: '' }],
  ['wrong opt-in', { ALLOW_LOCAL_SAMPLE_SEED: 'true' }],
  ['ordinary database', { DATABASE_URL: local.replace('incudal_seed_test', 'incudal') }],
  ['generic test database', { DATABASE_URL: local.replace('incudal_seed_test', 'incudal_pool_test') }],
  ['remote database', { DATABASE_URL: local.replace('127.0.0.1', 'db.example.invalid') }],
  ['loopback substring', { DATABASE_URL: local.replace('127.0.0.1', '127.0.0.1.example.invalid') }],
  ['remote with loopback username', { DATABASE_URL: 'postgresql://127.0.0.1:fixture@db.example.invalid:5432/incudal_seed_test' }],
  ['URL host override', { DATABASE_URL: local + '?host=db.example.invalid' }],
  ['URL parameter override', { DATABASE_URL: local + '?hostaddr=192.0.2.1' }],
  ['socket override', { DATABASE_URL: local + '?host=/var/run/postgresql' }],
  ['URL fragment', { DATABASE_URL: local + '#localhost' }],
  ['encoded name', { DATABASE_URL: local.replace('incudal_seed_test', '%69ncudal_seed_test') }],
  ['missing database URL', { DATABASE_URL: '' }],
  ['malformed URL', { DATABASE_URL: 'redacted-invalid' }],
  ['wrong protocol', { DATABASE_URL: local.replace('postgresql:', 'https:') }],
  ['zero port', { DATABASE_URL: local.replace(':5432/', ':0/') }],
  ['too large port', { DATABASE_URL: local.replace(':5432/', ':65536/') }],
  ['old force on production', { NODE_ENV: 'production', FORCE_BULK_SEED: '1' }],
  ['old force on ordinary database', { DATABASE_URL: local.replace('incudal_seed_test', 'incudal'), FORCE_BULK_SEED: '1' }],
  ['old substring spoof', { DATABASE_URL: 'postgresql://fixture:incudal_dev_password@db:5432/incudal?host=127.0.0.1', FORCE_BULK_SEED: '1' }],
]
const accepted = [
  ['IPv4 local test', {}],
  ['IPv6 local test', { DATABASE_URL: local.replace('127.0.0.1', '[::1]') }],
  ['localhost development', { NODE_ENV: 'development', DATABASE_URL: local.replace('127.0.0.1', 'localhost') }],
  ['postgres protocol', { DATABASE_URL: local.replace('postgresql:', 'postgres:') }],
]
for (const script of ['seed-test-data.ts', 'seed-bulk-local-data.ts']) {
  for (const [label, overrides] of [...rejected, ...accepted]) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', preload, `scripts/${script}`], {
      cwd: resolve(root, 'server'), encoding: 'utf8', timeout: 20000,
      env: { ...process.env, ...defaults, ...overrides },
    })
    assert.ifError(result.error)
    const output = result.stdout + result.stderr
    assert.notEqual(result.status, 0, `${script}: ${label} must stop at the guard or test database boundary`)
    if (rejected.some(([name]) => name === label)) {
      assert.ok(!output.includes('SEED_DATABASE_BOUNDARY_REACHED'), `${script}: ${label} reached database code`)
      assert.ok(!output.includes('SEED_DB_MODULE_LOADED'), `${script}: ${label} initialized database modules`)
      assert.ok(output.includes('Sample seed refused:'), `${script}: ${label} must explicitly refuse unsafe configuration`)
      const configuredUrl = overrides.DATABASE_URL ?? local
      if (configuredUrl) assert.ok(!output.includes(configuredUrl), `${script}: refusal must not print the database URL`)
    } else {
      assert.ok(output.includes('SEED_DATABASE_BOUNDARY_REACHED'), `${script}: ${label} must reach the isolated database replacement`)
      assert.ok(!output.includes('Sample seed refused:'), `${script}: ${label} wrongly refused`)
    }
  }
  console.log(`PASS ${script}: ${rejected.length} refusals before database code; ${accepted.length} explicit local targets accepted`)
}
