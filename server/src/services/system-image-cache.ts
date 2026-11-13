import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, open, readFile, rename, rm, writeFile, statfs } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ownerSelectedContainerImage } from '../lib/owner-selected-images.js'

export type CachedImagePart = { file: string; sha256: string; size: number; url?: string }
export type CachedSystemImage = { version: 1; alias: string; architecture: 'x86_64' | 'aarch64'; type: 'container' | 'vm';
  fingerprint: string; parts: CachedImagePart[]; sourceSha256?: string; preparationRevision?: string }
const exec = promisify(execFile)
const inFlight = new Map<string, Promise<CachedSystemImage>>()
const downloading = new Map<string, Promise<string>>()
const root = () => resolve(process.env.SYSTEM_IMAGE_CACHE_DIR || '/var/lib/incudal-images')
const imageKey = (alias: string, architecture: string, type: string) => createHash('sha256').update(JSON.stringify([alias, architecture, type])).digest('hex')
const templates = fileURLToPath(new URL('../../templates/', import.meta.url))
const validHash = (hash: unknown): hash is string => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)
export async function hashImageFile(file: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
async function initializeRoot() {
  if (process.env.NODE_ENV === 'production' && root() !== '/var/lib/incudal-images') throw Error('SYSTEM_IMAGE_CACHE_DIRECTORY_INVALID')
  await mkdir(root(), { recursive: true, mode: 0o750 })
  const info = await lstat(root())
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error('SYSTEM_IMAGE_CACHE_DIRECTORY_INVALID')
}
async function download(url: string, sha256: string, size: number, signal?: AbortSignal): Promise<string> {
  const key = root() + ':' + sha256
  let pending = downloading.get(key)
  if (!pending) {
    pending = downloadPart(url, sha256, size, signal)
    downloading.set(key, pending)
    pending.finally(() => downloading.delete(key)).catch(() => {})
  }
  return pending
}
async function downloadPart(url: string, sha256: string, size: number, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  if (!validHash(sha256) || !Number.isSafeInteger(size) || size <= 0 || size > 4 * 1024 ** 3) throw Error('SYSTEM_IMAGE_SOURCE_INVALID')
  const target = join(root(), sha256 + '.image')
  try {
    const info = await lstat(target)
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw Error('SYSTEM_IMAGE_CACHE_FILE_INVALID')
    if (info.isFile() && !info.isSymbolicLink() && info.size === size && await hashImageFile(target) === sha256) return target
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const temporary = target + '.' + randomUUID() + '.download'
  const space = await statfs(root())
  if (space.bavail * space.bsize < size + 512 * 1024 ** 2) throw Error('SYSTEM_IMAGE_CACHE_DISK_LOW')
  const descriptor = await open(temporary, 'wx', 0o640)
  try {
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(300000)]) : AbortSignal.timeout(300000) })
    if (!response.ok || !response.body) throw Error('SYSTEM_IMAGE_DOWNLOAD_FAILED')
    let received = 0
    for await (const chunk of response.body) {
      received += chunk.length
      if (received > size) throw Error('SYSTEM_IMAGE_SIZE_MISMATCH')
      let offset = 0
      while (offset < chunk.length) {
        const written = await descriptor.write(chunk, offset, chunk.length - offset)
        if (!written.bytesWritten) throw Error('SYSTEM_IMAGE_CACHE_WRITE_FAILED')
        offset += written.bytesWritten
      }
    }
    await descriptor.sync(); await descriptor.close()
    if (received !== size || await hashImageFile(temporary) !== sha256) throw Error('SYSTEM_IMAGE_HASH_MISMATCH')
    await rename(temporary, target)
    return target
  } catch (error) { await descriptor.close().catch(() => {}); await rm(temporary, { force: true }); throw error }
}
async function save(key: string, image: CachedSystemImage) {
  const temporary = join(root(), key + '.' + randomUUID() + '.json')
  try {
    await writeFile(temporary, JSON.stringify(image), { mode: 0o640, flag: 'wx' })
    await rename(temporary, join(root(), key + '.json'))
  } finally { await rm(temporary, { force: true }) }
}
function validateReceipt(image: CachedSystemImage, alias: string, architecture: string, type: string) {
  if (image.version !== 1 || image.alias !== alias || image.architecture !== architecture || image.type !== type ||
      !validHash(image.fingerprint) || !Array.isArray(image.parts) || ![1, 2].includes(image.parts.length) || image.parts.some(part =>
      part.file !== part.sha256 + '.image' || !validHash(part.sha256) || !Number.isSafeInteger(part.size) || part.size <= 0 || part.size > 4 * 1024 ** 3)) throw Error('SYSTEM_IMAGE_RECEIPT_INVALID')
}
export async function imagePartPath(part: CachedImagePart): Promise<string> {
  if (part.file !== part.sha256 + '.image' || !validHash(part.sha256)) throw Error('SYSTEM_IMAGE_PART_INVALID')
  return join(root(), part.file)
}
async function verifyParts(image: CachedSystemImage) {
  const combined = createHash('sha256')
  for (const part of image.parts) {
    const path = await imagePartPath(part)
    let info
    try { info = await lstat(path) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
    if (!info.isFile() || info.isSymbolicLink() || info.size !== part.size || await hashImageFile(path) !== part.sha256) return false
    for await (const chunk of createReadStream(path)) combined.update(chunk)
  }
  return combined.digest('hex') === image.fingerprint
}
let catalog: { at: number; data: any } | undefined
async function officialCatalog(signal?: AbortSignal) {
  if (catalog && Date.now() - catalog.at < 15 * 60000) return catalog.data
  const response = await fetch('https://images.linuxcontainers.org/streams/v1/images.json', { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000), redirect: 'error' })
  if (!response.ok || !response.body) throw Error('SYSTEM_IMAGE_CATALOG_UNAVAILABLE')
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of response.body) { size += chunk.length; if (size > 16 * 1024 ** 2) throw Error('SYSTEM_IMAGE_CATALOG_TOO_LARGE'); chunks.push(Buffer.from(chunk)) }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!data?.products || typeof data.products !== 'object' || Array.isArray(data.products)) throw Error('SYSTEM_IMAGE_CATALOG_INVALID')
  catalog = { at: Date.now(), data }; return data
}
async function ownerImage(alias: string, architecture: 'x86_64' | 'aarch64', type: 'container' | 'vm', key: string, signal?: AbortSignal): Promise<CachedSystemImage> {
  const image = ownerSelectedContainerImage(alias, architecture)
  if (!image || type !== 'container') throw Error('SYSTEM_IMAGE_CONTAINER_REQUIRED')
  const source = await download(`https://github.com/xkatld/zjmf-lxd-server/releases/download/images/debian11-${image.archiveArchitecture}.tar.gz`, image.sha256, image.size, signal)
  const converter = join(templates, 'prepare-owner-debian11-image.py')
  const revision = createHash('sha256').update(await readFile(converter)).update(await readFile(join(templates, 'owner-debian11-bootstrap.sh'))).digest('hex')
  const temporary = join(root(), key + '.' + randomUUID() + '.build')
  const space = await statfs(root())
  if (space.bavail * space.bsize < image.size + 512 * 1024 ** 2) throw Error('SYSTEM_IMAGE_CACHE_DISK_LOW')
  try {
    const result = await exec(process.platform === 'win32' ? 'python' : 'python3', [converter, source, temporary, image.archiveArchitecture], { timeout: 180000, maxBuffer: 8192, signal })
    const metadata = JSON.parse(result.stdout)
    if (metadata.architecture !== architecture || metadata.sourceSha256 !== image.sha256 || !validHash(metadata.sha256) || await hashImageFile(temporary) !== metadata.sha256) throw Error('SYSTEM_IMAGE_PREPARATION_UNVERIFIED')
    await rename(temporary, join(root(), metadata.sha256 + '.image'))
    return { version: 1, alias, architecture, type, fingerprint: metadata.sha256, parts: [{ file: metadata.sha256 + '.image', sha256: metadata.sha256, size: metadata.size }], sourceSha256: image.sha256, preparationRevision: revision }
  } finally { await rm(temporary, { force: true }) }
}
async function ownerPreparationRevision() {
  return createHash('sha256').update(await readFile(join(templates, 'prepare-owner-debian11-image.py')))
    .update(await readFile(join(templates, 'owner-debian11-bootstrap.sh'))).digest('hex')
}
async function officialImage(alias: string, architecture: 'x86_64' | 'aarch64', type: 'container' | 'vm', signal?: AbortSignal): Promise<CachedSystemImage> {
  const data = await officialCatalog(signal), arch = architecture === 'x86_64' ? 'amd64' : 'arm64'
  const remote = alias.slice(7).replace(/\/(?:amd64|arm64|x86_64|aarch64)$/, '')
  const product = Object.values(data.products).find((value: any) => value.arch === arch && typeof value.aliases === 'string' && value.aliases.split(',').includes(remote)) as any
  if (!product?.versions) throw Error('SYSTEM_IMAGE_UNAVAILABLE')
  const version = Object.keys(product.versions).sort().at(-1), items = product.versions[version!]?.items
  const metadata = Object.values(items || {}).find((item: any) => item.ftype === 'incus.tar.xz') as any
  const filesystem = Object.values(items || {}).find((item: any) => item.ftype === (type === 'container' ? 'root.tar.xz' : 'disk-kvm.img')) as any
  if (!metadata || !filesystem) throw Error('SYSTEM_IMAGE_TYPE_UNAVAILABLE')
  const parts: CachedImagePart[] = []
  for (const item of [metadata, filesystem]) {
    if (typeof item.path !== 'string' || !/^images\/[a-zA-Z0-9_:./-]+$/.test(item.path) || item.path.split('/').includes('..')) throw Error('SYSTEM_IMAGE_PATH_INVALID')
    const url = 'https://images.linuxcontainers.org/' + item.path
    await download(url, item.sha256, item.size, signal)
    parts.push({ file: item.sha256 + '.image', sha256: item.sha256, size: item.size, url })
  }
  const hash = createHash('sha256')
  for (const part of parts) for await (const chunk of createReadStream(await imagePartPath(part))) hash.update(chunk)
  const fingerprint = hash.digest('hex')
  const declared = metadata[type === 'container' ? 'combined_rootxz_sha256' : 'combined_disk-kvm-img_sha256']
  if (!validHash(declared) || declared !== fingerprint) throw Error('SYSTEM_IMAGE_COMBINED_HASH_MISMATCH')
  return { version: 1, alias, architecture, type, fingerprint, parts }
}

