import assert from 'node:assert/strict'
import { createHash, createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { controllerSigningKeyId, signControllerPrepareConfig, verifyControllerPrepareConfig, type ControllerPrepareConfig } from '../src/lib/controller-config.js'
import { signControllerFenceReceipt, type ControllerFenceReceipt } from '../src/lib/controller-fence-receipt.js'
import { createControllerWitness, type ControllerWitnessState } from '../src/services/controller-witness.js'
import { acquireDiscoveryMutationLock } from '../src/services/controller-discovery.js'
import { verifyControllerPreparePermit } from '../src/lib/controller-prepare-permit.js'
import { signControllerGateProof } from '../src/lib/controller-gate-proof.js'
import { verifyControllerWriteLease } from '../src/lib/controller-write-lease.js'

const directory = await mkdtemp(join(tmpdir(), 'payincus-witness-'))
const root = generateKeyPairSync('ed25519'), node = generateKeyPairSync('ed25519'), attacker = generateKeyPairSync('ed25519')
const rawKey = (key: typeof root.privateKey) => createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(12).toString('base64')
const candidateKeys = { [controllerSigningKeyId(rawKey(root.privateKey))]: rawKey(root.privateKey) }, nodePublicKey = rawKey(node.privateKey)
const identity = { platformId: '11111111-1111-4111-8111-111111111111', nodeId: '22222222-2222-4222-8222-222222222222' }
const now = Date.now()
const config: ControllerPrepareConfig = { schemaVersion: 1, purpose: 'controller-prepare', ...identity,
  controllerId: '33333333-3333-4333-8333-333333333333', requestId: '44444444-4444-4444-8444-444444444444',
  epoch: '9007199254740993', sequence: '1', issuedAt: now, expiresAt: now + 60000, panelBaseUrl: 'https://panel.example.com',
  gateway: { gatewayId: '55555555-5555-4555-8555-555555555555', endpointHost: 'gateway.example.com', endpointPort: 51820,
    publicKey: Buffer.alloc(32, 7).toString('base64'), nodeAddress: '10.253.240.2', controlAddress: '10.253.240.1' } }
const candidate = (changes: Partial<ControllerPrepareConfig> = {}) => signControllerPrepareConfig({ ...config, ...changes }, root.privateKey)
const observed = verifyControllerPrepareConfig(candidate(), { ...identity, now, trustedKeys: candidateKeys }).observed
const initial: ControllerWitnessState = { schemaVersion: 1, ...identity, epoch: config.epoch, sequence: config.sequence,
  candidateSha256: observed.payloadSha256, controllerId: config.controllerId, requestId: config.requestId,
  challenge: randomBytes(24).toString('base64url'), phase: 'preparing', preparedAt: now, expiresAt: config.expiresAt,
  lastObservedAt: now, leaseId: null, receiptSha256: null, bootId: null }
const witnessId = '88888888-8888-4888-8888-888888888888'
const statePath = join(directory, 'witness.json'), trust = { candidateKeys, nodePublicKey, writeAuthority: { witnessId, signingKey: root.privateKey } }
let checks = 0
try {
  await chmod(directory, 0o700)
  await assert.rejects(createControllerWitness(directory, identity, trust)); checks++
  await writeFile(statePath, JSON.stringify(initial), { mode: 0o600 })
  await assert.rejects(createControllerWitness(directory, identity, { ...trust, nodePublicKey: Buffer.alloc(32).toString('base64') })); checks++
  const first = await createControllerWitness(directory, identity, trust), second = await createControllerWitness(directory, identity, trust)
  assert.equal((await first.status()).signedWriteLeaseAvailable, false); checks++
  const prepared = await first.prepare(candidate())
  assert.equal(prepared.challenge, initial.challenge); checks++
  await assert.rejects(first.prepare(candidate({ sequence: '2' })), /WITNESS_INVALID/); checks++
  const concurrent = await Promise.allSettled([
    first.prepare(candidate({ epoch: '9007199254740994' })),
    second.prepare(candidate({ epoch: '9007199254740994', controllerId: '66666666-6666-4666-8666-666666666666' }))
  ])
  assert.equal(concurrent.filter(item => item.status === 'fulfilled').length, 1); checks++
  const binding = await second.prepare(candidate({ epoch: '9007199254740994' }))
  const permit = await second.preparePermit()
  assert.equal(verifyControllerPreparePermit(permit, { binding, witnessId, trustedWitnessKeys: candidateKeys, now: Date.now() }).epoch, binding.epoch); checks++
  const receiptTime = Date.now()
  const receipt: ControllerFenceReceipt = { schemaVersion: 1, purpose: 'host-fence-receipt', ...binding,
    bootId: '77777777-7777-4777-8777-777777777777', issuedAt: receiptTime, expiresAt: receiptTime + 30000,
    oldConnectionsBlocked: true, legacyCredentialsBlocked: true, outstandingSshProcesses: 0, outstandingLocalJobs: 0, activeIncusOperations: 0 }
  const before = await readFile(statePath)
  for (const encoded of [signControllerFenceReceipt(receipt, attacker.privateKey),
    signControllerFenceReceipt({ ...receipt, challenge: initial.challenge }, node.privateKey),
    signControllerFenceReceipt({ ...receipt, epoch: initial.epoch }, node.privateKey),
    signControllerFenceReceipt({ ...receipt, issuedAt: now - 10000, expiresAt: now - 1 }, node.privateKey)]) {
    await assert.rejects(first.activate(encoded)); assert.deepEqual(await readFile(statePath), before); checks++
  }
  const signedReceipt = signControllerFenceReceipt(receipt, node.privateKey)
  const leases = await Promise.all([first.activate(signedReceipt), second.activate(signedReceipt)])
  assert.equal(leases[0].leaseId, leases[1].leaseId); assert.equal(leases[0].signedWriteLeaseAvailable, false); checks++
  await assert.rejects(second.preparePermit(), /WITNESS_INVALID/); checks++
  const restoredProcess = await createControllerWitness(directory, identity, trust)
  await assert.rejects(restoredProcess.prepare(candidate()), /ROLLBACK/); checks++
  assert.equal((await restoredProcess.status()).state.bootId, receipt.bootId); checks++
  await assert.rejects(restoredProcess.activate(signControllerFenceReceipt({ ...receipt, bootId: config.gateway.gatewayId }, node.privateKey))); checks++
  const gateId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', holderKeyId = controllerSigningKeyId(rawKey(attacker.privateKey))
  const gateTime = Date.now()
  const gateBinding = { platformId: binding.platformId, nodeId: binding.nodeId, controllerId: binding.controllerId,
    requestId: binding.requestId, epoch: binding.epoch, sequence: binding.sequence, candidateSha256: binding.candidateSha256,
    bootId: receipt.bootId, gateId, holderKeyId }
  const gateProof = signControllerGateProof({ schemaVersion: 1, purpose: 'controller-gate-proof', ...gateBinding,
    receiptSha256: createHash('sha256').update(signedReceipt).digest('hex'), issuedAt: gateTime, expiresAt: gateTime + 30000 }, node.privateKey)
  const writeOptions = { gateId, holderKeyId, permissions: ['inspect', 'instance-power'] as ('inspect' | 'instance-power')[] }
  const lease1 = await first.issueWriteLease(signedReceipt, gateProof, writeOptions)
  const leaseBinding = { witnessId, ...gateBinding, leaseId: leases[0].leaseId }
  assert.equal(verifyControllerWriteLease(lease1, { binding: leaseBinding, witnessKeys: candidateKeys, now: Date.now() }).leaseSequence, '1'); checks++
  const lease2 = await restoredProcess.issueWriteLease(signedReceipt, gateProof, writeOptions)
  assert.equal(verifyControllerWriteLease(lease2, { binding: leaseBinding, witnessKeys: candidateKeys, now: Date.now() }).leaseSequence, '2'); checks++
  const issuedState = await readFile(statePath)
  await assert.rejects(first.issueWriteLease(signedReceipt, gateProof, { ...writeOptions, gateId: config.gateway.gatewayId }))
  await assert.rejects(createControllerWitness(directory, identity, { ...trust, writeAuthority: { witnessId, signingKey: attacker.privateKey } }))
  await assert.rejects(first.issueWriteLease(signedReceipt, gateProof, { ...writeOptions, permissions: ['inspect', 'instance-power', 'management-channel'] }))
  assert.deepEqual(await readFile(statePath), issuedState); checks++
  const concurrentLeases = await Promise.all([first.issueWriteLease(signedReceipt, gateProof, writeOptions), second.issueWriteLease(signedReceipt, gateProof, writeOptions)])
  const sequences = concurrentLeases.map(encoded => verifyControllerWriteLease(encoded, { binding: leaseBinding, witnessKeys: candidateKeys, now: Date.now() }).leaseSequence).sort()
  assert.deepEqual(sequences, ['3', '4']); checks++
  // A new epoch invalidates the prior active receipt; its old challenge cannot
  // activate the replacement writer, even when the former receipt has live TTL.
  const newer = await first.prepare(candidate({ epoch: '9007199254740995' }))
  assert.notEqual(newer.challenge, binding.challenge)
  await assert.rejects(second.activate(signedReceipt)); checks++
  assert.equal((await second.status()).state.phase, 'preparing'); checks++
  await assert.rejects(second.issueWriteLease(signedReceipt, gateProof, writeOptions)); checks++
  const shiftedNow = Date.now()
  await first.prepare(candidate({ epoch: '9007199254740996', issuedAt: shiftedNow + 25000, expiresAt: shiftedNow + 925000 }))
  assert.ok((await second.status()).state.expiresAt - (await second.status()).state.preparedAt <= 900000); checks++
  const savedPreparing = (await second.status()).state
  await writeFile(statePath, JSON.stringify({ ...savedPreparing, expiresAt: Date.now() - 1, preparedAt: Date.now() - 60000 }), { mode: 0o600 })
  assert.equal((await second.status()).expired, true)
  await assert.rejects(second.prepare(candidate({ epoch: '9007199254740996', issuedAt: shiftedNow + 25000, expiresAt: shiftedNow + 925000 }))); checks++
  await writeFile(statePath, JSON.stringify(savedPreparing), { mode: 0o600 })
  // Small tolerated rollback must still use persisted logical time, so a
  // candidate that has crossed expiry cannot be resurrected.
  const wallNow = Date.now()
  await writeFile(statePath, JSON.stringify({ ...savedPreparing, preparedAt: wallNow - 60000,
    expiresAt: wallNow + 1000, lastObservedAt: wallNow + 2000 }), { mode: 0o600 })
  assert.equal((await second.status()).expired, true); checks++
  await writeFile(statePath, JSON.stringify(savedPreparing), { mode: 0o600 })
  await writeFile(statePath, JSON.stringify({ ...savedPreparing, lastObservedAt: Date.now() + 10000 }), { mode: 0o600 })
  await assert.rejects(second.status(), /WITNESS_INVALID/)
  await assert.rejects(second.prepare(candidate({ epoch: '9007199254740997' })), /WITNESS_INVALID/); checks++
  await writeFile(statePath, JSON.stringify(savedPreparing), { mode: 0o600 })
  if (process.platform === 'linux') {
    const release = await acquireDiscoveryMutationLock(directory)
    try { await assert.rejects(second.prepare(candidate({ epoch: '9007199254740997' })), /ALREADY_RUNNING/); checks++ }
    finally { await release() }
    await chmod(statePath, 0o644); await assert.rejects(second.status()); checks++
    await chmod(statePath, 0o600)
  }
  await writeFile(statePath, '{corrupt', { mode: 0o600 })
  await assert.rejects(first.prepare(candidate({ epoch: '9007199254740996' })))
  assert.equal(await readFile(statePath, 'utf8'), '{corrupt'); checks++
  await assert.rejects(createControllerWitness(directory, identity, trust)); checks++
  await rm(statePath); await assert.rejects(first.prepare(candidate({ epoch: '9007199254740996' }))); checks++
  assert.equal((await readFile(join(directory, 'mutation.lock')).catch(() => Buffer.alloc(0))).length, 0)
  console.log(`Controller witness passed: ${checks} atomic preparation/receipt/activation/restart boundary checks; internal lease issuance tested, public host writes unavailable`)
} finally { await rm(directory, { recursive: true, force: true }) }
