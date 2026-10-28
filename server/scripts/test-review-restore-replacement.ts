import assert from 'node:assert/strict'
import { randomUUID, X509Certificate } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncusInstance } from '../src/types/incus.js'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use isolated local *_pool_test PostgreSQL')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { createRestoreTask } = await import('../src/db/restore-tasks.js')
const { createBackupWithQuotaReservation } = await import('../src/db/backups.js')
const { hasActiveTransferWorkflow } = await import('../src/db/transfers.js')
const { claimNextTask, executeRestoreTask, cleanupStaleTasks, cleanupTimeoutTasks } = await import('../src/workers/restoreTaskWorker.js')
const { transferHostIdentity } = await import('../src/lib/transfer-host-identity.js')
const tag = `restore-replace-${randomUUID()}`
const root = await mkdtemp(join(tmpdir(), tag))
const previousState = process.env.PLATFORM_BACKUP_STATE_DIR
process.env.PLATFORM_BACKUP_STATE_DIR = root
const certPath = join(root, 'cert.pem'), keyPath = join(root, 'key.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=incus-fixture', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath], { stdio: 'pipe', windowsHide: true })
const cert = await readFile(certPath, 'utf8')
let mode = 'success', requests: string[] = [], activeId = 0, taskTemp = '', deleteCount = 0
let remote = new Map<string, IncusInstance>()
const originalUuid = randomUUID(), restoredUuid = randomUUID(), operation = `/1.0/operations/${randomUUID()}`
const blueprint: IncusInstance = { name: tag, type: 'container', status: 'Stopped', status_code: 102,
  config: { 'volatile.uuid': originalUuid, 'volatile.eth0.hwaddr': '00:16:3e:00:11:22', 'limits.cpu': '2', 'security.nesting': 'true' },
  devices: { root: { type: 'disk', path: '/', pool: 'original-disk', size: '20GiB' },
    eth0: { type: 'nic', network: 'incusbr0', 'ipv4.address': '10.99.0.2', 'ipv6.address': 'fd00:99::2', hwaddr: '00:16:3e:00:11:22' },
    proxy: { type: 'proxy', listen: 'tcp:192.0.2.1:22', connect: 'tcp:10.99.0.2:22', nat: 'true' } } }
