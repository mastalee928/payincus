import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { constants, existsSync } from 'node:fs'
import { mkdir, open, readdir, rename, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export const BACKUP_INTERVALS = [1, 3, 6, 12, 24, 72] as const
export const BACKUP_RETENTIONS = [1, 3, 5] as const
// Regional public endpoints only. Keep this catalog explicit; no user-supplied hosts.
export const OSS_REGIONS = [
  ['cn-hangzhou', '华东1（杭州）'], ['cn-shanghai', '华东2（上海）'],
  ['cn-qingdao', '华北1（青岛）'], ['cn-beijing', '华北2（北京）'], ['cn-zhangjiakou', '华北3（张家口）'],
  ['cn-huhehaote', '华北5（呼和浩特）'], ['cn-wulanchabu', '华北6（乌兰察布）'],
  ['cn-shenzhen', '华南1（深圳）'], ['cn-heyuan', '华南2（河源）'], ['cn-guangzhou', '华南3（广州）'],
  ['cn-chengdu', '西南1（成都）'], ['cn-hongkong', '中国香港'], ['ap-northeast-1', '日本（东京）'],
  ['ap-northeast-2', '韩国（首尔）'], ['ap-southeast-1', '新加坡'], ['ap-southeast-3', '马来西亚（吉隆坡）'],
  ['ap-southeast-5', '印度尼西亚（雅加达）'], ['ap-southeast-6', '菲律宾（马尼拉）'],
  ['ap-southeast-7', '泰国（曼谷）'], ['us-west-1', '美国（硅谷）'], ['us-east-1', '美国（弗吉尼亚）'],
  ['eu-central-1', '德国（法兰克福）'], ['eu-west-1', '英国（伦敦）'], ['me-east-1', '阿联酋（迪拜）']
].map(([id, name]) => ({ id: `oss-${id}`, name }))

export class BackupError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code) }
}
export function ensure(condition: unknown, code: string, status = 400): asserts condition {
  if (!condition) throw new BackupError(code, status)
}
export function validateBucket(value: unknown): string {
  ensure(typeof value === 'string' && /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value), 'OSS_BUCKET_INVALID')
  return value
}
export function validateRegion(value: unknown): string {
  ensure(typeof value === 'string' && OSS_REGIONS.some(row => row.id === value), 'OSS_REGION_INVALID')
  return value
}
export function validatePrefix(value: unknown, allowEmpty = false): string {
  ensure(typeof value === 'string' && value.length <= 400, 'OSS_PREFIX_INVALID')
  ensure(!/[\\\x00-\x1f\x7f%]/.test(value) && !value.startsWith('/'), 'OSS_PREFIX_INVALID')
  const result = value.replace(/\/+$/, '')
  ensure((allowEmpty || result.length > 0) && (!result || result.split('/').every(p => p && p !== '.' && p !== '..')), 'OSS_PREFIX_INVALID')
  return result ? `${result}/` : ''
}
export function validateId(value: unknown): string {
  ensure(typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value), 'OSS_TASK_INVALID')
  return value
}
export function sealSecret(value: string): string {
  const secret = process.env.ENCRYPTION_KEY
  ensure(secret && secret.length >= 16, 'OSS_ENCRYPTION_KEY_REQUIRED', 503)
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), nonce)
  return Buffer.concat([nonce, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64')
}
export function openSecret(value: string): string {
  try {
    const secret = process.env.ENCRYPTION_KEY
    ensure(secret && secret.length >= 16, 'OSS_ENCRYPTION_KEY_REQUIRED', 503)
    const bytes = Buffer.from(value, 'base64')
    ensure(bytes.length >= 28 && bytes.toString('base64') === value, 'OSS_SECRET_INVALID')
    const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), bytes.subarray(0, 12))
    decipher.setAuthTag(bytes.subarray(-16))
    return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8')
  } catch { throw new BackupError('OSS_SECRET_DECRYPT_FAILED', 503) }
}
export interface BackupConfig {
  revision: string; installationId: string; enabled: boolean; region: string; bucket: string; prefix: string
  accessKeyId: string; accessKeySecret: string; backupPassword: string; intervalHours: number; retention: number
  nextRunAt: string | null; testedRevision: string | null
}
export function normalizeConfig(input: Record<string, unknown>, previous?: BackupConfig): BackupConfig {
  ensure(input && typeof input === 'object' && !Array.isArray(input), 'OSS_CONFIG_INVALID')
  ensure(Object.keys(input).every(key => ['revision', 'enabled', 'region', 'bucket', 'prefix', 'accessKeyId', 'accessKeySecret', 'backupPassword', 'intervalHours', 'retention'].includes(key)), 'OSS_CONFIG_INVALID')
  if (previous) ensure(input.revision === previous.revision, 'OSS_CONFIG_CHANGED', 409)
  ensure(typeof input.enabled === 'boolean' && BACKUP_INTERVALS.includes(input.intervalHours as never) && BACKUP_RETENTIONS.includes(input.retention as never), 'OSS_CONFIG_INVALID')
  ensure(typeof input.accessKeyId === 'string' && /^[A-Za-z0-9]{8,128}$/.test(input.accessKeyId), 'OSS_CREDENTIAL_INVALID')
  const secret = (field: 'accessKeySecret' | 'backupPassword', min: number) => {
    const v = input[field]
    if (v === undefined || v === '') {
      ensure(previous?.[field], 'OSS_CREDENTIAL_REQUIRED')
      return previous[field]
    }
    ensure(typeof v === 'string' && v.length >= min && v.length <= 256 && !/[\x00-\x1f\x7f]/.test(v), 'OSS_PASSWORD_INVALID')
    return sealSecret(v)
  }
  const next: BackupConfig = {
    revision: randomUUID(), installationId: previous?.installationId || randomUUID(), enabled: input.enabled,
    region: validateRegion(input.region), bucket: validateBucket(input.bucket), prefix: validatePrefix(input.prefix),
    accessKeyId: input.accessKeyId, accessKeySecret: secret('accessKeySecret', 8), backupPassword: secret('backupPassword', 12),
    intervalHours: input.intervalHours as number, retention: input.retention as number, nextRunAt: null, testedRevision: null
  }
  const sameTarget = previous && ['region', 'bucket', 'prefix', 'accessKeyId', 'accessKeySecret', 'backupPassword'].every(k => next[k as keyof BackupConfig] === previous[k as keyof BackupConfig])
  if (sameTarget && previous.testedRevision === previous.revision) next.testedRevision = next.revision
  ensure(!next.enabled || next.testedRevision === next.revision, 'OSS_TEST_REQUIRED', 409)
  next.nextRunAt = next.enabled ? (previous?.enabled && previous.intervalHours === next.intervalHours ? previous.nextRunAt : new Date(Date.now() + next.intervalHours * 3600000).toISOString()) : null
  return next
}
export function publicConfig(config: BackupConfig) {
  const { accessKeySecret, backupPassword, ...rest } = config
  return { ...rest, hasAccessKeySecret: Boolean(accessKeySecret), hasBackupPassword: Boolean(backupPassword) }
}
export function backupRoot(): string {
  return process.env.NODE_ENV === 'production' ? '/var/lib/incudal-backup' : resolve(process.env.PLATFORM_BACKUP_STATE_DIR || '.cache/platform-backup')
}
export const statePath = (area: 'inbox' | 'results' | 'private', name: string) => join(backupRoot(), area, name)
export function recoveryHeld(): boolean { return existsSync(join(backupRoot(), 'recovery-hold.json')) }
export function recoveryRequestAllowed(method: string, url: string): boolean {
  const path = url.split('?')[0]
  if (path.startsWith('/api/admin/aliyun-oss/')) return true
  if (method === 'GET' || method === 'HEAD') {
    return ['/api/health', '/api/auth/me', '/api/system-config/public', '/api/oauth/providers'].includes(path)
  }
  return method === 'POST' && ['/api/auth/login', '/api/auth/logout', '/api/auth/refresh', '/api/auth/check-2fa'].includes(path)
}
export async function readJson<T>(path: string, limit = 1024 * 1024): Promise<T | null> {
  let file
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const stat = await file.stat()
    ensure(stat.isFile() && stat.size <= limit, 'OSS_STATE_INVALID', 503)
    return JSON.parse(await file.readFile('utf8')) as T
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  } finally { await file?.close() }
}
export async function writeJson(path: string, value: unknown, mode = 0o600): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  const file = await open(temporary, 'wx', mode)
  try { await file.writeFile(JSON.stringify(value)); await file.sync() } finally { await file.close() }
  try { await rename(temporary, path) } finally { await unlink(temporary).catch(() => {}) }
  if (process.platform !== 'win32') {
    const directory = await open(dirname(path), 'r')
    try { await directory.sync() } finally { await directory.close() }
  }
}
export async function initBackupState(): Promise<void> {
  // Production directories and ownership must be installed by the root deployment helper.
  if (process.env.NODE_ENV !== 'production') for (const dir of ['inbox', 'results', 'private']) await mkdir(join(backupRoot(), dir), { recursive: true, mode: 0o700 })
}
export const readBackupConfig = () => readJson<BackupConfig>(statePath('inbox', 'config.json'))
export const writeBackupConfig = (config: BackupConfig) => writeJson(statePath('inbox', 'config.json'), config)
export type BackupTaskKind = 'backup' | 'preview' | 'restore' | 'resume' | 'rollback'
export interface BackupTaskRequest {
  id: string; kind: BackupTaskKind; createdAt: string; createdBy: number; config: BackupConfig
  sourcePrefix?: string; password?: string; previewId?: string; confirmation?: string
}
export interface BackupTaskResult {
  id: string; kind: BackupTaskKind; status: 'pending' | 'running' | 'success' | 'failed' | 'warning'
  createdAt: string; updatedAt: string; stage: string; error?: string
  bytes?: number; objectPrefix?: string; preview?: { version: string; createdAt: string; files: number; expiresAt: string }
}
export async function taskResults(): Promise<BackupTaskResult[]> {
  const names = await readdir(statePath('results', '')).catch((err: NodeJS.ErrnoException) => { if (err.code === 'ENOENT') return []; throw err })
  const results = await Promise.all(names.filter(n => /^[0-9a-f-]{36}\.json$/.test(n)).map(n => readJson<BackupTaskResult>(statePath('results', n))))
  return results.filter((r): r is BackupTaskResult => Boolean(r)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100)
}
let chain: Promise<unknown> = Promise.resolve()
export function serializeBackupMutation<T>(work: () => Promise<T>): Promise<T> {
  const result = chain.then(work); chain = result.catch(() => {}); return result
}
export function nextScheduledTime(previous: string, hours: number, now = Date.now()): string {
  const interval = hours * 3600000; const anchor = Date.parse(previous)
  ensure(Number.isFinite(anchor) && BACKUP_INTERVALS.includes(hours as never), 'OSS_SCHEDULE_INVALID')
  return new Date(anchor + (Math.floor(Math.max(0, now - anchor) / interval) + 1) * interval).toISOString()
}
