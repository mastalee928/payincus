import assert from 'node:assert/strict'
import Fastify, { type FastifyInstance } from 'fastify'
import { createHash, randomUUID } from 'node:crypto'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { rotateHostAgentCredentials } = await import('../src/lib/host-agent-credentials.js')
const { createAgentBodyHash, createAgentSignature } = await import('../src/lib/agent-auth.js')
const originalFetch = globalThis.fetch, originalNow = Date.now
const tag = randomUUID(), version = 'v1.0.998', oldVersion = 'v1.0.997'
const user = await prisma.user.create({ data: { username: `release-concurrency-${tag}`, passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: user.id, name: tag, url: 'https://127.0.0.1:1' } })
const actor = { id: user.id, sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
const credentials = await rotateHostAgentCredentials(host.id, true, { actor })
const body = { version: 'v1.0.1', runtime: { goos: 'linux', goarch: 'amd64' }, metrics: { heartbeatIntervalSeconds: 30 } }
const platforms = ['amd64', 'arm64'] as const
const bytes = (arch: string, releaseVersion = version) => Buffer.from(`verified release ${arch} ${releaseVersion}`)
const hash = (arch: string, releaseVersion = version) => createHash('sha256').update(bytes(arch, releaseVersion)).digest('hex')
const release = () => [{ tag_name: `agent-${version}`, assets: platforms.map((arch, index) => ({ name: `incudal-agent-${arch === 'amd64' ? 'x86_64' : 'aarch64'}-${version}`, size: bytes(arch).length, url: `https://api.github.com/repos/mastalee928/payincus/releases/assets/${index + 1}` })) }]
const counts = new Map<string, number>()
let metadataFailure = false, checksumFailure = false, incomplete = false, metadataThrottle = false
let binaryFailure: 'http' | 'hash' | 'empty' | 'network' | 'body' | null = null
let binaryPhase = false, gateKind: 'metadata' | 'checksum' | 'binary' = 'metadata'
let gateMode: 'headers' | 'body' = 'headers'
let unblock!: () => void, markStarted!: () => void, gate = Promise.resolve(), started = Promise.resolve()
let app: FastifyInstance | undefined

function setGate(kind: typeof gateKind, mode: typeof gateMode = 'headers') {
  unblock?.()
  gateKind = kind; gateMode = mode
  gate = new Promise<void>(resolve => { unblock = resolve })
  started = new Promise<void>(resolve => { markStarted = resolve })
}
function record(key: string) { counts.set(key, (counts.get(key) ?? 0) + 1) }
function total(prefix: string) { return [...counts].filter(([key]) => key.startsWith(prefix)).reduce((sum, [, count]) => sum + count, 0) }
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
async function untilStarted() {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { await Promise.race([started, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('controlled upstream request was not reached')), 5000) })]) }
  finally { if (timer) clearTimeout(timer) }
  await pause(80)
}
async function fixtureFetch(url: string | URL | Request, options?: RequestInit): Promise<Response> {
  const parsed = new URL(String(url))
  assert.ok(options?.signal instanceof AbortSignal, 'shared request preserves the external fetch deadline')
  assert.ok(parsed.protocol === 'https:' && ['api.github.com', 'github.com'].includes(parsed.hostname), 'no real or untrusted upstream requests')
  const metadata = parsed.pathname.endsWith('/releases')
  const arch = parsed.pathname.endsWith('/2') || parsed.pathname.includes('aarch64') ? 'arm64' : 'amd64'
  const releaseVersion = parsed.pathname.includes(oldVersion) ? oldVersion : version
  const kind = metadata ? 'metadata' : binaryPhase ? 'binary' : 'checksum'
  record(metadata ? kind : `${kind}:${releaseVersion}:${arch}`)
  const failure = metadata ? metadataFailure : kind === 'checksum' ? checksumFailure : binaryFailure === 'http'
  const contents = metadata ? Buffer.from(JSON.stringify(incomplete ? [{ ...release()[0], assets: release()[0].assets.slice(0, 1) }] : release()))
    : binaryPhase && binaryFailure === 'hash' ? Buffer.from('corrupted binary') : bytes(arch, releaseVersion)
  const mustWait = kind === gateKind
  if (mustWait) markStarted()
  if (mustWait && gateMode === 'headers') await gate
  if (metadata && metadataThrottle) { metadataThrottle = false; return new Response('fixture throttled', { status: 429, headers: { 'retry-after': '0.01' } }) }
  if (binaryPhase && binaryFailure === 'network') throw Error('fixture binary network failure')
  if (binaryPhase && binaryFailure === 'body') return new Response(new ReadableStream({ start(controller) { controller.error(Error('fixture binary body failure')) } }))
  if (failure) return new Response('fixture upstream unavailable', { status: 404 })
  if (binaryPhase && binaryFailure === 'empty') return new Response(null)
  if (mustWait && gateMode === 'body') {
    const heldGate = gate
    return new Response(new ReadableStream({ start(controller) { void heldGate.then(() => { controller.enqueue(contents); controller.close() }) } }))
  }
  return new Response(contents, metadata ? { headers: { 'content-type': 'application/json' } } : undefined)
}
async function fresh(mode: string) {
  await app?.close(); app = undefined; counts.clear()
  metadataFailure = false; checksumFailure = false; incomplete = false; metadataThrottle = false; binaryFailure = null; binaryPhase = false
  globalThis.fetch = fixtureFetch
  const routeUrl = new URL('../src/routes/agent.ts', import.meta.url); routeUrl.searchParams.set('concurrency', `${tag}-${mode}`)
  const routes = (await import(routeUrl.href)).default
  app = Fastify()
  for (const name of ['authenticate', 'authenticateAdmin']) app.decorate(name, async (request: any) => { request.user = actor })
  await app.register(routes, { prefix: '/agent' }); await app.ready()
}
function manifest() { return app!.inject({ method: 'GET', url: '/agent/manifest.json' }).then(response => response) }
function binary(arch = 'amd64', releaseVersion = version, sha = hash(arch, releaseVersion)) {
  return app!.inject({ method: 'GET', url: `/agent/binary/incudal-agent-linux-${arch}?v=${releaseVersion}&sha256=${sha}` }).then(response => response)
}
function heartbeat() {
  const timestamp = String(Date.now()), nonce = randomUUID(), bodyHash = createAgentBodyHash(body)
  return app!.inject({ method: 'POST', url: '/agent/heartbeat', payload: body, headers: {
    'x-incudal-agent-id': credentials.agentId, 'x-incudal-timestamp': timestamp, 'x-incudal-nonce': nonce, 'x-incudal-body-sha256': bodyHash,
    'x-incudal-signature': createAgentSignature(credentials.agentSecret, { method: 'POST', path: '/agent/heartbeat', timestamp, nonce, bodyHash })
  } }).then(response => response)
}
async function warmManifest() {
  setGate('metadata'); unblock()
  const response = await manifest(); assert.equal(response.statusCode, 200, response.body)
  assert.equal(response.json().files['linux-amd64'].sha256, hash('amd64'))
  assert.equal(response.json().files['linux-arm64'].sha256, hash('arm64'))
  binaryPhase = true
}

