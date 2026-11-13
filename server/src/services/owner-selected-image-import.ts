import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { request } from 'undici'
import { ownerSelectedContainerImage } from '../lib/owner-selected-images.js'
import { IncusApiError, type IncusClient } from '../lib/incus/incus-client.js'
import { waitForOperation } from '../lib/incus/incus-utils.js'
import type { IncusApiResponse } from '../types/incus.js'

type Prepared = { file: string; sha256: string; size: number; architecture: string }
const prepared = new Map<string, Promise<Prepared>>()
const imports = new Map<string, Promise<void>>()
const imageRoot = fileURLToPath(new URL('../../images/', import.meta.url))
const hashFile = async (path: string) => {
  const hash = createHash('sha256')
  for await (const data of createReadStream(path)) hash.update(data)
  return hash.digest('hex')
}
async function getArchive(image: NonNullable<ReturnType<typeof ownerSelectedContainerImage>>): Promise<Prepared> {
  const key = image.sha256
  let value = prepared.get(key)
  if (!value) {
    value = (async () => {
      const directory = await lstat(imageRoot)
      const manifestPath = join(imageRoot, 'manifest.json'), manifestInfo = await lstat(manifestPath)
      if (!directory.isDirectory() || directory.isSymbolicLink() || !manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > 8192) throw Error('BUNDLED_IMAGE_MANIFEST_INVALID')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      const metadata = manifest.images?.[image.archiveArchitecture]
      const file = join(imageRoot, `debian11-cloud-${image.archiveArchitecture}.tar.gz`), info = await lstat(file)
      if (manifest.version !== 1 || !info.isFile() || info.isSymbolicLink() || metadata?.sourceSha256 !== image.sha256 ||
          metadata?.architecture !== image.architecture || metadata?.size !== info.size || info.size > 200 * 1024 * 1024 ||
          !/^[a-f0-9]{64}$/.test(metadata?.sha256 || '') || await hashFile(file) !== metadata.sha256) throw Error('BUNDLED_IMAGE_INTEGRITY_FAILED')
      return { file, sha256: metadata.sha256, size: info.size, architecture: image.architecture }
    })()
    prepared.set(key, value)
    value.catch(() => prepared.delete(key))
  }
  return value
}
async function verifyImported(client: IncusClient, archive: Prepared) {
  const image = await client.request<{ fingerprint?: string; architecture?: string; type?: string }>('GET', `/1.0/images/${archive.sha256}`, null, 10000)
  if (image.fingerprint !== archive.sha256 || image.architecture !== archive.architecture || image.type !== 'container') throw Error('OWNER_IMAGE_IMPORT_UNVERIFIED')
}
async function upload(client: IncusClient, archive: Prepared) {
  const release = await client.beginMaintenanceAccess('POST')
  const transport = client.createTransport({ connectTimeout: 15000, headersTimeout: 180000, bodyTimeout: 0 })
  const signal = AbortSignal.timeout(180000), stream = createReadStream(archive.file)
  try {
    await client.assertMaintenanceAccess('POST', '/1.0/images')
    const response = await request(client.baseUrl + '/1.0/images', { method: 'POST', dispatcher: transport, signal,
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(archive.size),
        'X-Incus-fingerprint': archive.sha256, 'X-Incus-filename': 'debian11-cloud.tar.gz', 'X-Incus-public': 'false' }, body: stream })
    const chunks: Buffer[] = []; let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > 65536) throw Error('OWNER_IMAGE_IMPORT_RESPONSE_TOO_LARGE')
      chunks.push(Buffer.from(chunk))
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as IncusApiResponse
    if (response.statusCode >= 400 || data.type === 'error') {
      // Concurrent imports may complete the same immutable fingerprint.
      await verifyImported(client, archive)
      return
    }
    if (data.type === 'async') {
      if (!data.operation || !/^\/1\.0\/operations\/[a-f0-9-]{36}$/i.test(data.operation)) throw Error('OWNER_IMAGE_IMPORT_RECEIPT_INVALID')
      await waitForOperation(client, data.operation, 180000, signal)
    } else if (data.type !== 'sync') throw Error('OWNER_IMAGE_IMPORT_RECEIPT_INVALID')
    await verifyImported(client, archive)
  } finally { stream.destroy(); await transport.destroy().catch(() => {}); release() }
}

/** Resolve only the pinned derivative before an existing create/rebuild call.
 * This imports an image, never an instance or customer configuration. */
export async function resolveOwnerSelectedImage(client: IncusClient, alias: string, instanceType: 'container' | 'vm'): Promise<string | null> {
  if (!/^images:debian\/11\/cloud(?:\/(?:amd64|arm64|x86_64|aarch64))?$/.test(alias)) return null
  if (instanceType !== 'container') throw Error('OWNER_IMAGE_CONTAINER_REQUIRED')
  const server = await client.request<{ environment?: { kernel_architecture?: string } }>('GET', '/1.0', null, 10000)
  const selected = ownerSelectedContainerImage(alias, server.environment?.kernel_architecture || '')
  if (!selected) throw Error('OWNER_IMAGE_ARCHITECTURE_MISMATCH')
  const archive = await getArchive(selected)
  const key = `${client.baseUrl}:${archive.sha256}`
  let work = imports.get(key)
  if (!work) {
    work = (async () => {
      try { await verifyImported(client, archive); return }
      catch (error) { if (!(error instanceof IncusApiError) || error.statusCode !== 404 || error.path !== `/1.0/images/${archive.sha256}`) throw error }
      await upload(client, archive)
    })()
    imports.set(key, work)
    work.finally(() => imports.delete(key)).catch(() => {})
  }
  await work
  // A concurrent caller must verify through its own registered transport too.
  await verifyImported(client, archive)
  return archive.sha256
}
