import { constants } from 'node:fs'
import { mkdir, open } from 'node:fs/promises'
import { createHash, createPublicKey, randomBytes, type KeyObject } from 'node:crypto'
import { createServer, type ServerOptions } from 'node:https'
import type { TLSSocket } from 'node:tls'
import { dirname, join, resolve } from 'node:path'
import { ControllerConfigError, controllerSigningKeyId, verifyControllerPrepareConfig } from '../lib/controller-config.js'
import { acquireDiscoveryProcessLock, readDiscoveryPrivateFile, validateDiscoveryPrivateDirectory } from './controller-discovery.js'
import { createControllerWitness, type ControllerWitnessState } from './controller-witness.js'
import type { ControllerLeasePermission } from '../lib/controller-write-lease.js'

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
const HASH = /^[a-f0-9]{64}$/
export interface WitnessEnrollment {
  platformId: string; witnessId: string; candidateKeys: Readonly<Record<string, string>>
  nodes: Readonly<Record<string, string>>
}
export interface WitnessClient {
  controllerId: string; holderKeyId: string; nodeIds: readonly string[]
}
function require(condition: unknown): asserts condition {
  if (!condition) throw new ControllerConfigError('CONTROLLER_WITNESS_SERVICE_INVALID')
}
function publicKey(key: KeyObject): string {
  require(key.type === 'private' && key.asymmetricKeyType === 'ed25519')
  return createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(12).toString('base64')
}
function identity(enrollment: WitnessEnrollment, signingKey: KeyObject): string {
  require(enrollment && UUID.test(enrollment.platformId) && UUID.test(enrollment.witnessId))
  require(enrollment.nodes && Object.keys(enrollment.nodes).length > 0 && Object.keys(enrollment.nodes).length <= 256)
  require(enrollment.candidateKeys && Object.keys(enrollment.candidateKeys).length > 0 && Object.keys(enrollment.candidateKeys).length <= 8)
  const keys = Object.entries(enrollment.candidateKeys).sort(([a], [b]) => a.localeCompare(b))
  for (const [id, key] of keys) require(controllerSigningKeyId(key) === id)
  const nodes = Object.entries(enrollment.nodes).sort(([a], [b]) => a.localeCompare(b))
  for (const [id, key] of nodes) require(UUID.test(id) && /^[A-Za-z0-9+/]{43}=$/.test(key) &&
    Buffer.from(key, 'base64').toString('base64') === key && !Buffer.from(key, 'base64').equals(Buffer.alloc(32)))
  return JSON.stringify({ schemaVersion: 1, platformId: enrollment.platformId, witnessId: enrollment.witnessId,
    signingKeyId: controllerSigningKeyId(publicKey(signingKey)), candidateKeys: Object.fromEntries(keys), nodes: Object.fromEntries(nodes) })
}
async function createPrivateFile(path: string, raw: string): Promise<void> {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try { await file.writeFile(raw); await file.sync() } finally { await file.close() }
}
async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try { await file.sync() } finally { await file.close() }
}

