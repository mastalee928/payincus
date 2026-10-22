import { constants } from 'node:fs'
import { open, rename, unlink } from 'node:fs/promises'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { ControllerConfigError, verifyControllerPrepareConfig } from '../lib/controller-config.js'
import { verifyControllerFenceReceipt, type ControllerFenceReceiptBinding } from '../lib/controller-fence-receipt.js'
import { acquireDiscoveryMutationLock, readDiscoveryPrivateFile, validateDiscoveryPrivateDirectory } from './controller-discovery.js'

// Internal, single-authority witness persistence. No HTTP or signed write
// leases are exposed yet. Missing/corrupt state never initializes implicitly.
export interface ControllerWitnessState {
  schemaVersion: 1; platformId: string; nodeId: string
  epoch: string; sequence: string; candidateSha256: string
  controllerId: string; requestId: string; challenge: string
  phase: 'preparing' | 'active'; preparedAt: number; expiresAt: number; lastObservedAt: number
  leaseId: string | null; receiptSha256: string | null; bootId: string | null
}
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
const HASH = /^[a-f0-9]{64}$/
const COUNTER = /^[1-9][0-9]{0,18}$/
const queues = new Map<string, Promise<unknown>>()
function require(condition: unknown): asserts condition {
  if (!condition) throw new ControllerConfigError('CONTROLLER_WITNESS_INVALID')
}
export async function createControllerWitness(root: string, identity: { platformId: string; nodeId: string },
  trust: { candidateKeys: Readonly<Record<string, string>>; nodePublicKey: string }) {
  require(identity && typeof identity.platformId === 'string' && typeof identity.nodeId === 'string' && UUID.test(identity.platformId) && UUID.test(identity.nodeId))
  require(trust && typeof trust.nodePublicKey === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(trust.nodePublicKey) &&
    Buffer.from(trust.nodePublicKey, 'base64').toString('base64') === trust.nodePublicKey && !Buffer.from(trust.nodePublicKey, 'base64').equals(Buffer.alloc(32)))
  await validateDiscoveryPrivateDirectory(root)
  const fixedIdentity = { ...identity }, candidateKeys = Object.freeze({ ...trust.candidateKeys }), nodeKey = trust.nodePublicKey
  const path = join(root, 'witness.json')
  const read = async (): Promise<ControllerWitnessState> => {
    const state = JSON.parse(await readDiscoveryPrivateFile(path, 4096)) as ControllerWitnessState
    const fields = ['schemaVersion', 'platformId', 'nodeId', 'epoch', 'sequence', 'candidateSha256', 'controllerId', 'requestId',
      'challenge', 'phase', 'preparedAt', 'expiresAt', 'lastObservedAt', 'leaseId', 'receiptSha256', 'bootId']
    require(state && typeof state === 'object' && !Array.isArray(state) && Object.keys(state).length === fields.length && fields.every(key => Object.hasOwn(state, key)))
    require(state.schemaVersion === 1 && state.platformId === fixedIdentity.platformId && state.nodeId === fixedIdentity.nodeId)
    require(typeof state.epoch === 'string' && COUNTER.test(state.epoch) && BigInt(state.epoch) <= 9223372036854775807n &&
      typeof state.sequence === 'string' && COUNTER.test(state.sequence) && BigInt(state.sequence) <= 9223372036854775807n)
    require(typeof state.candidateSha256 === 'string' && HASH.test(state.candidateSha256) &&
      typeof state.controllerId === 'string' && typeof state.requestId === 'string' && UUID.test(state.controllerId) && UUID.test(state.requestId))
    require(typeof state.challenge === 'string' && /^[A-Za-z0-9_-]{32}$/.test(state.challenge) && state.challenge === Buffer.from(state.challenge, 'base64url').toString('base64url'))
    require(Number.isSafeInteger(state.preparedAt) && state.preparedAt > 0 && Number.isSafeInteger(state.expiresAt) &&
      state.expiresAt > state.preparedAt && state.expiresAt - state.preparedAt <= 900000)
    require(Number.isSafeInteger(state.lastObservedAt) && state.lastObservedAt >= state.preparedAt)
    require(state.phase === 'preparing' ? state.leaseId === null && state.receiptSha256 === null && state.bootId === null :
      state.phase === 'active' && typeof state.leaseId === 'string' && UUID.test(state.leaseId) &&
      typeof state.receiptSha256 === 'string' && HASH.test(state.receiptSha256) && typeof state.bootId === 'string' && UUID.test(state.bootId))
    return state
  }
  // Validate already-provisioned state immediately; a deleted authority must
  // go through independent disaster recovery, never become epoch 1 on startup.
  await read()
  const serialized = async <T>(work: () => Promise<T>): Promise<T> => {
    const before = queues.get(root) || Promise.resolve()
    const operation = before.catch(() => {}).then(async () => {
      const release = process.platform === 'linux' ? await acquireDiscoveryMutationLock(root) : async () => {}
      try { return await work() } finally { await release() }
    })
    queues.set(root, operation)
    try { return await operation } finally { if (queues.get(root) === operation) queues.delete(root) }
  }
  const save = async (state: ControllerWitnessState) => {
    await validateDiscoveryPrivateDirectory(root)
    const temporary = join(root, '.witness-' + randomBytes(16).toString('hex'))
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try {
      try { await file.writeFile(JSON.stringify(state)); await file.sync() } finally { await file.close() }
      await rename(temporary, path)
      if (process.platform !== 'win32') { const parent = await open(root, constants.O_RDONLY | constants.O_NOFOLLOW); try { await parent.sync() } finally { await parent.close() } }
    } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }) }
  }
  const binding = (state: ControllerWitnessState): ControllerFenceReceiptBinding => ({ ...fixedIdentity,
    controllerId: state.controllerId, requestId: state.requestId, epoch: state.epoch, sequence: state.sequence,
    candidateSha256: state.candidateSha256, challenge: state.challenge })
  const checkClock = (state: ControllerWitnessState, now: number) => {
    require(now + 5000 >= state.lastObservedAt)
    // Within tolerated clock adjustment, logical time still never decreases.
    // Otherwise a just-expired receipt could revive during a small rollback.
    return Math.max(now, state.lastObservedAt)
  }
  return {
    async prepare(candidate: string): Promise<ControllerFenceReceiptBinding> {
      return serialized(async () => {
        const previous = await read(), now = checkClock(previous, Date.now())
        const checked = verifyControllerPrepareConfig(candidate, { ...fixedIdentity, now, trustedKeys: candidateKeys,
          previous: { schemaVersion: 1, ...fixedIdentity, epoch: previous.epoch, sequence: previous.sequence, payloadSha256: previous.candidateSha256 } })
        const config = checked.config
        // Every new takeover must allocate a greater epoch. Config sequence
        // updates within an active epoch are separate from controller transfer.
        if (checked.duplicate) {
          require(previous.phase === 'preparing' && previous.expiresAt > now)
          await save({ ...previous, lastObservedAt: Math.max(previous.lastObservedAt, now) })
          return binding(previous)
        }
        require(BigInt(config.epoch) > BigInt(previous.epoch))
        const state: ControllerWitnessState = { schemaVersion: 1, ...fixedIdentity, epoch: config.epoch, sequence: config.sequence,
          candidateSha256: checked.observed.payloadSha256, controllerId: config.controllerId, requestId: config.requestId,
          challenge: randomBytes(24).toString('base64url'), phase: 'preparing', preparedAt: now, expiresAt: Math.min(config.expiresAt, now + 900000),
          lastObservedAt: now, leaseId: null, receiptSha256: null, bootId: null }
        await save(state)
        return binding(state)
      })
    },
    async activate(encodedReceipt: string): Promise<{ leaseId: string; phase: 'active'; signedWriteLeaseAvailable: false }> {
      return serialized(async () => {
        const state = await read(), now = checkClock(state, Date.now())
        require(state.expiresAt > now)
        const receipt = verifyControllerFenceReceipt(encodedReceipt, binding(state), nodeKey, now)
        const digest = createHash('sha256').update(encodedReceipt).digest('hex')
        if (state.phase === 'active') {
          require(state.receiptSha256 === digest && state.bootId === receipt.bootId)
          await save({ ...state, lastObservedAt: Math.max(state.lastObservedAt, now) })
          return { leaseId: state.leaseId!, phase: 'active', signedWriteLeaseAvailable: false }
        }
        const leaseId = randomUUID()
        // Internal lease is bounded by the verified receipt. Signing/renewal,
        // host boot enforcement and remote access authorization are later gates.
        await save({ ...state, phase: 'active', expiresAt: Math.min(state.expiresAt, receipt.expiresAt),
          lastObservedAt: Math.max(state.lastObservedAt, now), leaseId, receiptSha256: digest, bootId: receipt.bootId })
        return { leaseId, phase: 'active', signedWriteLeaseAvailable: false }
      })
    },
    async status(): Promise<{ state: ControllerWitnessState; expired: boolean; signedWriteLeaseAvailable: false }> {
      return serialized(async () => {
        const previous = await read(), now = checkClock(previous, Date.now())
        const state = { ...previous, lastObservedAt: Math.max(previous.lastObservedAt, now) }
        await save(state)
        return { state, expired: state.expiresAt <= now, signedWriteLeaseAvailable: false }
      })
    }
  }
}
