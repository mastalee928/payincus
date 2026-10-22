import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const script = await readFile(new URL('../../scripts/install-management-channels.sh', import.meta.url), 'utf8')
for (const invariant of ['--plan', '--install', 'Binary hash mismatch.', 'private_file(path)', 'ExecStartPre=']) {
  assert.ok(script.includes(invariant), 'missing installer boundary: ' + invariant)
}
assert.ok(script.indexOf('if [[ "$mode" == --plan ]]') < script.indexOf('"$binary" --apply "$config"'))
assert.ok(script.indexOf('Existing service is not owned') < script.indexOf('"$binary" --apply "$config"'))
assert.ok(script.includes('CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_RAW') && script.includes('MemoryMax=128M'))
assert.ok(script.includes('ReadWritePaths=$state') && script.includes('ProtectSystem=strict'))
assert.ok(script.includes('ExecStartPre=$target --restore $config') && script.includes('start_pre()'))
assert.ok(!/Requires=.*(?:incudal-backend|postgres|nginx)|PartOf=|BindsTo=/.test(script))
assert.ok(!script.includes('wg-quick down') && !script.includes('ip link del') && !script.includes('systemctl stop incudal-backend'))
assert.ok(script.includes('payincus-management-channels-v1'))
console.log('Management channels installer guards passed: explicit hash/config, owned service, startup restoration, sandbox and independent lifecycle')
const gateway = await readFile(new URL('../../scripts/install-management-gateway.sh', import.meta.url), 'utf8')
for (const invariant of ['--plan', '--install', 'os.O_NOFOLLOW', 'Gateway binary or digest invalid.', 'Unrelated existing gateway service.',
  'ExecStartPre=$target --restore $config', 'start_pre()', 'MemoryMax=128M', 'CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_RAW']) {
  assert.ok(gateway.includes(invariant), 'gateway installer missing boundary: ' + invariant)
}
assert.ok(gateway.indexOf('if [[ "$mode" == --plan ]]') < gateway.indexOf('"$binary" --apply "$config"'))
assert.ok(gateway.indexOf('Unrelated existing gateway service.') < gateway.indexOf('"$binary" --apply "$config"'))
assert.ok(!/Requires=.*(?:incudal-backend|postgres|nginx)|PartOf=|BindsTo=/.test(gateway))
console.log('Gateway transport installer guards passed: hash, protected configuration, owned service and independent restore lifecycle')
