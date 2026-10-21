import { createReadStream, createWriteStream, constants } from 'node:fs'
import { open, stat, unlink } from 'node:fs/promises'
import { Readable, Writable } from 'node:stream'
import { createHash } from 'node:crypto'
import { Reader, ZipReader, ZipWriter } from '@zip.js/zip.js'
import { ensure, BackupError } from './platform-backup-core.js'
import { hashFile, MAX_ARCHIVE_BYTES, type BackupSource } from './platform-backup-archive.js'

export function readableZipName(createdAt: string) {
  const date = new Date(createdAt)
  ensure(Number.isFinite(date.getTime()), 'OSS_ARCHIVE_INVALID')
  // UTC is explicit, independent of the controller's timezone.
  return `payincus-backup-${date.toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.\d{3}Z$/, '-UTC')}.zip`
}
export const validReadableZipName = (name: string) => /^payincus-backup-\d{8}-\d{6}-UTC\.zip$/.test(name)
class FileReader extends Reader<undefined> {
  constructor(private file: Awaited<ReturnType<typeof open>>, size: number) { super(undefined); this.size = size }
  async readUint8Array(offset: number, length: number) {
    const data = Buffer.alloc(length)
    const result = await this.file.read(data, 0, length, offset)
    return data.subarray(0, result.bytesRead)
  }
}
export async function createReadableZip(sources: BackupSource[], createdAt: string, password: string, destination: string) {
  ensure(password.length >= 12 && password.length <= 256, 'OSS_PASSWORD_INVALID')
  const names = new Set<string>(); let bytes = 0
  const files = []
  for (const source of [...sources].sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    ensure(!names.has(source.name) && !source.name.startsWith('/') && !source.name.split('/').some(p => !p || p === '..' || p === '.') && !/[\\\x00-\x1f]/.test(source.name), 'OSS_ARCHIVE_PATH_INVALID')
    names.add(source.name)
    const info = await stat(source.path); ensure(info.isFile(), 'OSS_SOURCE_INVALID')
    bytes += info.size; ensure(bytes <= MAX_ARCHIVE_BYTES, 'OSS_ARCHIVE_TOO_LARGE')
    files.push({ ...source, size: info.size, sha256: await hashFile(source.path) })
  }
  const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 })
  const writer = new ZipWriter(Writable.toWeb(output), { password, encryptionStrength: 3, zipCrypto: false, zip64: true, level: 0, useWebWorkers: false, lastModDate: new Date(createdAt) })
  try {
    for (const file of files) await writer.add(file.name, Readable.toWeb(createReadStream(file.path, { flags: (constants.O_RDONLY | constants.O_NOFOLLOW) as unknown as string })))
    await writer.close()
    ensure((await stat(destination)).size <= MAX_ARCHIVE_BYTES, 'OSS_ARCHIVE_TOO_LARGE')
    await verifyReadableZip(destination, password, files)
    return { name: readableZipName(createdAt), bytes: (await stat(destination)).size, sha256: await hashFile(destination) }
  } catch (error) { output.destroy(); await unlink(destination).catch(() => {}); throw error }
}
// Authenticate and hash every decrypted entry without extracting secrets to disk.
export async function verifyReadableZip(path: string, password: string, expected: Array<{ name: string; size: number; sha256: string }>) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  const reader = new ZipReader(new FileReader(file, (await file.stat()).size), { useWebWorkers: false })
  try {
    const entries = await reader.getEntries()
    ensure(entries.length === expected.length, 'OSS_READABLE_ZIP_INVALID')
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i], target = expected[i]
      ensure(!entry.directory && entry.filename === target.name && entry.encrypted && !entry.zipCrypto && entry.uncompressedSize === target.size, 'OSS_READABLE_ZIP_INVALID')
      const hash = createHash('sha256'); let size = 0
      await entry.getData(new WritableStream({ write(chunk: Uint8Array) { size += chunk.length; ensure(size <= target.size, 'OSS_ARCHIVE_TOO_LARGE'); hash.update(chunk) } }), { password, checkSignature: true })
      ensure(size === target.size && hash.digest('hex') === target.sha256, 'OSS_READABLE_ZIP_INVALID')
    }
  } catch (error) { throw error instanceof BackupError ? error : new BackupError('OSS_READABLE_ZIP_INVALID') }
  finally { await reader.close(); await file.close() }
}
