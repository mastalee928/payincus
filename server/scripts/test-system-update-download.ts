import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadSystemUpdateArtifact, fetchReleaseJson } from '../src/lib/system-update-download.js'
import { getOtaReleaseInfo, type OtaArtifactInfo } from '../src/lib/system-version.js'

export async function verifySystemUpdateDownloads(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'incudal-ota-download-'))
  const originalFetch = globalThis.fetch
  const oldRepository = process.env.SYSTEM_UPDATE_RELEASE_REPOSITORY
  const oldToken = process.env.SYSTEM_UPDATE_RELEASE_TOKEN
  const payload = Buffer.from('official architecture-specific package')
  const artifact: OtaArtifactInfo = {
    name: 'incudal-v1.8.4-linux-arm64.tar.gz', platform: 'linux', arch: 'arm64',
    url: 'https://github.com/owner/repo/releases/download/v1.8.4/incudal-v1.8.4-linux-arm64.tar.gz',
    apiUrl: 'https://api.github.com/repos/owner/repo/releases/assets/42',
    size: payload.length, sha256: createHash('sha256').update(payload).digest('hex')
  }
  const cdn = 'https://release-assets.githubusercontent.com/package?signature=private-fixture'
  const options = { token: 'fixture-release-token', retryDelayMs: 1, timeoutMs: 1000 }
  const destination = join(directory, 'package')
  const logs: string[] = []
  let requests: Array<{ url: string; headers: Headers }> = []
  const intercept = (handler: (url: string, init: RequestInit) => Response | Promise<Response>) => {
    requests = []
    globalThis.fetch = (async (input, init = {}) => {
      const url = String(input)
      requests.push({ url, headers: new Headers(init.headers) })
      assert.equal(init.redirect, 'manual')
      assert.ok(init.signal)
      return await handler(url, init)
    }) as typeof fetch
  }
  const empty = async () => assert.deepEqual(await readdir(directory), [], 'failed downloads must leave no artifact or partial files')
  try {
    for (const arch of ['amd64', 'arm64']) {
      intercept(url => url === artifact.url ? new Response('', { status: 504 })
        : url === artifact.apiUrl ? new Response(null, { status: 302, headers: { location: cdn } })
          : new Response(payload))
      await downloadSystemUpdateArtifact({ ...artifact, arch }, destination, { ...options, log: async line => { logs.push(line) } })
      assert.deepEqual(await readFile(destination), payload)
      assert.deepEqual(requests.map(r => r.url), [artifact.url, artifact.apiUrl, cdn])
      assert.equal(requests[1].headers.get('accept'), 'application/octet-stream')
      assert.equal(requests[1].headers.get('authorization'), 'Bearer fixture-release-token')
      assert.equal(requests[2].headers.get('authorization'), null, 'never forward API token to signed asset CDN')
      assert.ok(logs.every(line => !line.includes('fixture-release-token') && !line.includes('private-fixture')))
      await rm(destination)
    }

    for (const status of [408, 429, 500, 502, 503, 504]) {
      intercept(() => new Response('', { status }))
      await assert.rejects(downloadSystemUpdateArtifact(artifact, destination, options), /failed after 3 attempts/)
      assert.equal(requests.length, 3)
      await empty()
    }
    for (const status of [401, 403, 404, 206]) {
      intercept(() => new Response('', { status }))
      await assert.rejects(downloadSystemUpdateArtifact(artifact, destination, options), new RegExp(`HTTP ${status}`))
      assert.equal(requests.length, 1, 'permanent or partial responses are not retried')
      await empty()
    }
    for (const body of [Buffer.from('bad'), Buffer.alloc(payload.length), Buffer.alloc(payload.length + 1)]) {
      intercept(() => new Response(body))
      await assert.rejects(downloadSystemUpdateArtifact(artifact, destination, options), /size mismatch|sha256 mismatch|exceeds expected size/)
      assert.equal(requests.length, 1, 'integrity failures must not trigger alternate downloads')
      await empty()
    }
    for (const location of ['http://github.com/file', 'https://github.com.evil.test/file', 'https://127.0.0.1/file', 'https://user:secret@github.com/file']) {
      intercept(() => new Response(null, { status: 302, headers: { location } }))
      await assert.rejects(downloadSystemUpdateArtifact(artifact, destination, options), /official HTTPS/)
      assert.equal(requests.length, 1, 'unsafe redirects must never be contacted')
      await empty()
    }
    intercept(() => new Response(null, { status: 302, headers: { location: artifact.url } }))
    await assert.rejects(downloadSystemUpdateArtifact(artifact, destination, options), /excessive/)
    assert.equal(requests.length, 6)
    intercept(() => { throw new Error('unexpected request') })
    await assert.rejects(downloadSystemUpdateArtifact({ ...artifact, apiUrl: 'https://evil.test/package' }, destination, options), /official HTTPS/)
    assert.equal(requests.length, 0)

    // Real loopback HTTP responses exercise interrupted bodies and AbortSignal,
    // without weakening production HTTPS/host validation or contacting GitHub.
    let mode = 'disconnect', count = 0, cancelled = 0
    const server = createServer((_request, response) => {
      count++
      if (mode === 'stall-headers') { response.on('close', () => { cancelled++ }); return }
      response.writeHead(200, { 'Content-Length': payload.length })
      if (mode === 'stall-body') { response.write(payload.subarray(0, 3)); response.on('close', () => { cancelled++ }); return }
      if (mode === 'disconnect' && count === 1) {
        response.write(payload.subarray(0, 3)); setTimeout(() => response.destroy(), 10); return
      }
      response.end(payload)
    })
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    try {
      intercept((_url, init) => originalFetch(`http://127.0.0.1:${address.port}/fixture`, init))
      await downloadSystemUpdateArtifact(artifact, destination, options)
      assert.equal(count, 2)
      assert.deepEqual(await readFile(destination), payload)
      assert.deepEqual(await readdir(directory), ['package'], 'only the complete verified file is retained')
      await rm(destination)
      for (mode of ['stall-headers', 'stall-body']) {
        count = 0; cancelled = 0
        await assert.rejects(downloadSystemUpdateArtifact(artifact, destination, { ...options, timeoutMs: 80 }), /timed out; download failed after 3 attempts/)
        assert.equal(count, 3)
        await new Promise(done => setTimeout(done, 20))
        assert.equal(cancelled, 3, 'each timed-out socket/body is closed before returning')
        await empty()
      }
    } finally {
      server.closeAllConnections()
      await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()))
    }

    process.env.SYSTEM_UPDATE_RELEASE_REPOSITORY = 'owner/repo'
    process.env.SYSTEM_UPDATE_RELEASE_TOKEN = options.token
    const manifestUrl = 'https://github.com/owner/repo/releases/download/v1.8.4/ota-manifest.json'
    const release = { tag_name: 'v1.8.4', draft: false, assets: [
      { id: 41, name: 'ota-manifest.json', browser_download_url: manifestUrl },
      { id: 42, name: artifact.name, size: artifact.size, digest: `sha256:${artifact.sha256}`, browser_download_url: artifact.url }
    ] }
    let manifestArtifact: OtaArtifactInfo = { ...artifact, apiUrl: 'https://evil.test/injected' }
    intercept(url => {
      if (url.endsWith('/releases/tags/v1.8.4')) return Response.json(release)
      if (url === manifestUrl) return new Response('', { status: 504 })
      assert.equal(url, 'https://api.github.com/repos/owner/repo/releases/assets/41')
      return Response.json({ artifacts: [manifestArtifact] })
    })
    const ota = await getOtaReleaseInfo('v1.8.4')
    assert.equal(ota.error, null)
    assert.deepEqual(ota.artifacts, [artifact], 'fallback identity is derived from matching Release metadata, ignoring injected manifest URL')
    for (const invalid of [{ sha256: 'a'.repeat(64) }, { size: payload.length + 1 }, { url: 'https://github.com/other/repo/file' }, { name: '../package' }]) {
      manifestArtifact = { ...artifact, ...invalid }
      const failed = await getOtaReleaseInfo('v1.8.4')
      assert.equal(failed.manifestAvailable, false)
      assert.deepEqual(failed.artifacts, [])
    }
    release.tag_name = 'v1.8.3'
    assert.equal((await getOtaReleaseInfo('v1.8.4')).manifestAvailable, false)
    intercept(() => new Response('malformed private-fixture JSON'))
    await assert.rejects(fetchReleaseJson(manifestUrl, undefined, options), /^Error: Invalid GitHub Release JSON$/)
    assert.equal(requests.length, 1)
    intercept(() => new Response('x'.repeat(4 * 1024 * 1024 + 1)))
    await assert.rejects(fetchReleaseJson(manifestUrl, undefined, options), /size limit/)
    await empty()
    console.log('OTA download regression passed: 504 API fallback, credentials, integrity, retries, real disconnects/timeouts and metadata binding')
  } finally {
    globalThis.fetch = originalFetch
    if (oldRepository === undefined) delete process.env.SYSTEM_UPDATE_RELEASE_REPOSITORY
    else process.env.SYSTEM_UPDATE_RELEASE_REPOSITORY = oldRepository
    if (oldToken === undefined) delete process.env.SYSTEM_UPDATE_RELEASE_TOKEN
    else process.env.SYSTEM_UPDATE_RELEASE_TOKEN = oldToken
    await rm(directory, { recursive: true, force: true })
  }
}
