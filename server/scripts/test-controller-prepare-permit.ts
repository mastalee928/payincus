import assert from 'node:assert/strict'
import { createPublicKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { controllerSigningKeyId } from '../src/lib/controller-config.js'
import { signControllerPreparePermit, verifyControllerPreparePermit, type ControllerPreparePermit } from '../src/lib/controller-prepare-permit.js'

const keys = generateKeyPairSync('ed25519'), other = generateKeyPairSync('ed25519')
const publicKey = createPublicKey(keys.privateKey).export({ type: 'spki', format: 'der' }).subarray(12).toString('base64')
const now = Date.now(), witnessId = '77777777-7777-4777-8777-777777777777'
const binding = { platformId: '11111111-1111-4111-8111-111111111111', nodeId: '22222222-2222-4222-8222-222222222222',
  controllerId: '33333333-3333-4333-8333-333333333333', requestId: '44444444-4444-4444-8444-444444444444',
  epoch: '9007199254740993', sequence: '1', candidateSha256: 'a'.repeat(64), challenge: randomBytes(24).toString('base64url') }
const permit: ControllerPreparePermit = { schemaVersion: 1, purpose: 'host-fence-prepare', witnessId, ...binding, issuedAt: now, expiresAt: now + 60000 }
const encoded = signControllerPreparePermit(permit, keys.privateKey)
const context = { binding, witnessId, trustedWitnessKeys: { [controllerSigningKeyId(publicKey)]: publicKey }, now }
assert.deepEqual(verifyControllerPreparePermit(encoded, context), permit)
assert.throws(() => verifyControllerPreparePermit(encoded, { ...context, now: now + 60000 }))
assert.throws(() => verifyControllerPreparePermit(encoded, { ...context, witnessId: binding.nodeId }))
assert.throws(() => verifyControllerPreparePermit(signControllerPreparePermit(permit, other.privateKey), context))
const fixturePath = new URL('../../agent/internal/controllerconfig/testdata/permit-vectors.json', import.meta.url)
if (process.argv.includes('--write-fixtures')) {
  const cases: Array<{ name: string; encoded: string; accept: boolean; now?: number; witnessId?: string; binding?: typeof binding }> = [
    { name: 'valid witness prepare', encoded, accept: true }, { name: 'expired', encoded, accept: false, now: now + 60000 },
    { name: 'future', encoded, accept: false, now: now - 5001 }, { name: 'wrong witness', encoded, accept: false, witnessId: binding.nodeId },
    { name: 'untrusted signer', encoded: signControllerPreparePermit(permit, other.privateKey), accept: false },
    { name: 'outer whitespace', encoded: encoded + '\n', accept: false }, { name: 'oversize', encoded: ' '.repeat(4097), accept: false }
  ]
  for (const key of Object.keys(binding) as Array<keyof typeof binding>) cases.push({ name: 'wrong binding ' + key, encoded, accept: false, binding: { ...binding, [key]: 'changed' } })
  const signedRaw = (raw: string) => {
    const payload = Buffer.from(raw).toString('base64'), keyId = controllerSigningKeyId(publicKey)
    const signature = sign(null, Buffer.from('payincus/host-fence-prepare/v1\n' + keyId + '\n' + payload), keys.privateKey).toString('base64')
    return JSON.stringify({ schemaVersion: 1, keyId, payload, signature })
  }
  for (const changed of [{ purpose: 'activate' }, { expiresAt: now + 60001 }, { sequence: 1 }, { command: 'execute' }, { challenge: 'invalid' }]) {
    cases.push({ name: 'invalid signed permit ' + JSON.stringify(changed), encoded: signedRaw(JSON.stringify({ ...permit, ...changed })), accept: false })
  }
  cases.push({ name: 'duplicate signed key', encoded: signedRaw(JSON.stringify(permit).replace('{', '{"schemaVersion":1,')), accept: false })
  await writeFile(fixturePath, JSON.stringify({ publicKey, keyId: controllerSigningKeyId(publicKey), now, witnessId, binding, cases }, null, 2) + '\n')
}
const fixtures = JSON.parse(await readFile(fixturePath, 'utf8'))
for (const item of fixtures.cases) {
  const run = () => verifyControllerPreparePermit(item.encoded, { witnessId: item.witnessId || fixtures.witnessId, binding: item.binding || fixtures.binding,
    now: item.now || fixtures.now, trustedWitnessKeys: { [fixtures.keyId]: fixtures.publicKey } })
  if (item.accept) run(); else assert.throws(run, undefined, item.name)
}
console.log(`Host prepare permit passed: ${fixtures.cases.length} shared signature/identity/candidate/challenge/time cases`)
