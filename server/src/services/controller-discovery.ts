import { constants } from 'node:fs'
import { lstat, open, opendir, unlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { createServer, type ServerOptions } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ControllerConfigError, CONTROLLER_CONFIG_MAX_BYTES, controllerSigningKeyId, verifyControllerPrepareConfig } from '../lib/controller-config.js'
import { verifyControllerReadProof } from '../lib/controller-discovery-auth.js'
import { verifyManagementChannels } from '../lib/controller-channels.js'

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
const PUBKEY = /^[A-Za-z0-9+/]{43}=$/
const NONCE_FILE = /^[a-f0-9]{64}\.json$/

function fail(code: string): never { throw new ControllerConfigError(code) }
export async function validateDiscoveryPrivateDirectory(path: string): Promise<void> {
  if (resolve(path) !== path) fail('CONTROLLER_DISCOVERY_STATE_INVALID')
  let current = path
  while (true) {
    const info = await lstat(current)
    if (!info.isDirectory() || info.isSymbolicLink()) fail('CONTROLLER_DISCOVERY_STATE_INVALID')
    if (process.platform !== 'win32') {
      const uid = process.getuid!()
      if ((info.uid !== 0 && info.uid !== uid) || ((info.mode & 0o022) !== 0 && !(info.uid === 0 && (info.mode & 0o1000)))) fail('CONTROLLER_DISCOVERY_STATE_INVALID')
      if (current === path && (info.uid !== uid || (info.mode & 0o777) !== 0o700)) fail('CONTROLLER_DISCOVERY_STATE_INVALID')
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
}

export async function readDiscoveryPrivateFile(path: string, limit: number): Promise<string> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 65536) fail('CONTROLLER_DISCOVERY_STATE_INVALID')
  await validateDiscoveryPrivateDirectory(dirname(path))
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > limit || info.nlink !== 1 ||
      (process.platform !== 'win32' && (info.uid !== process.getuid!() || (info.mode & 0o777) !== 0o600))) fail('CONTROLLER_DISCOVERY_STATE_INVALID')
    const buffer = Buffer.alloc(limit + 1)
    let used = 0
    while (used < buffer.length) {
      const { bytesRead } = await file.read(buffer, used, buffer.length - used, null)
      if (!bytesRead) break
      used += bytesRead
    }
    if (used > limit) fail('CONTROLLER_DISCOVERY_STATE_INVALID')
    const raw = buffer.subarray(0, used)
    return new TextDecoder('utf-8', { fatal: true }).decode(raw)
  } finally { await file.close() }
}

// Linux flock locks the inherited open file description, which the Node
// process retains. No PID files or stale-lock deletion after an unclean exit.
async function acquireDiscoveryLock(root: string, name: 'service.lock' | 'mutation.lock'): Promise<() => Promise<void>> {
  if (process.platform !== 'linux') fail('CONTROLLER_DISCOVERY_PLATFORM_UNSUPPORTED')
  await validateDiscoveryPrivateDirectory(root)
  const file = await open(join(root, name), constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid!() || (info.mode & 0o777) !== 0o600) fail('CONTROLLER_DISCOVERY_STATE_INVALID')
    await new Promise<void>((resolve, reject) => {
      const child = spawn('/usr/bin/flock', ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'ignore', 'ignore', file.fd] })
      child.once('error', reject)
      child.once('exit', code => code === 0 ? resolve() : reject(new ControllerConfigError('CONTROLLER_DISCOVERY_ALREADY_RUNNING')))
    })
    return () => file.close()
  } catch (error) { await file.close(); throw error }
}

export const acquireDiscoveryProcessLock = (root: string) => acquireDiscoveryLock(root, 'service.lock')
export const acquireDiscoveryMutationLock = (root: string) => acquireDiscoveryLock(root, 'mutation.lock')

export interface DiscoveryNodeRecord {
  platformId: string; nodeId: string; enabled: boolean; publicKey: string; candidate: string
  channels?: string
}
export interface DiscoveryRepository {
  node: (nodeId: string) => Promise<DiscoveryNodeRecord | null>
  claimNonce: (claim: { platformId: string; nodeId: string; nonce: string; expiresAt: number }) => Promise<boolean>
}

