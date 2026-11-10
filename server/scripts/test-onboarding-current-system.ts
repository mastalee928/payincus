import assert from 'node:assert/strict'
import type { Prisma } from '@prisma/client'
import { randomUUID, generateKeyPairSync } from 'node:crypto'
import { once } from 'node:events'
import ssh2 from 'ssh2'
import Fastify from 'fastify'
import { writeFile, unlink, mkdtemp, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(database.hostname === '127.0.0.1' && database.pathname.endsWith('_pool_test'))
process.env.ENCRYPTION_KEY = 'onboarding-current-system-fixture'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { inspectCurrentOnboardingSystem, enrollOnboardingGateway, processOnboardingRetirements } = await import('../src/services/onboarding-lifecycle.js')
const { sshFingerprint } = await import('../src/services/onboarding-ssh.js')
const { deleteHost } = await import('../src/db/hosts.js')
const { claimHostOnboardingNode } = await import('../src/workers/hostOnboardingWorker.js')
const { default: routes } = await import('../src/routes/host-onboarding.js')
const id = randomUUID(), actor = await prisma.user.create({ data: { username: 'current-' + id, passwordHash: 'fixture', role: 'admin' } })
const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' })
let preflightFailure = false
const fixtureConnections = new Set<ssh2.Connection>()
const ssh = new ssh2.Server({ hostKeys: [key] }, connection => {
  fixtureConnections.add(connection); connection.on('close', () => fixtureConnections.delete(connection))
  connection.on('error', () => {})
  connection.on('authentication', context => context.method === 'password' && context.password === 'current-root-fixture' ? context.accept() : context.reject())
  connection.on('ready', () => connection.on('session', accept => {
    accept().on('exec', (accept, _reject, info) => {
      assert.equal(info.command, 'sh -s')
      const channel = accept(); let input = ''
      channel.on('data', (data: Buffer) => { input += data.toString() })
      channel.on('end', () => {
        assert.ok(input.includes('HOST_HAS_INSTANCES'))
        channel.write(preflightFailure ? 'INCUDAL_ERROR:HOST_HAS_INSTANCES\n' : 'INCUDAL_PREFLIGHT_OK\n')
        channel.exit(preflightFailure ? 1 : 0); channel.end()
      })
    })
  }))
})
ssh.listen(0, '127.0.0.1'); await once(ssh, 'listening')
const gatewayKey = ssh2.utils.generateKeyPairSync('ed25519')
const fixtureDirectory = await mkdtemp(join(tmpdir(), 'payincus-onboarding-'))
const keyFile = pathToFileURL(join(fixtureDirectory, 'gateway.private.key'))
await writeFile(keyFile, gatewayKey.private, { mode: 0o600 })
const oldPeer = { nodePublicKey: Buffer.alloc(32, 8).toString('base64'), managementIp: '10.253.240.6' }
let registration: typeof oldPeer | null = { ...oldPeer }, retireCalls = 0, failRetire = false, failAdd = false, helperVersion = true
const retiredRequests = new Set<string>()
const gatewayStatus = () => ({ publicKey: Buffer.alloc(32, 19).toString('base64'), controlIp: '10.253.240.1', network: '10.253.240.0/20',
  managementSshPublicKey: gatewayKey.public, ...(helperVersion ? { retirementProtocolVersion: 1 } : {}) })
const gateway = new ssh2.Server({ hostKeys: [key] }, connection => {
  connection.on('error', () => {})
  connection.on('authentication', ctx => ctx.method === 'publickey' ? ctx.accept() : ctx.reject())
  connection.on('ready', () => connection.on('session', accept => accept().on('exec', (accept, _reject, info) => {
    const channel = accept(); let input = ''
    channel.on('data', (data: Buffer) => { input += data.toString() })
    channel.on('end', () => { void (async () => {
      const [op, nodeId, publicKey] = info.command.split(' ')
      let result: unknown
      if (op === 'status') result = gatewayStatus()
      else if (op === 'registration') result = { nodeId, registration }
      else if (op === 'retire') {
        const request = JSON.parse(input)
        assert.ok(request.expiresAt > Date.now())
        // Intent must already be committed before the gateway changes.
        const node = await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { id: nodeId } })
        assert.equal((node.peerRetirement as { requestId: string }).requestId, request.requestId)
        if (!retiredRequests.has(request.requestId)) {
          assert.deepEqual(registration, { nodePublicKey: request.nodePublicKey, managementIp: request.managementIp })
          registration = null; retiredRequests.add(request.requestId); retireCalls++
        }
        // Heartbeat can update the row while the remote retirement is in flight.
        await prisma.hostOnboardingNode.update({ where: { id: nodeId }, data: { leaseUntil: new Date(Date.now() + 60000) } })
        if (failRetire) { failRetire = false; channel.write('INCUDAL_ERROR:GATEWAY_RETIREMENT_FAILED\n'); channel.exit(1); channel.end(); return }
        result = { nodeId, registrationRetired: true }
      } else if (op === 'add') {
        if (failAdd) { failAdd = false; channel.write('INCUDAL_ERROR:GATEWAY_RECOVERY_BUSY\n'); channel.exit(1); channel.end(); return }
        if (registration) assert.equal(registration.nodePublicKey, publicKey)
        registration = { nodePublicKey: publicKey, managementIp: '10.253.240.6' }; result = { ...gatewayStatus(), managementIp: registration.managementIp }
      } else throw Error('Unexpected gateway fixture operation')
      channel.write(JSON.stringify(result)); channel.exit(0); channel.end()
    })().catch(error => { console.error(error); channel.exit(1); channel.end() }) })
  })))
})
gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening')
process.env.ONBOARDING_GATEWAY_HOST = '127.0.0.1'
process.env.ONBOARDING_GATEWAY_PORT = String((gateway.address() as { port: number }).port)
process.env.ONBOARDING_GATEWAY_KEY_PATH = fileURLToPath(keyFile)
const parsedKey = ssh2.utils.parseKey(key); assert.ok(!(parsedKey instanceof Error) && !Array.isArray(parsedKey))
process.env.ONBOARDING_GATEWAY_FINGERPRINT = sshFingerprint(parsedKey.getPublicSSH())
process.env.ONBOARDING_WG_ENDPOINT = '8.8.8.8:51820'
process.env.PUBLIC_URL = 'https://fixture.example.com'
const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } })
app.decorate('authenticateAdmin', async (request, reply) => {
  if (request.headers['x-test-role'] !== 'admin') return reply.code(403).send({ code: 'ADMIN_REQUIRED' })
  request.user = { id: actor.id, username: actor.username, role: 'admin' }
})
await app.register(routes, { prefix: '/onboarding' })
const headers = { 'x-test-role': 'admin' }
try {
  const batch = await prisma.hostOnboardingBatch.create({ data: { id, createdById: actor.id, name: id, accountLabel: '', defaults: {},
    nodes: { create: { name: 'reinstalled', publicIp: '127.0.0.1', sshPort: (ssh.address() as { port: number }).port, credentialsExpireAt: new Date(Date.now() + 3600000),
      sshFingerprint: 'old-system', managementIp: '10.253.240.6', nodePublicKey: Buffer.alloc(32, 8).toString('base64'), status: 'failed', step: 'checking' } } }, include: { nodes: true } })
  const node = batch.nodes[0]!
  const retry = () => app.inject({ method: 'POST', url: `/onboarding/nodes/${node.id}/retry`, headers, payload: { password: 'current-root-fixture' } })
  assert.equal((await retry()).statusCode, 200)
  let claimed = (await claimHostOnboardingNode())!
  await prisma.hostOnboardingNode.update({ where: { id: node.id }, data: { leaseUntil: new Date(Date.now() - 1000) } })
  await assert.rejects(() => inspectCurrentOnboardingSystem(claimed, actor.id, { password: 'current-root-fixture' }), /WORKER_INTERRUPTED/)
  await assert.rejects(() => enrollOnboardingGateway(claimed, oldPeer.nodePublicKey, false), /WORKER_INTERRUPTED/)
  assert.equal(retireCalls, 0, 'expired enrollment cannot mutate a gateway')
  await prisma.hostOnboardingNode.update({ where: { id: node.id }, data: { leaseUntil: new Date(Date.now() + 60000) } })
  await prisma.user.update({ where: { id: actor.id }, data: { role: 'user' } })
  await assert.rejects(() => inspectCurrentOnboardingSystem(claimed, actor.id, { password: 'current-root-fixture' }), /ADMIN_REQUIRED/)
  await assert.rejects(() => enrollOnboardingGateway(claimed, oldPeer.nodePublicKey, false), /ADMIN_REQUIRED/)
  await prisma.user.update({ where: { id: actor.id }, data: { role: 'admin' } })
  await assert.rejects(() => inspectCurrentOnboardingSystem(claimed, actor.id, { password: 'wrong-root' }), /SSH_AUTH_FAILED/)
  assert.equal((await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { id: node.id } })).sshFingerprint, 'old-system')
  preflightFailure = true
  await assert.rejects(() => inspectCurrentOnboardingSystem(claimed, actor.id, { password: 'current-root-fixture' }), /HOST_HAS_INSTANCES/)
  assert.equal((await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { id: node.id } })).sshFingerprint, 'old-system')
  preflightFailure = false
  const client = await inspectCurrentOnboardingSystem(claimed, actor.id, { password: 'current-root-fixture' }); client.end()
  let current = await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { id: node.id } })
  assert.match(current.sshFingerprint!, /^SHA256:/)
  assert.equal((current.peerRetirement as { status: string }).status, 'pending')
  const changedFingerprint = current.sshFingerprint
  const originalIntent = current.identityReset as Prisma.InputJsonObject
  await prisma.hostOnboardingNode.update({ where: { id: node.id }, data: { identityReset: { ...originalIntent, verifiedFingerprint: 'SHA256:different-system' } } })
  await assert.rejects(() => inspectCurrentOnboardingSystem(claimed, actor.id, { password: 'current-root-fixture' }), /SSH_HOST_KEY_CHANGED/)
  assert.equal((await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { id: node.id } })).sshFingerprint, changedFingerprint)
  await prisma.hostOnboardingNode.update({ where: { id: node.id }, data: { identityReset: originalIntent } })
  await prisma.hostOnboardingNode.update({ where: { id: node.id }, data: { status: 'failed', leaseToken: null, leaseUntil: null } })
  assert.equal((await retry()).statusCode, 200); claimed = (await claimHostOnboardingNode())!
  const again = await inspectCurrentOnboardingSystem(claimed, actor.id, { password: 'current-root-fixture' }); again.end()
  assert.equal((await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { id: node.id } })).sshFingerprint, changedFingerprint)
  assert.equal(await prisma.log.count({ where: { action: 'host.onboarding.ssh_identity_refreshed', userId: actor.id } }), 1)
  await prisma.hostOnboardingNode.update({ where: { id: node.id }, data: { status: 'failed', leaseToken: null, leaseUntil: null } })
  const host = await prisma.host.create({ data: { userId: actor.id, name: 'registered-' + id, url: 'https://10.253.240.6:8443', natPublicIp: '8.8.4.4', ipAddress: '8.8.4.4', status: 'online', isInstalled: true } })
  const customer = await prisma.instance.create({ data: { hostId: host.id, userId: actor.id, name: 'customer-fixture', incusId: randomUUID(), image: 'debian', cpu: 1, memory: 256, disk: 10, status: 'running' } })
  await assert.rejects(() => deleteHost(host.id), /HOST_HAS_INSTANCES/)
  assert.equal(await prisma.host.count({ where: { id: host.id } }), 1, 'customer occupancy protects the Host')
  await prisma.instance.delete({ where: { id: customer.id } })
  await prisma.hostOnboardingNode.update({ where: { id: node.id }, data: { hostId: host.id, publicIp: '8.8.4.4', status: 'succeeded' } })
  const checked = await app.inject({ url: '/onboarding/address-check?address=8.8.4.4', headers })
  assert.equal(checked.statusCode, 200, checked.body); assert.equal(checked.json().conflict.host.id, host.id)
  assert.equal(checked.json().conflict.code, 'HOST_IP_ALREADY_REGISTERED')
  assert.equal((await app.inject({ url: '/onboarding/address-check?address=8.8.4.4' })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: '/onboarding', headers, payload: { requestId: randomUUID(), name: 'duplicate', accountLabel: '', defaults: { countryCode: 'us' }, credentials: { password: 'fixture' }, nodes: [{ name: 'duplicate', publicIp: '8.8.4.4' }] } })).json().code, 'HOST_IP_ALREADY_REGISTERED', 'duplicate check precedes gateway readiness')
  await deleteHost(host.id)
  current = await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { id: node.id } })
  assert.equal(current.hostId, null); assert.ok(current.deletedAt)
  assert.equal((current.peerRetirement as { status: string }).status, 'pending')
  assert.equal(current.credentialsEncrypted, null)
  assert.equal((await app.inject({ url: '/onboarding/address-check?address=8.8.4.4', headers })).json().conflict, null, 'removed historical node must not be presented as a live Host')
  assert.equal((await app.inject({ url: '/onboarding', headers })).json().retirements.length, 1, 'cleanup progress is visible after record deletion')
  const payload = { requestId: randomUUID(), name: 'new-system', accountLabel: '', defaults: { countryCode: 'us' }, credentials: { password: 'current-root-fixture' }, nodes: [{ name: 'new-system', publicIp: '8.8.4.4' }] }
  const recreated = await app.inject({ method: 'POST', url: '/onboarding', headers, payload })
  assert.equal(recreated.statusCode, 202, recreated.body)
  current = await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { id: node.id } })
  assert.equal(current.sshFingerprint, changedFingerprint, 'revival cannot replace identity before authentication')
  assert.equal((current.identityReset as { reason: string }).reason, 'new')
  claimed = (await claimHostOnboardingNode())!
  const newKey = Buffer.alloc(32, 20).toString('base64')
  helperVersion = false
  await assert.rejects(() => enrollOnboardingGateway(claimed, newKey, true), /GATEWAY_RETIREMENT_HELPER_REQUIRED/)
  assert.deepEqual(registration, oldPeer)
  helperVersion = true; failRetire = true
  await assert.rejects(() => enrollOnboardingGateway(claimed, newKey, true), /GATEWAY_RETIREMENT_FAILED/)
  assert.equal(retireCalls, 1); assert.equal(registration, null)
  failAdd = true
  await assert.rejects(() => enrollOnboardingGateway(claimed, newKey, true), /GATEWAY_RECOVERY_BUSY/)
  assert.equal((await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { id: node.id } })).peerRetirement &&
    ((await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { id: node.id } })).peerRetirement as { status: string }).status, 'done')
  const enrolled = await enrollOnboardingGateway(claimed, newKey, true)
  assert.equal(enrolled.managementIp, '10.253.240.6'); assert.equal(retireCalls, 1)
  current = await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { id: node.id } })
  assert.equal(current.nodePublicKey, newKey); assert.equal(current.identityReset, null)
  await assert.rejects(() => enrollOnboardingGateway({ ...claimed, leaseToken: randomUUID() }, newKey, true), /WORKER_INTERRUPTED/)
  assert.equal(retireCalls, 1, 'lost worker cannot mutate current registration')
  await prisma.hostOnboardingNode.update({ where: { id: node.id }, data: { status: 'failed', leaseToken: null, leaseUntil: null } })
  // Model add succeeding remotely with a lost DB response: old node fields,
  // durable enrollment key, and a current new gateway registration.
  await prisma.hostOnboardingNode.update({ where: { id: node.id }, data: { nodePublicKey: oldPeer.nodePublicKey } })
  await app.inject({ method: 'DELETE', url: `/onboarding/nodes/${node.id}`, headers })
  await processOnboardingRetirements()
  assert.equal(registration, null); assert.equal(retireCalls, 2)
  assert.equal((await app.inject({ url: '/onboarding', headers })).json().retirements.length, 0)
  const concurrentPayload = { ...payload, requestId: randomUUID(), nodes: [{ name: 'concurrent-fixture', publicIp: '1.1.1.1' }] }
  const attempts = await Promise.all([app.inject({ method: 'POST', url: '/onboarding', headers, payload: concurrentPayload }),
    app.inject({ method: 'POST', url: '/onboarding', headers, payload: { ...concurrentPayload, requestId: randomUUID() } })])
  assert.equal(attempts.filter(response => response.statusCode === 202).length, 1, 'concurrent same-IP submissions create one active task')
  assert.equal(await prisma.hostOnboardingNode.count({ where: { publicIp: '1.1.1.1', deletedAt: null } }), 1)
  assert.ok(attempts.some(response => response.json().code === 'HOST_IP_ONBOARDING'))
  const queued = await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { activePublicIp: '1.1.1.1' } })
  const { pendingPeerRetirement } = await import('../src/services/onboarding-lifecycle.js')
  const deferred = { ...pendingPeerRetirement(), nextAttemptAt: new Date(Date.now() + 300000).toISOString() }
  await prisma.hostOnboardingNode.update({ where: { id: queued.id }, data: { peerRetirement: deferred } })
  assert.equal(await claimHostOnboardingNode(), null, 'backoff must prevent immediate repeat gateway requests')
  await prisma.hostOnboardingNode.update({ where: { id: queued.id }, data: { peerRetirement: { ...deferred, nextAttemptAt: new Date(0).toISOString() } } })
  assert.equal((await claimHostOnboardingNode())?.id, queued.id, 'the persisted task becomes claimable when backoff expires')
  console.log('Current-system authentication, protected preflight, duplicate IP, delete/recreate, helper compatibility, durable retirement/lost receipt/add interruption, heartbeat and background cleanup passed (real local PG and SSH protocol, gateway OS fixture)')
} finally {
  for (const connection of fixtureConnections) connection.end()
  await app.close(); await new Promise<void>(resolve => ssh.close(() => resolve()))
  await new Promise<void>(resolve => gateway.close(() => resolve())); await unlink(keyFile); await rmdir(fixtureDirectory)
  await prisma.host.deleteMany({ where: { userId: actor.id } }); await prisma.hostOnboardingBatch.deleteMany({ where: { createdById: actor.id } }); await prisma.user.delete({ where: { id: actor.id } }); await closePrismaDatabase()
}
process.exit(0)
