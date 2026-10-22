import assert from 'node:assert/strict'
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  ControllerConfigError, controllerSigningKeyId, signControllerPrepareConfig, verifyControllerPrepareConfig,
  type ControllerPrepareConfig, type ControllerObservedState
} from '../src/lib/controller-config.js'
import { verifyControllerReadProof, type ControllerReadProof } from '../src/lib/controller-discovery-auth.js'

const fixturePath = resolve(import.meta.dirname, '../../agent/internal/controllerconfig/testdata/node-vectors.json')
interface TestCase { name: string; encoded: string; accept: boolean; previous?: ControllerObservedState; now?: number; platformId?: string; nodeId?: string; duplicate?: boolean }
interface Fixtures { publicKey: string; keyId: string; platformId: string; nodeId: string; now: number; cases: TestCase[] }

function createFixtures(): Fixtures {
  const keys = generateKeyPairSync('ed25519')
  const publicKey = createPublicKey(keys.privateKey).export({ format: 'der', type: 'spki' }).subarray(12).toString('base64')
  const keyId = controllerSigningKeyId(publicKey), now = 1792684800000
  const platformId = '11111111-1111-4111-8111-111111111111', nodeId = '22222222-2222-4222-8222-222222222222'
  const config: ControllerPrepareConfig = {
    schemaVersion: 1, purpose: 'controller-prepare', platformId, nodeId,
    controllerId: '33333333-3333-4333-8333-333333333333', requestId: '44444444-4444-4444-8444-444444444444',
    epoch: '9007199254740993', sequence: '1', issuedAt: now, expiresAt: now + 60000,
    panelBaseUrl: 'https://panel.example.com', gateway: { gatewayId: '55555555-5555-4555-8555-555555555555',
      endpointHost: 'gateway.example.com', endpointPort: 51820, publicKey: Buffer.alloc(32, 7).toString('base64'),
      nodeAddress: '10.253.240.2', controlAddress: '10.253.240.1' }
  }
  const encoded = signControllerPrepareConfig(config, keys.privateKey)
  const first = verifyControllerPrepareConfig(encoded, { platformId, nodeId, now, trustedKeys: { [keyId]: publicKey } })
  const cases: TestCase[] = []
  const add = (name: string, value: string, accept: boolean, extras: Partial<TestCase> = {}) => cases.push({ name, encoded: value, accept, ...extras })
  const signedRaw = (raw: string) => {
    const payload = Buffer.from(raw).toString('base64')
    const signature = sign(null, Buffer.from(`payincus/controller-prepare/v1\n${keyId}\n${payload}`), keys.privateKey).toString('base64')
    return JSON.stringify({ schemaVersion: 1, keyId, payload, signature })
  }
  const signed = (value: unknown) => signedRaw(JSON.stringify(value))
  add('valid candidate with counter beyond JS precision', encoded, true)
  add('same version same content is idempotent', encoded, true, { previous: first.observed, duplicate: true })
  add('counter remains exact at int64 maximum', signed({ ...config, epoch: '9223372036854775807' }), true, { previous: first.observed })
  add('new domain and UDP port are configuration', signed({ ...config, sequence: '2', panelBaseUrl: 'https://next.example.net:8443', gateway: { ...config.gateway, endpointHost: 'edge.example.net', endpointPort: 51900 } }), true, { previous: first.observed })
  add('new epoch can restart sequence', signed({ ...config, epoch: '9007199254740994' }), true, { previous: { ...first.observed, sequence: '99' } })
  const env = JSON.parse(encoded)
  add('tampered signature', JSON.stringify({ ...env, signature: Buffer.alloc(64).toString('base64') }), false)
  add('tampered payload', JSON.stringify({ ...env, payload: Buffer.from(JSON.stringify({ ...config, sequence: '2' })).toString('base64') }), false)
  add('wrong trust key identity', JSON.stringify({ ...env, keyId: 'key_' + 'f'.repeat(64) }), false)
  add('envelope unknown command', JSON.stringify({ ...env, command: 'execute' }), false)
  add('duplicate envelope key', encoded.replace('{', '{"schemaVersion":1,'), false)
  add('outer whitespace', encoded + '\n', false)
  add('oversized envelope', ' '.repeat(12289), false)
  add('noncanonical base64', JSON.stringify({ ...env, payload: env.payload + '\n' }), false)
  add('wrong platform', encoded, false, { platformId: config.controllerId })
  add('wrong node', encoded, false, { nodeId: config.controllerId })
  add('expired', encoded, false, { now: config.expiresAt })
  add('far future timestamp', encoded, false, { now: now - 30001 })
  add('old epoch', encoded, false, { previous: { ...first.observed, epoch: '9007199254740994' } })
  add('old sequence after disk state reload', encoded, false, { previous: { ...first.observed, sequence: '2' } })
  add('same version different content', signed({ ...config, panelBaseUrl: 'https://changed.example.net' }), false, { previous: first.observed })
  add('state belongs to another node', encoded, false, { previous: { ...first.observed, nodeId: config.controllerId } })
  add('state invalid hash', encoded, false, { previous: { ...first.observed, payloadSha256: 'bad' } })
  add('state invalid schema', encoded, false, { previous: { ...first.observed, schemaVersion: 2 as 1 } })
  for (const [name, value] of [
    ['wrong schema', { ...config, schemaVersion: 2 }], ['unknown operation', { ...config, purpose: 'activate' }],
    ['unknown field', { ...config, command: 'run' }], ['counter as number', { ...config, epoch: 2 }],
    ['counter overflow', { ...config, epoch: '9223372036854775808' }], ['counter leading zero', { ...config, epoch: '02' }],
    ['counter zero', { ...config, sequence: '0' }], ['unsafe timestamp', { ...config, issuedAt: Number.MAX_SAFE_INTEGER + 1 }],
    ['excessive TTL', { ...config, expiresAt: now + 900001 }], ['noncanonical timestamp', { ...config, issuedAt: String(now) }],
    ['uppercase identity', { ...config, platformId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }]
  ] as const) add(name, signed(value), false)
  for (const value of ['http://panel.example.com', 'https://user:pass@panel.example.com', 'https://panel.example.com/path',
    'https://panel.example.com/', 'https://panel.example.com:443', 'https://panel.example.com?x=1', 'https://PANEL.example.com',
    'https://127.0.0.1', 'https://10.0.0.1', 'https://localhost', 'https://panel.example.com#x', 'https://[::1]', 'https://panel.example.com:']) {
    add('invalid panel URL ' + value, signed({ ...config, panelBaseUrl: value }), false)
  }
  for (const value of ['127.0.0.1', '10.0.0.1', '100.64.0.1', '169.254.169.254', '192.168.1.1', 'localhost',
    'gateway.local', '999.0.0.1', 'https://gateway.example.com', 'gateway.example.com:51820', '-gateway.example.com', '[::1]', '::ffff:8.8.8.8']) {
    add('invalid gateway host ' + value, signed({ ...config, gateway: { ...config.gateway, endpointHost: value } }), false)
  }
  for (const [name, value] of [
    ['port zero', { ...config.gateway, endpointPort: 0 }], ['port overflow', { ...config.gateway, endpointPort: 65536 }],
    ['port as string', { ...config.gateway, endpointPort: '51820' }], ['null port', { ...config.gateway, endpointPort: null }],
    ['gateway missing field', { ...config.gateway, gatewayId: undefined }], ['gateway arbitrary command', { ...config.gateway, script: 'run' }],
    ['invalid public key', { ...config.gateway, publicKey: Buffer.alloc(32).toString('base64') }],
    ['public management IP', { ...config.gateway, nodeAddress: '8.8.8.8' }], ['Incus reserved subnet', { ...config.gateway, nodeAddress: '10.10.0.2' }],
    ['duplicate management IP', { ...config.gateway, nodeAddress: config.gateway.controlAddress }]
  ] as const) add(name, signed({ ...config, gateway: value }), false)
  const raw = JSON.stringify(config)
  add('duplicate signed payload key', signedRaw(raw.replace('{', '{"schemaVersion":1,')), false)
  add('alternate JSON numeric spelling', signedRaw(raw.replace('"schemaVersion":1', '"schemaVersion":1.0')), false)
  add('signed payload whitespace', signedRaw(raw + '\n'), false)
  return { publicKey, keyId, platformId, nodeId, now, cases }
}

