import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routeSource = readFileSync(resolve(process.cwd(), 'src/routes/images.ts'), 'utf8')

assert.ok(
  routeSource.includes('function parsePositiveInteger(value: string | undefined): number | null | undefined') &&
    routeSource.includes('const POSITIVE_INTEGER_PATTERN = /^[1-9]\\d*$/') &&
    routeSource.includes('Number.isSafeInteger(parsed)'),
  'image routes must use strict positive safe-integer parsing'
)

assert.ok(
  routeSource.includes('const memoryNum = parsePositiveInteger(memory)') &&
    routeSource.includes('const hostIdNum = parsePositiveInteger(hostId)') &&
    routeSource.includes('if (memoryNum === null || hostIdNum === null)'),
  'image list query filters must reject malformed numeric query values'
)

assert.equal(
  routeSource.match(/const id = parsePositiveRouteId\(request\.params\.id\)/g)?.length ?? 0,
  2,
  'image admin update/delete routes must strictly validate path IDs'
)

for (const forbiddenPattern of [
  'parseInt(memory, 10)',
  'parseInt(hostId, 10)',
  'parseInt(request.params.id)',
  'Number(request.params.id)'
]) {
  assert.ok(
    !routeSource.includes(forbiddenPattern),
    `image routes must not use loose numeric parsing: ${forbiddenPattern}`
  )
}

console.log('image route guard tests passed')
const databaseSource = readFileSync(resolve(process.cwd(), 'src/db/images.ts'), 'utf8')
const saveAllowlist = databaseSource.slice(databaseSource.indexOf('export async function saveHostAllowedImages('), databaseSource.indexOf('export async function getSystemImageAvailabilityForHost('))
assert.ok(saveAllowlist.indexOf('SELECT id FROM hosts WHERE id = ${hostId} FOR UPDATE') < saveAllowlist.indexOf('await tx.hostAllowedImage.deleteMany('),
  'host allowlist replacement must take the host lock before changing existing or empty allowlists')

const { officialImageAvailable, filterAvailableOfficialImages, parseOfficialImageCatalog, officialImagePresent } = await import('../src/lib/official-image-availability.js')
const catalog = { products: {
  amd: { aliases: 'debian/12/cloud,debian/bookworm/cloud', arch: 'amd64', versions: { current: { items: { root: { ftype: 'squashfs' }, vm: { ftype: 'disk-kvm.img' } } } } },
  arm: { aliases: 'alpine/3.24/tinycloud', arch: 'arm64', versions: { current: { items: { root: { ftype: 'root.tar.xz' } } } } }
} }
const parsed = parseOfficialImageCatalog(catalog)
assert.equal(officialImagePresent(parsed, 'images:debian/12/cloud', 'x86_64', 'vm'), true)
assert.equal(officialImagePresent(parsed, 'images:debian/12/cloud/arm64', 'aarch64', 'container'), false)
assert.equal(officialImagePresent(parsed, 'images:alpine/3.24/tinycloud/arm64', 'aarch64', 'container'), true)
assert.equal(officialImagePresent(parsed, 'images:alpine/3.24/tinycloud', 'arm64', 'vm'), false)
assert.throws(() => parseOfficialImageCatalog({ products: {} }))
const originalFetch = globalThis.fetch, originalNow = Date.now
let now = originalNow(), requests = 0, fail = false
Date.now = () => now
globalThis.fetch = (async (url: string | URL | Request) => {
  requests++
  assert.equal(String(url), 'https://images.linuxcontainers.org/streams/v1/images.json')
  if (fail) throw Error('isolated upstream outage')
  return new Response(JSON.stringify(catalog))
}) as typeof fetch
try {
  assert.equal(await officialImageAvailable('custom:debian/11', 'x86_64', 'container'), true)
  assert.equal(requests, 0)
  const checks = await Promise.all(Array.from({ length: 8 }, () => officialImageAvailable('images:debian/11/cloud', 'x86_64', 'container')))
  assert.ok(checks.every(value => value === false)); assert.equal(requests, 1, 'concurrent lookups share one bounded fetch')
  const images = [
    { remoteAlias: 'images:debian/12/cloud', architecture: 'x86_64', instanceType: 'both' },
    { remoteAlias: 'images:debian/11/cloud', architecture: 'x86_64', instanceType: 'both' }
  ]
  assert.equal((await filterAvailableOfficialImages(images, 'container')).length, 1)
  fail = true; now += 16 * 60000
  assert.equal(await officialImageAvailable('images:debian/11/cloud', 'x86_64', 'container'), false)
  assert.equal(await officialImageAvailable('images:debian/11/cloud', 'x86_64', 'container'), false)
  assert.equal(requests, 2, 'failed upstream requests back off')
  now += 61 * 60000
  assert.equal(await officialImageAvailable('images:debian/11/cloud', 'x86_64', 'container'), null)
  assert.equal((await filterAvailableOfficialImages(images)).length, 2, 'unknown upstream state must not erase inventory')
} finally { globalThis.fetch = originalFetch; Date.now = originalNow }
console.log('official catalog: withdrawal, architecture/type, custom sources, concurrency, stale cache and outage passed')
