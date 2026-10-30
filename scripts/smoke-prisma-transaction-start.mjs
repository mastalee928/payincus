import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Only run on a disposable CI machine')
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted')
assert.equal(process.getuid(), 0, 'Requires the disposable fresh-install root runner')
const serverRoot = '/opt/incudal/server'
const require = createRequire(join(serverRoot, 'package.json'))
const env = require('dotenv').parse(await readFile('/opt/incudal/.env'))
const database = new URL(env.DATABASE_URL)
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol) &&
  ['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && !database.search && !database.hash,
  'installed database must be local to the disposable runner')
const clientRoot = dirname(require.resolve('@prisma/client/package.json'))
for (const format of ['client.js', 'client.mjs']) {
  const runtime = await readFile(join(clientRoot, 'runtime', format), 'utf8')
  assert.ok(runtime.includes('r.transaction=void 0;void started.then(async tx=>') &&
    runtime.includes('await tx.executeRaw({sql:"ROLLBACK",args:[],argTypes:[]})}finally{await tx.rollback()}'),
    `${format}: installed production runtime must own and roll back late transactions`)
}
const testDatabase = `prisma_${randomUUID().replaceAll('-', '')}_pool_test`
assert.match(testDatabase, /^prisma_[a-f0-9]{32}_pool_test$/)
const temporary = await mkdtemp(join(serverRoot, '.prisma-timeout-smoke-'))
let created = false
try {
  execFileSync('sudo', ['-u', 'postgres', 'createdb', '--owner', decodeURIComponent(database.username), testDatabase], { stdio: 'pipe' })
  created = true
  database.pathname = `/${testDatabase}`
  // Place the test below the installed server so imports use packaged production dependencies.
  const testPath = join(temporary, 'test-prisma-transaction-start-timeout.ts')
  await writeFile(testPath, await readFile(new URL('../server/scripts/test-prisma-transaction-start-timeout.ts', import.meta.url)))
  const result = spawnSync(process.execPath, ['--experimental-strip-types', testPath], {
    cwd: serverRoot, env: { ...process.env, DATABASE_URL: database.href }, stdio: 'inherit', timeout: 100_000
  })
  assert.ok(!result.error && result.status === 0, 'packaged production Prisma must pass the real PostgreSQL timeout regression')
  console.log('Installed production Prisma passed: repeated eight-connection timeouts, late BEGIN rollback/release and ordinary transactions')
} finally {
  if (created) execFileSync('sudo', ['-u', 'postgres', 'dropdb', '--force', testDatabase], { stdio: 'pipe' })
  assert.ok(resolve(temporary).startsWith(`${serverRoot}/.prisma-timeout-smoke-`))
  await rm(temporary, { recursive: true, force: true })
}
