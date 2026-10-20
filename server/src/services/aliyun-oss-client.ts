import OSS from 'ali-oss'
import { Agent } from 'node:https'
import type { LookupFunction } from 'node:net'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { resolvePublicHostname } from '../lib/outbound-security.js'
import { BackupError, ensure, openSecret, validateBucket, validateId, validatePrefix, validateRegion, type BackupConfig } from './platform-backup-core.js'
import { boundedDownload, hashFile, MAX_ARCHIVE_BYTES } from './platform-backup-archive.js'

type NativeOss = OSS & {
  getBucketVersioning(name: string): Promise<{ versionStatus?: string }>
  getBucketWorm(name: string): Promise<unknown>
}
export interface BackupIndex {
  format: 1; id: string; installationId: string; createdAt: string; version: string; bytes: number; sha256: string
}
export interface RemoteBackup extends BackupIndex { prefix: string }
const noConfig = (error: unknown, code: string) => (error as { code?: string }).code === code || (error as { name?: string }).name === `${code}Error`
export function sanitizedOssError(error: unknown): BackupError {
  if (error instanceof BackupError) return error
  const code = String((error as { code?: string }).code || '').replace(/Error$/, '')
  const allowed = ['AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch', 'BucketNotEmpty', 'BucketAlreadyExists', 'NoSuchBucket', 'NoSuchKey', 'RequestTimeTooSkewed', 'TooManyBuckets']
  return new BackupError(allowed.includes(code) ? `OSS_${code}` : 'OSS_OPERATION_FAILED', 502)
}
export class AliyunOssClient {
  readonly client: NativeOss
  readonly agent: Agent
  readonly bucket: string
  constructor(config: Pick<BackupConfig, 'region' | 'bucket' | 'accessKeyId' | 'accessKeySecret'>) {
    const region = validateRegion(config.region); this.bucket = validateBucket(config.bucket)
    const host = `${region}.aliyuncs.com`
    const lookup: LookupFunction = (hostname, options, callback) => {
      if (hostname !== host && hostname !== `${this.bucket}.${host}`) { callback(new Error('OSS_ENDPOINT_REJECTED'), '', 4); return }
      resolvePublicHostname(hostname).then(records => {
        const selected = records.find(r => !options.family || r.family === options.family) || records[0]
        if ((options as { all?: boolean }).all) (callback as Function)(null, records)
        else callback(null, selected.address, selected.family)
      }).catch(() => callback(new Error('OSS_DNS_REJECTED'), '', 4))
    }
    this.agent = new Agent({ keepAlive: true, maxSockets: 4, lookup })
    this.client = new OSS({ region, endpoint: `https://${host}`, bucket: this.bucket,
      accessKeyId: config.accessKeyId, accessKeySecret: openSecret(config.accessKeySecret),
      authorizationV4: true, secure: true, timeout: 60000, httpsAgent: this.agent
    } as OSS.Options & { httpsAgent: Agent }) as NativeOss
  }
  close() { this.agent.destroy() }
  async listBuckets(marker?: string) {
    ensure(!marker || marker.length <= 200, 'OSS_CURSOR_INVALID')
    const result = await this.client.listBuckets({ 'max-keys': 100, ...(marker ? { marker } : {}) }) as unknown as { buckets: OSS.Bucket[]; isTruncated?: boolean; nextMarker?: string }
    return { buckets: (result.buckets || []).map(b => ({ name: b.name, region: b.region, creationDate: b.creationDate })), nextCursor: result.isTruncated ? result.nextMarker : null }
  }
  async listObjects(prefix: string, cursor?: string) {
    prefix = validatePrefix(prefix, true); ensure(!cursor || cursor.length <= 4096, 'OSS_CURSOR_INVALID')
    const result = await this.client.listV2({ prefix, delimiter: '/', 'max-keys': 100, ...(cursor ? { 'continuation-token': cursor } : {}) })
    return { directories: result.prefixes || [], objects: (result.objects || []).map(o => ({ name: o.name, size: o.size, lastModified: o.lastModified })), nextCursor: result.isTruncated ? result.nextContinuationToken : null }
  }
  async assertBackupBucket(region: string) {
    const location = await this.client.getBucketLocation(this.bucket)
    ensure(location.location === region, 'OSS_REGION_MISMATCH')
    const acl = await this.client.getBucketACL(this.bucket)
    ensure(acl.acl === 'private', 'OSS_PRIVATE_BUCKET_REQUIRED')
    const version = await this.client.getBucketVersioning(this.bucket)
    ensure(!version.versionStatus, 'OSS_VERSIONING_UNSUPPORTED')
    try { await this.client.getBucketWorm(this.bucket); throw new BackupError('OSS_WORM_UNSUPPORTED') }
    catch (error) { if (!noConfig(error, 'NoSuchWORMConfiguration')) throw error }
    try {
      const lifecycle = await this.client.getBucketLifecycle(this.bucket)
      ensure(!lifecycle.rules?.some((rule: { status?: string }) => rule.status === 'Enabled'), 'OSS_LIFECYCLE_UNSUPPORTED')
    } catch (error) { if (!noConfig(error, 'NoSuchLifecycle')) throw error }
  }
  async test(config: BackupConfig) {
    await this.assertBackupBucket(config.region)
    const key = `${config.prefix}${config.installationId}/.probe-${randomUUID()}`
    const payload = Buffer.from(randomUUID())
    try {
      await this.client.put(key, payload, { headers: { 'x-oss-forbid-overwrite': 'true' } })
      const downloaded = await this.readSmall(key)
      ensure(downloaded.equals(payload), 'OSS_VERIFY_FAILED')
    } finally { await this.client.delete(key) }
  }
  async readSmall(key: string): Promise<Buffer> {
    const response = await this.client.getStream(key)
    let length = 0; const parts: Buffer[] = []
    try {
      for await (const chunk of response.stream) { const bytes = Buffer.from(chunk); length += bytes.length; ensure(length <= 65536, 'OSS_INDEX_INVALID'); parts.push(bytes) }
    } finally { response.stream.destroy() }
    return Buffer.concat(parts)
  }
  async index(prefix: string): Promise<RemoteBackup> {
    prefix = validatePrefix(prefix)
    const parsed = JSON.parse((await this.readSmall(`${prefix}complete.json`)).toString('utf8')) as BackupIndex
    validateId(parsed.id); validateId(parsed.installationId)
    ensure(parsed.format === 1 && prefix.endsWith(`/${parsed.installationId}/${parsed.id}/`) && /^[a-f0-9]{64}$/.test(parsed.sha256) && Number.isSafeInteger(parsed.bytes) && parsed.bytes > 0 && parsed.bytes <= MAX_ARCHIVE_BYTES && typeof parsed.createdAt === 'string' && Number.isFinite(Date.parse(parsed.createdAt)) && typeof parsed.version === 'string' && parsed.version.length <= 64, 'OSS_INDEX_INVALID')
    return { ...parsed, prefix }
  }
  async backups(prefix: string): Promise<RemoteBackup[]> {
    prefix = validatePrefix(prefix); const backups: RemoteBackup[] = []; let cursor: string | undefined; const seen = new Set<string>()
    for (let page = 0; page < 100; page++) {
      const result = await this.client.listV2({ prefix, 'max-keys': 100, ...(cursor ? { 'continuation-token': cursor } : {}) })
      for (const object of result.objects || []) if (object.name.endsWith('/complete.json')) backups.push(await this.index(object.name.slice(0, -'complete.json'.length)))
      if (!result.isTruncated) return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      cursor = result.nextContinuationToken; ensure(cursor && !seen.has(cursor), 'OSS_CURSOR_INVALID'); seen.add(cursor)
    }
    throw new BackupError('OSS_LIST_LIMIT', 409)
  }
  async download(backup: RemoteBackup, destination: string) {
    const response = await this.client.getStream(`${backup.prefix}payload.enc`)
    await pipeline(response.stream, boundedDownload(backup.bytes), createWriteStream(destination, { flags: 'wx', mode: 0o600 }))
    ensure(await hashFile(destination) === backup.sha256, 'OSS_VERIFY_FAILED')
  }
  async upload(config: BackupConfig, file: string, metadata: BackupIndex, verificationPath: string, onCheckpoint?: (checkpoint: OSS.Checkpoint) => Promise<void>) {
    const prefix = `${config.prefix}${config.installationId}/${metadata.id}/`
    let checkpoint: OSS.Checkpoint | undefined
    try {
      await this.client.multipartUpload(`${prefix}payload.enc`, file, { parallel: 2, partSize: 8 * 1024 ** 2,
        headers: { 'x-oss-forbid-overwrite': 'true' }, progress: async (_p, next) => {
          // ali-oss reports completion with null (multipart) or no checkpoint
          // (small-object PUT). Keep the last real checkpoint for failure cleanup.
          if (next) { checkpoint = next; await onCheckpoint?.(next) }
        } })
      // Read back the ciphertext: neither an ETag nor our own metadata proves remote content.
      await this.download({ ...metadata, prefix }, verificationPath)
      await this.client.put(`${prefix}complete.json`, Buffer.from(JSON.stringify(metadata)), { headers: { 'x-oss-forbid-overwrite': 'true' } })
      return prefix
    } catch (error) {
      if (checkpoint) await this.client.abortMultipartUpload(checkpoint.name, checkpoint.uploadId).catch(() => {})
      throw error
    }
  }
  async retain(config: BackupConfig, pinned: Set<string>) {
    await this.assertBackupBucket(config.region)
    const root = `${config.prefix}${config.installationId}/`
    const candidates = await this.backups(root)
    // A tombstone survives a partial delete so the next successful backup can
    // retry orphan cleanup without advertising the set as recoverable.
    let cursor: string | undefined
    const pending: string[] = []
    const seen = new Set<string>()
    for (let page = 0; page < 100; page++) {
      const result = await this.client.listV2({ prefix: root, 'max-keys': 100, ...(cursor ? { 'continuation-token': cursor } : {}) })
      for (const object of result.objects || []) if (object.name.endsWith('/deleting.json')) {
        const prefix = object.name.slice(0, -'deleting.json'.length)
        const id = prefix.slice(root.length).replace(/\/$/, '')
        validateId(id)
        ensure(prefix === `${root}${id}/`, 'OSS_DELETE_SCOPE_INVALID')
        const marker = JSON.parse((await this.readSmall(object.name)).toString('utf8')) as { id: string; installationId: string }
        ensure(marker.id === id && marker.installationId === config.installationId, 'OSS_DELETE_SCOPE_INVALID')
        if (!pinned.has(prefix)) pending.push(prefix)
      }
      if (!result.isTruncated) break
      cursor = result.nextContinuationToken; ensure(cursor && !seen.has(cursor) && page < 99, 'OSS_LIST_LIMIT'); seen.add(cursor)
    }
    const removeSet = async (prefix: string) => {
      await this.client.delete(`${prefix}complete.json`)
      await this.client.delete(`${prefix}payload.enc`)
      await this.client.delete(`${prefix}deleting.json`)
    }
    for (const prefix of pending) await removeSet(prefix)
    for (const backup of candidates.slice(config.retention)) {
      ensure(backup.installationId === config.installationId && backup.prefix.startsWith(root), 'OSS_DELETE_SCOPE_INVALID')
      if (pinned.has(backup.prefix)) continue
      await this.client.put(`${backup.prefix}deleting.json`, Buffer.from(JSON.stringify({ id: backup.id, installationId: backup.installationId })))
      await removeSet(backup.prefix)
    }
  }
}
