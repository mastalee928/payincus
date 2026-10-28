import assert from 'node:assert/strict'
import { randomUUID, X509Certificate } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { prepareTransferCleanup, runTransferCleanup } = await import('../src/services/transfer-cleanup.js')
const { closeCaddyClients } = await import('../src/lib/caddy-client.js')
const tag = `transfer-${randomUUID().slice(0, 8)}`
const root = await mkdtemp(join(tmpdir(), tag))
const keyPath = join(root, 'key.pem'), certPath = join(root, 'cert.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=caddy-admin', '-addext', 'subjectAltName=DNS:caddy-admin,IP:127.0.0.1', '-keyout', keyPath, '-out', certPath],
{ stdio: 'pipe', windowsHide: true })
const certificate = await readFile(certPath, 'utf8')
const tls = { key: await readFile(keyPath), cert: certificate }
type Remote = { name: string; uuid: string; status: string; devices: Record<string, any>; snapshots: Set<string>; backups: Set<string> }
const remotes = new Map<string, Remote>()
const calls: string[] = []
let refuseDelete = false, ignoreDelete = false
let pauseRemote: (() => Promise<void>) | undefined
let pauseDeleted: (() => Promise<void>) | undefined
const incus = createServer({ ...tls, ca: certificate, requestCert: true, rejectUnauthorized: true }, async (req, res) => {
  const reply = (status: number, metadata: unknown) => {
    res.statusCode = status; res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(status === 200 ? { type: 'sync', metadata } : { type: 'error', error: String(metadata) }))
  }
  try {
    assert.ok((req.socket as any).authorized)
    calls.push(`${req.method} ${req.url}`)
    if (req.url === '/1.0') return reply(200, { api_version: '1.0' })
    if (req.url === '/1.0/instances') {
      await pauseRemote?.()
      return reply(200, [...remotes.keys()].map(name => `/1.0/instances/${name}`))
    }
    const parts = req.url!.split('/'), name = parts[3], kind = parts[4]
    const remote = remotes.get(name)
    if (!remote) return reply(404, 'instance missing')
    if (!kind && req.method === 'GET') return reply(200, { name, status: remote.status, type: 'container',
      config: { 'volatile.uuid': remote.uuid, 'user.fixture-disk': 'unchanged' }, devices: remote.devices })
    if (!kind && (req.method === 'POST' || req.method === 'PUT')) {
      let body = ''; for await (const chunk of req) body += chunk
      const data = JSON.parse(body)
      if (req.method === 'POST') {
        assert.ok(!remotes.has(data.name)); remotes.delete(name); remote.name = data.name; remotes.set(data.name, remote)
      } else {
        assert.equal(data.config['volatile.uuid'], remote.uuid)
        assert.equal(data.config['user.fixture-disk'], 'unchanged')
        assert.deepEqual(data.devices.root, remote.devices.root)
        assert.deepEqual(data.devices.eth0, remote.devices.eth0)
        remote.devices = data.devices
      }
      return reply(200, {})
    }
    assert.ok(kind === 'snapshots' || kind === 'backups')
    const set = remote[kind]
    if (req.method === 'GET') return reply(200, [...set].map(item => `/1.0/instances/${name}/${kind}/${item}`))
    if (req.method === 'DELETE') {
      if (refuseDelete) return reply(500, 'fixture-delete-refused 404 is only text')
      if (!set.has(parts[5])) return reply(404, 'missing captured resource')
      if (!ignoreDelete) set.delete(parts[5])
      await pauseDeleted?.()
      return reply(200, {})
    }
    reply(500, 'unexpected request')
  } catch (error) { reply(500, error instanceof Error ? error.message : error) }
})
let caddyConfig: any = { apps: { http: { servers: {} } } }, caddyRevision = 0, rejectCaddy = false
const caddy = createServer(tls, async (req, res) => {
  const respond = (code: number, data: unknown) => { res.statusCode = code; res.setHeader('etag', `"/config/ ${caddyRevision}"`); res.end(JSON.stringify(data)) }
  if (req.headers.authorization !== `Basic ${Buffer.from('fixture:fixture-password').toString('base64')}`) return respond(401, {})
  if (req.method === 'GET' && req.url === '/config/') return respond(200, caddyConfig)
  if (req.method === 'POST' && req.url === '/config/apps/http') {
    if (rejectCaddy) return respond(500, { error: 'fixture-caddy-refused' })
    if (req.headers['if-match'] !== `"/config/ ${caddyRevision}"`) return respond(412, {})
    let body = ''; for await (const chunk of req) body += chunk
    caddyConfig.apps.http = JSON.parse(body); caddyRevision++; return respond(200, {})
  }
  respond(404, {})
})
await Promise.all([incus, caddy].map(server => new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))))
const incusPort = (incus.address() as { port: number }).port, caddyPort = (caddy.address() as { port: number }).port
const previousCa = process.env.CADDY_CA_PATH
process.env.CADDY_CA_PATH = certPath
const owner = await prisma.user.create({ data: { username: `${tag}-source`, passwordHash: 'fixture' } })
const target = await prisma.user.create({ data: { username: `${tag}-target`, passwordHash: 'fixture' } })
const actor = { id: target.id, sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
const instanceIds: number[] = [], hostIds: number[] = []
let triggerTable: string | undefined
async function dropFault() {
  if (triggerTable) {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fixture_transfer_fault ON ${triggerTable}`)
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fixture_transfer_fault()')
    triggerTable = undefined
  }
}
async function injectFault(table: string, condition: string) {
  assert.ok(['instance_transfers', 'port_mappings', 'snapshots', 'backups'].includes(table))
  triggerTable = table
  await prisma.$executeRawUnsafe(`CREATE FUNCTION fixture_transfer_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'fixture-transfer-db-failure'; END IF; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER fixture_transfer_fault BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION fixture_transfer_fault()`)
}
try {
  for (const scenario of ['shared', 'dedicated', 'rename_commit', 'port_commit', 'snapshot_commit', 'backup_commit',
    'site_failure', 'remote_refused', 'unconfirmed_delete', 'host_identity', 'uuid_changed', 'session_revoked', 'concurrent', 'new_resource', 'process_killed'] as const) {
    const dedicated = scenario === 'dedicated'
    const name = `${tag}-${scenario}`, newName = dedicated ? name : `${name}-target`
    const host = await prisma.host.create({ data: { userId: owner.id, name, url: `https://127.0.0.1:${incusPort}`,
      certPath, keyPath, serverCertificate: certificate, serverFingerprint: new X509Certificate(certificate).fingerprint256,
      status: 'online', transferEnabled: true, cpuAllowanceMax: 400, memoryMax: 4096, natPortsUsedCount: 2,
      caddyEnabled: true, caddyUsername: 'fixture', caddyPassword: 'fixture-password', caddyPort, ipAddress: '127.0.0.1' } })
    hostIds.push(host.id)
    const instance = await prisma.instance.create({ data: { userId: owner.id, hostId: host.id, name, incusId: name,
      image: 'fixture/debian', status: dedicated ? 'running' : 'stopped', dedicatedIpv4: dedicated, dedicatedNetworkReady: dedicated,
      cpu: 100, memory: 512, disk: 2048, ipv4: '10.7.0.2', ipv6: `2001:db8:1::${host.id.toString(16)}`,
      expiresAt: new Date('2030-01-01'), billingPrice: 3.5, autoRenew: true } })
    instanceIds.push(instance.id)
    const devices: Record<string, any> = { root: { type: 'disk', path: '/', pool: 'default' }, eth0: { type: 'nic', network: 'incusbr0' },
      'customer-data': { type: 'disk', path: '/data', source: '/fixture/customer-data' } }
    for (const protocol of ['tcp', 'udp'] as const) {
      await prisma.portMapping.create({ data: { hostId: host.id, instanceId: instance.id, protocol, publicPort: 23000, privatePort: 8080 } })
      for (const suffix of ['', '-v6']) devices[`proxy-${protocol}-23000${suffix}`] = {
        type: 'proxy', listen: `${protocol}:${suffix ? '[2001:db8::1]' : '192.0.2.1'}:23000`, connect: `${protocol}:0.0.0.0:8080` }
    }
    const remote: Remote = { name, uuid: randomUUID(), status: dedicated ? 'Running' : 'Stopped', devices,
      snapshots: new Set(['old-snapshot']), backups: new Set(['old-backup']) }
    remotes.set(name, remote)
    const originalDevices = structuredClone(devices), originalUuid = remote.uuid
    const snapshot = await prisma.snapshot.create({ data: { instanceId: instance.id, name: 'old-snapshot', incusName: 'old-snapshot' } })
    const backup = await prisma.backup.create({ data: { instanceId: instance.id, name: 'old-backup', incusName: 'old-backup', status: 'ready' } })
    await prisma.snapshotPolicy.create({ data: { instanceId: instance.id, enabled: true } })
    await prisma.backupPolicy.create({ data: { instanceId: instance.id, enabled: true } })
    const site = scenario === 'site_failure' ? await prisma.proxySite.create({ data: {
      hostId: host.id, instanceId: instance.id, domain: `${name}.example.test`, targetPort: 8080, enabled: false } }) : null
    const transfer = await prisma.instanceTransfer.create({ data: { instanceId: instance.id, fromUserId: owner.id,
      toUserId: target.id, status: 'processing', snapshot: {}, fee: 2.5 } })
    await prepareTransferCleanup(transfer.id, newName, name, actor)
    const fixed = (await prisma.instanceTransfer.findUniqueOrThrow({ where: { id: transfer.id } })).cleanupState as any
    assert.equal(await prisma.snapshotPolicy.count({ where: { instanceId: instance.id } }), 0)
    assert.equal(await prisma.backupPolicy.count({ where: { instanceId: instance.id } }), 0)
    assert.equal((await prepareTransferCleanup(transfer.id, newName, 'different retry label', actor)).newName, name)
    const run = () => runTransferCleanup(transfer.id, actor)
    const beforeCalls = calls.length
    if (scenario === 'host_identity') {
      await prisma.host.update({ where: { id: host.id }, data: { serverFingerprint: 'changed' } })
      await assert.rejects(run, /TRANSFER_SOURCE_CHANGED/)
      assert.equal(calls.length, beforeCalls)
      await prisma.host.update({ where: { id: host.id }, data: { serverFingerprint: new X509Certificate(certificate).fingerprint256 } })
    }
    if (scenario === 'session_revoked') {
      await prisma.tokenInvalidation.create({ data: { userId: target.id, sessionId: tag, invalidatedAt: actor.iat } })
      await assert.rejects(run, /FORBIDDEN/); assert.equal(calls.length, beforeCalls)
      await prisma.tokenInvalidation.deleteMany({ where: { userId: target.id, sessionId: tag } })
    }
    if (scenario === 'rename_commit') await injectFault('instance_transfers', `NEW.id = ${transfer.id} AND NEW.cleanup_state->>'stage' = 'renamed'`)
    if (scenario === 'port_commit') await injectFault('port_mappings', `OLD.instance_id = ${instance.id}`)
    if (scenario === 'snapshot_commit') await injectFault('snapshots', `OLD.id = ${snapshot.id}`)
    if (scenario === 'backup_commit') await injectFault('backups', `NEW.id = ${backup.id} AND NEW.status = 'deleted'`)
    rejectCaddy = scenario === 'site_failure'
    refuseDelete = ['remote_refused', 'uuid_changed', 'new_resource'].includes(scenario)
    ignoreDelete = scenario === 'unconfirmed_delete'
    if (triggerTable || rejectCaddy || refuseDelete || ignoreDelete) {
      await assert.rejects(run)
      const pending = await prisma.instanceTransfer.findUniqueOrThrow({ where: { id: transfer.id } })
      assert.equal(pending.status, 'processing')
      assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).userId, owner.id)
      assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: instance.id } }), 0)
      assert.ok((pending.cleanupState as any).error)
      assert.equal((pending.cleanupState as any).newIncusId, fixed.newIncusId)
      if (scenario === 'snapshot_commit') {
        assert.ok(!remote.snapshots.has('old-snapshot')); assert.ok(await prisma.snapshot.findUnique({ where: { id: snapshot.id } }))
      }
      if (scenario === 'site_failure') assert.ok(await prisma.proxySite.findUnique({ where: { id: site!.id } }))
      await dropFault(); rejectCaddy = false; refuseDelete = false; ignoreDelete = false
      if (scenario === 'site_failure') await prisma.proxySiteOperation.updateMany({ where: { instanceId: instance.id }, data: { nextRetryAt: new Date(0) } })
    }
    if (scenario === 'uuid_changed') {
      remote.uuid = randomUUID()
      await assert.rejects(run, /TRANSFER_INCUS_IDENTITY_CHANGED/)
      assert.ok(remote.snapshots.has('old-snapshot'))
      remote.uuid = originalUuid
    }
    if (scenario === 'new_resource') {
      await prisma.snapshot.create({ data: { instanceId: instance.id, incusName: 'new-owner-resource', name: 'new-owner-resource' } })
      remote.snapshots.add('new-owner-resource')
      await assert.rejects(run, /TRANSFER_CLEANUP_RESOURCES_CHANGED/)
      assert.ok(remote.snapshots.has('new-owner-resource'))
      // Remove only the test-injected out-of-plan row; production finalization must remain blocked until reviewed.
      await prisma.snapshot.deleteMany({ where: { instanceId: instance.id, incusName: 'new-owner-resource' } })
      remote.snapshots.delete('new-owner-resource')
    }
    if (scenario === 'process_killed') {
      let reached!: () => void, release!: () => void
      const waiting = new Promise<void>(resolve => { release = resolve })
      const ready = new Promise<void>(resolve => { reached = resolve })
      pauseDeleted = async () => { reached(); await waiting }
      const serviceUrl = new URL('../src/services/transfer-cleanup.ts', import.meta.url).href
      const script = `const {runTransferCleanup}=await import(${JSON.stringify(serviceUrl)});await runTransferCleanup(${transfer.id},${JSON.stringify(actor)});process.exit(0)`
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''; child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
      const exited = new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('exit', () => resolve()) })
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([ready, exited.then(() => { throw new Error(`cleanup child exited before fault: ${output}`) }),
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('cleanup child fault timed out')), 20000) })])
        child.kill('SIGKILL'); await exited
      } finally {
        if (timer) clearTimeout(timer)
        child.kill('SIGKILL'); pauseDeleted = undefined; release()
      }
      assert.ok(!remote.snapshots.has('old-snapshot'))
      assert.ok(await prisma.snapshot.findUnique({ where: { id: snapshot.id } }))
      assert.equal((await prisma.instanceTransfer.findUniqueOrThrow({ where: { id: transfer.id } })).status, 'processing')
    }
    if (scenario === 'concurrent') {
      let entered!: () => void, release!: () => void
      const ready = new Promise<void>(resolve => { entered = resolve }), waiting = new Promise<void>(resolve => { release = resolve })
      pauseRemote = async () => { entered(); await waiting }
      const first = run(); await ready
      await assert.rejects(run, /TRANSFER_INSTANCE_BUSY/)
      pauseRemote = undefined; release(); await first
    } else await run()
    const completed = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
    assert.equal(completed.userId, target.id); assert.equal(completed.incusId, newName); assert.equal(completed.autoRenew, false)
    for (const key of ['hostId', 'status', 'ipv4', 'ipv6', 'cpu', 'memory', 'disk', 'billingPrice', 'expiresAt', 'dedicatedNetworkReady'] as const) {
      assert.deepEqual(completed[key], instance[key], `${scenario}: preserve ${key}`)
    }
    assert.equal(remote.uuid, originalUuid)
    assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: instance.id, type: 'transfer_fee' } }), 1)
    assert.equal((await prisma.instanceTransfer.findUniqueOrThrow({ where: { id: transfer.id } })).status, 'accepted')
    assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).natPortsUsedCount, dedicated ? 2 : 0)
    assert.equal(await prisma.portMapping.count({ where: { instanceId: instance.id } }), dedicated ? 2 : 0)
    assert.deepEqual(remote.devices, dedicated ? originalDevices : Object.fromEntries(Object.entries(originalDevices).filter(([key]) => !key.startsWith('proxy-'))))
    assert.equal(calls.slice(beforeCalls).filter(call => call === `POST /1.0/instances/${name}`).length, dedicated ? 0 : 1)
    assert.equal(calls.slice(beforeCalls).filter(call => call === `DELETE /1.0/instances/${newName}/snapshots/old-snapshot`).length,
      ['remote_refused', 'unconfirmed_delete', 'uuid_changed', 'new_resource'].includes(scenario) ? 2 : 1)
    console.log(`PASS ${scenario}`)
  }
  console.log('Transfer cleanup integration passed: actual PostgreSQL, mTLS Incus boundary, TLS Caddy boundary; fixed resources, UUID/pin, restartable receipts, concurrency and dedicated preservation')
} finally {
  await dropFault()
  await closeCaddyClients()
  await Promise.all([incus, caddy].map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  await prisma.log.deleteMany({ where: { instanceId: { in: instanceIds } } })
  await prisma.instance.deleteMany({ where: { id: { in: instanceIds } } })
  await prisma.host.deleteMany({ where: { id: { in: hostIds } } })
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, target.id] } } })
  await closePrismaDatabase()
  if (previousCa === undefined) delete process.env.CADDY_CA_PATH; else process.env.CADDY_CA_PATH = previousCa
  await rm(root, { recursive: true, force: true })
}
