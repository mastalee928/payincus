import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { randomUUID, X509Certificate } from 'node:crypto'
import { execFile, execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { parseBackfillInstanceNetworkArgs } from './lib/backfill-instance-network-args.js'
for (const value of ['', '0', '-1', '1.5', '1e2', '0x10', '01', ' 1', '1 ', 'NaN', 'Infinity', 'abc', '2147483648', '9007199254740992']) {
  assert.throws(() => parseBackfillInstanceNetworkArgs([`--host-id=${value}`]), /Invalid/)
}
for (const args of [['--host-id'], ['--host-id=1', '--host-id=2'], ['--dryrun'], ['--dry-run', '--dry-run'], ['--host-id=1', '--unknown']]) {
  assert.throws(() => parseBackfillInstanceNetworkArgs(args), /Unknown|duplicate/)
}
assert.deepEqual(parseBackfillInstanceNetworkArgs([]), { hostId: null, dryRun: false })
assert.deepEqual(parseBackfillInstanceNetworkArgs(['--dry-run', '--host-id=2147483647']), { hostId: 2147483647, dryRun: true })
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.JWT_SECRET ||= 'network-sync-fixture-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: hostRoutes } = await import('../src/routes/hosts.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const prefix = `network-${randomUUID().slice(0, 8)}`
const root = await mkdtemp(join(tmpdir(), prefix))
const keyPath = join(root, 'key.pem'), certPath = join(root, 'cert.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=network-fixture',
  '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath], { stdio: 'pipe', windowsHide: true })
const certificate = await readFile(certPath, 'utf8')
let beforeProbe: (() => Promise<void>) | undefined
let target = ''
const writes: string[] = []
let remoteRequests = 0
const remote = createServer({ key: await readFile(keyPath), cert: certificate, ca: certificate, requestCert: true, rejectUnauthorized: true }, async (request, response) => {
  remoteRequests++
  const send = (metadata: unknown, status = 200) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify({ type: status === 200 ? 'sync' : 'error', metadata })) }
  try {
    assert.ok((request.socket as any).authorized)
    if (request.method !== 'GET') { writes.push(`${request.method} ${request.url}`); return send({}, 500) }
    if (request.url === '/1.0') return send({ api_version: '1.0' })
    if (request.url === '/1.0/resources') return send({})
    if (request.url === '/1.0/networks?recursion=1') return send([])
    if (request.url === `/1.0/instances/${target}/state` || request.url === `/1.0/instances/${target}`) {
      if (beforeProbe) { const hook = beforeProbe; beforeProbe = undefined; await hook() }
      return send({ name: target, status: 'Stopped', devices: { eth1: { 'ipv6.address': '2001:db8::20' } },
        network: { eth0: { addresses: [{ family: 'inet', scope: 'global', address: '10.10.1.20' }] } } })
    }
    return send({}, 404)
  } catch { return send({}, 500) }
})
await new Promise<void>(resolve => remote.listen(0, '127.0.0.1', resolve))
const admin = await prisma.user.create({ data: { username: `${prefix}-admin`, passwordHash: 'unusable-fixture', role: 'admin' } })
const owner = await prisma.user.create({ data: { username: `${prefix}-owner`, passwordHash: 'unusable-fixture' } })
const other = await prisma.user.create({ data: { username: `${prefix}-other`, passwordHash: 'unusable-fixture' } })
const replacement = await prisma.host.create({ data: { userId: owner.id, name: prefix, url: 'https://127.0.0.1:1' } })
const actor = { id: admin.id, role: 'admin', username: admin.username, sid: prefix, iat: Math.floor(Date.now() / 1000) + 5 }
const app = Fastify()
app.decorate('authenticate', async (request: any) => { request.user = { ...actor } })
app.decorate('requireAdmin', async () => {})
app.decorate('authenticateAdmin', app.authenticate)
await app.register(hostRoutes, { prefix: '/hosts' })
let constraint: string | undefined
let failure: unknown
try {
  for (const entry of process.env.REVIEW_NETWORK_ENTRIES?.split(',') || ['single', 'repair', 'baseline', 'backfill']) {
    const modes = entry === 'backfill' ? ['host_changed', 'host_connection_changed', 'database_failure', 'success', 'dry_run'] : ['host_changed', 'instance_renamed', 'owner_changed', 'new_generation', 'address_changed', 'host_connection_changed', 'host_owner_changed', 'actor_banned', 'session_revoked', 'cleanup_pending', 'pending_task', 'deleted', 'suspended', 'database_failure', 'success', ...(entry !== 'baseline' ? ['stable_suspended'] : [])]
    for (const mode of process.env.REVIEW_NETWORK_MODES?.split(',') || modes) {
      const host = await prisma.host.create({ data: { userId: owner.id, name: `${prefix}-${entry}-${mode}`, url: `https://127.0.0.1:${(remote.address() as { port: number }).port}`,
        certPath, keyPath, serverCertificate: certificate, serverFingerprint: new X509Certificate(certificate).fingerprint256, status: 'online' } })
      const instance = await prisma.instance.create({ data: { userId: owner.id, hostId: host.id, name: host.name, incusId: host.name, image: 'fixture/debian',
        networkMode: 'nat_ipv6', status: mode === 'stable_suspended' ? 'suspended' : 'running', cpu: 50, memory: 256, disk: 1024, ipv4: '10.10.1.10', ipv6: '2001:db8::10' } })
      target = instance.incusId
      const primary = await prisma.ipAddress.create({ data: { instanceId: instance.id, hostId: host.id, address: instance.ipv4!, type: 'inet4', isPrimary: true, device: 'eth0' } })
      const custom = await prisma.ipAddress.create({ data: { instanceId: instance.id, hostId: host.id, address: '2001:db8::99', type: 'inet6', isPrimary: false, isCustom: true, device: 'eth1' } })
      beforeProbe = async () => {
        if (mode === 'host_changed') await prisma.instance.update({ where: { id: instance.id }, data: { hostId: replacement.id } })
        if (mode === 'instance_renamed') await prisma.instance.update({ where: { id: instance.id }, data: { incusId: instance.incusId + '-new' } })
        if (mode === 'owner_changed') await prisma.instance.update({ where: { id: instance.id }, data: { userId: other.id } })
        if (mode === 'new_generation') await prisma.instance.update({ where: { id: instance.id }, data: { updatedAt: new Date(instance.updatedAt.getTime() + 1000) } })
        if (mode === 'address_changed') await prisma.instance.update({ where: { id: instance.id }, data: { ipv4: '10.10.1.30' } })
        if (mode === 'host_connection_changed') await prisma.host.update({ where: { id: host.id }, data: { url: 'https://127.0.0.1:1' } })
        if (mode === 'host_owner_changed') await prisma.host.update({ where: { id: host.id }, data: { userId: other.id } })
        if (mode === 'actor_banned') await prisma.user.update({ where: { id: admin.id }, data: { status: 'banned' } })
        if (mode === 'session_revoked') await prisma.tokenInvalidation.create({ data: { userId: admin.id, sessionId: actor.sid, invalidatedAt: actor.iat } })
        if (mode === 'cleanup_pending') await prisma.instance.update({ where: { id: instance.id }, data: { provisioningCleanupPending: true } })
        if (mode === 'pending_task') await prisma.instanceTask.create({ data: { instanceId: instance.id, hostId: host.id, userId: owner.id, taskType: 'rebuild', status: 'PENDING' } })
        if (mode === 'deleted' || mode === 'suspended') await prisma.instance.update({ where: { id: instance.id }, data: { status: mode } })
      }
      if (mode === 'database_failure') {
        constraint = `review_network_${randomUUID().replaceAll('-', '')}`
        await prisma.$executeRawUnsafe(`ALTER TABLE ip_addresses ADD CONSTRAINT ${constraint} CHECK (instance_id <> ${instance.id} OR address <> '10.10.1.20') NOT VALID`)
      }
      const url = entry === 'single' ? `/hosts/${host.id}/ops/instances/${instance.id}/sync` : `/hosts/${host.id}/ops/${entry === 'repair' ? 'network-repair' : 'baseline-sync'}`
      const response = entry === 'backfill' ? undefined : await app.inject({ method: 'POST', url })
      let cliCode = 0
      let cliOutput = ''
      if (entry === 'backfill') {
        if (mode === 'success') {
          for (const args of [['--host-id=bad'], ['--host-id=0'], ['--host-id=2147483648'], [`--host-id=${host.id}`, '--dryrun'],
            [`--host-id=${host.id}`, `--host-id=${replacement.id}`]]) {
            const requestCount = remoteRequests
            const invalid = await new Promise<{ code: number; output: string }>(resolve => execFile(process.execPath,
              ['--import', 'tsx', 'scripts/backfill-instance-network-addresses.ts', ...args],
              { timeout: 30000, windowsHide: true }, (error, stdout, stderr) => resolve({
                code: error ? typeof error.code === 'number' ? error.code : -1 : 0, output: stdout + stderr
              })))
            assert.equal(invalid.code, 1, 'malformed CLI filters must fail')
            assert.match(invalid.output, /Invalid --host-id|Unknown or duplicate argument/)
            assert.doesNotMatch(invalid.output, /Starting|No matching online hosts/, 'invalid input rejected before host listing')
            assert.equal(remoteRequests, requestCount, 'malformed CLI must not probe any hosts')
          }
        }
        cliCode = await new Promise<number>(resolve => execFile(process.execPath,
          ['--import', 'tsx', 'scripts/backfill-instance-network-addresses.ts', `--host-id=${host.id}`, ...(mode === 'dry_run' ? ['--dry-run'] : [])],
          { timeout: 30000, windowsHide: true }, (error, stdout, stderr) => {
            cliOutput = stdout
            const code = error ? typeof error.code === 'number' ? error.code : -1 : 0
            if (code !== (mode === 'success' || mode === 'dry_run' ? 0 : 1)) console.error('Maintenance CLI diagnostics:', { code, stdout, stderr })
            resolve(code)
          }))
        assert.equal(cliCode, mode === 'success' || mode === 'dry_run' ? 0 : 1, 'actual maintenance CLI must finish and report failures')
        assert.match(cliOutput, new RegExp(`scanned=1, changed=${mode === 'success' ? 1 : 0}, ipv4Changed=${mode === 'success' ? 1 : 0}, ipv6Changed=${mode === 'success' ? 1 : 0}, failed=${mode === 'success' || mode === 'dry_run' ? 0 : 1}`),
          'only successfully committed changes count as changed')
        if (mode === 'dry_run') assert.match(cliOutput, /planned=1, ipv4Planned=1, ipv6Planned=1/, 'dry-run reports only proposed changes')
      }
      const current = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
      const success = ['success', 'stable_suspended'].includes(mode)
      const acknowledged = entry === 'backfill' ? cliCode === 0 && mode !== 'dry_run' : entry === 'single' ? response!.statusCode === 200 : entry === 'repair' ? response!.json().summary.success === 1 : response!.json().instanceSync.synced === 1
      assert.equal(acknowledged, success, `${entry}/${mode}: obsolete or failed observation must not report applied`)
      assert.equal(current.status, mode === 'stable_suspended' ? 'suspended' : success && entry !== 'backfill' ? 'stopped' : mode === 'deleted' || mode === 'suspended' ? mode : 'running', `${entry}/${mode}: state changes must commit with addresses`)
      assert.equal(current.ipv4, success ? '10.10.1.20' : mode === 'address_changed' ? '10.10.1.30' : '10.10.1.10')
      assert.equal(current.ipv6, success ? '2001:db8::20' : '2001:db8::10')
      assert.equal(current.lastSyncedAt !== null, success)
      if (mode === 'deleted') {
        assert.equal(await prisma.ipAddress.count({ where: { instanceId: instance.id } }), 0, 'deletion trigger removes addresses; obsolete sync must not recreate them')
      } else {
        assert.equal((await prisma.ipAddress.findUniqueOrThrow({ where: { id: primary.id } })).address, success ? '10.10.1.20' : '10.10.1.10')
        assert.equal((await prisma.ipAddress.findUniqueOrThrow({ where: { id: custom.id } })).address, custom.address)
      }
      assert.equal(writes.length, 0, 'observation sync must not write Incus or Caddy')
      if (constraint) { await prisma.$executeRawUnsafe(`ALTER TABLE ip_addresses DROP CONSTRAINT ${constraint}`); constraint = undefined }
      if (mode === 'actor_banned') await prisma.user.update({ where: { id: admin.id }, data: { status: 'active' } })
      if (mode === 'session_revoked') await prisma.tokenInvalidation.deleteMany({ where: { userId: admin.id, sessionId: actor.sid } })
      await prisma.instance.delete({ where: { id: instance.id } })
      await prisma.host.delete({ where: { id: host.id } })
      console.log(`PASS host network ${entry}/${mode}`)
    }
  }
} catch (error) { failure = error } finally {
  if (constraint) await prisma.$executeRawUnsafe(`ALTER TABLE ip_addresses DROP CONSTRAINT ${constraint}`)
  await app.close(); await closeAllClients(); await new Promise<void>(resolve => remote.close(() => resolve()))
  await prisma.instance.deleteMany({ where: { name: { startsWith: prefix } } })
  await prisma.host.deleteMany({ where: { name: { startsWith: prefix } } })
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, owner.id, other.id] } } }); await closePrismaDatabase()
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + prefix)); await rm(root, { recursive: true, force: true })
}
if (failure) { console.error(failure); process.exit(1) }
console.log('PASS actual host observation routes with PostgreSQL and mTLS; native Incus/production not exercised')
process.exit(0)