// Standalone service storage: local enrolled node records and immutable nonce
// reservations only. No PayIncus database, admin cookie, OSS key or writer lease.
export async function createFileDiscoveryRepository(root: string): Promise<DiscoveryRepository> {
  await validateDiscoveryPrivateDirectory(root)
  await validateDiscoveryPrivateDirectory(join(root, 'nodes'))
  await validateDiscoveryPrivateDirectory(join(root, 'nonces'))
  let queue: Promise<unknown> = Promise.resolve()
  return {
    async node(nodeId) {
      if (!UUID.test(nodeId)) fail('CONTROLLER_DISCOVERY_IDENTITY_INVALID')
      let encoded: string
      try { encoded = await readDiscoveryPrivateFile(join(root, 'nodes', `${nodeId}.json`), 32768) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
      const record = JSON.parse(encoded) as DiscoveryNodeRecord
      const keys = ['platformId', 'nodeId', 'enabled', 'publicKey', 'candidate']
      if (!record || typeof record !== 'object' || Array.isArray(record) || !Object.keys(record).every(key => keys.includes(key) || key === 'channels') ||
        !keys.every(key => Object.hasOwn(record, key)) || typeof record.platformId !== 'string' || !UUID.test(record.platformId) || record.nodeId !== nodeId ||
        typeof record.enabled !== 'boolean' || typeof record.publicKey !== 'string' || !PUBKEY.test(record.publicKey) ||
        Buffer.from(record.publicKey, 'base64').toString('base64') !== record.publicKey || typeof record.candidate !== 'string' ||
        Buffer.byteLength(record.candidate) > CONTROLLER_CONFIG_MAX_BYTES) fail('CONTROLLER_DISCOVERY_STATE_INVALID')
      if (Buffer.from(record.publicKey, 'base64').equals(Buffer.alloc(32))) fail('CONTROLLER_DISCOVERY_STATE_INVALID')
      if (record.channels !== undefined && (typeof record.channels !== 'string' || Buffer.byteLength(record.channels) > CONTROLLER_CONFIG_MAX_BYTES)) fail('CONTROLLER_DISCOVERY_STATE_INVALID')
      return record
    },
    async claimNonce(claim) {
      if (!UUID.test(claim.nodeId) || !UUID.test(claim.platformId) || !/^[A-Za-z0-9_-]{32}$/.test(claim.nonce) ||
        !Number.isSafeInteger(claim.expiresAt)) fail('CONTROLLER_DISCOVERY_NONCE_INVALID')
      const work = async () => {
        const directory = join(root, 'nonces', claim.nodeId)
        // Directories are prepared during enrollment; requests cannot create
        // arbitrary users or directory trees.
        await validateDiscoveryPrivateDirectory(directory)
        const now = Date.now(), names: string[] = []
        // Stop enumeration before allocating an unbounded directory listing.
        const entries = await opendir(directory)
        for await (const entry of entries) {
          names.push(entry.name)
          if (names.length > 256) fail('CONTROLLER_DISCOVERY_NONCE_CAPACITY')
        }
        let active = 0
        for (const name of names) {
          if (!NONCE_FILE.test(name)) fail('CONTROLLER_DISCOVERY_STATE_INVALID')
          const saved = JSON.parse(await readDiscoveryPrivateFile(join(directory, name), 256)) as { expiresAt?: number }
          if (!saved || typeof saved !== 'object' || Array.isArray(saved) || Object.keys(saved).length !== 1 || !Number.isSafeInteger(saved.expiresAt) || saved.expiresAt! <= 0) fail('CONTROLLER_DISCOVERY_STATE_INVALID')
          if (saved.expiresAt! < now) await unlink(join(directory, name))
          else active++
        }
        if (active >= 256 || claim.expiresAt <= now || claim.expiresAt > now + 60001) fail('CONTROLLER_DISCOVERY_NONCE_CAPACITY')
        const digest = createHash('sha256').update(`${claim.platformId}\n${claim.nodeId}\n${claim.nonce}`).digest('hex')
        let file
        try { file = await open(join(directory, `${digest}.json`), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600) }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error }
        try { await file.writeFile(JSON.stringify({ expiresAt: claim.expiresAt })); await file.sync() }
        finally { await file.close() }
        if (process.platform !== 'win32') { const parent = await open(directory, 'r'); try { await parent.sync() } finally { await parent.close() } }
        return true
      }
      const result = queue.then(work, work)
      queue = result.catch(() => {})
      return result
    }
  }
}

export interface ControllerDiscoveryOptions {
  authority: string; trustedConfigKeys: Readonly<Record<string, string>>; repository: DiscoveryRepository
}

