import { createHash, createPublicKey, sign } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
export const GATEWAY_COMPONENT_FILES = [
  'LICENSE',
  'bin/incudal-channels', 'bin/incudal-gateway', 'bin/incudal-maintenance', 'bin/node',
  'lib/gateway-console.cjs', 'lib/gateway-backup.cjs', 'lib/controller-discovery.cjs', 'lib/controller-witness.cjs',
  'ui/index.html', 'ui/console.css', 'ui/console.js',
  'scripts/install-management-gateway.sh', 'scripts/install-management-channels.sh', 'scripts/install-gateway-console.sh',
  'scripts/install-gateway-backup.sh', 'scripts/probe-management-gateway.py',
  'scripts/gateway-install-plan.py', 'scripts/verify-gateway-component-package.py', 'scripts/execute-gateway-install.py'
].sort()
export const GATEWAY_BUILD_INPUTS = [
  'agent', 'server/src', 'server/package.json', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'LICENSE',
  'scripts/build-gateway-component-package.mjs', 'scripts/gateway-component-manifest.mjs',
  ...GATEWAY_COMPONENT_FILES.filter(path => path.startsWith('scripts/'))
]
const exec = promisify(execFile)
export async function verifyGatewayComponentSource(root) {
  // Include installers, dependency resolution and the builder itself. Unknown
  // runtime sources must not inherit the identity of an older clean commit.
  await exec('git', ['ls-files', '--error-unmatch', '--', ...GATEWAY_BUILD_INPUTS], { cwd: root })
  const status = await exec('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...GATEWAY_BUILD_INPUTS], { cwd: root })
  if (status.stdout) throw Error('gateway build sources must be committed and unchanged')
  const commit = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim()
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('invalid source identity')
  return commit
}
export const GATEWAY_PACKAGE_PREFIX = 'payincus/gateway-component-package/v1\n'
export function signGatewayComponentManifest(manifest, privateKey) {
  if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') throw Error('Ed25519 signing key required')
  const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(12)
  const keyId = 'key_' + createHash('sha256').update(publicKey).digest('hex')
  const payload = Buffer.from(JSON.stringify(manifest)).toString('base64')
  return JSON.stringify({ schemaVersion: 1, keyId, payload, signature: sign(null, Buffer.from(GATEWAY_PACKAGE_PREFIX + keyId + '\n' + payload), privateKey).toString('base64') })
}
