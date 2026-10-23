import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from 'node:crypto'
import { constants, createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, rename, stat, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ZipFile as ZipWriter } from 'yazl'
import { open as openZip, type ZipFile as ZipReader, type Entry } from 'yauzl'
import { BackupError, ensure, validateId } from './platform-backup-core.js'

const MAGIC = Buffer.from('PICBKP01')
const ZIP_MAGIC = Buffer.from('PICBKP02')
const HEADER_SIZE = 36 // magic + salt (16) + GCM nonce (12)
export const MAX_ARCHIVE_BYTES = 32 * 1024 ** 3
const MAX_MANIFEST_BYTES = 1024 * 1024
export interface BackupManifest {
  format: 1; id: string; installationId: string; createdAt: string; version: string; migrationHash: string; postgresMajor: number; databaseBytes: number
  files: Array<{ name: string; size: number; sha256: string }>
}
export interface BackupSource { name: string; path: string }
function passwordKey(password: string, salt: Buffer): Promise<Buffer> {
  ensure(password.length >= 12 && password.length <= 256, 'OSS_PASSWORD_INVALID')
  // Fixed format parameters; downloaded input cannot select an unbounded KDF cost.
  return new Promise((resolve, reject) => scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 ** 2 }, (err, key) => err ? reject(err) : resolve(key)))
}
export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path, { flags: (constants.O_RDONLY | constants.O_NOFOLLOW) as unknown as string })) hash.update(chunk)
  return hash.digest('hex')
}
export function validAssetName(name: string): boolean {
  return ['database.dump', 'database-globals.sql', 'database-integrity.json', 'runtime.env', 'backup.config', 'gateway.conf', 'management.key', 'management.pub',
    'controller/signing.pem', 'controller/identity.json', 'controller/enrollment.json'].includes(name) ||
    /^certs\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,100}\.(crt|key|pem|pub)$/.test(name) ||
    /^peers\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.json$/.test(name)
}
export function validateManifest(input: unknown): BackupManifest {
  ensure(input && typeof input === 'object', 'OSS_ARCHIVE_INVALID')
  const m = input as BackupManifest
  ensure(m.format === 1 && typeof m.version === 'string' &&
    (/^v?\d+\.\d+\.\d+(?:[-.][A-Za-z0-9.-]+)?$/.test(m.version) || /^preview-[a-f0-9]{7,40}$/.test(m.version)), 'OSS_ARCHIVE_INVALID')
  validateId(m.id); validateId(m.installationId)
  ensure(typeof m.createdAt === 'string' && Number.isFinite(Date.parse(m.createdAt)) && /^[a-f0-9]{64}$/.test(m.migrationHash) && Number.isInteger(m.postgresMajor) && m.postgresMajor >= 14 && m.postgresMajor <= 30, 'OSS_ARCHIVE_INVALID')
  ensure(Number.isSafeInteger(m.databaseBytes) && m.databaseBytes > 0 && m.databaseBytes < 1024 ** 5, 'OSS_ARCHIVE_INVALID')
  ensure(Array.isArray(m.files) && m.files.length > 1 && m.files.length <= 10000, 'OSS_ARCHIVE_INVALID')
  let size = 0; const names = new Set<string>()
  for (const file of m.files) {
    ensure(typeof file.name === 'string' && validAssetName(file.name) && !names.has(file.name), 'OSS_ARCHIVE_PATH_INVALID')
    ensure(Number.isSafeInteger(file.size) && file.size >= 0 && (file.name === 'database.dump' || file.size <= 1024 * 1024) && /^[0-9a-f]{64}$/.test(file.sha256), 'OSS_ARCHIVE_INVALID')
    names.add(file.name); size += file.size
  }
  ensure(names.has('database.dump') && names.has('runtime.env') && size <= MAX_ARCHIVE_BYTES - MAX_MANIFEST_BYTES, 'OSS_ARCHIVE_INVALID')
  return m
}
export async function encryptBackup(sources: BackupSource[], metadata: Omit<BackupManifest, 'files'>, password: string, destination: string): Promise<BackupManifest> {
  sources = [...sources].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  const files: BackupManifest['files'] = []
  for (const source of sources) {
    const info = await stat(source.path)
    ensure(info.isFile(), 'OSS_SOURCE_INVALID')
    files.push({ name: source.name, size: info.size, sha256: await hashFile(source.path) })
  }
  const manifest = validateManifest({ ...metadata, files })
  const manifestBytes = Buffer.from(JSON.stringify(manifest)); ensure(manifestBytes.length <= MAX_MANIFEST_BYTES, 'OSS_ARCHIVE_TOO_LARGE')
  ensure(files.reduce((sum, file) => sum + file.size, 4 + manifestBytes.length + HEADER_SIZE + 16) <= MAX_ARCHIVE_BYTES, 'OSS_ARCHIVE_TOO_LARGE')
  const salt = randomBytes(16), nonce = randomBytes(12), header = Buffer.concat([ZIP_MAGIC, salt, nonce])
  const key = await passwordKey(password, salt)
  const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(header)
  const zip = new ZipWriter(), streams = new Set<Readable>(), zipOutput = zip.outputStream as Readable
  zip.on('error', error => zipOutput.destroy(error))
  zip.addBuffer(manifestBytes, 'manifest.json', { compress: false, mode: 0o100600 })
  for (let i = 0; i < sources.length; i++) {
    const entry = files[i]
    zip.addReadStreamLazy(entry.name, { size: entry.size, compress: false, mode: 0o100600, mtime: new Date(manifest.createdAt) }, callback => {
      async function* contents() {
        let size = 0; const hash = createHash('sha256')
        for await (const chunk of createReadStream(sources[i].path, { flags: (constants.O_RDONLY | constants.O_NOFOLLOW) as unknown as string })) {
          size += chunk.length; ensure(size <= entry.size, 'OSS_SOURCE_CHANGED'); hash.update(chunk); yield chunk
        }
        ensure(size === entry.size && hash.digest('hex') === entry.sha256, 'OSS_SOURCE_CHANGED')
      }
      const stream = Readable.from(contents()); streams.add(stream); stream.once('close', () => streams.delete(stream)); callback(null, stream)
    })
  }
  zip.end({ forceZip64Format: true, comment: '' })
  async function* encryptedSource() {
    yield header; let bytes = HEADER_SIZE + 16
    for await (const chunk of zipOutput) { bytes += chunk.length; ensure(bytes <= MAX_ARCHIVE_BYTES, 'OSS_ARCHIVE_TOO_LARGE'); yield cipher.update(chunk) }
    yield cipher.final(); yield cipher.getAuthTag()
  }
  try {
    await pipeline(Readable.from(encryptedSource()), createWriteStream(destination, { flags: 'wx', mode: 0o600 }))
    const output = await open(destination, 'r+')
    try { await output.sync() } finally { await output.close() }
  } catch (error) { await unlink(destination).catch(() => {}); throw error }
  finally { key.fill(0); zipOutput.destroy(); for (const stream of streams) stream.destroy() }
  return manifest
}
// Nothing is extracted or restored until the entire ciphertext authenticates.
export async function decryptBackup(source: string, password: string, directory: string): Promise<{ manifest: BackupManifest; files: Map<string, string>; zipPath?: string }> {
  await mkdir(directory, { recursive: false, mode: 0o700 })
  const file = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW)
  const plaintext = join(directory, 'authenticated.bin')
  let key: Buffer | undefined, zipped = false
  try {
    const info = await file.stat(); ensure(info.isFile() && info.size > HEADER_SIZE + 16 && info.size <= MAX_ARCHIVE_BYTES, 'OSS_ARCHIVE_INVALID')
    const header = Buffer.alloc(HEADER_SIZE), tag = Buffer.alloc(16)
    await file.read(header, 0, header.length, 0); await file.read(tag, 0, 16, info.size - 16)
    zipped = header.subarray(0, 8).equals(ZIP_MAGIC)
    ensure(zipped || header.subarray(0, 8).equals(MAGIC), 'OSS_ARCHIVE_INVALID')
    key = await passwordKey(password, header.subarray(8, 24))
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(24)); decipher.setAAD(header); decipher.setAuthTag(tag)
    try {
      await pipeline(createReadStream(source, { start: HEADER_SIZE, end: info.size - 17, flags: (constants.O_RDONLY | constants.O_NOFOLLOW) as unknown as string }), decipher, createWriteStream(plaintext, { flags: 'wx', mode: 0o600 }))
    } catch { await unlink(plaintext).catch(() => {}); throw new BackupError('OSS_ARCHIVE_AUTH_FAILED') }
  } finally { key?.fill(0); await file.close() }
  if (zipped) {
    try { return await extractZipBackup(plaintext, directory) }
    finally { await unlink(plaintext).catch(() => {}) }
  }
  const input = await open(plaintext, 'r')
  try {
    const len = Buffer.alloc(4); ensure((await input.read(len, 0, 4, 0)).bytesRead === 4, 'OSS_ARCHIVE_INVALID')
    const size = len.readUInt32BE(); ensure(size > 0 && size <= MAX_MANIFEST_BYTES, 'OSS_ARCHIVE_INVALID')
    const json = Buffer.alloc(size); ensure((await input.read(json, 0, size, 4)).bytesRead === size, 'OSS_ARCHIVE_INVALID')
    const manifest = validateManifest(JSON.parse(json.toString('utf8')))
    const total = manifest.files.reduce((n, entry) => n + entry.size, 4 + size)
    ensure((await input.stat()).size === total, 'OSS_ARCHIVE_INVALID')
    let offset = 4 + size; const files = new Map<string, string>()
    for (const [index, entry] of manifest.files.entries()) {
      const destination = join(directory, `${index}.blob`)
      if (entry.size) await pipeline(createReadStream(plaintext, { start: offset, end: offset + entry.size - 1 }), createWriteStream(destination, { flags: 'wx', mode: 0o600 }))
      else { const empty = await open(destination, 'wx', 0o600); await empty.close() }
      ensure(await hashFile(destination) === entry.sha256, 'OSS_ARCHIVE_HASH_FAILED')
      files.set(entry.name, destination); offset += entry.size
    }
    return { manifest, files }
  } finally { await input.close(); await unlink(plaintext).catch(() => {}) }
}
async function extractZipBackup(path: string, directory: string): Promise<{ manifest: BackupManifest; files: Map<string, string>; zipPath: string }> {
  const zip = await new Promise<ZipReader>((resolve, reject) => openZip(path, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true }, (error, value) => error || !value ? reject(error || new BackupError('OSS_ARCHIVE_INVALID')) : resolve(value)))
  const created: string[] = []
  try {
    ensure(zip.entryCount <= 10001, 'OSS_ARCHIVE_INVALID')
    const entries = await new Promise<Map<string, Entry>>((resolve, reject) => {
      const found = new Map<string, Entry>()
      zip.on('error', reject)
      zip.on('entry', (entry: Entry) => {
        try {
          const type = (entry.externalFileAttributes >>> 16) & 0xf000
          ensure((type === 0 || type === 0x8000) && !(entry.generalPurposeBitFlag & 1) && [0, 8].includes(entry.compressionMethod), 'OSS_ARCHIVE_INVALID')
          ensure(!found.has(entry.fileName) && (entry.fileName === 'manifest.json' || validAssetName(entry.fileName)), 'OSS_ARCHIVE_PATH_INVALID')
          ensure(Number.isSafeInteger(entry.uncompressedSize) && entry.uncompressedSize >= 0 && entry.uncompressedSize <= (entry.fileName === 'database.dump' ? MAX_ARCHIVE_BYTES : MAX_MANIFEST_BYTES), 'OSS_ARCHIVE_TOO_LARGE')
          found.set(entry.fileName, entry); zip.readEntry()
        } catch (error) { reject(error) }
      })
      zip.once('end', () => resolve(found)); zip.readEntry()
    })
    const readEntry = (entry: Entry) => new Promise<import('node:stream').Readable>((resolve, reject) => zip.openReadStream(entry, (error, stream) => error || !stream ? reject(error || new BackupError('OSS_ARCHIVE_INVALID')) : resolve(stream)))
    const manifestEntry = entries.get('manifest.json'); ensure(manifestEntry, 'OSS_ARCHIVE_INVALID')
    const parts: Buffer[] = []; let size = 0
    for await (const chunk of await readEntry(manifestEntry)) { const bytes = Buffer.from(chunk); size += bytes.length; ensure(size <= MAX_MANIFEST_BYTES, 'OSS_ARCHIVE_TOO_LARGE'); parts.push(bytes) }
    const manifest = validateManifest(JSON.parse(Buffer.concat(parts).toString('utf8')))
    ensure(entries.size === manifest.files.length + 1, 'OSS_ARCHIVE_INVALID')
    const files = new Map<string, string>()
    for (const [index, file] of manifest.files.entries()) {
      const entry = entries.get(file.name); ensure(entry && entry.uncompressedSize === file.size, 'OSS_ARCHIVE_INVALID')
      const destination = join(directory, `${index}.blob`); created.push(destination)
      await pipeline(await readEntry(entry), boundedDownload(file.size), createWriteStream(destination, { flags: 'wx', mode: 0o600 }))
      ensure(await hashFile(destination) === file.sha256, 'OSS_ARCHIVE_HASH_FAILED'); files.set(file.name, destination)
    }
    const zipPath = join(directory, 'database-backup.zip'); await rename(path, zipPath)
    return { manifest, files, zipPath }
  } catch (error) {
    for (const file of created) await unlink(file).catch(() => {})
    throw error instanceof BackupError ? error : new BackupError('OSS_ARCHIVE_INVALID')
  } finally { zip.close() }
}
export function boundedDownload(max = MAX_ARCHIVE_BYTES): Transform {
  let size = 0
  return new Transform({ transform(chunk, _encoding, done) { size += chunk.length; done(size > max ? new BackupError('OSS_ARCHIVE_TOO_LARGE') : null, chunk) } })
}
export async function atomicFileCopy(source: string, destination: string): Promise<void> {
  const temp = `${destination}.restore-${randomBytes(8).toString('hex')}`
  await pipeline(createReadStream(source, { flags: (constants.O_RDONLY | constants.O_NOFOLLOW) as unknown as string }), createWriteStream(temp, { flags: 'wx', mode: 0o600 }))
  const file = await open(temp, 'r+')
  try { await file.sync() } finally { await file.close() }
  await rename(temp, destination)
  if (process.platform !== 'win32') {
    const directory = await open(dirname(destination), 'r')
    try { await directory.sync() } finally { await directory.close() }
  }
}
