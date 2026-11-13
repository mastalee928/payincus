import { ownerSelectedContainerImage } from './owner-selected-images.js'
import { cachedSystemImagePresent } from '../services/system-image-cache.js'

const endpoint = 'https://images.linuxcontainers.org/streams/v1/images.json'
type Catalog = Set<string>
let saved: { at: number; aliases: Catalog } | undefined
let pending: Promise<Catalog | null> | undefined
let retryAfter = 0
const key = (alias: string, arch: string, type: string) => `${alias}|${arch}|${type}`

export function parseOfficialImageCatalog(value: unknown): Catalog {
  const data = value as { products?: Record<string, { aliases?: string; arch?: string; versions?: Record<string, { items?: Record<string, { ftype?: string }> }> }> }
  if (!data || typeof data.products !== 'object' || !data.products || Array.isArray(data.products) || !Object.keys(data.products).length) throw Error('Invalid official image catalog')
  const result: Catalog = new Set()
  for (const product of Object.values(data.products)) {
    if (typeof product.aliases !== 'string' || !['amd64','arm64'].includes(product.arch || '')) continue
    const items = Object.values(product.versions || {}).flatMap(version => Object.values(version.items || {}))
    for (const alias of product.aliases.split(',').map(v => v.trim()).filter(Boolean)) {
      if (items.some(item => ['squashfs','root.tar.xz'].includes(item.ftype || ''))) result.add(key(alias, product.arch!, 'container'))
      if (items.some(item => ['disk-kvm.img','disk1.img'].includes(item.ftype || ''))) result.add(key(alias, product.arch!, 'vm'))
    }
  }
  if (!result.size) throw Error('Empty usable official image catalog')
  return result
}

async function catalog(): Promise<Catalog | null> {
  if (saved && Date.now() - saved.at < 15 * 60000) return saved.aliases
  if (Date.now() < retryAfter) return saved && Date.now() - saved.at < 60 * 60000 ? saved.aliases : null
  pending ||= (async () => {
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(12000), redirect: 'error' })
      if (!response.ok || !response.body) throw Error('Official image catalog unavailable')
      const chunks: Uint8Array[] = []; let length = 0
      for await (const chunk of response.body) { length += chunk.length; if (length > 16 * 1024 * 1024) throw Error('Official image catalog too large'); chunks.push(chunk) }
      const aliases = parseOfficialImageCatalog(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      saved = { at: Date.now(), aliases }; return aliases
    } catch {
      retryAfter = Date.now() + 60000
      // Keep the last confirmed inventory during a brief upstream outage.
      return saved && Date.now() - saved.at < 60 * 60000 ? saved.aliases : null
    } finally { pending = undefined }
  })()
  return pending
}

export function officialImagePresent(aliases: Catalog, remoteAlias: string, architecture: string, type: 'container' | 'vm' | 'both'): boolean {
  if (ownerSelectedContainerImage(remoteAlias, architecture)) return type !== 'vm'
  if (!remoteAlias.startsWith('images:')) return true
  const arch = ['aarch64','arm64'].includes(architecture) ? 'arm64' : ['amd64','x86_64'].includes(architecture) ? 'amd64' : null
  if (!arch) return true // Unknown architectures are handled by the existing host gate.
  const alias = remoteAlias.slice(7).replace(/\/(?:amd64|arm64|aarch64|x86_64)$/, '')
  return type === 'both' ? aliases.has(key(alias, arch, 'container')) || aliases.has(key(alias, arch, 'vm')) : aliases.has(key(alias, arch, type))
}

/** Only a complete successful catalog proves an alias was withdrawn.
 * Network failure is not an empty inventory and never rewrites admin data. */
export async function officialImageAvailable(remoteAlias: string, architecture: string, type: 'container' | 'vm' | 'both'): Promise<boolean | null> {
  if (ownerSelectedContainerImage(remoteAlias, architecture)) return type !== 'vm'
  if (!remoteAlias.startsWith('images:')) return true
  if (type === 'both' ? await cachedSystemImagePresent(remoteAlias, architecture, 'container') || await cachedSystemImagePresent(remoteAlias, architecture, 'vm') :
    await cachedSystemImagePresent(remoteAlias, architecture, type)) return true
  const data = await catalog()
  return data ? officialImagePresent(data, remoteAlias, architecture, type) : null
}

export async function filterAvailableOfficialImages<T extends { remoteAlias: string; architecture: string; instanceType: string }>(images: T[], type?: 'container' | 'vm'): Promise<T[]> {
  if (!images.some(image => image.remoteAlias.startsWith('images:'))) return images
  const data = await catalog()
  if (!data) return images
  const available = await Promise.all(images.map(async image => {
    const target = type || image.instanceType as 'container' | 'vm' | 'both'
    return officialImagePresent(data, image.remoteAlias, image.architecture, target) ||
      (target === 'both' ? await cachedSystemImagePresent(image.remoteAlias, image.architecture, 'container') || await cachedSystemImagePresent(image.remoteAlias, image.architecture, 'vm') :
        await cachedSystemImagePresent(image.remoteAlias, image.architecture, target))
  }))
  return images.filter((_image, index) => available[index])
}