if (process.argv.includes('--write-fixtures')) await writeFile(fixturePath, JSON.stringify(createFixtures(), null, 2) + '\n')
const fixtures = JSON.parse(await readFile(fixturePath, 'utf8')) as Fixtures
assert.equal(controllerSigningKeyId(fixtures.publicKey), fixtures.keyId)
const freshKeys = generateKeyPairSync('ed25519')
const freshPublic = createPublicKey(freshKeys.privateKey).export({ format: 'der', type: 'spki' }).subarray(12).toString('base64')
const validConfig = JSON.parse(Buffer.from(JSON.parse(fixtures.cases[0].encoded).payload, 'base64').toString()) as ControllerPrepareConfig
const freshSigned = signControllerPrepareConfig(validConfig, freshKeys.privateKey)
assert.equal(verifyControllerPrepareConfig(freshSigned, { platformId: fixtures.platformId, nodeId: fixtures.nodeId,
  now: fixtures.now, trustedKeys: { [controllerSigningKeyId(freshPublic)]: freshPublic } }).canWrite, false)
assert.throws(() => signControllerPrepareConfig(validConfig, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey), /CONTROLLER_CONFIG_KEY_INVALID/)
for (const item of fixtures.cases) {
  const context = { trustedKeys: { [fixtures.keyId]: fixtures.publicKey }, platformId: item.platformId || fixtures.platformId,
    nodeId: item.nodeId || fixtures.nodeId, now: item.now || fixtures.now, previous: item.previous }
  if (item.accept) {
    const result = verifyControllerPrepareConfig(item.encoded, context)
    assert.equal(result.canWrite, false, `${item.name} must never authorize a writer`)
    assert.equal(result.duplicate, item.duplicate || false, item.name)
    assert.equal(result.observed.payloadSha256, createHash('sha256').update(Buffer.from(JSON.parse(item.encoded).payload, 'base64')).digest('hex'))
  } else {
    assert.throws(() => verifyControllerPrepareConfig(item.encoded, context), ControllerConfigError, item.name)
  }
}
console.log(`Controller candidate configuration guards passed: ${fixtures.cases.length} shared Node/Go cases; no write authority`)

