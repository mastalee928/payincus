import assert from 'node:assert/strict'
import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { controllerSigningKeyId } from '../src/lib/controller-config.js'
import { signControllerWriteLease, verifyControllerWriteLease, type ControllerLeaseBinding, type ControllerWriteLease } from '../src/lib/controller-write-lease.js'
import { signControllerLeaseRequest } from '../src/lib/controller-lease-request.js'

const fixturePath = resolve(import.meta.dirname, '../../agent/internal/controllerconfig/testdata/lease-vectors.json')
if (process.argv.includes('--write-fixtures')) {
  const key = generateKeyPairSync('ed25519'), publicKey = createPublicKey(key.privateKey).export({ type: 'spki', format: 'der' }).subarray(12).toString('base64')
  const keyId = controllerSigningKeyId(publicKey), now = 1792684800000
  const binding: ControllerLeaseBinding = { witnessId: '77777777-7777-4777-8777-777777777777', platformId: '11111111-1111-4111-8111-111111111111',
    nodeId: '22222222-2222-4222-8222-222222222222', controllerId: '33333333-3333-4333-8333-333333333333', requestId: '44444444-4444-4444-8444-444444444444',
    epoch: '9007199254740993', sequence: '1', candidateSha256: 'a'.repeat(64), leaseId: '55555555-5555-4555-8555-555555555555',
    bootId: '88888888-8888-4888-8888-888888888888', gateId: '99999999-9999-4999-8999-999999999999', holderKeyId: keyId }
  const lease: ControllerWriteLease = { schemaVersion: 1, purpose: 'controller-write-lease', witnessId: binding.witnessId,
    platformId: binding.platformId, nodeId: binding.nodeId, controllerId: binding.controllerId, requestId: binding.requestId,
    epoch: binding.epoch, sequence: binding.sequence, candidateSha256: binding.candidateSha256, leaseId: binding.leaseId,
    leaseSequence: '1', bootId: binding.bootId, gateId: binding.gateId, holderKeyId: binding.holderKeyId, issuedAt: now,
    expiresAt: now + 30000, permissions: ['inspect', 'instance-power', 'management-channel'] }
  const cases: { name: string; encoded: string; accept: boolean; now?: number; binding?: ControllerLeaseBinding }[] = []
  const signedRaw = (raw: string) => {
    const payload = Buffer.from(raw).toString('base64')
    return JSON.stringify({ schemaVersion: 1, keyId, payload, signature: sign(null, Buffer.from('payincus/controller-write-lease/v1\n' + keyId + '\n' + payload), key.privateKey).toString('base64') })
  }
  const encoded = signControllerWriteLease(lease, key.privateKey)
  cases.push({ name: 'valid restricted lease', encoded, accept: true }, { name: 'last live millisecond', encoded, accept: true, now: now + 29999 },
    { name: 'expired exactly', encoded, accept: false, now: now + 30000 }, { name: 'future issue time receives no skew', encoded, accept: false, now: now - 1 },
    { name: 'int64 maximum renewal sequence', encoded: signedRaw(JSON.stringify({ ...lease, leaseSequence: '9223372036854775807' })), accept: true },
    { name: 'outer whitespace', encoded: encoded + '\n', accept: false },
    { name: 'duplicate payload key', encoded: signedRaw(JSON.stringify(lease).replace('{', '{"schemaVersion":1,')), accept: false },
    { name: 'payload whitespace', encoded: signedRaw(JSON.stringify(lease) + '\n'), accept: false })
  for (const [name, changed] of [
    ['wrong purpose', { purpose: 'controller-prepare' }], ['unknown command', { command: 'shell' }], ['too long TTL', { expiresAt: now + 30001 }],
    ['sequence as number', { leaseSequence: 1 }], ['sequence zero', { leaseSequence: '0' }], ['sequence leading zero', { leaseSequence: '01' }],
    ['sequence overflow', { leaseSequence: '9223372036854775808' }], ['permissions unknown', { permissions: ['shell'] }],
    ['permissions empty', { permissions: [] }], ['permissions duplicated', { permissions: ['inspect', 'inspect'] }],
    ['permissions unordered', { permissions: ['instance-power', 'inspect'] }], ['missing gate id', { gateId: undefined }],
    ['holder invalid', { holderKeyId: 'invalid' }]
  ] as const) cases.push({ name, encoded: signedRaw(JSON.stringify({ ...lease, ...changed })), accept: false })
  for (const field of ['witnessId', 'platformId', 'nodeId', 'controllerId', 'requestId', 'leaseId', 'bootId', 'gateId'] as const) {
    cases.push({ name: 'binding mismatch ' + field, encoded, accept: false, binding: { ...binding, [field]: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } })
  }
  for (const [field, value] of [['epoch', '9007199254740994'], ['sequence', '2'], ['candidateSha256', 'b'.repeat(64)], ['holderKeyId', 'key_' + 'b'.repeat(64)]] as const) {
    cases.push({ name: 'binding mismatch ' + field, encoded, accept: false, binding: { ...binding, [field]: value } })
  }
  const envelope = JSON.parse(encoded)
  cases.push({ name: 'tampered signature', encoded: JSON.stringify({ ...envelope, signature: Buffer.alloc(64).toString('base64') }), accept: false },
    { name: 'wrong domain separation', encoded: JSON.stringify({ ...envelope, signature: sign(null, Buffer.from('payincus/host-fence-prepare/v1\n' + keyId + '\n' + envelope.payload), key.privateKey).toString('base64') }), accept: false },
    { name: 'duplicate envelope key', encoded: encoded.replace('{', '{"schemaVersion":1,'), accept: false })
  const body = Buffer.from('{"instance":"test-instance","action":"stop"}')
  const proof = signControllerLeaseRequest(encoded, 'instance-power', body, now, Buffer.alloc(24, 7).toString('base64url'), key.privateKey)
  const requests = [{ name: 'valid holder proof', proof, accept: true },
    { name: 'tampered body digest', proof: { ...proof, bodySha256: 'b'.repeat(64) }, accept: false },
    { name: 'tampered lease digest', proof: { ...proof, leaseSha256: 'b'.repeat(64) }, accept: false },
    { name: 'tampered permission', proof: { ...proof, permission: 'inspect' }, accept: false },
    { name: 'bad holder signature', proof: { ...proof, signature: Buffer.alloc(64).toString('base64') }, accept: false },
    { name: 'stale holder proof', proof, now: now + 5001, accept: false },
    { name: 'future holder proof', proof, now: now - 5001, accept: false },
    { name: 'noncanonical timestamp', proof: { ...proof, timestamp: '0' + now }, accept: false },
    { name: 'short nonce', proof: { ...proof, nonce: 'short' }, accept: false }]
  await writeFile(fixturePath, JSON.stringify({ publicKey, keyId, binding, now, cases, requestBody: body.toString(), requestProof: proof, requests }, null, 2) + '\n')
}
const fixtures = JSON.parse(await readFile(fixturePath, 'utf8'))
for (const item of fixtures.cases) {
  const check = () => verifyControllerWriteLease(item.encoded, { binding: item.binding || fixtures.binding,
    witnessKeys: { [fixtures.keyId]: fixtures.publicKey }, now: item.now ?? fixtures.now })
  if (item.accept) check(); else assert.throws(check, undefined, item.name)
}
assert.throws(() => verifyControllerWriteLease(fixtures.cases[0].encoded, { binding: fixtures.binding, now: fixtures.now, witnessKeys: {} }))
const proof = fixtures.requestProof
const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(fixtures.publicKey, 'base64')]), type: 'spki', format: 'der' })
assert.equal(verify(null, Buffer.from('payincus/controller-lease-request/v1\n' + [proof.leaseSha256, proof.permission, proof.bodySha256, proof.timestamp, proof.nonce].join('\n')), key, Buffer.from(proof.signature, 'base64')), true)
console.log(`Controller write lease codec passed: ${fixtures.cases.length} shared Node/Go identity/time/scope/signature cases; no runtime issuance`)