const forwards = [
  { listen_address: '192.0.2.1', description: `payincus-dedicated:${tag}`, config: { target_address: '10.99.0.2' } },
  { listen_address: '2001:db8::1', description: `payincus-dedicated:${tag}`, config: { target_address: 'fd00:99::3' },
    ports: ['tcp', 'udp'].map(protocol => ({ protocol, listen_port: '1-65535', target_address: 'fd00:99::2', snat: true })) }
]
const preservedForwards = structuredClone(forwards)
const server = createServer({ cert, key: await readFile(keyPath), ca: cert, requestCert: true, rejectUnauthorized: true }, (req, res) => {
  void (async () => {
    assert.ok((req.socket as any).authorized)
    requests.push(`${req.method} ${req.url}`)
    const json = (status: number, metadata: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(status < 400 ? { type: 'sync', metadata } : { type: 'error', error: metadata })) }
    if (req.url === '/1.0') { json(200, {}); return }
    if (req.url?.startsWith('/1.0/networks')) {
      if (req.method === 'DELETE') forwards.splice(0)
      json(200, forwards); return
    }
    if (req.url === `/1.0/instances/${tag}/backups/saved/export`) {
      res.end('fixture backup disk bytes'); return
    }
    if (req.url === '/1.0/instances' && req.method === 'POST') {
      for await (const _chunk of req) { /* drain complete backup body */ }
      assert.equal(req.headers['x-incus-name'], taskTemp)
      assert.equal(req.headers['x-incus-pool'], 'original-disk', 'must retain actual root pool')
      const copy = structuredClone(blueprint)
      copy.name = taskTemp; copy.config!['volatile.uuid'] = restoredUuid
      if (mode === 'wrong-device') copy.devices!.eth0['ipv6.address'] = 'fd00:99::bad'
      if (mode === 'wrong-pool') copy.devices!.root.pool = 'new-package-pool'
      if (mode === 'missing-uuid') delete copy.config!['volatile.uuid']
      remote.set(taskTemp, copy)
      if (mode === 'original-reused') remote.get(tag)!.config!['volatile.uuid'] = randomUUID()
      if (mode === 'ban-after-import') await prisma.user.update({ where: { id: user.id }, data: { status: 'banned' } })
      if (mode === 'late-backup') await prisma.backup.create({ data: { instanceId: instance.id, name: 'late', incusName: 'late', status: 'ready' } })
      if (mode === 'import-error') { json(500, 'fixture import operation refused'); return }
      res.writeHead(202, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'async', operation })); return
    }
    if (req.url?.startsWith(operation + '/wait?')) {
      const saved = await prisma.restoreTask.findUniqueOrThrow({ where: { id: activeId } })
      assert.equal((saved.recoveryState as any).operation, operation, 'operation must commit before polling')
      json(200, { status: 'Success', metadata: {} }); return
    }
    const match = req.url?.match(/^\/1.0\/instances\/([^/?]+)(\/state)?$/)
    if (match) {
      const name = decodeURIComponent(match[1]), item = remote.get(name)
      if (!item) { json(404, 'instance not found'); return }
      if (req.method === 'GET') { json(200, match[2] ? { status: item.status } : item); return }
      if (req.method === 'DELETE') {
        assert.equal(name, tag, 'no cleanup may delete the temporary copy')
        deleteCount++
        const saved = await prisma.restoreTask.findUniqueOrThrow({ where: { id: activeId } })
        assert.equal((saved.recoveryState as any).stage, 'replacing')
        assert.equal((saved.recoveryState as any).original.uuid, originalUuid)
        assert.equal((saved.recoveryState as any).restored.uuid, restoredUuid)
        if (mode === 'delete-error') { json(403, 'fixture delete refused'); return }
        if (mode !== 'delete-present') remote.delete(name)
        if (mode === 'delete-disconnect') { req.socket.destroy(); return }
        json(200, {}); return
      }
      const chunks = []; for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString())
      if (req.method === 'POST') {
        if (mode === 'rename-error') { json(500, 'fixture rename refused'); return }
        assert.equal(body.name, tag); remote.delete(name); item.name = tag; remote.set(tag, item)
        if (mode === 'rename-wrong-uuid') item.config!['volatile.uuid'] = randomUUID()
        json(200, {}); return
      }
      if (req.method === 'PUT' && match[2]) {
        if (mode === 'start-error' && body.action === 'start') { json(500, 'fixture start refused'); return }
        item.status = body.action === 'start' ? 'Running' : 'Stopped'; json(200, {}); return
      }
    }
    json(404, 'unexpected fixture path')
  })().catch(error => { console.error(error); res.destroy(error); process.exitCode = 1 })
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const user = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: user.id, name: tag, status: 'online', url: `https://127.0.0.1:${(server.address() as { port: number }).port}`,
  certPath, keyPath, serverCertificate: cert, serverFingerprint: new X509Certificate(cert).fingerprint256 } })
const instance = await prisma.instance.create({ data: { userId: user.id, hostId: host.id, name: tag, incusId: tag, image: 'fixture/debian',
  status: 'stopped', cpu: 100, memory: 512, disk: 1024, backupLimit: 5, storagePoolName: 'stale-package-pool',
  ipv4: '10.99.0.2', ipv6: 'fd00:99::2', dedicatedIpv4: true } })
