import assert from 'node:assert/strict'
import { createPublicKey, generateKeyPairSync } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { controllerSigningKeyId, signControllerPrepareConfig, type ControllerPrepareConfig } from '../src/lib/controller-config.js'
import { createControllerCandidateStore } from '../src/services/controller-candidate-store.js'
import { acquireDiscoveryMutationLock, createFileDiscoveryRepository } from '../src/services/controller-discovery.js'

const directory = await mkdtemp(join(tmpdir(), 'payincus-candidate-store-'))
const root = generateKeyPairSync('ed25519'), node = generateKeyPairSync('ed25519')
const publicRoot = createPublicKey(root.privateKey).export({ format: 'der', type: 'spki' }).subarray(12).toString('base64')
const publicNode = node.publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64')
const platformId = '11111111-1111-4111-8111-111111111111', nodeId = '22222222-2222-4222-8222-222222222222'
const trust = { [controllerSigningKeyId(publicRoot)]: publicRoot }, now = Date.now()
const config: ControllerPrepareConfig = { schemaVersion: 1, purpose: 'controller-prepare', platformId, nodeId,
  controllerId: '33333333-3333-4333-8333-333333333333', requestId: '44444444-4444-4444-8444-444444444444',
  epoch: '9007199254740993', sequence: '1', issuedAt: now, expiresAt: now + 60000, panelBaseUrl: 'https://panel.example.com',
  gateway: { gatewayId: '55555555-5555-4555-8555-555555555555', endpointHost: 'gateway.example.com', endpointPort: 51820,
    publicKey: Buffer.alloc(32, 7).toString('base64'), nodeAddress: '10.253.240.2', controlAddress: '10.253.240.1' } }
const signed = (changes: Partial<ControllerPrepareConfig> = {}) => signControllerPrepareConfig({ ...config, ...changes }, root.privateKey)
const record = { platformId, nodeId, enabled: true, publicKey: publicNode, candidate: signed() }
const nodePath = join(directory, 'nodes', nodeId + '.json')
let checks = 0
try {
  for (const path of [directory, join(directory, 'nodes'), join(directory, 'nonces')]) {
    await mkdir(path, { recursive: true, mode: 0o700 }); await chmod(path, 0o700)
  }
  const store = await createControllerCandidateStore(directory, trust)
  const second = await createControllerCandidateStore(directory, trust)
  const repository = await createFileDiscoveryRepository(directory)
  await assert.rejects(store.publish(nodeId, record.candidate), /REVOKED_OR_UNKNOWN/); checks++
  await assert.rejects(store.enroll({ ...record, enabled: false }), /IDENTITY_INVALID/); checks++
  await assert.rejects(store.enroll({ ...record, publicKey: Buffer.alloc(32).toString('base64') }), /IDENTITY_INVALID/); checks++
  assert.deepEqual(await store.enroll(record), { duplicate: false, canWrite: false })
  assert.deepEqual(await repository.node(nodeId), record); checks++
  assert.deepEqual(await second.enroll({ candidate: record.candidate, publicKey: publicNode, enabled: true, nodeId, platformId }), { duplicate: true, canWrite: false }); checks++
  if (process.platform === 'linux') {
    const release = await acquireDiscoveryMutationLock(directory)
    try { await assert.rejects(second.publish(nodeId, signed({ sequence: '2' })), /ALREADY_RUNNING/); checks++ }
    finally { await release() }
    assert.equal((await repository.node(nodeId))!.candidate, record.candidate)
  }
  const before = await readFile(nodePath)
  for (const candidate of [record.candidate + '\n', signed({ epoch: '2' }), signed({ panelBaseUrl: 'https://changed.example.com' }),
    signed({ nodeId: config.controllerId }), signed({ issuedAt: now - 10000, expiresAt: now - 1 })]) {
    await assert.rejects(store.publish(nodeId, candidate))
    assert.deepEqual(await readFile(nodePath), before); checks++
  }
  await assert.rejects(store.enroll({ ...record, publicKey: publicRoot }), /ENROLLMENT_CONFLICT/); checks++
  const parallel = await Promise.all([store.publish(nodeId, signed({ sequence: '2' })), second.publish(nodeId, signed({ sequence: '3' }))])
  assert.ok(parallel.every(item => !item.duplicate && !item.canWrite))
  assert.equal((await repository.node(nodeId))!.candidate, signed({ sequence: '3' })); checks++
  const reloaded = await createControllerCandidateStore(directory, trust)
  await assert.rejects(reloaded.publish(nodeId, signed({ sequence: '2' })), /ROLLBACK/); checks++
  // Simulate a legitimately signed stored candidate expiring before publication.
  // Its high watermark must survive expiry, while the new object needs live TTL.
  const expired = { ...record, candidate: signed({ sequence: '9', issuedAt: now - 10000, expiresAt: now - 1 }) }
  await writeFile(nodePath, JSON.stringify(expired), { mode: 0o600 })
  await assert.rejects(reloaded.publish(nodeId, signed({ sequence: '8' })), /ROLLBACK/); checks++
  assert.deepEqual(await reloaded.publish(nodeId, signed({ sequence: '10' })), { duplicate: false, canWrite: false }); checks++
  assert.deepEqual(await store.publish(nodeId, signed({ sequence: '10' })), { duplicate: true, canWrite: false }); checks++
  await reloaded.revoke(nodeId)
  assert.equal((await repository.node(nodeId))!.enabled, false)
  assert.deepEqual(await store.revoke(nodeId), { duplicate: true, canWrite: false }); checks++
  await assert.rejects(second.enroll(record), /ENROLLMENT_CONFLICT/)
  await assert.rejects(second.publish(nodeId, signed({ sequence: '11' })), /REVOKED_OR_UNKNOWN/); checks++
  const revoked = await readFile(nodePath)
  assert.equal(JSON.parse(revoked.toString()).candidate, signed({ sequence: '10' })); checks++
  await writeFile(nodePath, '{corrupt', { mode: 0o600 })
  await assert.rejects(store.publish(nodeId, signed({ sequence: '11' })))
  assert.equal(await readFile(nodePath, 'utf8'), '{corrupt'); checks++
  if (process.platform === 'linux') {
    await rm(nodePath); await symlink(join(directory, 'missing'), nodePath)
    await assert.rejects(store.enroll(record)); checks++
  }
  console.log(`Controller candidate store passed: ${checks} enrollment/publication/revocation boundary checks`)
} finally { await rm(directory, { recursive: true, force: true }) }