export function createControllerDiscoveryServer(tls: ServerOptions, options: ControllerDiscoveryOptions) {
  if (tls.requestCert || tls.rejectUnauthorized === false || !tls.key || !tls.cert ||
    !/^[a-z0-9.[\]:-]{1,300}$/.test(options.authority) || options.authority.endsWith(':') ||
    !Object.keys(options.trustedConfigKeys).length) fail('CONTROLLER_DISCOVERY_CONFIG_INVALID')
  for (const [keyId, publicKey] of Object.entries(options.trustedConfigKeys)) {
    if (typeof publicKey !== 'string' || !PUBKEY.test(publicKey) || controllerSigningKeyId(publicKey) !== keyId) fail('CONTROLLER_DISCOVERY_CONFIG_INVALID')
  }
  const rates = new Map<string, { start: number; count: number }>()
  const send = (reply: ServerResponse, status: number, code: string) => {
    reply.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    reply.end(JSON.stringify({ code }))
  }
  const handler = async (request: IncomingMessage, reply: ServerResponse) => {
    const now = Date.now(), ip = request.socket.remoteAddress || 'unknown'
    // Bound memory independently of authenticated traffic. Proxy clients share
    // the source limit; forwarded headers never establish identity.
    if (rates.size >= 4096) { for (const [key, row] of rates) if (now - row.start > 60000) rates.delete(key) }
    if (!rates.has(ip) && rates.size >= 4096) { send(reply, 429, 'CONTROLLER_DISCOVERY_RATE_LIMIT'); return }
    const row = rates.get(ip)
    const rate = !row || now - row.start > 60000 ? { start: now, count: 0 } : row
    rate.count++; rates.set(ip, rate)
    if (rate.count > 120) { send(reply, 429, 'CONTROLLER_DISCOVERY_RATE_LIMIT'); return }
    if (request.method !== 'GET' || (request.url !== '/v1/controller-config' && request.url !== '/v1/management-channels')) { send(reply, 404, 'CONTROLLER_DISCOVERY_ROUTE_INVALID'); return }
    const hostCount = request.rawHeaders.filter((_value, index) => index % 2 === 0 && request.rawHeaders[index].toLowerCase() === 'host').length
    if (hostCount !== 1 || request.headers.host !== options.authority || request.headers['transfer-encoding'] ||
      (request.headers['content-length'] && request.headers['content-length'] !== '0')) { send(reply, 400, 'CONTROLLER_DISCOVERY_REQUEST_INVALID'); return }
    const readHeader = (name: string) => {
      let count = 0
      for (let i = 0; i < request.rawHeaders.length; i += 2) if (request.rawHeaders[i].toLowerCase() === name) count++
      const value = request.headers[name]
      if (count !== 1 || typeof value !== 'string' || value.length > 128) fail('CONTROLLER_DISCOVERY_REQUEST_INVALID')
      return value
    }
    try {
      const proof = { platformId: readHeader('x-payincus-platform-id'), nodeId: readHeader('x-payincus-node-id'),
        timestamp: readHeader('x-payincus-timestamp'), nonce: readHeader('x-payincus-nonce'), signature: readHeader('x-payincus-signature') }
      const node = await options.repository.node(proof.nodeId)
      if (!node?.enabled) { send(reply, 401, 'CONTROLLER_DISCOVERY_UNAUTHORIZED'); return }
      await verifyControllerReadProof(proof, { platformId: node.platformId, nodeId: node.nodeId, nodePublicKey: node.publicKey,
        authority: options.authority, path: request.url, now, claimNonce: options.repository.claimNonce })
      // Re-read enrollment after nonce I/O. Revocation/key rotation must not
      // release a candidate loaded before that state changed.
      const current = await options.repository.node(proof.nodeId)
      if (!current?.enabled || current.publicKey !== node.publicKey || current.platformId !== node.platformId) {
        send(reply, 401, 'CONTROLLER_DISCOVERY_UNAUTHORIZED'); return
      }
      const trust = { platformId: node.platformId, nodeId: node.nodeId, now: Date.now(), trustedKeys: options.trustedConfigKeys }
      const encoded = request.url === '/v1/management-channels' ? current.channels : current.candidate
      if (!encoded) fail('CONTROLLER_DISCOVERY_NOT_READY')
      if (request.url === '/v1/management-channels') verifyManagementChannels(encoded, trust)
      else verifyControllerPrepareConfig(encoded, trust)
      reply.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      reply.end(encoded)
    } catch (error) {
      // Avoid exposing enrolled node details, stored candidates or parser errors.
      const auth = error instanceof ControllerConfigError && /IDENTITY|SIGNATURE|TIMESTAMP|NONCE_REPLAY|REQUEST_INVALID/.test(error.code)
      send(reply, auth ? 401 : 503, auth ? 'CONTROLLER_DISCOVERY_UNAUTHORIZED' : 'CONTROLLER_DISCOVERY_NOT_READY')
    }
  }
  const server = createServer({ ...tls, minVersion: 'TLSv1.2' }, (request, reply) => { void handler(request, reply).catch(() => { if (!reply.headersSent) send(reply, 503, 'CONTROLLER_DISCOVERY_NOT_READY'); else reply.destroy() }) })
  server.requestTimeout = 10000
  server.headersTimeout = 10000
  server.keepAliveTimeout = 5000
  server.maxHeadersCount = 24
  server.maxConnections = 256
  return server
}
