#!/usr/bin/env node
// Explicit build only: never initialize a signing identity or publish a release.
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'
import { lstat, mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { GATEWAY_COMPONENT_FILES, signGatewayComponentManifest, verifyGatewayComponentSource } from './gateway-component-manifest.mjs'
const exec = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))
const argv = process.argv.slice(2), args = {}
for (let index = 0; index < argv.length; index += 2) {
  const key = argv[index]
  if (!['--out', '--architecture', '--node', '--go', '--signing-key'].includes(key) || args[key] || !argv[index + 1]) throw Error('invalid build arguments')
  args[key] = argv[index + 1]
}
if (Object.keys(args).length !== 5 || !['amd64', 'arm64'].includes(args['--architecture'])) throw Error('explicit output, architecture, node, go and signing key required')
const output = resolve(args['--out']), architecture = args['--architecture']
if (output === root || root.startsWith(output + '/') || root.startsWith(output + '\\')) throw Error('output must not contain the source checkout')
async function regular(path, secret = false) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (secret && process.platform !== 'win32' && (info.mode & 0o777) !== 0o600)) throw Error('unsafe build input')
  return info
}
await regular(args['--node']); await regular(args['--go']); await regular(args['--signing-key'], true)
const runtime = await readFile(args['--node'])
if (runtime.length < 20 || runtime.subarray(0, 4).toString('hex') !== '7f454c46' || runtime[4] !== 2 || runtime[5] !== 1 || runtime.readUInt16LE(18) !== (architecture === 'amd64' ? 62 : 183)) throw Error('Node ELF architecture mismatch')
const signer = createPrivateKey(await readFile(args['--signing-key']))
if (signer.asymmetricKeyType !== 'ed25519') throw Error('Ed25519 signing key required')
const version = JSON.parse(await readFile(join(root, 'server/package.json'), 'utf8')).version
const sourceCommit = await verifyGatewayComponentSource(root)
if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(version) || !/^[a-f0-9]{40}$/.test(sourceCommit)) throw Error('invalid source identity')
await mkdir(output, { mode: 0o700 })
for (const directory of ['bin', 'lib', 'ui', 'scripts']) {
  await mkdir(join(output, directory), { mode: 0o755 }); await chmod(join(output, directory), 0o755)
}
const writePackageFile = async (name, contents, mode) => {
  const path = join(output, name)
  await writeFile(path, contents, { mode, flag: 'wx' }); await chmod(path, mode)
}
await writePackageFile('package.json', '{"type":"commonjs","private":true}', 0o644)
await writePackageFile('LICENSE', await readFile(join(root, 'LICENSE')), 0o644)
await writePackageFile('bin/node', runtime, 0o755)
for (const command of ['incudal-channels', 'incudal-gateway', 'incudal-maintenance']) {
  await exec(resolve(args['--go']), ['build', '-trimpath', '-buildvcs=false', '-ldflags=-s -w', '-o', join(output, 'bin', command), './cmd/' + command],
    { cwd: join(root, 'agent'), env: { ...process.env, GOOS: 'linux', GOARCH: architecture, CGO_ENABLED: '0' }, timeout: 180000 })
  await chmod(join(output, 'bin', command), 0o755)
}
for (const [entry, target] of [['run-gateway-console', 'gateway-console'], ['run-gateway-backup', 'gateway-backup'], ['run-controller-discovery', 'controller-discovery'], ['run-controller-witness', 'controller-witness']]) {
  const result = await build({ absWorkingDir: root, entryPoints: ['server/src/scripts/' + entry + '.ts'], outfile: join(output, 'lib', target + '.cjs'),
    bundle: true, platform: 'node', target: 'node22', format: 'cjs', metafile: true, sourcemap: false, legalComments: 'inline', logLevel: 'silent',
    plugins: [{ name: 'gateway-reject-optional-proxy', setup(bundler) {
      bundler.onResolve({ filter: /^proxy-agent$/ }, () => ({ path: 'proxy-agent', namespace: 'gateway-no-proxy' }))
      bundler.onLoad({ filter: /.*/, namespace: 'gateway-no-proxy' }, () => ({ contents: "module.exports = function GatewayProxyRejected() { throw new Error('GATEWAY_PROXY_UNSUPPORTED') }", loader: 'js' }))
    } }] })
  // A standalone control component cannot smuggle in business state or workers.
  if (Object.keys(result.metafile.inputs).some(path => /(?:server\/src\/(?:app\.ts|db\/|workers\/|config\/env\.ts)|@prisma|dotenv)/.test(path.replaceAll('\\', '/')))) throw Error('business backend dependency in gateway bundle')
  await chmod(join(output, 'lib', target + '.cjs'), 0o644)
}
for (const name of GATEWAY_COMPONENT_FILES.filter(path => path.startsWith('ui/') || path.startsWith('scripts/'))) {
  const source = name.startsWith('ui/') ? join(root, 'server/src/gateway-ui', name.slice(3)) : join(root, name)
  await writePackageFile(name, await readFile(source), name.endsWith('.sh') ? 0o755 : 0o644)
}
const files = []
for (const path of GATEWAY_COMPONENT_FILES) {
  const contents = await readFile(join(output, path))
  files.push({ path, size: contents.length, sha256: createHash('sha256').update(contents).digest('hex'), mode: path.startsWith('bin/') || path.endsWith('.sh') ? 493 : 420 })
}
const manifest = { schemaVersion: 1, purpose: 'gateway-component-package', version, sourceCommit, architecture,
  protocols: { gatewayTransport: 1, managementChannels: 1, maintenance: 1, discovery: 1, witness: 1, console: 1, backup: 1 }, files }
if (await verifyGatewayComponentSource(root) !== sourceCommit) throw Error('source changed during build')
await writePackageFile('manifest.json', signGatewayComponentManifest(manifest, signer), 0o644)
const publicKey = createPublicKey(signer).export({ format: 'der', type: 'spki' }).subarray(12).toString('base64')
process.stdout.write(JSON.stringify({ built: true, architecture, version, sourceCommit, files: files.length, publicKey }) + '\n')