const backup = await prisma.backup.create({ data: { instanceId: instance.id, name: 'saved', incusName: 'saved', status: 'ready' } })
const actor = { id: user.id, sid: randomUUID(), iat: Math.floor(Date.now() / 1000) }
const trigger = `restore_final_${user.id}`
let triggerInstalled = false
try {
  for (const scenario of ['success', 'wrong-device', 'wrong-pool', 'missing-uuid', 'original-reused', 'ban-after-import', 'late-backup',
    'import-error', 'delete-error', 'delete-present', 'delete-disconnect', 'rename-error', 'rename-wrong-uuid', 'start-error', 'final-db-error']) {
    mode = scenario; requests = []; deleteCount = 0
    remote = new Map([[tag, structuredClone(blueprint)]])
    await prisma.backup.update({ where: { id: backup.id }, data: { status: 'ready' } })
    const id = await createRestoreTask({ userId: user.id, ownerId: user.id, instanceId: instance.id, hostId: host.id, backupId: backup.id,
      session: actor, originalIncusId: tag, originalInstanceName: tag, expectedBackupName: 'saved', expectedBackupCreatedAt: backup.createdAt.toISOString(),
      expectedHostIdentity: transferHostIdentity(host) })
    assert.ok(id); activeId = id
    const task = await claimNextTask(host.id); assert.equal(task?.id, id); taskTemp = task!.tempInstanceName!
    if (mode === 'final-db-error') {
      await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = ${id} AND NEW.status = 'COMPLETED' THEN RAISE EXCEPTION 'fixture-restore-final-refused'; END IF; RETURN NEW; END $$`)
      await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON restore_tasks FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
      triggerInstalled = true
    }
    await executeRestoreTask(id)
    const result = await prisma.restoreTask.findUniqueOrThrow({ where: { id } })
    assert.deepEqual(forwards, preservedForwards, `${mode}: IPv4/IPv6 forwards must survive`)
    assert.equal(requests.some(path => path.includes('/networks')), false)
    const current = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
    assert.equal(current.ipv4, instance.ipv4); assert.equal(current.ipv6, instance.ipv6)
    assert.equal(current.userId, instance.userId); assert.equal(current.hostId, instance.hostId); assert.equal(current.dedicatedIpv4, true)
    if (mode === 'success') {
      assert.equal(result.status, 'COMPLETED', result.error ?? '')
      assert.equal(remote.size, 1); assert.equal(remote.get(tag)?.status, 'Running'); assert.equal(remote.get(tag)?.config?.['volatile.uuid'], restoredUuid)
      assert.equal(current.storagePoolName, 'original-disk')
      assert.equal((await prisma.backup.findUniqueOrThrow({ where: { id: backup.id } })).status, 'deleted')
      assert.equal(await hasActiveTransferWorkflow(instance.id), false)
    } else {
      assert.equal(result.status, 'PROCESSING', mode); assert.equal(result.progress, 'manual_intervention', mode)
      assert.ok(result.error && result.recoveryState)
      assert.ok(remote.size >= 1, mode + ': retain every surviving copy')
      assert.equal(await hasActiveTransferWorkflow(instance.id), true)
      assert.equal(await claimNextTask(host.id), null)
      assert.equal((await createBackupWithQuotaReservation({ instanceId: instance.id, incusName: 'blocked', name: 'blocked' })).allowed, false)
      assert.equal((await prisma.backup.findUniqueOrThrow({ where: { id: backup.id } })).status, 'ready')
      const before = requests.length
      await cleanupStaleTasks(); await cleanupTimeoutTasks(); await executeRestoreTask(id)
      assert.equal(requests.length, before, 'restart/late execution never repeats import/delete')
      if (['wrong-device', 'wrong-pool', 'missing-uuid', 'original-reused', 'ban-after-import', 'late-backup', 'import-error'].includes(mode)) {
        assert.equal(deleteCount, 0, mode); assert.equal(remote.size, 2, mode)
      }
      if (['delete-disconnect', 'rename-error'].includes(mode)) assert.ok(remote.has(taskTemp), mode + ': unique temp preserved')
    }
    if (triggerInstalled) {
      await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON restore_tasks`); await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`); triggerInstalled = false
    }
    await prisma.user.update({ where: { id: user.id }, data: { status: 'active' } })
    await prisma.backup.deleteMany({ where: { instanceId: instance.id, id: { not: backup.id } } })
    await prisma.restoreTask.update({ where: { id }, data: { status: 'FAILED' } })
  }
  console.log('PASS 15 real PG/mTLS worker replacement scenarios: source pool/UUID/devices, persisted operation before wait, original reuse, changed IPv6/pool/missing UUID, revocation, changed manifest, remote import/delete/rename/start faults and atomic final DB failure; all remaining copies and workflow fences preserved; zero network-forward deletions. Disk contents and guest connectivity are fixtures, not real Incus evidence.')
} finally {
  if (triggerInstalled) { await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON restore_tasks`); await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`) }
  await prisma.restoreTask.deleteMany({ where: { hostId: host.id } })
  await prisma.instance.delete({ where: { id: instance.id } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.log.deleteMany({ where: { userId: user.id } }); await prisma.inboxMessage.deleteMany({ where: { userId: user.id } })
  await prisma.user.delete({ where: { id: user.id } })
  await closePrismaDatabase()
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  if (previousState === undefined) delete process.env.PLATFORM_BACKUP_STATE_DIR; else process.env.PLATFORM_BACKUP_STATE_DIR = previousState
  await rm(root, { recursive: true, force: true })
}
process.exit(process.exitCode || 0)
