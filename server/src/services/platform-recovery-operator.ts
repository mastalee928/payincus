// Recovery login is anchored in B's authenticated operator, outside A's dump.
// @ts-ignore -- bcryptjs 2 follows the existing auth module import.
import bcrypt from 'bcryptjs'
import { authenticator } from 'otplib'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { backupRoot, ensure, readJson, recoveryHeld, serializeBackupMutation, statePath, writeJson } from './platform-backup-core.js'
import { decryptGatewayTaskSecret } from './gateway-admin-authorization.js'
import { pgQuery, pgRecoveryTransaction } from './platform-backup-database.js'

interface RecoveryOperator {
  batchId: string; originalId: number; actorId: number; username: string; passwordHash: string
  mfa: string | null; synthetic: boolean
}
const path = () => join(backupRoot(), 'recovery-operator.json')
function mfaKey() {
  ensure(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16, 'OSS_RECOVERY_OPERATOR_KEY_REQUIRED', 503)
  return createHash('sha256').update('recovery-operator:').update(process.env.JWT_SECRET).digest()
}
function protect(value: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', mfaKey(), iv)
  const bytes = Buffer.concat([cipher.update(value), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64')
}
function unprotect(value: string) {
  const bytes = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', mfaKey(), bytes.subarray(0, 12))
  cipher.setAuthTag(bytes.subarray(12, 28))
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')
}
export async function captureRecoveryOperator(actorId: number, batchId: string) {
  if (actorId === 0) {
    // Root CLI has no Web actor. Resolve only one explicitly allowed B account;
    // never infer recovery authority from users imported from A.
    const raw = process.env.PLATFORM_BACKUP_ALLOWED_ADMIN_IDS?.trim()
    const candidates = await pgQuery<{ id: number }>(raw
      ? "SELECT id FROM users WHERE role='admin' AND status='active' AND id=ANY($1::int[])"
      : "SELECT id FROM users WHERE role='admin' AND status='active' AND username='admin'", raw ? [raw.split(',').map(Number)] : [])
    ensure(candidates.length === 1, 'OSS_RECOVERY_OPERATOR_REQUIRED', 403)
    actorId = candidates[0].id
  }
  const [user] = await pgQuery<{ id: number; username: string; password_hash: string; two_factor_enabled: boolean; two_factor_secret: string | null }>(
    "SELECT id, username, password_hash, two_factor_enabled, two_factor_secret FROM users WHERE id=$1 AND role='admin' AND status='active'", [actorId])
  const allowed = process.env.PLATFORM_BACKUP_ALLOWED_ADMIN_IDS?.trim() ? process.env.PLATFORM_BACKUP_ALLOWED_ADMIN_IDS.split(',').map(Number) : undefined
  ensure(user && (allowed ? allowed.includes(user.id) : user.username === 'admin'), 'OSS_RECOVERY_OPERATOR_REQUIRED', 403)
  ensure(!user.two_factor_enabled || user.two_factor_secret, 'OSS_RECOVERY_OPERATOR_REQUIRED', 403)
  await writeJson(path(), { batchId, originalId: actorId, actorId, username: user.username, passwordHash: user.password_hash,
    mfa: user.two_factor_enabled ? protect(decryptGatewayTaskSecret(user.two_factor_secret!)) : null, synthetic: false } satisfies RecoveryOperator, 0o640)
}
export async function installRecoveryOperator(batchId: string, holdTaskId: string, mode: 'restore' | 'rollback', database?: string) {
  const operator = await readJson<RecoveryOperator>(path()); ensure(operator, 'OSS_RECOVERY_OPERATOR_REQUIRED', 403)
  const installed = await pgRecoveryTransaction(async query => {
  // Serialize retries, including an interrupted insert before its file receipt.
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`recovery-operator:${batchId}`])
  let actorId = operator.originalId
  const [existing] = await query<{ operator_id: number; mode: string; hold_task_id: string }>('SELECT operator_id,mode,hold_task_id FROM platform_recovery_batches WHERE id=$1', [batchId])
  if (existing) {
    ensure(existing.mode === mode && existing.hold_task_id === holdTaskId, 'OSS_RECOVERY_CONTEXT_CHANGED', 409)
    return existing.operator_id
  }
  if (mode === 'restore') {
    // Never overwrite A's user having the same numeric ID or username as B.
    const [row] = await query<{ id: number }>(`INSERT INTO users (username,password_hash,role,status,updated_at)
      VALUES ($1,$2,'admin','active',NOW()) RETURNING id`, [`recovery-${batchId}`, await bcrypt.hash(randomBytes(32).toString('hex'), 12)])
    actorId = row.id
  }
  await query(`INSERT INTO platform_recovery_batches(id,hold_task_id,mode,operator_id) VALUES($1,$2,$3,$4)`, [batchId, holdTaskId, mode, actorId])
  return actorId
  }, database)
  await writeJson(path(), { ...operator, batchId, actorId: installed, synthetic: mode === 'restore' }, 0o640)
  return installed
}
export async function recoveryOperator() {
  ensure(recoveryHeld(), 'OSS_RECOVERY_NOT_HELD', 409)
  const [hold, operator] = await Promise.all([readJson<{ batchId?: string }>(join(backupRoot(), 'recovery-hold.json')), readJson<RecoveryOperator>(path())])
  ensure(operator && hold?.batchId === operator.batchId, 'OSS_RECOVERY_OPERATOR_REQUIRED', 403)
  return operator
}
export async function recoveryOperatorPayload() {
  const operator = await recoveryOperator()
  return { id: operator.actorId, username: operator.username, role: 'admin' as const, status: 'active', balance: 0, recoveryOperator: true }
}
export async function validateRecoverySession(user: { id?: number; sid?: string }) {
  if (!recoveryHeld()) return !user.sid?.startsWith('recovery:')
  const operator = await recoveryOperator()
  return user.id === operator.actorId && user.sid?.startsWith(`recovery:${operator.batchId}:`) === true
}
export async function authenticateRecoveryOperator(username: string, password: string, totpCode?: string) {
  return serializeBackupMutation(async () => {
    const operator = await recoveryOperator(), now = Date.now()
    const attemptPath = statePath('inbox', `operator-${operator.batchId}.json`)
    const saved = await readJson<{ count: number; until: number; step?: number }>(attemptPath)
    const state = saved && saved.until > now ? saved : { count: 0, until: now + 300000, step: saved?.step }
    ensure(state.count < 8, 'OSS_RECOVERY_LOGIN_LOCKED', 429)
    state.count++; await writeJson(attemptPath, state)
    ensure(username === operator.username && typeof password === 'string' && password.length <= 256 && await bcrypt.compare(password, operator.passwordHash), 'OSS_RECOVERY_CREDENTIALS_INVALID', 401)
    if (operator.mfa) {
      const verifier = authenticator.clone({ digits: 6, step: 30, window: 1, epoch: now })
      const delta = totpCode && /^\d{6}$/.test(totpCode) ? verifier.checkDelta(totpCode, unprotect(operator.mfa)) : null
      ensure(delta !== null && delta !== undefined, 'OSS_RECOVERY_MFA_REQUIRED', 401)
      const step = Math.floor(now / 30000) + delta
      ensure(state.step === undefined || step > state.step, 'OSS_RECOVERY_MFA_REPLAYED', 401)
      state.step = step
    }
    state.count = 0; await writeJson(attemptPath, state)
    return { ...(await recoveryOperatorPayload()), sid: `recovery:${operator.batchId}:${randomUUID()}` }
  })
}
// Caller already holds serializeBackupMutation. Reauthentication must not nest it.
export async function reauthenticateRecoveryOperator(actorId: number, input: { password: string; totpCode?: string }) {
  const operator = await recoveryOperator()
  const attemptPath = statePath('inbox', `operator-${operator.batchId}.json`), now = Date.now()
  const prior = await readJson<{ count: number; until: number; step?: number }>(attemptPath)
  const attempt = prior && prior.until > now ? prior : { count: 0, until: now + 300000, step: prior?.step }
  ensure(attempt.count < 8, 'OSS_RECOVERY_LOGIN_LOCKED', 429)
  attempt.count++; await writeJson(attemptPath, attempt)
  ensure(operator.actorId === actorId && typeof input.password === 'string' && input.password.length <= 256 && await bcrypt.compare(input.password, operator.passwordHash), 'OSS_RECOVERY_CREDENTIALS_INVALID', 403)
  if (operator.mfa) {
    const verifier = authenticator.clone({ digits: 6, step: 30, window: 1, epoch: now })
    const delta = input.totpCode && /^\d{6}$/.test(input.totpCode) ? verifier.checkDelta(input.totpCode, unprotect(operator.mfa)) : null
    ensure(delta !== null && delta !== undefined, 'OSS_RECOVERY_MFA_REQUIRED', 403)
    const saved = attempt
    const step = Math.floor(now / 30000) + delta
    ensure(saved?.step === undefined || step > saved.step, 'OSS_RECOVERY_MFA_REPLAYED', 403)
    attempt.step = step
  }
  attempt.count = 0; await writeJson(attemptPath, attempt)
}
