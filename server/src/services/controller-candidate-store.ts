import { constants } from 'node:fs'
import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { ControllerConfigError, verifyControllerPrepareConfig } from '../lib/controller-config.js'
import { verifyManagementChannels } from '../lib/controller-channels.js'
import { acquireDiscoveryMutationLock, createFileDiscoveryRepository, validateDiscoveryPrivateDirectory, type DiscoveryNodeRecord } from './controller-discovery.js'

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
const queues = new Map<string, Promise<unknown>>()
function fail(code: string): never { throw new ControllerConfigError(code) }

// Internal persistence only. The caller must authorize enrollment/publication;
// this library exposes no HTTP endpoint and grants no active controller lease.
export async function createControllerCandidateStore(root: string, trustedKeys: Readonly<Record<string, string>>) {
  const repository = await createFileDiscoveryRepository(root)
  const trust = Object.freeze({ ...trustedKeys })
  const verify = (record: DiscoveryNodeRecord, now: number, previous?: ReturnType<typeof verifyControllerPrepareConfig>['observed']) =>
    verifyControllerPrepareConfig(record.candidate, { platformId: record.platformId, nodeId: record.nodeId, now, trustedKeys: trust, previous })
  const historical = (record: DiscoveryNodeRecord) => {
    // Retain the authenticated watermark even after this candidate expires.
    // Decode only to select verification time; trust is established by the
    // full signature/schema/identity verification, not this untrusted timestamp.
    let issuedAt: number
    try { issuedAt = JSON.parse(Buffer.from(JSON.parse(record.candidate).payload, 'base64').toString('utf8')).issuedAt }
    catch { return fail('CONTROLLER_DISCOVERY_STATE_INVALID') }
    return verify(record, issuedAt)
  }
  const serialized = async <T>(work: () => Promise<T>): Promise<T> => {
    const before = queues.get(root) || Promise.resolve()
    const operation = before.catch(() => {}).then(async () => {
      const release = process.platform === 'linux' ? await acquireDiscoveryMutationLock(root) : async () => {}
      try { return await work() } finally { await release() }
    })
    queues.set(root, operation)
    try { return await operation } finally { if (queues.get(root) === operation) queues.delete(root) }
  }
  const write = async (record: DiscoveryNodeRecord) => {
    const directory = join(root, 'nodes')
    await validateDiscoveryPrivateDirectory(directory)
    const temporary = join(directory, `.candidate-${randomBytes(16).toString('hex')}`)
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try {
      try { await file.writeFile(JSON.stringify(record)); await file.sync() } finally { await file.close() }
      await rename(temporary, join(directory, `${record.nodeId}.json`))
      if (process.platform !== 'win32') {
        const parent = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW)
        try { await parent.sync() } finally { await parent.close() }
      }
    } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }) }
  }
  const identity = (nodeId: string) => { if (!UUID.test(nodeId)) fail('CONTROLLER_DISCOVERY_IDENTITY_INVALID') }
  return {
    async enroll(input: DiscoveryNodeRecord): Promise<{ duplicate: boolean; canWrite: false }> {
      // Snapshot caller input before awaiting a lock; reject unknown enrollment
      // fields instead of silently persisting them into the read-service store.
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 5 ||
        !['platformId', 'nodeId', 'enabled', 'publicKey', 'candidate'].every(key => Object.hasOwn(input, key)) ||
        input.enabled !== true || typeof input.publicKey !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(input.publicKey) ||
        Buffer.from(input.publicKey, 'base64').toString('base64') !== input.publicKey || Buffer.from(input.publicKey, 'base64').equals(Buffer.alloc(32))) fail('CONTROLLER_DISCOVERY_IDENTITY_INVALID')
      const record: DiscoveryNodeRecord = { platformId: input.platformId, nodeId: input.nodeId, enabled: true,
        publicKey: input.publicKey, candidate: input.candidate }; identity(record.nodeId)
      return serialized(async () => {
        verify(record, Date.now())
        const current = await repository.node(record.nodeId)
        if (current) {
          if (!current.enabled || current.platformId !== record.platformId || current.publicKey !== record.publicKey ||
            current.candidate !== record.candidate) fail('CONTROLLER_DISCOVERY_ENROLLMENT_CONFLICT')
          historical(current)
          return { duplicate: true, canWrite: false }
        }
        const directory = join(root, 'nonces', record.nodeId)
        await mkdir(directory, { mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error })
        await validateDiscoveryPrivateDirectory(directory)
        if (process.platform !== 'win32') {
          const parent = await open(join(root, 'nonces'), constants.O_RDONLY | constants.O_NOFOLLOW)
          try { await parent.sync() } finally { await parent.close() }
        }
        await write(record)
        return { duplicate: false, canWrite: false }
      })
    },
    async publish(nodeId: string, candidate: string): Promise<{ duplicate: boolean; canWrite: false }> {
      identity(nodeId)
      return serialized(async () => {
        const current = await repository.node(nodeId)
        if (!current?.enabled) fail('CONTROLLER_DISCOVERY_NODE_REVOKED_OR_UNKNOWN')
        const previous = historical(current).observed
        const result = verify({ ...current, candidate }, Date.now(), previous)
        if (!result.duplicate) await write({ ...current, candidate })
        return { duplicate: result.duplicate, canWrite: false }
      })
    },
    async revoke(nodeId: string): Promise<{ duplicate: boolean; canWrite: false }> {
      identity(nodeId)
      return serialized(async () => {
        const current = await repository.node(nodeId)
        if (!current) fail('CONTROLLER_DISCOVERY_NODE_UNKNOWN')
        if (!current.enabled) return { duplicate: true, canWrite: false }
        // Preserve the identity and watermark tombstone. Reusing a revoked node
        // identity requires a future explicit trust-rotation protocol.
        await write({ ...current, enabled: false })
        return { duplicate: false, canWrite: false }
      })
    },
    async publishChannels(nodeId: string, encoded: string): Promise<{ duplicate: boolean; canWrite: false }> {
      identity(nodeId)
      return serialized(async () => {
        const current = await repository.node(nodeId)
        if (!current?.enabled) fail('CONTROLLER_DISCOVERY_NODE_REVOKED_OR_UNKNOWN')
        let previous
        if (current.channels) {
          const issuedAt = JSON.parse(Buffer.from(JSON.parse(current.channels).payload, 'base64').toString()).issuedAt as number
          previous = verifyManagementChannels(current.channels, { platformId: current.platformId, nodeId, now: issuedAt, trustedKeys: trust }).observed
        }
        const result = verifyManagementChannels(encoded, { platformId: current.platformId, nodeId, now: Date.now(), trustedKeys: trust, previous })
        if (!result.duplicate) await write({ ...current, channels: encoded })
        return { duplicate: result.duplicate, canWrite: false }
      })
    }
  }
}
