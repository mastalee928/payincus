import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import type { OtaArtifactInfo } from './system-version.js'

const releaseHosts = new Set(['github.com', 'api.github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'])
const transientStatuses = new Set([408, 429, 500, 502, 503, 504])
class RetryableDownloadError extends Error {}

interface DownloadOptions {
  token?: string | null
  log?: (message: string) => Promise<void>
  timeoutMs?: number
  retryDelayMs?: number
}

function trustedUrl(raw: string): URL {
  let url: URL
  try { url = new URL(raw) }
  catch { throw new Error('Invalid OTA download URL') }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !releaseHosts.has(url.hostname)) {
    throw new Error('OTA download must use an official HTTPS GitHub Release host')
  }
  return url
}

function isNetworkFailure(error: unknown): boolean {
  const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code
    || (error as { code?: string })?.code || ''
  return /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|UND_ERR_(SOCKET|CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT))$/.test(code)
}

// Keep the deadline alive until the body is consumed, and rebuild credentials
// on every redirect. A signed CDN location never receives the Release token.
async function transfer<T>(url: string, apiUrl: string | undefined, accept: string, options: DownloadOptions,
  consume: (response: Response, signal: AbortSignal) => Promise<T>): Promise<T> {
  trustedUrl(url)
  if (apiUrl) {
    const api = trustedUrl(apiUrl)
    if (api.hostname !== 'api.github.com' || !/^\/repos\/[^/]+\/[^/]+\/releases\/assets\/\d+$/.test(api.pathname) || api.search || api.hash) {
      throw new Error('Invalid official OTA asset API URL')
    }
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 300000)
    let response: Response | undefined
    try {
      const start = trustedUrl(attempt > 0 && apiUrl ? apiUrl : url)
      let current = start
      for (let redirects = 0; ; redirects++) {
        const headers: Record<string, string> = {
          'user-agent': 'payincus-online-update',
          accept: attempt > 0 && apiUrl ? 'application/octet-stream' : accept
        }
        if (options.token && current.origin === start.origin && ['github.com', 'api.github.com'].includes(current.hostname)) {
          headers.authorization = `Bearer ${options.token}`
        }
        response = await fetch(current, { headers, redirect: 'manual', signal: controller.signal })
        if (![301, 302, 303, 307, 308].includes(response.status)) break
        const location = response.headers.get('location')
        await response.body?.cancel()
        if (!location || redirects >= 5) throw new Error('Invalid or excessive OTA download redirects')
        current = trustedUrl(new URL(location, current).href)
      }
      if (response.status !== 200 || !response.body) {
        const message = `Failed to download OTA artifact: HTTP ${response.status}`
        if (transientStatuses.has(response.status)) throw new RetryableDownloadError(message)
        throw new Error(message)
      }
      return await consume(response, controller.signal)
    } catch (error) {
      const retryable = error instanceof RetryableDownloadError || controller.signal.aborted || isNetworkFailure(error)
      // Never persist response bodies, tokens, or signed redirect URLs in logs.
      const message = controller.signal.aborted ? 'OTA download timed out' : error instanceof RetryableDownloadError
        ? error.message : isNetworkFailure(error) ? 'OTA download connection interrupted' : 'OTA download rejected'
      if (!retryable || attempt === 2) {
        if (retryable) throw new Error(`${message}; download failed after ${attempt + 1} attempts`)
        throw error
      }
      await options.log?.(`${message}; retry ${attempt + 2}/3${apiUrl ? ' using official GitHub asset API' : ''}`)
    } finally {
      clearTimeout(timer)
      await response?.body?.cancel().catch(() => {})
    }
    await delay(options.retryDelayMs ?? (attempt + 1) * 1000)
  }
  throw new Error('OTA download attempts exhausted')
}

export async function fetchReleaseJson<T>(url: string, apiUrl?: string, options: DownloadOptions = {}): Promise<T> {
  return await transfer(url, apiUrl, 'application/vnd.github+json', { timeoutMs: 45000, ...options }, async (response, signal) => {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of Readable.fromWeb(response.body!, { signal })) {
      const bytes = Buffer.from(chunk)
      size += bytes.length
      if (size > 4 * 1024 * 1024) throw new Error('GitHub Release JSON exceeds size limit')
      chunks.push(bytes)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T }
    catch { throw new Error('Invalid GitHub Release JSON') }
  })
}

export async function downloadSystemUpdateArtifact(artifact: OtaArtifactInfo, destination: string, options: DownloadOptions = {}): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(artifact.sha256) || (artifact.size !== null && (!Number.isSafeInteger(artifact.size) || artifact.size <= 0))) {
    throw new Error('Invalid OTA artifact integrity metadata')
  }
  await transfer(artifact.url, artifact.apiUrl, 'application/octet-stream', options, async (response, signal) => {
    const temporary = `${destination}.${randomUUID()}.part`
    const hash = createHash('sha256')
    let size = 0
    const verify = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length
      if (size > (artifact.size ?? 4 * 1024 ** 3)) return callback(new Error('OTA artifact exceeds expected size'))
      hash.update(chunk)
      callback(null, chunk)
    } })
    try {
      await pipeline(Readable.fromWeb(response.body!), verify, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), { signal })
      if (artifact.size !== null && size !== artifact.size) throw new Error(`OTA artifact size mismatch: expected ${artifact.size}, got ${size}`)
      const actual = hash.digest('hex')
      if (actual !== artifact.sha256) throw new Error(`OTA artifact sha256 mismatch: expected ${artifact.sha256}, got ${actual}`)
      signal.throwIfAborted()
      await rename(temporary, destination)
      await options.log?.(`OTA artifact verified: sha256=${actual}`)
    } finally {
      await rm(temporary, { force: true })
    }
  })
}