// Explicit first initialization only. Never repair missing files, overwrite an
// existing authority, or derive epoch 1 from a missing/corrupt old installation.
// The parent must be protected and the complete target directory must be new.
export async function initializeControllerWitness(root: string, enrollment: WitnessEnrollment, signingKey: KeyObject,
  initialCandidates: Readonly<Record<string, string>>): Promise<void> {
  const manifest = identity(enrollment, signingKey)
  require(resolve(root) === root)
  require(initialCandidates && Object.keys(initialCandidates).length === Object.keys(enrollment.nodes).length)
  const now = Date.now()
  const states: Array<[string, ControllerWitnessState]> = []
  for (const nodeId of Object.keys(enrollment.nodes)) {
    require(Object.hasOwn(initialCandidates, nodeId))
    const result = verifyControllerPrepareConfig(initialCandidates[nodeId], { platformId: enrollment.platformId, nodeId,
      trustedKeys: enrollment.candidateKeys, now })
    const config = result.config
    states.push([nodeId, { schemaVersion: 1, platformId: enrollment.platformId, nodeId, epoch: config.epoch, sequence: config.sequence,
      candidateSha256: result.observed.payloadSha256, controllerId: config.controllerId, requestId: config.requestId,
      challenge: randomBytes(24).toString('base64url'), phase: 'preparing', preparedAt: now, expiresAt: Math.min(config.expiresAt, now + 900000),
      lastObservedAt: now, leaseId: null, receiptSha256: null, bootId: null }])
  }
  // Validate the parent before any mutation. mkdir without recursive/O_EXCL
  // file creation ensure even an interrupted initialization cannot be rerun.
  await validateDiscoveryPrivateDirectory(dirname(root))
  await mkdir(root, { mode: 0o700 })
  await validateDiscoveryPrivateDirectory(root)
  const nodesRoot = join(root, 'nodes')
  await mkdir(nodesRoot, { mode: 0o700 })
  for (const [nodeId, state] of states) {
    const directory = join(nodesRoot, nodeId)
    await mkdir(directory, { mode: 0o700 })
    await createPrivateFile(join(directory, 'witness.json'), JSON.stringify(state))
    await syncDirectory(directory)
  }
  await syncDirectory(nodesRoot)
  // identity.json is published last, after all node states are durable.
  await createPrivateFile(join(root, 'identity.json'), manifest)
  await syncDirectory(root)
  await syncDirectory(dirname(root))
}

export async function openControllerWitnessService(root: string, enrollment: WitnessEnrollment, signingKey: KeyObject) {
  const manifest = identity(enrollment, signingKey)
  await validateDiscoveryPrivateDirectory(root)
  require(await readDiscoveryPrivateFile(join(root, 'identity.json'), 65536) === manifest)
  const nodes = new Map<string, Awaited<ReturnType<typeof createControllerWitness>>>()
  for (const [nodeId, nodePublicKey] of Object.entries(enrollment.nodes)) {
    nodes.set(nodeId, await createControllerWitness(join(root, 'nodes', nodeId), { platformId: enrollment.platformId, nodeId },
      { candidateKeys: enrollment.candidateKeys, nodePublicKey, writeAuthority: { witnessId: enrollment.witnessId, signingKey } }))
  }
  return { platformId: enrollment.platformId, nodes }
}

export function witnessCertificateID(raw: Buffer): string { return createHash('sha256').update(raw).digest('hex') }

