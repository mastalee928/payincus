import assert from 'node:assert/strict'
import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto'
import { signControllerGateProof, verifyControllerGateProof, type ControllerGateProof } from '../src/lib/controller-gate-proof.js'
import { controllerSigningKeyId } from '../src/lib/controller-config.js'

const node = generateKeyPairSync('ed25519'), attacker = generateKeyPairSync('ed25519'), now = Date.now()
const publicKey = createPublicKey(node.privateKey).export({ type: 'spki', format: 'der' }).subarray(12).toString('base64')
const binding = { platformId: '11111111-1111-4111-8111-111111111111', nodeId: '22222222-2222-4222-8222-222222222222',
  controllerId: '33333333-3333-4333-8333-333333333333', requestId: '44444444-4444-4444-8444-444444444444', epoch: '2', sequence: '1',
  candidateSha256: 'a'.repeat(64), bootId: '55555555-5555-4555-8555-555555555555', gateId: '66666666-6666-4666-8666-666666666666', holderKeyId: controllerSigningKeyId(publicKey) }
const receipt = 'exact-host-fence-receipt'
const proof: ControllerGateProof = { schemaVersion: 1, purpose: 'controller-gate-proof', ...binding,
  receiptSha256: createHash('sha256').update(receipt).digest('hex'), issuedAt: now, expiresAt: now + 30000 }
const encoded = signControllerGateProof(proof, node.privateKey)
assert.deepEqual(verifyControllerGateProof(encoded, binding, receipt, publicKey, now), proof)
for (const field of Object.keys(binding) as (keyof typeof binding)[]) {
  assert.throws(() => verifyControllerGateProof(encoded, { ...binding, [field]: 'changed' }, receipt, publicKey, now))
}
assert.throws(() => verifyControllerGateProof(encoded, binding, receipt + 'changed', publicKey, now))
assert.throws(() => verifyControllerGateProof(encoded, binding, receipt, publicKey, now - 1))
assert.throws(() => verifyControllerGateProof(encoded, binding, receipt, publicKey, now + 30000))
assert.throws(() => verifyControllerGateProof(signControllerGateProof(proof, attacker.privateKey), binding, receipt, publicKey, now))
assert.throws(() => verifyControllerGateProof(encoded + '\n', binding, receipt, publicKey, now))
assert.throws(() => signControllerGateProof({ ...proof, command: 'run' } as ControllerGateProof, node.privateKey))
assert.throws(() => signControllerGateProof({ ...proof, expiresAt: now + 30001 }, node.privateKey))
console.log('Controller gate proof passed: node/receipt/boot/gate/holder binding, strict time and signature; no physical attestation generated')
