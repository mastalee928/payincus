import { constants } from 'node:fs'
import { open, rename, unlink } from 'node:fs/promises'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { join } from 'node:path'
import { ControllerConfigError, controllerSigningKeyId, verifyControllerPrepareConfig } from '../lib/controller-config.js'
import { verifyControllerFenceReceipt, type ControllerFenceReceiptBinding } from '../lib/controller-fence-receipt.js'
import { signControllerPreparePermit } from '../lib/controller-prepare-permit.js'
import { signControllerWriteLease, verifyControllerWriteLease, type ControllerLeasePermission } from '../lib/controller-write-lease.js'
import { verifyControllerGateProof } from '../lib/controller-gate-proof.js'
import { acquireDiscoveryMutationLock, readDiscoveryPrivateFile, validateDiscoveryPrivateDirectory } from './controller-discovery.js'
import { createPublicKey } from 'node:crypto'

// Internal, single-authority witness persistence. Signed leases require a
// fixed signing authority and fresh node/gate proofs. No public host writer
// is wired here; missing/corrupt state never initializes implicitly.
export interface ControllerWitnessState {
  schemaVersion: 1; platformId: string; nodeId: string
  epoch: string; sequence: string; candidateSha256: string
  controllerId: string; requestId: string; challenge: string
  phase: 'preparing' | 'active'; preparedAt: number; expiresAt: number; lastObservedAt: number
  leaseId: string | null; receiptSha256: string | null; bootId: string | null
  authorizationExpiresAt?: number
  writeLease?: { gateId: string; holderKeyId: string; witnessId: string; signingKeyId: string; sequence: string; encoded: string }
}
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
const HASH = /^[a-f0-9]{64}$/
const COUNTER = /^[1-9][0-9]{0,18}$/
const queues = new Map<string, Promise<unknown>>()
function require(condition: unknown): asserts condition {
  if (!condition) throw new ControllerConfigError('CONTROLLER_WITNESS_INVALID')
}
export async function createControllerWitness(root: string, identity: { platformId: string; nodeId: string },
  trust: { candidateKeys: Readonly<Record<string, string>>; nodePublicKey: string;
    writeAuthority?: { witnessId: string; signingKey: KeyObject } }) {
  require(identity && typeof identity.platformId === 'string' && typeof identity.nodeId === 'string' && UUID.test(identity.platformId) && UUID.test(identity.nodeId))
  require(trust && typeof trust.nodePublicKey === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(trust.nodePublicKey) &&
    Buffer.from(trust.nodePublicKey, 'base64').toString('base64') === trust.nodePublicKey && !Buffer.from(trust.nodePublicKey, 'base64').equals(Buffer.alloc(32)))
  await validateDiscoveryPrivateDirectory(root)
  const fixedIdentity = { ...identity }, candidateKeys = Object.freeze({ ...trust.candidateKeys }), nodeKey = trust.nodePublicKey
  const authority = trust.writeAuthority ? { ...trust.writeAuthority } : null
  if (authority) require(typeof authority.witnessId === 'string' && UUID.test(authority.witnessId) &&
    authority.signingKey.type === 'private' && authority.signingKey.asymmetricKeyType === 'ed25519')
  const authorityPublicKey = authority ? createPublicKey(authority.signingKey).export({ type: 'spki', format: 'der' }).subarray(12).toString('base64') : null
  const authorityKeyId = authorityPublicKey ? controllerSigningKeyId(authorityPublicKey) : null
  const path = join(root, 'witness.json')
  const read = async (): Promise<ControllerWitnessState> => {
    const state = JSON.parse(await readDiscoveryPrivateFile(path, 4096)) as ControllerWitnessState
    const fields = ['schemaVersion', 'platformId', 'nodeId', 'epoch', 'sequence', 'candidateSha256', 'controllerId', 'requestId',
      'challenge', 'phase', 'preparedAt', 'expiresAt', 'lastObservedAt', 'leaseId', 'receiptSha256', 'bootId']
    require(state && typeof state === 'object' && !Array.isArray(state) &&
      Object.keys(state).every(key => fields.includes(key) || key === 'authorizationExpiresAt' || key === 'writeLease') && fields.every(key => Object.hasOwn(state, key)))
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
    if (state.authorizationExpiresAt !== undefined) require(state.phase === 'active' && Number.isSafeInteger(state.authorizationExpiresAt) &&
      state.authorizationExpiresAt >= state.expiresAt && state.authorizationExpiresAt <= state.preparedAt + 900000)
    if (state.writeLease !== undefined) {
      const value = state.writeLease
      require(state.phase === 'active' && state.authorizationExpiresAt !== undefined && value && typeof value === 'object' &&
        Object.keys(value).length === 6 && ['gateId', 'holderKeyId', 'witnessId', 'signingKeyId', 'sequence', 'encoded'].every(key => Object.hasOwn(value, key)))
      require(UUID.test(value.gateId) && UUID.test(value.witnessId) && /^key_[a-f0-9]{64}$/.test(value.holderKeyId) &&
        /^key_[a-f0-9]{64}$/.test(value.signingKeyId) && COUNTER.test(value.sequence) && BigInt(value.sequence) <= 9223372036854775807n &&
        typeof value.encoded === 'string' && Buffer.byteLength(value.encoded) <= 4096)
      require(authority && authorityPublicKey && authorityKeyId && value.witnessId === authority.witnessId && value.signingKeyId === authorityKeyId)
      // Authenticate saved authorization independently of current TTL. An
      // expired lease preserves its watermark, but corrupted disk state must
      // not silently mint a new authorization after restart.
      const env = JSON.parse(value.encoded) as { payload?: string }
      require(typeof env.payload === 'string')
      const issued = JSON.parse(Buffer.from(env.payload, 'base64').toString()) as { issuedAt?: number }
      require(Number.isSafeInteger(issued.issuedAt))
      const checked = verifyControllerWriteLease(value.encoded, { binding: { witnessId: authority.witnessId, ...fixedIdentity,
        controllerId: state.controllerId, requestId: state.requestId, epoch: state.epoch, sequence: state.sequence,
        candidateSha256: state.candidateSha256, leaseId: state.leaseId!, bootId: state.bootId!, gateId: value.gateId,
        holderKeyId: value.holderKeyId }, witnessKeys: { [authorityKeyId]: authorityPublicKey }, now: issued.issuedAt! })
      require(checked.leaseSequence === value.sequence && checked.expiresAt <= state.authorizationExpiresAt! && checked.expiresAt <= state.expiresAt)
    }
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
    async preparePermit(witnessId: string, signingKey: KeyObject): Promise<string> {
      return serialized(async () => {
        const state = await read(), now = checkClock(state, Date.now())
        require(state.phase === 'preparing' && state.expiresAt > now)
        const encoded = signControllerPreparePermit({ schemaVersion: 1, purpose: 'host-fence-prepare', witnessId,
          ...binding(state), issuedAt: now, expiresAt: Math.min(state.expiresAt, now + 60000) }, signingKey)
        // Persist time before releasing the signed preparation authority.
        await save({ ...state, lastObservedAt: now })
        return encoded
      })
    },
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
          authorizationExpiresAt: state.expiresAt, lastObservedAt: Math.max(state.lastObservedAt, now), leaseId, receiptSha256: digest, bootId: receipt.bootId })
        return { leaseId, phase: 'active', signedWriteLeaseAvailable: false }
      })
    },
    // Internal issuance only. Public authorization must authenticate a fixed
    // witness signing identity. Every renewal requires fresh host attestation;
    // a new gate/holder may only start through a greater epoch preparation.
    async issueWriteLease(encodedReceipt: string, encodedGateProof: string, options: {
      gateId: string; holderKeyId: string; permissions: ControllerLeasePermission[]
    }): Promise<string> {
      // Snapshot caller-owned options before waiting for the authority lock.
      // A concurrent caller cannot replace holder/scope during persistence.
      require(options && typeof options === 'object' && Array.isArray(options.permissions))
      const requested = { gateId: options.gateId, holderKeyId: options.holderKeyId, permissions: [...options.permissions] }
      return serialized(async () => {
        const state = await read(), now = checkClock(state, Date.now())
        require(authority && authorityKeyId)
        require(state.phase === 'active' && state.authorizationExpiresAt !== undefined && state.authorizationExpiresAt > now)
        const receipt = verifyControllerFenceReceipt(encodedReceipt, binding(state), nodeKey, now)
        require(receipt.bootId === state.bootId)
        const gate = verifyControllerGateProof(encodedGateProof, { ...fixedIdentity, controllerId: state.controllerId, requestId: state.requestId,
          epoch: state.epoch, sequence: state.sequence, candidateSha256: state.candidateSha256, bootId: state.bootId!,
          gateId: requested.gateId, holderKeyId: requested.holderKeyId }, encodedReceipt, nodeKey, now)
        const sequence = state.writeLease ? BigInt(state.writeLease.sequence) + 1n : 1n
        require(sequence <= 9223372036854775807n)
        const encoded = signControllerWriteLease({ schemaVersion: 1, purpose: 'controller-write-lease', witnessId: authority.witnessId,
          ...fixedIdentity, controllerId: state.controllerId, requestId: state.requestId, epoch: state.epoch, sequence: state.sequence,
          candidateSha256: state.candidateSha256, leaseId: state.leaseId!, leaseSequence: sequence.toString(), bootId: state.bootId!,
          gateId: gate.gateId, holderKeyId: gate.holderKeyId, issuedAt: now,
          expiresAt: Math.min(now + 30000, state.authorizationExpiresAt, receipt.expiresAt, gate.expiresAt), permissions: requested.permissions }, authority.signingKey)
        const envelope = JSON.parse(encoded) as { keyId: string }
        if (state.writeLease) require(state.writeLease.gateId === gate.gateId && state.writeLease.holderKeyId === gate.holderKeyId &&
          state.writeLease.witnessId === authority.witnessId && state.writeLease.signingKeyId === envelope.keyId)
        if (state.writeLease) {
          const prior = JSON.parse(Buffer.from((JSON.parse(state.writeLease.encoded) as { payload: string }).payload, 'base64').toString()) as { permissions: ControllerLeasePermission[] }
          // Renewal can narrow scope, never escalate it. Escalation requires a
          // fresh explicitly authorized takeover and physical host attestation.
          require(requested.permissions.every(permission => prior.permissions.includes(permission)))
        }
        await save({ ...state, expiresAt: Math.min(state.authorizationExpiresAt, receipt.expiresAt), lastObservedAt: now,
          receiptSha256: createHash('sha256').update(encodedReceipt).digest('hex'), writeLease: { gateId: gate.gateId, holderKeyId: gate.holderKeyId,
            witnessId: authority.witnessId, signingKeyId: envelope.keyId, sequence: sequence.toString(), encoded } })
        return encoded
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
