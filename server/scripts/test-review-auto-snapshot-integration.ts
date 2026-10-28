import assert from 'node:assert/strict'
import { randomUUID, X509Certificate } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile, unlink } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'),
  'Use isolated local *_pool_test PostgreSQL')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { runAutoSnapshotJob } = await import('../src/services/auto-policy-scheduler.js')
const { prepareAutoSnapshotOperation, applyAutoSnapshotOperation, retryAutoSnapshotOperation } = await import('../src/services/auto-snapshot-operations.js')
const { withSnapshotMutation } = await import('../src/db/snapshot-operation-guards.js')
const { createInstanceTask } = await import('../src/db/instance-tasks.js')
const { INSTANCE_OPERATION_LOCK_NAMESPACE, advisoryTransactionLock } = await import('../src/db/advisory-locks.js')
const { acquireLock, releaseLock } = await import('../src/lib/distributed-lock.js')
const tag = `auto-snapshot-${randomUUID()}`
const root = await mkdtemp(join(tmpdir(), tag))
const keyPath = join(root, 'key.pem'), certPath = join(root, 'cert.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=incus-fixture', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath],
{ stdio: 'pipe', windowsHide: true })
const certificate = await readFile(certPath, 'utf8')
const fingerprint = new X509Certificate(certificate).fingerprint256
const remoteSnapshots = new Map<string, Set<string>>()
const requests: Array<{ method: string; name: string; path: string }> = []
let rejectCreate = false
let hideCreate = false
let keepDeleted = false
let uuidSuffix = ''
let runningRemoteName = ''
let mutationReached: (() => void) | undefined
let holdResponse = false
const server = createServer({ key: await readFile(keyPath), cert: certificate, ca: certificate,
  requestCert: true, rejectUnauthorized: true }, async (request, response) => {
  try {
    assert.ok((request.socket as any).authorized, 'use actual authenticated TLS')
    response.setHeader('content-type', 'application/json')
    if (request.url === '/1.0') return response.end(JSON.stringify({ type: 'sync', metadata: { api_version: '1.0' } }))
    if (request.url === '/1.0/operations?recursion=1') return response.end(JSON.stringify({ type:'sync', metadata: { running: runningRemoteName ? [{ resources: { instances: ['/1.0/instances/' + runningRemoteName] } }] : [] } }))
    const parts = (request.url || '').split('/')
    const name = parts[3]
    requests.push({ method: request.method || '', name, path: request.url || '' })
    const snapshots = remoteSnapshots.get(name)
    assert.ok(snapshots, 'never touch another instance or its disk')
    if (request.method === 'GET') {
      const metadata = parts[4] === 'snapshots' ? [...snapshots].map(item => '/1.0/instances/' + name + '/snapshots/' + item) :
        { name, config: { 'volatile.uuid': name + uuidSuffix } }
      return response.end(JSON.stringify({ type: 'sync', metadata }))
    }
    assert.equal(parts[4], 'snapshots')
    if (request.method === 'POST') {
      let body = ''; for await (const chunk of request) body += chunk
      if (rejectCreate) {
        response.statusCode = 500
        return response.end(JSON.stringify({ type: 'error', error: 'fixture-snapshot-create-refused' }))
      }
      const target = JSON.parse(body).name
      assert.equal(typeof target, 'string')
      assert.ok(!snapshots.has(target))
      if (!hideCreate) snapshots.add(target)
      mutationReached?.(); if (holdResponse) return
    } else if (request.method === 'DELETE') {
      if (!keepDeleted) assert.ok(snapshots.delete(parts[5]), 'delete only an existing captured snapshot')
    } else throw new Error('unexpected remote action')
    response.end(JSON.stringify({ type: 'sync', metadata: {} }))
  } catch (error) {
    response.statusCode = 500
    response.end(JSON.stringify({ type: 'error', error: error instanceof Error ? error.message : String(error) }))
  }
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as { port: number }).port
const owner = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: owner.id, name: tag, status: 'online', url: `https://127.0.0.1:${port}`,
  certPath, keyPath, serverCertificate: certificate, serverFingerprint: fingerprint } })
