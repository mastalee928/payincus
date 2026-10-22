import assert from 'node:assert/strict'
import { createPublicKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { signControllerFenceReceipt, verifyControllerFenceReceipt, type ControllerFenceReceipt } from '../src/lib/controller-fence-receipt.js'

const node = generateKeyPairSync('ed25519'), other = generateKeyPairSync('ed25519')
const publicKey = createPublicKey(node.privateKey).export({ type: 'spki', format: 'der' }).subarray(12).toString('base64')
const now = Date.now()
const binding = { platformId: '11111111-1111-4111-8111-111111111111', nodeId: '22222222-2222-4222-8222-222222222222',
  controllerId: '33333333-3333-4333-8333-333333333333', requestId: '44444444-4444-4444-8444-444444444444',
  epoch: '9007199254740993', sequence: '1', candidateSha256: 'a'.repeat(64), challenge: randomBytes(24).toString('base64url') }
const receipt: ControllerFenceReceipt = { schemaVersion: 1, purpose: 'host-fence-receipt', ...binding,
  bootId: '55555555-5555-4555-8555-555555555555', issuedAt: now, expiresAt: now + 30000,
  oldConnectionsBlocked: true, legacyCredentialsBlocked: true, outstandingSshProcesses: 0, outstandingLocalJobs: 0, activeIncusOperations: 0 }
const encoded = signControllerFenceReceipt(receipt, node.privateKey)
if (process.argv.includes('--write-fixtures')) {
  const cases: Array<{ name: string; encoded: string; accept: boolean; now?: number; binding?: typeof binding }> = [
    { name: 'valid host receipt', encoded, accept: true },
    { name: 'expired receipt', encoded, accept: false, now: now + 30000 },
    { name: 'future receipt', encoded, accept: false, now: now - 5001 },
    { name: 'wrong host signature', encoded: signControllerFenceReceipt(receipt, other.privateKey), accept: false },
    { name: 'outer whitespace', encoded: encoded + '\n', accept: false }
  ]
  for (const key of Object.keys(binding) as Array<keyof typeof binding>) cases.push({ name: 'wrong binding ' + key,
    encoded, accept: false, binding: { ...binding, [key]: 'changed' } })
  const invalidRaw = (value: unknown) => {
    const payload = Buffer.from(JSON.stringify(value)).toString('base64')
    return JSON.stringify({ schemaVersion: 1, payload,
      signature: sign(null, Buffer.from('payincus/host-fence-receipt/v1\n' + payload), node.privateKey).toString('base64') })
  }
  for (const changed of [{ oldConnectionsBlocked: false }, { legacyCredentialsBlocked: false }, { outstandingSshProcesses: 1 },
    { outstandingLocalJobs: 1 }, { activeIncusOperations: 1 }, { expiresAt: now + 30001 }, { command: 'run' },
    { outstandingLocalJobs: null }, { sequence: 1 }, { bootId: 'unknown' }]) cases.push({ name: 'invalid signed receipt ' + JSON.stringify(changed), encoded: invalidRaw({ ...receipt, ...changed }), accept: false })
  const duplicate = JSON.stringify(receipt).replace('{', '{"schemaVersion":1,')
  const duplicateEncoded = Buffer.from(duplicate).toString('base64')
  cases.push({ name: 'duplicate signed payload key', encoded: JSON.stringify({ schemaVersion: 1, payload: duplicateEncoded,
    signature: sign(null, Buffer.from('payincus/host-fence-receipt/v1\n' + duplicateEncoded), node.privateKey).toString('base64') }), accept: false })
  cases.push({ name: 'tampered envelope signature', encoded: JSON.stringify({ ...JSON.parse(encoded), signature: Buffer.alloc(64).toString('base64') }), accept: false })
  cases.push({ name: 'oversized envelope', encoded: ' '.repeat(4097), accept: false })
  await writeFile(new URL('../../agent/internal/controllerconfig/testdata/fence-vectors.json', import.meta.url), JSON.stringify({ publicKey, now, binding, cases }, null, 2) + '\n')
}
assert.deepEqual(verifyControllerFenceReceipt(encoded, binding, publicKey, now), receipt)
for (const key of Object.keys(binding) as Array<keyof typeof binding>) {
  assert.throws(() => verifyControllerFenceReceipt(encoded, { ...binding, [key]: 'changed' }, publicKey, now))
}
for (const changes of [{ oldConnectionsBlocked: false }, { legacyCredentialsBlocked: false }, { outstandingSshProcesses: 1 },
  { outstandingLocalJobs: 1 }, { activeIncusOperations: 1 }, { expiresAt: now + 30001 }, { command: 'run' }]) {
  assert.throws(() => signControllerFenceReceipt({ ...receipt, ...changes } as ControllerFenceReceipt, node.privateKey))
}
assert.throws(() => verifyControllerFenceReceipt(signControllerFenceReceipt(receipt, other.privateKey), binding, publicKey, now))
assert.throws(() => verifyControllerFenceReceipt(encoded, binding, publicKey, now + 30000))
assert.throws(() => verifyControllerFenceReceipt(encoded, binding, publicKey, now - 5001))
assert.throws(() => verifyControllerFenceReceipt(encoded + '\n', binding, publicKey, now))
const rawEnvelope = JSON.parse(encoded)
assert.throws(() => verifyControllerFenceReceipt(JSON.stringify({ ...rawEnvelope, signature: Buffer.alloc(64).toString('base64') }), binding, publicKey, now))
const duplicatePayload = JSON.stringify(receipt).replace('{', '{"schemaVersion":1,')
const payload = Buffer.from(duplicatePayload).toString('base64')
const signature = sign(null, Buffer.from('payincus/host-fence-receipt/v1\n' + payload), node.privateKey).toString('base64')
assert.throws(() => verifyControllerFenceReceipt(JSON.stringify({ schemaVersion: 1, payload, signature }), binding, publicKey, now))
const fixture = JSON.parse(await readFile(new URL('../../agent/internal/controllerconfig/testdata/fence-vectors.json', import.meta.url), 'utf8'))
for (const item of fixture.cases) {
  const run = () => verifyControllerFenceReceipt(item.encoded, item.binding || fixture.binding, fixture.publicKey, item.now || fixture.now)
  if (item.accept) run(); else assert.throws(run, undefined, item.name)
}
console.log('Host fence receipt passed: host signature, challenge/candidate binding, time, quiescence and strict encoding')
