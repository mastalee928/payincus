import assert from 'node:assert/strict'
import { createHash, createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { GATEWAY_BUILD_INPUTS, GATEWAY_COMPONENT_FILES, GATEWAY_PACKAGE_PREFIX,
  signGatewayComponentManifest, verifyGatewayComponentSource } from '../../scripts/gateway-component-manifest.mjs'
const pair = generateKeyPairSync('ed25519')
const manifest = { schemaVersion: 1, purpose: 'gateway-component-package', files: GATEWAY_COMPONENT_FILES }
const raw = signGatewayComponentManifest(manifest, pair.privateKey), envelope = JSON.parse(raw)
assert.ok(verify(null, Buffer.from(GATEWAY_PACKAGE_PREFIX + envelope.keyId + '\n' + envelope.payload), pair.publicKey, Buffer.from(envelope.signature, 'base64')))
const publicKey = createPublicKey(pair.privateKey).export({ format: 'der', type: 'spki' }).subarray(12)
assert.equal(envelope.keyId, 'key_' + createHash('sha256').update(publicKey).digest('hex'))
assert.ok(!verify(null, Buffer.from('incorrect-domain\n' + envelope.keyId + '\n' + envelope.payload), pair.publicKey, Buffer.from(envelope.signature, 'base64')))
assert.throws(() => signGatewayComponentManifest(manifest, pair.publicKey))
const python = await readFile(new URL('../../scripts/verify-gateway-component-package.py', import.meta.url), 'utf8')
const builder = await readFile(new URL('../../scripts/build-gateway-component-package.mjs', import.meta.url), 'utf8')
for (const workflow of ['ci.yml', 'release.yml']) {
  const source = await readFile(new URL('../../.github/workflows/' + workflow, import.meta.url), 'utf8')
  assert.ok(source.includes('sudo cp -R --preserve=mode --no-preserve=ownership'), 'root staging must preserve signed file modes independently of sudo umask')
}
for (const path of GATEWAY_COMPONENT_FILES) assert.ok(python.includes(`'${path}'`), 'cross-language fixed file list: ' + path)
assert.ok(builder.includes('bundle: true') && builder.includes('metafile: true') && builder.includes('@prisma|dotenv'))
assert.ok(builder.includes('GATEWAY_PROXY_UNSUPPORTED'), 'optional proxy branch must not bypass endpoint pinning')
assert.ok(builder.includes('source changed during build') && builder.includes("CGO_ENABLED: '0'"))
assert.ok(!builder.includes('git push') && !builder.includes('generateKeyPair'))
const directory = await mkdtemp(join(tmpdir(), 'incudal-package-source-'))
const exec = promisify(execFile)
const git = (args: string[]) => exec('git', args, { cwd: directory })
try {
  await git(['init', '--quiet'])
  for (const input of GATEWAY_BUILD_INPUTS) {
    const path = join(directory, input === 'agent' || input === 'server/src' ? input + '/fixture' : input)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, 'source\n')
  }
  await git(['add', '.'])
  await git(['-c', 'user.name=Package Guard', '-c', 'user.email=package-guard@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture'])
  const expected = (await git(['rev-parse', 'HEAD'])).stdout.trim()
  assert.equal(await verifyGatewayComponentSource(directory), expected)
  // A document outside the actual build inputs does not taint a package.
  await writeFile(join(directory, 'notes.txt'), 'unrelated\n')
  assert.equal(await verifyGatewayComponentSource(directory), expected)
  for (const input of ['scripts/install-gateway-console.sh', 'scripts/build-gateway-component-package.mjs', 'pnpm-lock.yaml', 'server/package.json', 'agent/fixture']) {
    await writeFile(join(directory, input), 'changed\n')
    await assert.rejects(verifyGatewayComponentSource(directory), /must be committed/)
    await writeFile(join(directory, input), 'source\n')
  }
  await writeFile(join(directory, 'server/src/untracked.ts'), 'untracked\n')
  await assert.rejects(verifyGatewayComponentSource(directory), /must be committed/)
  await rm(join(directory, 'server/src/untracked.ts'))
  await writeFile(join(directory, 'server/src/fixture'), 'staged\n')
  await git(['add', 'server/src/fixture'])
  await assert.rejects(verifyGatewayComponentSource(directory), /must be committed/)
} finally {
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
  assert.ok(basename(directory).startsWith('incudal-package-source-'))
  await rm(directory, { recursive: true, force: true })
}
console.log('Gateway component package signature domain, pinned identity, strict file coverage and independent build guards passed')
