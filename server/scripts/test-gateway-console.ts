import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises'
import { request } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createGatewayAuth, initializeGatewayAuth } from '../src/services/gateway-auth.js'
import { createGatewayConsoleServer } from '../src/services/gateway-console.js'

const directory = await mkdtemp(join(tmpdir(), 'payincus-gateway-console-'))
const exec = promisify(execFile)
const openssl = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl'
const origin = 'https://gateway.example.test:18444'
const recoveryCodes = Array.from({ length: 8 }, () => randomBytes(24).toString('base64url'))
const password = 'test-console-password-1234'
let server: Awaited<ReturnType<typeof createGatewayConsoleServer>> | undefined
let checks = 0, statusCalls = 0
try {
  await chmod(directory, 0o700)
  await initializeGatewayAuth(directory, { username: 'operator', password, role: 'operator', totpSeed: randomBytes(20).toString('base64'), recoveryCodes })
  const auth = await createGatewayAuth(directory)
  await exec(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, 'tls.key'), '-out', join(directory, 'tls.crt'),
    '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'])
  const key = await readFile(join(directory, 'tls.key')), cert = await readFile(join(directory, 'tls.crt'))
  server = await createGatewayConsoleServer({ key, cert }, { origin, auth, assetDirectory: fileURLToPath(new URL('../src/gateway-ui', import.meta.url)),
    status: async () => { statusCalls++; return { gatewayId: '22222222-2222-4222-8222-222222222222', slot: 'a', address: '10.250.1.1', componentVersion: 'test',
      configurationEpoch: '2', configurationSequence: '1', transportReady: true, canWrite: false, blockers: ['host-write-service-not-ready'], peers: [], backup: { ready: false, lastCompletedAt: null } } } })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const send = async (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => {
    return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
      const r = request({ hostname: '127.0.0.1', port: address.port, path, method, ca: cert, servername: 'localhost', agent: false,
        headers: { Host: new URL(origin).host, 'Content-Type': 'application/json', ...headers } }, response => {
        let body = ''; response.on('data', data => { body += data }); response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, body }))
      })
      r.setTimeout(3000, () => r.destroy(new Error('timeout'))); r.once('error', reject); r.end(body === undefined ? undefined : JSON.stringify(body))
    })
  }
  const page = await send('/'); assert.equal(page.status, 200); assert.ok(page.body.includes('网关控制台')); checks++
  const collector = await readFile(new URL('../src/services/gateway-status.ts', import.meta.url), 'utf8')
  assert.ok(collector.includes("['-j', '-4', 'route', 'show']") && collector.includes('route.dev === name'))
  assert.ok(!collector.includes("['-j', '-4', 'route', 'show', 'dev', name]")); checks++
  assert.ok(String(page.headers['content-security-policy']).includes("script-src 'self'")); assert.equal(page.headers['x-frame-options'], 'DENY'); checks++
  for (const path of ['/api/status', '/api/session']) assert.equal((await send(path)).status, 401)
  assert.equal(statusCalls, 0); checks++
  const credentials = { username: 'operator', password, recoveryCode: recoveryCodes[0] }
  assert.equal((await send('/api/login', 'POST', credentials)).status, 403); checks++
  assert.equal((await send('/api/login', 'POST', credentials, { Origin: 'https://other.example.test' })).status, 403); checks++
  assert.equal((await send('/api/login', 'POST', credentials, { Origin: origin, 'Sec-Fetch-Site': 'cross-site' })).status, 403); checks++
  assert.equal((await send('/api/login?x=1', 'POST', credentials, { Origin: origin })).status, 404); checks++
  const login = await send('/api/login', 'POST', credentials, { Origin: origin }); assert.equal(login.status, 200)
  const cookie = (login.headers['set-cookie'] as string[])[0], csrf = JSON.parse(login.body).csrf as string
  assert.ok(cookie.includes('__Host-payincus_gateway=') && cookie.includes('HttpOnly') && cookie.includes('Secure') && cookie.includes('SameSite=Strict') && !cookie.includes('Domain=')); checks++
  assert.ok(!login.body.includes('token') && !login.body.includes('password') && !login.body.includes(recoveryCodes[0])); checks++
  const sessionCookie = cookie.split(';')[0]
  assert.equal((await send('/api/status', 'GET', undefined, { Cookie: sessionCookie })).status, 200); assert.equal(statusCalls, 1); checks++
  assert.equal((await send('/api/logout', 'POST', {}, { Origin: origin, Cookie: sessionCookie })).status, 401); checks++
  assert.equal((await send('/api/logout', 'POST', {}, { Origin: origin, Cookie: sessionCookie, 'X-Gateway-CSRF': 'wrong' })).status, 401); checks++
  assert.equal((await send('/api/session', 'GET', undefined, { Cookie: sessionCookie })).status, 200); checks++
  assert.equal((await send('/api/reauthenticate', 'POST', { password, recoveryCode: recoveryCodes[1] }, { Origin: origin, Cookie: sessionCookie, 'X-Gateway-CSRF': csrf })).status, 200); checks++
  assert.equal((await send('/api/logout', 'POST', {}, { Origin: origin, Cookie: sessionCookie, 'X-Gateway-CSRF': csrf })).status, 200); checks++
  assert.equal((await send('/api/session', 'GET', undefined, { Cookie: sessionCookie })).status, 401); checks++
  assert.equal((await send('/api/exec', 'POST', { command: 'id' }, { Origin: origin, Cookie: sessionCookie })).status, 404); checks++
  const installer = await readFile(new URL('../../scripts/install-gateway-console.sh', import.meta.url), 'utf8')
  assert.ok(installer.includes('--plan') && installer.includes('explicit account initialization required'))
  assert.ok(installer.includes('ReadWritePaths=$auth') && installer.includes('MemoryMax=256M'))
  assert.ok(!/Requires=.*(?:incudal-backend|postgres|nginx)|PartOf=|BindsTo=/.test(installer)); checks++
  console.log(`Gateway HTTPS console passed: ${checks} cookie, CSP, Origin/CSRF, login/session/recovery and fixed endpoint checks`)
} finally {
  if (server) await new Promise<void>(resolve => { server!.close(() => resolve()); server!.closeAllConnections() })
  await rm(directory, { recursive: true, force: true })
}
