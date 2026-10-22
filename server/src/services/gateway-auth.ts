import { constants } from 'node:fs'
import { open, rename, unlink } from 'node:fs/promises'
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ControllerConfigError } from '../lib/controller-config.js'
import { acquireDiscoveryMutationLock, readDiscoveryPrivateFile, validateDiscoveryPrivateDirectory } from './controller-discovery.js'

const derive = promisify(scrypt)
export type GatewayRole = 'operator' | 'viewer'
interface User {
  username: string; role: GatewayRole; enabled: boolean; version: number
  salt: string; passwordHash: string; totpSeed: string; lastTotpStep: number; recoveryHashes: string[]
  failures: number; lockedUntil: number
}
interface State { schemaVersion: 1; users: User[]; lastObservedAt: number }
interface Session { username: string; version: number; csrf: string; expiresAt: number; elevatedUntil: number }
const queues = new Map<string, Promise<unknown>>()
const USERNAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/
const HASH = /^[a-f0-9]{64}$/
function require(condition: unknown): asserts condition { if (!condition) throw new ControllerConfigError('GATEWAY_AUTH_REJECTED') }
function hash(value: string): string { return createHash('sha256').update(value).digest('hex') }
function equal(left: string, right: string): boolean {
  const a = Buffer.from(left), b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
export function gatewayTotp(seed: string, step: number): string {
  require(/^[A-Za-z0-9+/]{27}=$/.test(seed) && Number.isSafeInteger(step) && step >= 0)
  const key = Buffer.from(seed, 'base64'); require(key.length === 20 && key.toString('base64') === seed)
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step))
  const mac = createHmac('sha1', key).update(counter).digest(), offset = mac[19] & 15
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0')
}
async function passwordHash(password: string, salt: string): Promise<string> {
  require(typeof password === 'string' && password.length >= 12 && Buffer.byteLength(password) <= 256)
  return (await derive(password, Buffer.from(salt, 'base64'), 32) as Buffer).toString('hex')
}
async function exclusiveWrite(path: string, raw: string): Promise<void> {
  const file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
  try { await file.writeFile(raw); await file.sync() } finally { await file.close() }
}
async function syncDirectory(root: string): Promise<void> {
  if (process.platform === 'win32') return
  const file = await open(root, constants.O_RDONLY | constants.O_NOFOLLOW)
  try { await file.sync() } finally { await file.close() }
}
// Only an explicit local initializer receives the independently stored MFA
// seed and recovery codes. They never appear in login/diagnostic responses.
export async function initializeGatewayAuth(root: string, input: {
  username: string; password: string; role: GatewayRole; totpSeed: string; recoveryCodes: string[]
}): Promise<void> {
  require(USERNAME.test(input.username) && ['operator', 'viewer'].includes(input.role) && input.recoveryCodes.length >= 4 && input.recoveryCodes.length <= 16)
  require(input.recoveryCodes.every(code => /^[A-Za-z0-9_-]{24,64}$/.test(code)) && new Set(input.recoveryCodes).size === input.recoveryCodes.length)
  gatewayTotp(input.totpSeed, 0)
  await validateDiscoveryPrivateDirectory(root)
  const salt = randomBytes(16).toString('base64'), now = Date.now()
  const user: User = { username: input.username, role: input.role, enabled: true, version: 1, salt,
    passwordHash: await passwordHash(input.password, salt), totpSeed: input.totpSeed, lastTotpStep: 0,
    recoveryHashes: input.recoveryCodes.map(hash), failures: 0, lockedUntil: 0 }
  // O_EXCL refuses repeated initialization, including damaged/empty state.
  await exclusiveWrite(join(root, 'gateway-auth.json'), JSON.stringify({ schemaVersion: 1, users: [user], lastObservedAt: now }))
  await syncDirectory(root)
}