/** Stable local receipt first: code upgrades and upstream build dates do not
 * replace an already verified image. Only missing/corrupt data is fetched. */
export async function cacheSystemImage(alias: string, architecture: string, type: 'container' | 'vm', signal?: AbortSignal): Promise<CachedSystemImage> {
  signal?.throwIfAborted()
  if (!alias.startsWith('images:') || !['x86_64', 'aarch64', 'amd64', 'arm64'].includes(architecture)) throw Error('SYSTEM_IMAGE_TARGET_INVALID')
  const arch = ['aarch64', 'arm64'].includes(architecture) ? 'aarch64' : 'x86_64'
  const suffix = alias.match(/\/(amd64|arm64|x86_64|aarch64)$/)?.[1]
  if (suffix && (['arm64', 'aarch64'].includes(suffix) ? 'aarch64' : 'x86_64') !== arch) throw Error('SYSTEM_IMAGE_ARCHITECTURE_MISMATCH')
  await initializeRoot()
  const key = imageKey(alias, arch, type), flightKey = root() + ':' + key
  let pending = inFlight.get(flightKey)
  if (!pending) {
    pending = (async () => {
      let receipt: CachedSystemImage | undefined
      try {
        const path = join(root(), key + '.json'), info = await lstat(path)
        if (!info.isFile() || info.isSymbolicLink() || info.size > 8192) throw Error('SYSTEM_IMAGE_RECEIPT_INVALID')
        receipt = JSON.parse(await readFile(path, 'utf8')); validateReceipt(receipt!, alias, arch, type)
        const preparationCurrent = !ownerSelectedContainerImage(alias, arch) || receipt!.preparationRevision === await ownerPreparationRevision()
        if (preparationCurrent && await verifyParts(receipt!)) return receipt!
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      // Exact original URLs/hashes can repair data without changing its pin.
      if (receipt && !ownerSelectedContainerImage(alias, arch) && receipt.parts.every(part =>
        typeof part.url === 'string' && /^https:\/\/images\.linuxcontainers\.org\/images\/[a-zA-Z0-9_:./-]+$/.test(part.url) && !part.url.split('/').includes('..'))) {
        for (const part of receipt.parts) await download(part.url!, part.sha256, part.size, signal)
        if (await verifyParts(receipt)) return receipt
      }
      const image = ownerSelectedContainerImage(alias, arch) ? await ownerImage(alias, arch, type, key, signal) : await officialImage(alias, arch, type, signal)
      signal?.throwIfAborted()
      await save(key, image); return image
    })()
    inFlight.set(flightKey, pending); pending.finally(() => inFlight.delete(flightKey)).catch(() => {})
  }
  return pending
}

export async function cachedSystemImagePresent(alias: string, architecture: string, type: 'container' | 'vm'): Promise<boolean> {
  if (!['x86_64', 'aarch64', 'amd64', 'arm64'].includes(architecture)) return false
  const arch = ['aarch64', 'arm64'].includes(architecture) ? 'aarch64' : 'x86_64'
  try { const path = join(root(), imageKey(alias, arch, type) + '.json'), info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size > 8192) return false
    const image = JSON.parse(await readFile(path, 'utf8')); validateReceipt(image, alias, arch, type); return true
  } catch { return false }
}