const nodeKeys = generateKeyPairSync('ed25519'), authority = 'discovery.example.com:8443'
const nodePublicKey = createPublicKey(nodeKeys.privateKey).export({ format: 'der', type: 'spki' }).subarray(12).toString('base64')
const readProof: ControllerReadProof = { platformId: fixtures.platformId, nodeId: fixtures.nodeId,
  timestamp: String(fixtures.now), nonce: randomBytes(24).toString('base64url'), signature: '' }
const signProof = (proof: ControllerReadProof, host = authority) => ({ ...proof, signature: sign(null,
  Buffer.from('payincus/controller-config-read/v1\n' + ['GET', host, '/v1/controller-config', proof.platformId, proof.nodeId, proof.timestamp, proof.nonce].join('\n')), nodeKeys.privateKey).toString('base64') })
const signedProof = signProof(readProof), claimed = new Set<string>()
const readTrust = { platformId: fixtures.platformId, nodeId: fixtures.nodeId, authority, now: fixtures.now, nodePublicKey,
  claimNonce: async (claim: { nonce: string }) => { if (claimed.has(claim.nonce)) return false; claimed.add(claim.nonce); return true } }
await verifyControllerReadProof(signedProof, readTrust)
await assert.rejects(verifyControllerReadProof(signedProof, readTrust), /CONTROLLER_DISCOVERY_NONCE_REPLAY/)
assert.equal(claimed.size, 1)
for (const proof of [
  { ...signedProof, nodeId: '33333333-3333-4333-8333-333333333333' },
  { ...signedProof, platformId: '33333333-3333-4333-8333-333333333333' },
  { ...signedProof, timestamp: String(fixtures.now - 30001) }, { ...signedProof, timestamp: '0' + fixtures.now },
  { ...signedProof, nonce: 'short' }, { ...signedProof, signature: Buffer.alloc(64).toString('base64') },
  signProof(readProof, 'other.example.com'), { ...signedProof, nonce: signedProof.nonce + '\n' },
  { ...signedProof, unexpected: 'data' }
]) {
  await assert.rejects(verifyControllerReadProof(proof, readTrust), ControllerConfigError)
  assert.equal(claimed.size, 1, 'invalid proof must not reserve a nonce')
}
await assert.rejects(verifyControllerReadProof(signedProof, { ...readTrust, claimNonce: async () => { throw new Error('storage unavailable') } }), /storage unavailable/)
await assert.rejects(verifyControllerReadProof(signedProof, { ...readTrust, claimNonce: undefined as unknown as typeof readTrust.claimNonce }), /CONTROLLER_DISCOVERY_NONCE_STORAGE_REQUIRED/)
console.log('Controller discovery read proof guards passed: node/origin binding, nonce replay and storage failure')
await import('./test-controller-discovery-service.js')
await import('./test-controller-candidate-store.js')
await import('./test-controller-quiescence.js')
await import('./test-controller-fence-receipt.js')
await import('./test-controller-witness.js')
await import('./test-controller-prepare-permit.js')
await import('./test-controller-write-lease.js')
await import('./test-controller-gate-proof.js')
await import('./test-controller-witness-service.js')
await import('./test-controller-channels.js')
await import('./test-management-channels-installer.js')
await import('./test-gateway-transport.js')
await import('./test-gateway-auth.js')
await import('./test-gateway-console.js')
await import('./test-gateway-backup.js')