export async function createGatewayAuth(root: string) {
  await validateDiscoveryPrivateDirectory(root)
  const path = join(root, 'gateway-auth.json'), sessions = new Map<string, Session>()
  let highestObservedAt = 0
  const read = async (): Promise<State> => {
    const raw = await readDiscoveryPrivateFile(path, 65536), state = JSON.parse(raw) as State
    require(raw === JSON.stringify(state) && state && Object.keys(state).length === 3 && state.schemaVersion === 1 &&
      Number.isSafeInteger(state.lastObservedAt) && state.lastObservedAt > 0 && Array.isArray(state.users) && state.users.length > 0 && state.users.length <= 16)
    const names = new Set<string>()
    for (const user of state.users) {
      const fields = ['username','role','enabled','version','salt','passwordHash','totpSeed','lastTotpStep','recoveryHashes','failures','lockedUntil']
      require(user && Object.keys(user).length === fields.length && fields.every(field => Object.hasOwn(user,field)) && USERNAME.test(user.username) && !names.has(user.username) && ['operator', 'viewer'].includes(user.role) &&
        typeof user.enabled === 'boolean' && Number.isSafeInteger(user.version) && user.version > 0 && /^[A-Za-z0-9+/]{22}==$/.test(user.salt) &&
        HASH.test(user.passwordHash) && Number.isSafeInteger(user.lastTotpStep) && user.lastTotpStep >= 0 && Array.isArray(user.recoveryHashes) &&
        user.recoveryHashes.length <= 16 && user.recoveryHashes.every(value => HASH.test(value)) && Number.isSafeInteger(user.failures) && user.failures >= 0 &&
        Number.isSafeInteger(user.lockedUntil) && user.lockedUntil >= 0)
      gatewayTotp(user.totpSeed, 0); names.add(user.username)
    }
    return state
  }
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
  const save = async (state: State) => {
    const temporary = join(root, '.auth-' + randomBytes(16).toString('hex'))
    try { await exclusiveWrite(temporary, JSON.stringify(state)); await rename(temporary, path); await syncDirectory(root) }
    finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }) }
  }
  const clock = (state: State) => {
    const now = Date.now(), minimum = Math.max(state.lastObservedAt, highestObservedAt)
    require(now + 5000 >= minimum)
    highestObservedAt = Math.max(now, minimum)
    return highestObservedAt
  }
  const credentials = async (state: State, input: { username: string; password: string; totp?: string; recoveryCode?: string }): Promise<User> => {
    const now = clock(state), user = state.users.find(user => user.username === input.username)
    // Unknown users take the same password cost, but never create disk records.
    const salt = user?.salt || Buffer.alloc(16).toString('base64')
    let checked: string
    let validPassword = true
    try { checked = await passwordHash(input.password, salt) } catch { validPassword = false; checked = await passwordHash('invalid-password-placeholder', salt) }
    let step = -1, recovery = -1
    if (user && input.totp && /^[0-9]{6}$/.test(input.totp)) {
      const current = Math.floor(now / 30000)
      for (const candidate of [current - 1, current, current + 1]) {
        if (candidate > user.lastTotpStep && equal(gatewayTotp(user.totpSeed, candidate), input.totp)) step = candidate
      }
    }
    if (user && input.recoveryCode && /^[A-Za-z0-9_-]{24,64}$/.test(input.recoveryCode)) recovery = user.recoveryHashes.findIndex(value => equal(value, hash(input.recoveryCode!)))
    const accepted = user?.enabled && validPassword && now >= user.lockedUntil && equal(checked, user.passwordHash) &&
      ((step >= 0 && !input.recoveryCode) || (recovery >= 0 && !input.totp))
    if (!accepted) {
      if (user) { user.failures++; if (user.failures >= 5) user.lockedUntil = Math.max(user.lockedUntil, now + 900000) }
      await save({ ...state, lastObservedAt: now }); throw new ControllerConfigError('GATEWAY_AUTH_REJECTED')
    }
    user!.failures = 0; user!.lockedUntil = 0
    if (step >= 0) user!.lastTotpStep = step
    if (recovery >= 0) user!.recoveryHashes.splice(recovery, 1)
    await save({ ...state, lastObservedAt: now })
    return user!
  }
  return {
    async login(input: { username: string; password: string; totp?: string; recoveryCode?: string }) {
      require(input && typeof input === 'object' && USERNAME.test(input.username) &&
        Object.keys(input).every(key => ['username', 'password', 'totp', 'recoveryCode'].includes(key)))
      const requested = { ...input }
      return serialized(async () => {
        const state = await read(), now = clock(state)
        for (const [id, session] of sessions) if (session.expiresAt <= now) sessions.delete(id)
        require(sessions.size < 128)
        const user = await credentials(state, requested), token = randomBytes(32).toString('base64url'), csrf = randomBytes(24).toString('base64url')
        sessions.set(hash(token), { username: user.username, version: user.version, csrf, expiresAt: now + 3600000, elevatedUntil: 0 })
        return { token, csrf, username: user.username, role: user.role }
      })
    },
    async session(token: string, csrf?: string, requireOperator = false, requireElevation = false) {
      return serialized(async () => {
        require(typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token))
        const state = await read(), now = clock(state), session = sessions.get(hash(token))
        const user = session && state.users.find(user => user.username === session.username)
        require(session && user?.enabled && user.version === session.version && now < session.expiresAt)
        if (csrf !== undefined) require(equal(csrf, session.csrf))
        if (requireOperator) require(user.role === 'operator')
        if (requireElevation) require(now < session.elevatedUntil)
        return { username: user.username, role: user.role, csrf: session.csrf }
      })
    },
    async reauthenticate(token: string, csrf: string, input: { password: string; totp?: string; recoveryCode?: string }) {
      require(typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) && typeof csrf === 'string')
      require(input && typeof input === 'object' && Object.keys(input).every(key => ['password', 'totp', 'recoveryCode'].includes(key)))
      const requested = { ...input }
      return serialized(async () => {
        const state = await read(), now = clock(state), session = sessions.get(hash(token))
        const user = session && state.users.find(user => user.username === session.username)
        require(session && user?.enabled && session.version === user.version && now < session.expiresAt && equal(csrf, session.csrf))
        await credentials(state, { username: session.username, ...requested })
        session.elevatedUntil = now + 120000
      })
    },
    logout(token: string) { sessions.delete(hash(token)) },
    async revokeUser(username: string) {
      return serialized(async () => {
        const state = await read(), user = state.users.find(user => user.username === username); require(user)
        user.version++; await save({ ...state, lastObservedAt: clock(state) })
        for (const [id, session] of sessions) if (session.username === username) sessions.delete(id)
      })
    }
  }
}