const instanceIds: number[] = []
try {
  for (const kind of ['success', 'rotation', 'expired', 'transfer', 'operation_busy', 'policy_disabled_while_queued', 'remote_refused'] as const) {
    const name = `${tag}-${kind}`
    const instance = await prisma.instance.create({ data: { userId: owner.id, hostId: host.id, name, incusId: name,
      image: 'fixture/debian', status: 'running', cpu: 100, memory: 512, disk: 1024, snapshotLimit: 1,
      expiresAt: new Date(Date.now() + (kind === 'expired' ? -60000 : 86400000)) } })
    instanceIds.push(instance.id)
    remoteSnapshots.set(name, new Set())
    await prisma.snapshotPolicy.create({ data: { instanceId: instance.id, enabled: true, intervalMinutes: 10 } })
    if (kind === 'rotation') {
      remoteSnapshots.get(name)!.add('auto-old')
      await prisma.snapshot.create({ data: { instanceId: instance.id, name: 'auto-old', incusName: 'auto-old' } })
    }
    if (kind === 'transfer') await prisma.instanceTransfer.create({ data: {
      instanceId: instance.id, fromUserId: owner.id, toUserId: owner.id, status: 'processing', fee: 0, snapshot: {} } })
    const lockKey = `auto-policy:snapshot:${instance.id}`
    let snapshotLock: Awaited<ReturnType<typeof acquireLock>> | undefined
    if (kind === 'policy_disabled_while_queued') snapshotLock = await acquireLock(lockKey)
    let unlock: (() => void) | undefined
    let lockTransaction: Promise<unknown> | undefined
    if (kind === 'operation_busy') {
      let acquired!: () => void
      const ready = new Promise<void>(resolve => { acquired = resolve })
      const release = new Promise<void>(resolve => { unlock = resolve })
      lockTransaction = prisma.$transaction(async tx => {
        await advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instance.id)
        acquired(); await release
      }, { timeout: 20000 })
      await ready
    }
    rejectCreate = kind === 'remote_refused'
    const before = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
    try {
      const job = runAutoSnapshotJob()
      if (snapshotLock?.ownerId) {
        // Let candidate selection finish, then revoke its policy before it can execute.
        await new Promise(resolve => setTimeout(resolve, 20))
        await prisma.snapshotPolicy.update({ where: { instanceId: instance.id }, data: { enabled: false } })
        await releaseLock(lockKey, snapshotLock.ownerId)
      }
      await job
      const snapshots = await prisma.snapshot.findMany({ where: { instanceId: instance.id } })
      const policy = await prisma.snapshotPolicy.findUniqueOrThrow({ where: { instanceId: instance.id } })
      const calls = requests.filter(request => request.name === name)
      if (kind === 'success' || kind === 'rotation') {
        assert.equal(snapshots.length, 1)
        assert.match(snapshots[0].name, /^auto-/)
        assert.ok(remoteSnapshots.get(name)!.has(snapshots[0].incusName))
        assert.ok(policy.lastRunAt && policy.nextRunAt && policy.nextRunAt > policy.lastRunAt)
        assert.equal(calls.filter(call => call.method === 'POST').length, 1)
        assert.equal(calls.filter(call => call.method === 'DELETE').length, kind === 'rotation' ? 1 : 0)
      } else {
        assert.equal(snapshots.length, 0)
        assert.equal(policy.lastRunAt, null)
        assert.equal(calls.filter(call => call.method !== 'GET').length, kind === 'remote_refused' ? 1 : 0, 'ineligible or locked candidates cause no remote writes')
      }
      assert.deepEqual(await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } }), before,
        'snapshot job must preserve instance identity, price, network, disk and inventory fields')
      console.log(`PASS automatic snapshot/${kind}: current eligibility, remote effects and policy receipts verified`)
    } finally {
      unlock?.(); await lockTransaction
      if (snapshotLock?.ownerId) await releaseLock(lockKey, snapshotLock.ownerId)
      await prisma.snapshotPolicy.update({ where: { instanceId: instance.id }, data: { enabled: false } })
      await prisma.autoSnapshotOperation.updateMany({ where: { instanceId: instance.id, state: 'retry' }, data: { state: 'blocked' } })
    }
  }

  rejectCreate = false
  const actor = { id: owner.id, sid: randomUUID(), iat: Math.floor(Date.now() / 1000) + 10 }
  for (const kind of ['create_commit', 'delete_commit', 'finalize_commit', 'remote_refused_keeps_old',
    'unconfirmed_create', 'unconfirmed_delete', 'uuid_changed', 'host_changed', 'session_revoked',
    'concurrent', 'disabled_recovery', 'expired_recovery', 'fresh_applying', 'stale_applying', 'process_killed', 'bounded_retries', 'remote_still_running', 'recovery_hold'] as const) {
    const name = tag + '-' + kind
    const instance = await prisma.instance.create({ data: { userId: owner.id, hostId: host.id, name, incusId: name,
      image: 'fixture/debian', status: 'running', cpu: 100, memory: 512, disk: 1024, snapshotLimit: 1,
      expiresAt: new Date(Date.now() + 86400000) } })
    instanceIds.push(instance.id)
    remoteSnapshots.set(name, new Set(['auto-old']))
    await prisma.snapshot.create({ data: { instanceId: instance.id, incusName: 'auto-old', name: 'auto-old' } })
    await prisma.snapshotPolicy.create({ data: { instanceId: instance.id, enabled: true, intervalMinutes: 10 } })
    const plan = await prepareAutoSnapshotOperation(instance.id)
    assert.ok(plan)
    if (kind === 'recovery_hold') {
      const previousDir = process.env.PLATFORM_BACKUP_STATE_DIR
      process.env.PLATFORM_BACKUP_STATE_DIR = root
      try {
        await writeFile(join(root, 'recovery-hold.json'), '{}')
        assert.equal((await applyAutoSnapshotOperation(plan.id)).state, 'pending')
        assert.equal(requests.filter(row => row.name === name).length, 0)
        assert.equal(await prepareAutoSnapshotOperation(instance.id), null)
      } finally {
        await unlink(join(root, 'recovery-hold.json'))
        if (previousDir === undefined) delete process.env.PLATFORM_BACKUP_STATE_DIR; else process.env.PLATFORM_BACKUP_STATE_DIR = previousDir
      }
    }
    const calls = () => requests.filter(call => call.name === name && call.method !== 'GET')
    const frozen = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
    await assert.rejects(createInstanceTask({ instanceId: instance.id, hostId: host.id, userId: owner.id, taskType: 'stop' }), /自动快照/)
    await assert.rejects(withSnapshotMutation({ id: instance.id, user_id: owner.id, host_id: host.id, incus_id: name }, actor, false,
      async () => { throw new Error('must not execute') }), /自动快照/)
    const triggerStage = kind === 'create_commit' ? 'created' : kind === 'delete_commit' ? 'deleted' : kind === 'finalize_commit' ? 'finalize' : null
    if (triggerStage) {
      await prisma.$executeRawUnsafe(`CREATE FUNCTION fixture_auto_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.id = '${plan.id}'::uuid AND NEW.stage = '${triggerStage}' THEN RAISE EXCEPTION 'fixture-auto-commit-failure'; END IF; RETURN NEW; END $$`)
      await prisma.$executeRawUnsafe('CREATE TRIGGER fixture_auto_failure BEFORE UPDATE ON auto_snapshot_operations FOR EACH ROW EXECUTE FUNCTION fixture_auto_failure()')
    }
    try {
      rejectCreate = kind === 'remote_refused_keeps_old' || kind === 'bounded_retries'
      hideCreate = kind === 'unconfirmed_create'; keepDeleted = kind === 'unconfirmed_delete'
      if (['uuid_changed', 'host_changed', 'session_revoked', 'disabled_recovery', 'expired_recovery', 'remote_still_running'].includes(kind)) {
        // A prior remote create happened, but its transaction receipt was lost.
        remoteSnapshots.get(name)!.add(plan.snapshotName)
        await prisma.autoSnapshotOperation.update({ where: { id: plan.id }, data: { remoteUuid: name } })
      }
      if (kind === 'remote_still_running') runningRemoteName = name
      if (kind === 'uuid_changed') uuidSuffix = '-replaced'
      if (kind === 'host_changed') await prisma.host.update({ where: { id: host.id }, data: { serverFingerprint: 'changed-pin' } })
      if (kind === 'session_revoked') {
        await prisma.tokenInvalidation.create({ data: { userId: owner.id, sessionId: actor.sid, invalidatedAt: actor.iat } })
        await assert.rejects(retryAutoSnapshotOperation(instance.id, plan.id, actor), /无权/)
        assert.equal(calls().length, 0)
        await prisma.tokenInvalidation.deleteMany({ where: { userId: owner.id, sessionId: actor.sid } })
      }
      if (kind === 'disabled_recovery') await prisma.snapshotPolicy.update({ where: { instanceId: instance.id }, data: { enabled: false } })
      if (kind === 'expired_recovery') await prisma.instance.update({ where: { id: instance.id }, data: { expiresAt: new Date(0), status: 'suspended' } })
      if (kind === 'fresh_applying' || kind === 'stale_applying') await prisma.autoSnapshotOperation.update({ where: { id: plan.id }, data: {
        state: 'applying', attemptId: randomUUID(), startedAt: kind === 'fresh_applying' ? new Date() : new Date(0) } })
      if (kind === 'process_killed') {
        const reached = new Promise<void>(resolve => { mutationReached = resolve }); holdResponse = true
        const childCode = `import {applyAutoSnapshotOperation} from './src/services/auto-snapshot-operations.ts';await applyAutoSnapshotOperation('${plan.id}');`
        const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', childCode], { cwd: process.cwd(), env: process.env, windowsHide: true, stdio: 'ignore' })
        try {
          await Promise.race([reached, new Promise((_, reject) => setTimeout(() => reject(new Error('child mutation deadline')), 20000))])
        } finally {
          child.kill('SIGKILL'); await new Promise(resolve => child.once('exit', resolve)); holdResponse = false; mutationReached = undefined
        }
        assert.equal((await prisma.autoSnapshotOperation.findUniqueOrThrow({ where: { id: plan.id } })).state, 'applying')
        await prisma.autoSnapshotOperation.update({ where: { id: plan.id }, data: { startedAt: new Date(0) } })
      }
      if (kind === 'concurrent') await Promise.all([applyAutoSnapshotOperation(plan.id), applyAutoSnapshotOperation(plan.id)])
      else await applyAutoSnapshotOperation(plan.id)
      let result = await prisma.autoSnapshotOperation.findUniqueOrThrow({ where: { id: plan.id } })
      if (triggerStage) assert.equal(result.state, 'retry')
      if (kind === 'remote_still_running') { assert.equal(result.state, 'retry'); assert.equal(calls().length, 0) }
      runningRemoteName = ''
      if (['remote_refused_keeps_old','unconfirmed_create'].includes(kind)) {
        assert.ok(remoteSnapshots.get(name)!.has('auto-old')); assert.equal(calls().filter(call => call.method === 'DELETE').length, 0)
      }
      if (kind === 'bounded_retries') {
        for (let attempt = 1; attempt < 5; attempt++) {
          await prisma.autoSnapshotOperation.update({ where: { id: plan.id }, data: { nextRetryAt: new Date(0) } }); await applyAutoSnapshotOperation(plan.id)
        }
        result = await prisma.autoSnapshotOperation.findUniqueOrThrow({ where: { id: plan.id } })
        assert.equal(result.state, 'blocked'); assert.equal(result.attempts, 5)
        await applyAutoSnapshotOperation(plan.id); assert.equal(calls().length, 5)
      }
      if (['uuid_changed', 'host_changed'].includes(kind)) { assert.equal(result.state, 'blocked'); assert.equal(calls().length, 0) }
      if (kind === 'fresh_applying') { assert.equal(result.state, 'applying'); assert.equal(calls().length, 0) }
      if (triggerStage) { await prisma.$executeRawUnsafe('DROP TRIGGER fixture_auto_failure ON auto_snapshot_operations'); await prisma.$executeRawUnsafe('DROP FUNCTION fixture_auto_failure()') }
      rejectCreate = false; hideCreate = false; keepDeleted = false; uuidSuffix = ''
      await prisma.host.update({ where: { id: host.id }, data: { serverFingerprint: fingerprint } })
      if (result.state !== 'succeeded') {
        await prisma.autoSnapshotOperation.update({ where: { id: plan.id }, data: { startedAt: new Date(0) } })
        await retryAutoSnapshotOperation(instance.id, plan.id, actor)
      }
      result = await prisma.autoSnapshotOperation.findUniqueOrThrow({ where: { id: plan.id } })
      assert.equal(result.state, 'succeeded'); assert.equal(result.snapshotName, plan.snapshotName)
      assert.deepEqual([...remoteSnapshots.get(name)!], [plan.snapshotName])
      assert.equal(await prisma.snapshot.count({ where: { instanceId: instance.id } }), 1)
      assert.equal(await prisma.log.count({ where: { instanceId: instance.id, action: 'snapshot.auto_create' } }), 1)
      if (kind !== 'bounded_retries' && kind !== 'remote_refused_keeps_old' && kind !== 'unconfirmed_create') assert.ok(calls().filter(call => call.method === 'POST').length <= 1)
      if (kind !== 'unconfirmed_delete') assert.equal(calls().filter(call => call.method === 'DELETE').length, 1)
      if (kind !== 'expired_recovery') assert.deepEqual(await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } }), frozen)
      console.log('PASS durable automatic snapshot/' + kind)
    } finally {
      if (triggerStage) { await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fixture_auto_failure ON auto_snapshot_operations'); await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fixture_auto_failure()') }
      rejectCreate = false; hideCreate = false; keepDeleted = false; uuidSuffix = ''; holdResponse = false; mutationReached = undefined
      await prisma.host.update({ where: { id: host.id }, data: { serverFingerprint: fingerprint } })
    }
  }
  console.log('PASS real PostgreSQL and mTLS automatic snapshot execution; Incus API is a fixture, process-kill recovery verified; actual Incus disk and Linux remain separate acceptance')
} finally {
  await prisma.log.deleteMany({ where: { OR: [{ userId: owner.id }, { instanceId: { in: instanceIds } }] } })
  await prisma.inboxMessage.deleteMany({ where: { userId: owner.id } })
  await prisma.autoSnapshotOperation.deleteMany({ where: { instanceId: { in: instanceIds } } })
  await prisma.instance.deleteMany({ where: { id: { in: instanceIds } } })
  await prisma.host.delete({ where: { id: host.id } })
  await prisma.user.delete({ where: { id: owner.id } })
  await closePrismaDatabase()
  await new Promise<void>(resolve => server.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
}
process.exit(0)
