import { createServer, type ServerOptions } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ControllerConfigError } from '../lib/controller-config.js'
import { createGatewayAuth } from './gateway-auth.js'

export interface GatewayConsoleStatus {
  gatewayId: string; slot: 'a'|'b'; address: string; componentVersion: string
  configurationEpoch: string; configurationSequence: string; transportReady: boolean
  canWrite: boolean; blockers: string[]
  peers: Array<{ nodeId: string; address: string; enabled: boolean; lastHandshakeAt: number }>
  backup: { lastCompletedAt: number|null; ready: boolean }
}
type Auth = Awaited<ReturnType<typeof createGatewayAuth>>
const COOKIE = '__Host-payincus_gateway'
function sessionToken(request: IncomingMessage): string {
  const raw = request.headers.cookie || ''
  if (raw.length > 2048) throw new ControllerConfigError('GATEWAY_SESSION_INVALID')
  const values = raw.split(';').map(value => value.trim()).filter(value => value.startsWith(COOKIE + '='))
  if (values.length !== 1) throw new ControllerConfigError('GATEWAY_SESSION_INVALID')
  return values[0].slice(COOKIE.length + 1)
}
async function requestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers['content-type'] !== 'application/json' || request.headers['content-encoding'] !== undefined ||
    Number(request.headers['content-length'] || 0) > 2048) throw new ControllerConfigError('GATEWAY_REQUEST_INVALID')
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 2048) throw new ControllerConfigError('GATEWAY_REQUEST_INVALID')
    chunks.push(Buffer.from(chunk))
  }
  const raw = new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks)), data = JSON.parse(raw)
  if (!data || typeof data !== 'object' || Array.isArray(data) || raw !== JSON.stringify(data)) throw new ControllerConfigError('GATEWAY_REQUEST_INVALID')
  return data
}

// Independent HTTPS browser console; it does not run app.ts/Prisma and does
// not proxy Incus, shell or business operations. Origin+CSRF are both required
// for cookie-authenticated mutations. All status is supplied by local collectors.
export async function createGatewayConsoleServer(tls: ServerOptions, options: {
  origin: string; auth: Auth; assetDirectory: string; status: () => Promise<GatewayConsoleStatus>
}) {
  const origin = new URL(options.origin)
  if (origin.protocol !== 'https:' || origin.origin !== options.origin || !tls.key || !tls.cert || tls.requestCert) throw new Error('gateway console configuration invalid')
  const assets = new Map<string, { type: string; data: Buffer }>()
  for (const [path, name, type] of [['/', 'index.html', 'text/html; charset=utf-8'], ['/console.css', 'console.css', 'text/css; charset=utf-8'],
    ['/console.js', 'console.js', 'text/javascript; charset=utf-8']]) {
    assets.set(path, { type, data: await readFile(join(options.assetDirectory, name)) })
  }
  const rates = new Map<string, { start: number; count: number }>()
  let active = 0
  const server = createServer({ ...tls, minVersion: 'TLSv1.3' }, async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
    response.setHeader('Strict-Transport-Security', 'max-age=31536000')
    const reply = (status: number, data: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data))
    }
    if (request.headers.host !== origin.host) { reply(400, { code: 'GATEWAY_HOST_INVALID' }); return }
    const now = Date.now(), ip = request.socket.remoteAddress || 'unknown'
    if (rates.size >= 4096) for (const [key, value] of rates) if (now - value.start > 60000) rates.delete(key)
    if (!rates.has(ip) && rates.size >= 4096) { reply(429, { code: 'GATEWAY_RATE_LIMIT' }); return }
    const saved = rates.get(ip), rate = saved && now - saved.start < 60000 ? saved : { start: now, count: 0 }
    rate.count++; rates.set(ip, rate)
    if (rate.count > 120 || active >= 16) { reply(429, { code: 'GATEWAY_RATE_LIMIT' }); return }
    if (request.method === 'GET' && assets.has(request.url || '')) {
      const asset = assets.get(request.url!)!
      response.writeHead(200, { 'Content-Type': asset.type }); response.end(asset.data); return
    }
    const path = request.url
    if (!['/api/login', '/api/session', '/api/status', '/api/reauthenticate', '/api/logout'].includes(path || '') ||
      !((request.method === 'GET' && (path === '/api/session' || path === '/api/status')) ||
        (request.method === 'POST' && ['/api/login', '/api/reauthenticate', '/api/logout'].includes(path || '')))) {
      reply(404, { code: 'GATEWAY_ENDPOINT_UNKNOWN' }); return
    }
    if (request.method === 'POST' && request.headers.origin !== options.origin) { reply(403, { code: 'GATEWAY_ORIGIN_INVALID' }); return }
    if (request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site'] as string)) {
      reply(403, { code: 'GATEWAY_ORIGIN_INVALID' }); return
    }
    active++
    let authenticated = false
    try {
      if (path === '/api/login') {
        const body = await requestBody(request)
        const result = await options.auth.login(body as unknown as { username: string; password: string; totp?: string; recoveryCode?: string })
        response.setHeader('Set-Cookie', `${COOKIE}=${result.token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=3600`)
        reply(200, { username: result.username, role: result.role, csrf: result.csrf })
      } else {
        const token = sessionToken(request)
        const csrf = request.headers['x-gateway-csrf']
        if (request.method === 'POST' && typeof csrf !== 'string') throw new ControllerConfigError('GATEWAY_CSRF_INVALID')
        const session = await options.auth.session(token, request.method === 'POST' ? csrf as string : undefined)
        authenticated = true
        if (path === '/api/session') reply(200, session)
        else if (path === '/api/status') reply(200, await options.status())
        else if (path === '/api/reauthenticate') {
          const body = await requestBody(request)
          await options.auth.reauthenticate(token, csrf as string, body as unknown as { password: string; totp?: string; recoveryCode?: string })
          reply(200, { reauthenticated: true, expiresInSeconds: 120 })
        } else {
          const body = await requestBody(request)
          if (Object.keys(body).length) throw new ControllerConfigError('GATEWAY_REQUEST_INVALID')
          options.auth.logout(token)
          response.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`)
          reply(200, { loggedOut: true })
        }
      }
    } catch {
      const unavailable = path === '/api/status' && authenticated
      if (!response.headersSent) reply(unavailable ? 503 : 401, { code: unavailable ? 'GATEWAY_STATUS_UNAVAILABLE' : 'GATEWAY_AUTH_REJECTED' })
    } finally { active-- }
  })
  server.requestTimeout = 10000; server.headersTimeout = 5000; server.keepAliveTimeout = 5000
  server.maxHeadersCount = 32; server.maxConnections = 128
  return server
}
