import { createReadStream } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { request } from 'undici'
import { IncusApiError, type IncusClient } from '../lib/incus/incus-client.js'
import { waitForOperation } from '../lib/incus/incus-utils.js'
import type { IncusApiResponse } from '../types/incus.js'
import { cacheSystemImage, imagePartPath, type CachedSystemImage } from './system-image-cache.js'
import { retiredDefaultSystemImage } from '../lib/retired-system-images.js'

const imports = new Map<string, Promise<void>>()
async function verifyImported(client: IncusClient, archive: CachedSystemImage) {
  const image = await client.request<{ fingerprint?: string; architecture?: string; type?: string }>('GET', `/1.0/images/${archive.fingerprint}`, null, 10000)
  if (image.fingerprint !== archive.fingerprint || image.architecture !== archive.architecture || image.type !== (archive.type === 'vm' ? 'virtual-machine' : 'container')) throw Error('SYSTEM_IMAGE_IMPORT_UNVERIFIED')
}
async function upload(client: IncusClient, archive: CachedSystemImage) {
  const release = await client.beginMaintenanceAccess('POST')
  const transport = client.createTransport({ connectTimeout: 15000, headersTimeout: 180000, bodyTimeout: 0 })
  const signal = AbortSignal.timeout(180000), boundary = 'incudal-image-' + randomUUID()
  const stream = Readable.from((async function* () {
    for (let i = 0; i < archive.parts.length; i++) {
      if (archive.parts.length > 1) yield Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${i === 0 ? 'metadata' : archive.type === 'vm' ? 'rootfs.img' : 'rootfs'}"; filename="${i === 0 ? 'metadata.tar.xz' : 'rootfs.image'}"\r\nContent-Type: application/octet-stream\r\n\r\n`)
      for await (const chunk of createReadStream(await imagePartPath(archive.parts[i]))) yield chunk
      if (archive.parts.length > 1) yield Buffer.from('\r\n')
    }
    if (archive.parts.length > 1) yield Buffer.from(`--${boundary}--\r\n`)
  })())
  try {
    await client.assertMaintenanceAccess('POST', '/1.0/images')
    const response = await request(client.baseUrl + '/1.0/images', { method: 'POST', dispatcher: transport, signal,
      headers: { 'Content-Type': archive.parts.length === 1 ? 'application/octet-stream' : `multipart/form-data; boundary=${boundary}`,
        'X-Incus-fingerprint': archive.fingerprint, 'X-Incus-filename': 'system-image.tar.gz', 'X-Incus-public': 'false' }, body: stream })
    const chunks: Buffer[] = []; let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > 65536) throw Error('SYSTEM_IMAGE_IMPORT_RESPONSE_TOO_LARGE')
      chunks.push(Buffer.from(chunk))
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as IncusApiResponse
    if (response.statusCode >= 400 || data.type === 'error') {
      // Concurrent imports may complete the same immutable fingerprint.
      await verifyImported(client, archive)
      return
    }
    if (data.type === 'async') {
      if (!data.operation || !/^\/1\.0\/operations\/[a-f0-9-]{36}$/i.test(data.operation)) throw Error('SYSTEM_IMAGE_IMPORT_RECEIPT_INVALID')
      await waitForOperation(client, data.operation, 180000, signal)
    } else if (data.type !== 'sync') throw Error('SYSTEM_IMAGE_IMPORT_RECEIPT_INVALID')
    await verifyImported(client, archive)
  } finally { stream.destroy(); await transport.destroy().catch(() => {}); release() }
}

/** Resolve a persistent controller image before the guarded create/rebuild.
 * Only the registered image transport imports it; no guest mutation here. */
export async function resolveCachedSystemImage(client: IncusClient, alias: string, instanceType: 'container' | 'vm'): Promise<string | null> {
  if (retiredDefaultSystemImage(alias)) throw Error('SYSTEM_IMAGE_RETIRED')
  if (!alias.startsWith('images:')) return null
  const server = await client.request<{ environment?: { kernel_architecture?: string } }>('GET', '/1.0', null, 10000)
  const archive = await cacheSystemImage(alias, server.environment?.kernel_architecture || '', instanceType)
  const key = `${client.baseUrl}:${archive.fingerprint}`
  let work = imports.get(key)
  if (!work) {
    work = (async () => {
      try { await verifyImported(client, archive); return }
      catch (error) { if (!(error instanceof IncusApiError) || error.statusCode !== 404 || error.path !== `/1.0/images/${archive.fingerprint}`) throw error }
      await upload(client, archive)
    })()
    imports.set(key, work)
    work.finally(() => imports.delete(key)).catch(() => {})
  }
  await work
  // A concurrent caller must verify through its own registered transport too.
  await verifyImported(client, archive)
  return archive.fingerprint
}
