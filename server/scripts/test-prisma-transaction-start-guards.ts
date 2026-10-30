import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(new URL('../package.json', import.meta.url))
const clientRoot = dirname(require.resolve('@prisma/client/package.json'))
for (const format of ['client.js', 'client.mjs']) {
  const source = readFileSync(resolve(clientRoot, 'runtime', format), 'utf8')
  assert.ok(source.includes('let started=this.driverAdapter.startTransaction(t.isolationLevel)'), `${format}: keep the pending startup promise`)
  assert.ok(source.includes('r.transaction=void 0;void started.then(async tx=>'), `${format}: abandoned result must have one cleanup owner`)
  assert.ok(source.includes('if(tx.options.usePhantomQuery){await tx.rollback()}else{try{await tx.executeRaw({sql:"ROLLBACK",args:[],argTypes:[]})}finally{await tx.rollback()}}'),
    `${format}: PostgreSQL cleanup must send ROLLBACK before releasing the client even on SQL failure`)
}
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
assert.equal(pkg.pnpm.patchedDependencies['@prisma/client@7.1.0'], 'patches/@prisma__client@7.1.0.patch')
const attributes = readFileSync(resolve(root, '.gitattributes'), 'utf8')
assert.ok(attributes.includes('*.patch text eol=lf'), 'patch bytes must be stable across Git checkout platforms')
assert.ok(!readFileSync(resolve(root, pkg.pnpm.patchedDependencies['@prisma/client@7.1.0'])).includes(13),
  'the frozen-install patch must use LF line endings')
const workflow = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8')
assert.ok(workflow.indexOf('cp -r patches release/') > 0 &&
  workflow.indexOf('cp -r patches release/') < workflow.indexOf('pnpm install --prod --frozen-lockfile --ignore-scripts --filter server'),
  'production package must carry the patch before frozen dependency installation')
const ci = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')
assert.ok(ci.includes('run: pnpm --filter server test:prisma-transaction-start-timeout'), 'real PostgreSQL timeout regression must run in CI')
console.log('Prisma transaction-start cleanup guards passed for both Node runtimes and production packaging')
