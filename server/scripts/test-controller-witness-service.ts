import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { X509Certificate } from 'node:crypto'
import { promisify } from 'node:util'
import { controllerSigningKeyId, signControllerPrepareConfig, type ControllerPrepareConfig } from '../src/lib/controller-config.js'
import { signControllerFenceReceipt } from '../src/lib/controller-fence-receipt.js'
import { signControllerGateProof } from '../src/lib/controller-gate-proof.js'
import { verifyControllerPreparePermit } from '../src/lib/controller-prepare-permit.js'
import { verifyControllerWriteLease } from '../src/lib/controller-write-lease.js'
import { createControllerWitnessServer, initializeControllerWitness, openControllerWitnessService, witnessCertificateID } from '../src/services/controller-witness-service.js'

const directory = await mkdtemp(join(tmpdir(), 'payincus-witness-service-'))
const state = join(directory, 'authority')
const exec = promisify(execFile)
const openssl = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl'
const authority = 'witness.example.test:8443'
const root = generateKeyPairSync('ed25519'), witness = generateKeyPairSync('ed25519'), node = generateKeyPairSync('ed25519'), holder = generateKeyPairSync('ed25519')
const pub = (key: typeof root.privateKey) => createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(12).toString('base64')
const platformId = '11111111-1111-4111-8111-111111111111', nodeId = '22222222-2222-4222-8222-222222222222'
const controllerId = '33333333-3333-4333-8333-333333333333', witnessId = '77777777-7777-4777-8777-777777777777'
const candidateKeys = { [controllerSigningKeyId(pub(root.privateKey))]: pub(root.privateKey) }
const witnessKeys = { [controllerSigningKeyId(pub(witness.privateKey))]: pub(witness.privateKey) }
const enrolled = { platformId, witnessId, candidateKeys, nodes: { [nodeId]: pub(node.privateKey) } }
const now = Date.now()
const config: ControllerPrepareConfig = { schemaVersion: 1, purpose: 'controller-prepare', platformId, nodeId, controllerId,
  requestId: '44444444-4444-4444-8444-444444444444', epoch: '2', sequence: '1', issuedAt: now, expiresAt: now + 600000,
  panelBaseUrl: 'https://panel.example.com', gateway: { gatewayId: '55555555-5555-4555-8555-555555555555', endpointHost: 'gateway.example.com',
    endpointPort: 51820, publicKey: Buffer.alloc(32, 7).toString('base64'), nodeAddress: '10.253.240.2', controlAddress: '10.253.240.1' } }
