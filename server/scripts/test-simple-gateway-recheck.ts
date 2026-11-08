import assert from 'node:assert/strict'
import Fastify from 'fastify'
import ssh2 from 'ssh2'
import { mkdtemp, writeFile, readFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prisma } from '../src/db/prisma.js'
import { registerSimpleGatewaySetupRoutes } from '../src/routes/simple-gateway-setup.js'
import { simpleGatewayStatus, requestSimpleGatewaySetup, confirmSimpleGatewaySetup } from '../src/services/simple-gateway-setup.js'
import { sshFingerprint } from '../src/services/onboarding-ssh.js'

// Real loopback SSH transport and production service/HTTP handlers. Database
// reads are a fixture; writes and host commands are not needed for rechecking.
const folder = await mkdtemp(join(tmpdir(), 'payincus-gateway-check-'))
const keyPath = join(folder, 'key'), keys = ssh2.utils.generateKeyPairSync('ed25519')
const parsed = ssh2.utils.parseKey(keys.private)
assert.ok(!(parsed instanceof Error))
await writeFile(keyPath, keys.private, { mode: 0o600 })
const commands: string[] = [], connections = new Set<import('ssh2').Connection>()
let failing = false
const server = new ssh2.Server({ hostKeys: [keys.private] }, connection => {
  connections.add(connection); connection.on('close', () => connections.delete(connection))
  connection.on('error', () => {}) // Expected when the client rejects the changed host key.
  connection.on('authentication', context => context.method === 'publickey' ? context.accept() : context.reject())
  connection.on('ready', () => connection.on('session', accept => accept().on('exec', (accept, _reject, info) => {
    commands.push(info.command)
    const stream = accept()
    stream.on('data', () => {})
    stream.on('end', () => {
      if (info.command !== 'status' || failing) { stream.exit(1); stream.end(); return }
      stream.write(JSON.stringify({ publicKey: Buffer.alloc(32, 7).toString('base64'), controlIp: '10.253.240.1',
        network: '10.253.240.0/20', managementSshPublicKey: keys.public.trim(), dnsProtocolVersion: 2 }))
      stream.exit(0); stream.end()
    })
  })))
})
const environment = { ...process.env }, originalFind = prisma.systemConfig.findUnique, originalUser = prisma.user.findUnique
const app = Fastify()
try {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  Object.assign(process.env, { ONBOARDING_GATEWAY_HOST: '127.0.0.1', ONBOARDING_GATEWAY_PORT: String((server.address() as { port: number }).port),
    ONBOARDING_GATEWAY_KEY_PATH: keyPath, ONBOARDING_GATEWAY_FINGERPRINT: sshFingerprint(parsed.getPublicSSH()),
    ONBOARDING_WG_ENDPOINT: 'gateway.example.com:51820', ADMIN_FRONTEND_URL: 'https://admin.example.com' })
  prisma.systemConfig.findUnique = (async (input: any) => {
    assert.equal(input.where.key, 'onboarding_gateway_dns_endpoint', 'read-only route never loads installation history')
    return { value: JSON.stringify({ hostname: 'gateway.example.com', port: 51820 }) }
  }) as typeof originalFind
  prisma.user.findUnique = (async () => ({ role: 'admin', status: 'active' })) as unknown as typeof originalUser
  app.decorate('authenticateAdmin', async (request, reply) => {
    if (request.headers['x-role'] !== 'admin') return reply.code(403).send({ code: 'ADMIN_REQUIRED' })
    request.user = { id: 1, username: 'fixture', role: 'admin', sid: 'fixture-session' }
  })
  await registerSimpleGatewaySetupRoutes(app)
  const headers = { 'x-role': 'admin', origin: 'https://admin.example.com', authorization: 'Bearer fixture' }
  for (let n = 0; n < 3; n++) {
    const response = await app.inject({ url: '/gateway/setup/check', headers })
    assert.equal(response.statusCode, 200); assert.equal(response.json().ready, true)
    assert.equal(response.json().setupAllowed, false)
  }
  assert.deepEqual(commands, ['status', 'status', 'status'])
  const id = '22222222-2222-4222-8222-222222222222'
  await assert.rejects(requestSimpleGatewaySetup({ requestId: id }, 1, 'fixture-session'), /ALREADY_CONFIGURED/)
  await assert.rejects(confirmSimpleGatewaySetup(id, 'a'.repeat(64), 1, 'fixture-session', 'gateway.example.com'), /ALREADY_CONFIGURED/,
    'even an old/nonexistent plan is rejected before files or service commands')
  assert.equal((await app.inject({ method: 'POST', url: '/gateway/setup', headers, payload: { requestId: id } })).json().code, 'SIMPLE_GATEWAY_ALREADY_CONFIGURED')
  assert.equal((await app.inject({ method: 'POST', url: `/gateway/setup/${id}/confirm`, headers, payload: { planHash: 'a'.repeat(64) } })).json().code, 'SIMPLE_GATEWAY_ALREADY_CONFIGURED')
  failing = true
  const failed = await simpleGatewayStatus()
  assert.equal(failed.ready, false); assert.equal(failed.local, true); assert.equal(failed.setupAllowed, false)
  await assert.rejects(confirmSimpleGatewaySetup(id, 'a'.repeat(64), 1, 'fixture-session'), /ALREADY_CONFIGURED/)
  process.env.ONBOARDING_GATEWAY_FINGERPRINT = 'SHA256:wrong'
  const changed = await simpleGatewayStatus()
  assert.equal(changed.ready, false); assert.equal(changed.code, 'SSH_HOST_KEY_CHANGED'); assert.equal(changed.setupAllowed, false)
  delete process.env.ONBOARDING_GATEWAY_FINGERPRINT
  const partial = await simpleGatewayStatus()
  assert.equal(partial.ready, false); assert.equal(partial.setupAllowed, false)
  assert.deepEqual(commands, ['status', 'status', 'status', 'status'], 'failed/partial identities never install, restart or send host commands')
  assert.equal(await readFile(keyPath, 'utf8'), keys.private)
  console.log('PASS loopback SSH + actual HTTP/service: repeated check issues status only; old confirm, direct repeat, offline, changed identity and partial config remain protected')
} finally {
  await app.close()
  for (const connection of connections) connection.end()
  await new Promise<void>(resolve => server.close(() => resolve()))
  prisma.systemConfig.findUnique = originalFind; prisma.user.findUnique = originalUser
  for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key]
  Object.assign(process.env, environment)
  await unlink(keyPath); await rmdir(folder)
}