try {
  for (const mode of ['headers', 'body'] as const) {
    await fresh(`metadata-${mode}`); setGate('metadata', mode)
    const manifests = Array.from({ length: 20 }, manifest), heartbeats = Array.from({ length: 7 }, heartbeat)
    try {
      await untilStarted()
      assert.equal(total('metadata'), 1, 'concurrent public manifests and authenticated heartbeats share one metadata refresh')
    } finally { unblock(); await Promise.all([...manifests, ...heartbeats]) }
    for (const response of await Promise.all(manifests)) {
      assert.equal(response.statusCode, 200); assert.equal(response.json().files['linux-amd64'].sha256, hash('amd64')); assert.equal(response.json().files['linux-arm64'].sha256, hash('arm64'))
    }
    for (const response of await Promise.all(heartbeats)) { assert.equal(response.statusCode, 200); assert.equal(response.json().upgrade.sha256, hash('amd64')) }
    assert.equal(total('metadata'), 1); assert.equal(total('checksum'), 2, 'both architectures are hashed once')
    assert.equal((await prisma.hostAgent.findUniqueOrThrow({ where: { hostId: host.id } })).status, 'online')
    await manifest(); assert.equal(total('metadata'), 1, 'complete verified cache remains usable')
  }
  await fresh('heartbeat-background'); setGate('metadata', 'body')
  const waitingManifest = manifest(), firstHeartbeats = Array.from({ length: 7 }, heartbeat)
  try {
    await untilStarted()
    const firstResponses = await Promise.all(firstHeartbeats)
    for (const response of firstResponses) { assert.equal(response.statusCode, 200); assert.equal(response.json().upgrade.available, false) }
    const secondResponses = await Promise.all(Array.from({ length: 3 }, heartbeat))
    for (const response of secondResponses) { assert.equal(response.statusCode, 200); assert.equal(response.json().upgrade.available, false) }
    assert.equal(total('metadata'), 1, 'successive heartbeat deadline expirations keep sharing the same unfinished refresh')
  } finally { unblock(); await Promise.all([waitingManifest, ...firstHeartbeats]) }
  assert.equal((await heartbeat()).json().upgrade.sha256, hash('amd64'), 'later heartbeats receive the completed verified refresh')
  await fresh('metadata-throttle'); setGate('metadata'); metadataThrottle = true
  const throttled = Array.from({ length: 16 }, manifest)
  try { await untilStarted(); assert.equal(total('metadata'), 1) } finally { unblock(); await Promise.all(throttled) }
  for (const response of await Promise.all(throttled)) assert.equal(response.statusCode, 200)
  assert.equal(total('metadata'), 2, 'all waiters share the existing bounded throttle retry sequence')
  for (const mode of ['metadata-failure', 'checksum-failure', 'incomplete']) {
    await fresh(mode); setGate(mode === 'checksum-failure' ? 'checksum' : 'metadata')
    metadataFailure = mode === 'metadata-failure'; checksumFailure = mode === 'checksum-failure'; incomplete = mode === 'incomplete'
    const requests = Array.from({ length: 16 }, manifest)
    try { await untilStarted(); assert.equal(total('metadata'), 1) } finally { unblock(); await Promise.all(requests) }
    for (const response of await Promise.all(requests)) assert.equal(response.statusCode, 404, 'failed or incomplete refresh does not publish a manifest')
    metadataFailure = false; checksumFailure = false; incomplete = false; setGate('metadata')
    const retries = Array.from({ length: 16 }, manifest)
    try { await untilStarted(); assert.equal(total('metadata'), 2, 'failed in-flight refresh is released for one shared retry') } finally { unblock(); await Promise.all(retries) }
    for (const response of await Promise.all(retries)) assert.equal(response.statusCode, 200)
  }
  await fresh('stale'); await warmManifest(); binaryPhase = false
  let clockOffset = 5 * 60 * 1000 + 1
  Date.now = () => originalNow() + clockOffset
  try {
    metadataFailure = true; setGate('metadata')
    const requests = Array.from({ length: 16 }, manifest)
    try { await untilStarted(); assert.equal(total('metadata'), 2, 'expired cache shares a single refresh') } finally { unblock(); await Promise.all(requests) }
    for (const response of await Promise.all(requests)) { assert.equal(response.statusCode, 200); assert.equal(response.json().version, version) }
    await manifest(); assert.equal(total('metadata'), 2, 'stale retry TTL remains in effect')
    metadataFailure = false; clockOffset += 60 * 1000 + 1; setGate('metadata'); unblock()
    assert.equal((await manifest()).statusCode, 200); assert.equal(total('metadata'), 3, 'stale retry later refreshes again')
  } finally { Date.now = originalNow }
  for (const mode of ['headers', 'body'] as const) {
    await fresh(`binary-${mode}`); await warmManifest(); setGate('binary', mode)
    const requests = Array.from({ length: 24 }, (_value, index) => index % 3 === 0
      ? app!.inject({ method: 'GET', url: '/agent/binary/incudal-agent-linux-amd64' }).then(response => response)
      : binary('amd64', version, index % 2 ? hash('amd64').toUpperCase() : hash('amd64')))
    try { await untilStarted(); assert.equal(total('binary'), 1, 'exact, uppercase checksum and latest queries share one verified download') } finally { unblock(); await Promise.all(requests) }
    for (const response of await Promise.all(requests)) { assert.equal(response.statusCode, 200); assert.deepEqual(response.rawPayload, bytes('amd64')); assert.match(String(response.headers['cache-control']), /no-store/) }
    await binary(); assert.equal(total('binary'), 1, 'verified binary cache is reused')
  }
  for (const failure of ['http', 'hash', 'empty', 'network', 'body'] as const) {
    await fresh(`binary-failure-${failure}`); await warmManifest(); setGate('binary'); binaryFailure = failure
    const requests = Array.from({ length: 16 }, () => binary())
    try { await untilStarted(); assert.equal(total('binary'), 1) } finally { unblock(); await Promise.all(requests) }
    for (const response of await Promise.all(requests)) assert.equal(response.statusCode, 502, 'all waiters reject an unverified binary')
    binaryFailure = null; setGate('binary', 'body')
    const retries = Array.from({ length: 16 }, () => binary())
    try { await untilStarted(); assert.equal(total('binary'), 2, 'failed download releases its key for one retry') } finally { unblock(); await Promise.all(retries) }
    for (const response of await Promise.all(retries)) { assert.equal(response.statusCode, 200); assert.deepEqual(response.rawPayload, bytes('amd64')) }
  }
  await fresh('binary-keys'); await warmManifest(); setGate('binary', 'body')
  const keys = [
    { arch: 'amd64', releaseVersion: version, sha: hash('amd64'), status: 200 },
    { arch: 'arm64', releaseVersion: version, sha: hash('arm64'), status: 200 },
    { arch: 'amd64', releaseVersion: oldVersion, sha: hash('amd64', oldVersion), status: 200 },
    { arch: 'arm64', releaseVersion: oldVersion, sha: hash('arm64', oldVersion), status: 200 },
    { arch: 'amd64', releaseVersion: version, sha: '0'.repeat(64), status: 502 }
  ]
  const groups = keys.map(key => Array.from({ length: 8 }, () => binary(key.arch, key.releaseVersion, key.sha)))
  try { await untilStarted(); assert.equal(total('binary'), 5, 'version, architecture and expected hash each isolate in-flight downloads') } finally { unblock(); await Promise.all(groups.flat()) }
  for (let index = 0; index < keys.length; index++) for (const response of await Promise.all(groups[index])) {
    assert.equal(response.statusCode, keys[index].status)
    if (keys[index].status === 200) assert.deepEqual(response.rawPayload, bytes(keys[index].arch, keys[index].releaseVersion))
  }
  const beforeInvalid = total('binary')
  for (const url of ['/agent/binary/incudal-agent-linux-amd64?v=invalid&sha256=' + hash('amd64'), '/agent/binary/incudal-agent-linux-amd64?v=' + version, '/agent/binary/invalid']) {
    assert.equal((await app!.inject({ method: 'GET', url })).statusCode, 400)
  }
  assert.equal(total('binary'), beforeInvalid, 'invalid query inputs do not reach shared upstream work')
  console.log('PASS actual Fastify/HMAC/PostgreSQL concurrent manifest and binary requests; metadata/header/body coalescing, two-architecture checksums, failure/incomplete/stale retry, binary header/body/failure retry and version/name/hash isolation; upstream fully controlled locally')
} finally {
  unblock?.(); Date.now = originalNow; globalThis.fetch = originalFetch
  await app?.close(); await prisma.host.delete({ where: { id: host.id } }); await prisma.user.delete({ where: { id: user.id } }); await closePrismaDatabase()
}
process.exit(0)