const signCandidate = (changes: Partial<ControllerPrepareConfig> = {}) => signControllerPrepareConfig({ ...config, ...changes }, root.privateKey)
let server: ReturnType<typeof createControllerWitnessServer> | undefined
let checks = 0
try {
  await chmod(directory, 0o700)
  await assert.rejects(openControllerWitnessService(state, enrolled, witness.privateKey)); checks++
  await initializeControllerWitness(state, enrolled, witness.privateKey, { [nodeId]: signCandidate() })
  await assert.rejects(initializeControllerWitness(state, enrolled, witness.privateKey, { [nodeId]: signCandidate() })); checks++
  await assert.rejects(openControllerWitnessService(state, enrolled, root.privateKey)); checks++
  await assert.rejects(openControllerWitnessService(state, { ...enrolled, nodes: { [nodeId]: pub(holder.privateKey) } }, witness.privateKey)); checks++
  const service = await openControllerWitnessService(state, enrolled, witness.privateKey)
  await exec(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, 'ca.key'), '-out', join(directory, 'ca.crt'),
    '-days', '1', '-subj', '/CN=witness-service-test-ca'])
  for (const name of ['server', 'client', 'foreign']) {
    await exec(openssl, ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, name + '.key'), '-out', join(directory, name + '.csr'), '-subj', '/CN=localhost'])
    await writeFile(join(directory, name + '.ext'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=' + (name === 'server' ? 'serverAuth' : 'clientAuth'))
    await exec(openssl, ['x509', '-req', '-in', join(directory, name + '.csr'), '-CA', join(directory, 'ca.crt'), '-CAkey', join(directory, 'ca.key'),
      '-CAcreateserial', '-out', join(directory, name + '.crt'), '-days', '1', '-extfile', join(directory, name + '.ext')])
  }
  const ca = await readFile(join(directory, 'ca.crt')), key = await readFile(join(directory, 'server.key')), cert = await readFile(join(directory, 'server.crt'))
  const clientKey = await readFile(join(directory, 'client.key')), clientCert = await readFile(join(directory, 'client.crt'))
  const clientID = witnessCertificateID(new X509Certificate(clientCert).raw), holderKeyId = controllerSigningKeyId(pub(holder.privateKey))
  const clients = { [clientID]: { controllerId, holderKeyId, nodeIds: [nodeId] } }
  assert.throws(() => createControllerWitnessServer({ key, cert, ca }, service, clients, authority)); checks++
  const start = async () => {
    server = createControllerWitnessServer({ key, cert, ca, requestCert: true, rejectUnauthorized: true }, service, clients, authority)
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', resolve) })
  }
  await start()
  const foreignKey = await readFile(join(directory, 'foreign.key')), foreignCert = await readFile(join(directory, 'foreign.crt'))
  const send = async (data: unknown, path = '/v1/witness/status', raw?: string, client: boolean | 'foreign' = true, host = authority) => {
    const address = server!.address(); assert.ok(address && typeof address !== 'string')
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const r = request({ hostname: '127.0.0.1', port: address.port, path, method: 'POST', ca, servername: 'localhost', agent: false,
        ...(client ? { key: client === 'foreign' ? foreignKey : clientKey, cert: client === 'foreign' ? foreignCert : clientCert } : {}), headers: { Host: host, 'Content-Type': 'application/json' } }, response => {
        let body = ''; response.on('data', data => { body += data }); response.on('end', () => resolve({ status: response.statusCode!, body }))
      })
      r.setTimeout(3000, () => r.destroy(new Error('timeout'))); r.once('error', reject); r.end(raw ?? JSON.stringify(data))
    })
  }
  assert.equal((await send({ nodeId })).status, 200); checks++
  await assert.rejects(send({ nodeId }, undefined, undefined, false)); checks++
  assert.equal((await send({ nodeId }, undefined, undefined, 'foreign')).status, 401); checks++
  for (const path of ['/v1/witness/status?', '/v1/witness/%73tatus', '/v1/shell']) { assert.equal((await send({ nodeId }, path)).status, 404); checks++ }
  assert.equal((await send({ nodeId }, undefined, undefined, true, 'other.example.test')).status, 400); checks++
  for (const raw of ['{"nodeId":"' + nodeId + '","nodeId":"' + nodeId + '"}', JSON.stringify({ nodeId }) + '\n', JSON.stringify({ nodeId, command: 'run' }), JSON.stringify({ nodeId: controllerId })]) {
    assert.equal((await send(null, undefined, raw)).status, 409); checks++
  }
  assert.equal((await send({ nodeId, candidate: signCandidate({ epoch: '3', controllerId: witnessId }) }, '/v1/witness/prepare')).status, 409); checks++
  const prepared = await send({ nodeId, candidate: signCandidate({ epoch: '3' }) }, '/v1/witness/prepare')
  assert.equal(prepared.status, 200)
  const permit = JSON.parse(prepared.body).preparePermit as string
  const binding = (await service.nodes.get(nodeId)!.status()).state
  verifyControllerPreparePermit(permit, { witnessId, binding: { platformId, nodeId, controllerId, requestId: binding.requestId,
    epoch: binding.epoch, sequence: binding.sequence, candidateSha256: binding.candidateSha256, challenge: binding.challenge },
    trustedWitnessKeys: witnessKeys, now: Date.now() }); checks++
  assert.equal((await send({ nodeId, receipt: 'invalid' }, '/v1/witness/activate')).status, 409); checks++
  const time = Date.now(), bootId = '88888888-8888-4888-8888-888888888888', gateId = '99999999-9999-4999-8999-999999999999'
  const fenceBinding = { platformId, nodeId, controllerId, requestId: binding.requestId, epoch: binding.epoch, sequence: binding.sequence,
    candidateSha256: binding.candidateSha256, challenge: binding.challenge }
  const receipt = signControllerFenceReceipt({ schemaVersion: 1, purpose: 'host-fence-receipt', ...fenceBinding, bootId,
    issuedAt: time, expiresAt: time + 30000, oldConnectionsBlocked: true, legacyCredentialsBlocked: true,
    outstandingSshProcesses: 0, outstandingLocalJobs: 0, activeIncusOperations: 0 }, node.privateKey)
  const activated = await send({ nodeId, receipt }, '/v1/witness/activate')
  assert.equal(activated.status, 200); checks++
  const gateBinding = { platformId, nodeId, controllerId, requestId: binding.requestId, epoch: binding.epoch, sequence: binding.sequence,
    candidateSha256: binding.candidateSha256, bootId, gateId, holderKeyId }
  const gateProof = signControllerGateProof({ schemaVersion: 1, purpose: 'controller-gate-proof', ...gateBinding,
    receiptSha256: createHash('sha256').update(receipt).digest('hex'), issuedAt: time, expiresAt: time + 30000 }, node.privateKey)
  const leaseRequest = { nodeId, receipt, gateProof, gateId, holderKeyId, permissions: ['inspect'] }
  const issued = await send(leaseRequest, '/v1/witness/lease'); assert.equal(issued.status, 200)
  const leaseBinding = { witnessId, ...gateBinding, leaseId: JSON.parse(activated.body).leaseId as string }
  assert.equal(verifyControllerWriteLease(JSON.parse(issued.body).lease, { binding: leaseBinding, witnessKeys, now: Date.now() }).leaseSequence, '1'); checks++
  assert.equal((await send({ ...leaseRequest, holderKeyId: controllerSigningKeyId(pub(node.privateKey)) }, '/v1/witness/lease')).status, 409); checks++
  assert.equal((await send({ ...leaseRequest, permissions: ['inspect', 'instance-power'] }, '/v1/witness/lease')).status, 409); checks++
  const renewed = await send(leaseRequest, '/v1/witness/lease')
  assert.equal(verifyControllerWriteLease(JSON.parse(renewed.body).lease, { binding: leaseBinding, witnessKeys, now: Date.now() }).leaseSequence, '2'); checks++
  // Two compound operations cannot interleave status/authorization/issuance.
  const currentWitness = service.nodes.get(nodeId)!
  const previousStatus = currentWitness.status
  let unlock!: () => void, entered!: () => void
  const released = new Promise<void>(resolve => { unlock = resolve })
  const started = new Promise<void>(resolve => { entered = resolve })
  currentWitness.status = async () => { entered(); await released; return previousStatus() }
  const firstRequest = send({ nodeId })
  await started
  assert.equal((await send({ nodeId })).status, 409)
  unlock(); assert.equal((await firstRequest).status, 200)
  currentWitness.status = previousStatus; checks++
  const saved = await readFile(join(state, 'nodes', nodeId, 'witness.json'))
  await rm(join(state, 'nodes', nodeId, 'witness.json'))
  await assert.rejects(openControllerWitnessService(state, enrolled, witness.privateKey)); checks++
  await writeFile(join(state, 'nodes', nodeId, 'witness.json'), saved, { mode: 0o600 })
  console.log(`Independent witness service passed: ${checks} initialization, mTLS, identity/coverage, signing and persisted authority checks; receipt fixtures are not physical fencing evidence`)
} finally {
  if (server) await new Promise<void>(resolve => { server!.close(() => resolve()); server!.closeAllConnections() })
  await rm(directory, { recursive: true, force: true })
}