// mTLS pins each authorized controller certificate to explicit node coverage.
// Host receipts/gate proofs are still independently authenticated by the node's
// signing identity. TLS authentication never substitutes for physical fencing.
export function createControllerWitnessServer(tls: ServerOptions, service: Awaited<ReturnType<typeof openControllerWitnessService>>,
  clients: Readonly<Record<string, WitnessClient>>, authority: string) {
  require(tls.requestCert === true && tls.rejectUnauthorized === true && tls.ca)
  require(typeof authority === 'string' && /^[a-z0-9.-]+(?::[1-9][0-9]{0,4})?$/.test(authority))
  require(Object.keys(clients).length > 0 && Object.keys(clients).length <= 256)
  const registered = new Map<string, WitnessClient>()
  for (const [fingerprint, client] of Object.entries(clients)) {
    require(HASH.test(fingerprint) && client && UUID.test(client.controllerId) && /^key_[a-f0-9]{64}$/.test(client.holderKeyId) && Array.isArray(client.nodeIds) &&
      client.nodeIds.length > 0 && client.nodeIds.length <= 256 && new Set(client.nodeIds).size === client.nodeIds.length &&
      client.nodeIds.every(nodeId => service.nodes.has(nodeId)))
    registered.set(fingerprint, { controllerId: client.controllerId, holderKeyId: client.holderKeyId, nodeIds: [...client.nodeIds] })
  }
  let active = 0
  const busyNodes = new Set<string>()
  const server = createServer({ ...tls, minVersion: 'TLSv1.3' }, async (request, response) => {
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    const reply = (status: number, value: unknown) => { response.writeHead(status); response.end(JSON.stringify(value)) }
    const socket = request.socket as TLSSocket
    const certificate = socket.getPeerCertificate()
    const client = socket.authorized && certificate.raw ? registered.get(witnessCertificateID(certificate.raw)) : undefined
    if (!client) { reply(401, { code: 'WITNESS_IDENTITY_REQUIRED' }); return }
    if (request.headers.host !== authority) { reply(400, { code: 'WITNESS_AUTHORITY_INVALID' }); return }
    const endpoint = request.url
    if (request.method !== 'POST' || !['/v1/witness/status', '/v1/witness/prepare', '/v1/witness/activate', '/v1/witness/lease'].includes(endpoint || '')) {
      reply(404, { code: 'WITNESS_ENDPOINT_UNKNOWN' }); return
    }
    if (request.headers['content-type'] !== 'application/json' || request.headers['content-encoding'] !== undefined ||
      Number(request.headers['content-length'] || 0) > 20000 || active >= 32) { reply(400, { code: 'WITNESS_REQUEST_INVALID' }); return }
    active++
    let lockedNode: string | undefined
    try {
      const chunks: Buffer[] = []; let size = 0
      for await (const chunk of request) {
        size += chunk.length
        if (size > 20000) throw new ControllerConfigError('CONTROLLER_WITNESS_REQUEST_INVALID')
        chunks.push(Buffer.from(chunk))
      }
      const raw = new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks))
      const data = JSON.parse(raw) as Record<string, unknown>
      require(data && typeof data === 'object' && !Array.isArray(data) && raw === JSON.stringify(data))
      require(typeof data.nodeId === 'string' && client.nodeIds.includes(data.nodeId))
      require(!busyNodes.has(data.nodeId))
      busyNodes.add(data.nodeId); lockedNode = data.nodeId
      const witness = service.nodes.get(data.nodeId)!
      const fields = endpoint === '/v1/witness/status' ? ['nodeId'] : endpoint === '/v1/witness/prepare' ? ['nodeId', 'candidate'] :
        endpoint === '/v1/witness/activate' ? ['nodeId', 'receipt'] : ['nodeId', 'receipt', 'gateProof', 'gateId', 'holderKeyId', 'permissions']
      require(Object.keys(data).length === fields.length && fields.every(field => Object.hasOwn(data, field)))
      if (endpoint === '/v1/witness/prepare') {
        require(typeof data.candidate === 'string')
        // Full signature validation remains in witness.prepare; this identity
        // check forbids one registered controller requesting another's writer.
        const untrusted = JSON.parse(Buffer.from((JSON.parse(data.candidate) as { payload: string }).payload, 'base64').toString()) as { controllerId?: string }
        require(untrusted.controllerId === client.controllerId)
        await witness.prepare(data.candidate)
        reply(200, { preparePermit: await witness.preparePermit() })
      } else {
        const status = await witness.status()
        require(status.state.controllerId === client.controllerId)
        if (endpoint === '/v1/witness/status') {
          reply(200, { platformId: service.platformId, nodeId: data.nodeId, epoch: status.state.epoch,
            phase: status.state.phase, expired: status.expired, signedWriteLeaseAvailable: false })
        } else if (endpoint === '/v1/witness/activate') {
          require(typeof data.receipt === 'string')
          reply(200, await witness.activate(data.receipt))
        } else {
          require(typeof data.receipt === 'string' && typeof data.gateProof === 'string' && typeof data.gateId === 'string' &&
            data.holderKeyId === client.holderKeyId && Array.isArray(data.permissions))
          const lease = await witness.issueWriteLease(data.receipt, data.gateProof, { gateId: data.gateId,
            holderKeyId: client.holderKeyId, permissions: data.permissions as ControllerLeasePermission[] })
          reply(200, { lease })
        }
      }
    } catch { if (!response.headersSent) reply(409, { code: 'WITNESS_REQUEST_REJECTED' }) }
    finally { active--; if (lockedNode) busyNodes.delete(lockedNode) }
  })
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000
  server.maxHeadersCount = 24; server.maxConnections = 128
  return server
}

export const acquireControllerWitnessServiceLock = acquireDiscoveryProcessLock
