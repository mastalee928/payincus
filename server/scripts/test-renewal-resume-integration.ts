import assert from 'node:assert/strict'
import { randomUUID, X509Certificate } from 'node:crypto'
import { createServer } from 'node:https'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Client } from 'pg'
import { setTimeout as delay } from 'node:timers/promises'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
process.env.DB_POOL_MAX = '2'
const root = await mkdtemp(join(tmpdir(), 'renew-start-'))
process.env.PLATFORM_BACKUP_STATE_DIR = root
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=localhost', '-keyout', join(root, 'key.pem'), '-out', join(root, 'cert.pem')], { stdio: 'pipe', windowsHide: true })
const interval = globalThis.setInterval
globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => { const timer = interval(...args); timer.unref(); return timer }) as typeof setInterval
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { performRenewal } = await import('../src/db/billing-operations.js')
const { executeAutoRenew } = await import('../src/services/billing-scheduler.js')
const { claimLightTask, executeTask, failExpiredInstanceTaskAttempt } = await import('../src/workers/instanceTaskWorker.js')
const { retryRenewalResumes, RENEWAL_RESUME_ENTRY } = await import('../src/services/renewal-resume.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const { cancelInstanceTask, createInstanceTask, cleanupOldTasks } = await import('../src/db/instance-tasks.js')
const { transferHostIdentity } = await import('../src/lib/transfer-host-identity.js')
globalThis.setInterval = interval
const tag = 'renew-start-' + randomUUID()
const certificate = await readFile(join(root, 'cert.pem'), 'utf8')
const fingerprint = new X509Certificate(certificate).fingerprint256
const remote = new Map<string, any>(), starts = new Map<string, number>()
const operations = new Map<string, any>()
let fault = ''
let remoteBusy: string | undefined
const server = createServer({ cert: await readFile(join(root, 'cert.pem')), key: await readFile(join(root, 'key.pem')) }, async (req, res) => {
  const url = new URL(req.url!, 'https://fixture')
  const send = (metadata: unknown, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: code === 200 ? 'sync' : 'error', metadata, error: code === 200 ? '' : 'isolated unavailable' })) }
  if (url.pathname === '/1.0') return send({ api_version: '1.0' })
  if (url.pathname === '/1.0/operations') return send({ running: remoteBusy ? [
    { id: 'prior-operation', status: 'Running', resources: { instances: [`/1.0/instances/${remoteBusy}`] } }
  ] : [] })
  const operation = /^\/1\.0\/operations\/([^/]+)\/wait$/.exec(url.pathname)
  if (operation) {
    const guest = operations.get(operation[1]); assert.ok(guest)
    guest.status = 'Running'; return send({ status: 'Success', metadata: {} })
  }
  const match = /^\/1\.0\/instances\/([^/]+)(\/state)?$/.exec(url.pathname)
  if (!match) return send({}, 404)
  const guest = remote.get(match[1]); if (!guest) return send({}, 404)
  if (req.method === 'GET') return send(guest)
  assert.equal(req.method, 'PUT'); assert.equal(match[2], '/state')
  let body = ''; for await (const chunk of req) body += chunk
  assert.deepEqual(JSON.parse(body), { action: 'start', timeout: 30 })
  starts.set(guest.name, (starts.get(guest.name) ?? 0) + 1)
  if (fault === 'refused') return send({}, 503)
  if (fault === 'no-effect') return send({})
  if (fault === 'async') {
    const id = randomUUID(); operations.set(id, guest); guest.status = 'Starting'
    res.writeHead(202, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ type: 'async', operation: `/1.0/operations/${id}`, metadata: {} }))
  }
  guest.status = 'Running'
  if (fault === 'accepted-error') return send({}, 503)
  return send({})
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const holder = new Client({ connectionString: database.href }), monitor = new Client({ connectionString: database.href })
const userIds: number[] = [], hostIds: number[] = []
let pkgId: number | undefined
const wait = async (check: () => Promise<boolean> | boolean, label: string) => {
  const deadline = Date.now() + 10000
  while (!await check()) { if (Date.now() > deadline) throw Error(label); await delay(10) }
}
try {
  await holder.connect(); await monitor.connect()
  const owner = await prisma.user.create({ data: { username: tag, passwordHash: 'unused', role: 'admin' } }); userIds.push(owner.id)
  const pkg = await prisma.package.create({ data: { userId: owner.id, name: tag, cpuMax: 100, memoryMax: 128, diskMax: 1024 } }); pkgId = pkg.id
  const plan = await prisma.packagePlan.create({ data: { packageId: pkg.id, name: tag, cpu: 100, memory: 128, disk: 1024,
    portLimit: 1, snapshotLimit: 0, backupLimit: 0, siteLimit: 0, trafficLimit: 0n, price: 1000 } })
  const make = async (kind = 'suspended', arch = 'x86_64') => {
    const user = await prisma.user.create({ data: { username: tag + userIds.length, passwordHash: 'unused', balance: 100 } }); userIds.push(user.id)
    const host = await prisma.host.create({ data: { userId: owner.id, name: tag + hostIds.length, url: `https://127.0.0.1:${(server.address() as { port: number }).port}`,
      certPath: join(root, 'cert.pem'), keyPath: join(root, 'key.pem'), serverCertificate: certificate,
      serverFingerprint: fingerprint, status: 'online', architecture: arch } }); hostIds.push(host.id)
    const name = 'guest-' + randomUUID(), uuid = randomUUID(), createdAt = new Date(Date.now() - 86400000).toISOString()
    const guest = { name, type: 'container', project: 'default', status: kind === 'running' ? 'Running' : 'Stopped', ephemeral: false,
      created_at: createdAt, profiles: [], config: { 'volatile.uuid': uuid, 'security.privileged': 'false' },
      devices: { root: { type: 'disk', path: '/', pool: 'default' }, eth0: { type: 'nic', nictype: 'bridged', parent: 'incusbr0' } } }
    remote.set(name, guest)
    const instance = await prisma.instance.create({ data: { userId: user.id, hostId: host.id, packageId: pkg.id, packagePlanId: plan.id,
      name, incusId: name, image: 'fixture', cpu: 100, memory: 128, disk: 1024, billingPrice: 10, billingCycle: 1, autoRenew: true,
      status: kind as 'suspended' | 'stopped' | 'running', ...(kind === 'suspended' ? { suspendReason: 'expired', suspendedAt: new Date() } : {}),
      expiresAt: new Date(Date.now() - 60000), snapshottedSpecs: { recoveryIdentity: { uuid, createdAt, project: 'default' } } } })
    return { user, host, instance, guest }
  }
  const taskFor = (id: number) => prisma.instanceTask.findFirstOrThrow({ where: { instanceId: id, operationEntry: RENEWAL_RESUME_ENTRY } })
  const run = async (id: number) => {
    const task = await taskFor(id), claim = await claimLightTask(task.hostId, task.id)
    assert.ok(claim, 'automatic resume can enter normal light-task worker')
    await executeTask(task.id, claim)
    return taskFor(id)
  }
  const renew = (instance: any) => performRenewal(instance.userId, instance, 1, { expiryThreshold: new Date(Date.now() + 86400000) })
  const due = async (id: number) => {
    const task = await taskFor(id)
    await prisma.instanceTask.update({ where: { id: task.id }, data: { replacementState: { ...(task.replacementState as any), nextAttemptAt: new Date(0).toISOString() } } })
    await retryRenewalResumes()
  }
  const assertPaidOnce = async (id: number) => {
    assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: id, type: 'renew' } }), 1)
    assert.equal(await prisma.balanceLog.count({ where: { instanceId: id, type: 'consume' } }), 1)
  }
  for (const arch of ['x86_64', 'aarch64']) {
    const row = await make('suspended', arch), before = structuredClone(row.guest)
    await renew(row.instance)
    assert.equal((await taskFor(row.instance.id)).status, 'PENDING')
    const task = await run(row.instance.id)
    assert.equal(task.status, 'COMPLETED'); assert.equal(starts.get(row.instance.incusId), 1)
    assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: row.instance.id } })).status, 'running')
    assert.deepEqual(row.guest, { ...before, status: 'Running' }); await assertPaidOnce(row.instance.id)
    await retryRenewalResumes(); await executeTask(task.id, task); assert.equal(starts.get(row.instance.incusId), 1)
  }
  console.log('PASS AMD64/ARM64 fixture metadata: one paid transaction queues one task, actual worker verifies start and preserves configuration; no replay')
  for (const kind of ['stopped', 'running']) {
    const row = await make(kind); await renew(row.instance)
    assert.equal(await prisma.instanceTask.count({ where: { instanceId: row.instance.id } }), 0)
  }
  const manual = await make(); await performRenewal(manual.user.id, manual.instance, 1)
  assert.equal(await prisma.instanceTask.count({ where: { instanceId: manual.instance.id } }), 0)
  console.log('PASS ordinary stopped/running and manual renewals do not enqueue automatic starts')

  const fair = await make(); await renew(fair.instance)
  const template = await taskFor(fair.instance.id)
  const queued = await prisma.instanceTask.createManyAndReturn({ data: Array.from({ length: 100 }, () => ({
    instanceId: fair.instance.id, hostId: fair.host.id, userId: fair.user.id, taskType: 'start' as const, status: 'FAILED' as const,
    operationEntry: RENEWAL_RESUME_ENTRY, replacementState: { ...(template.replacementState as any), nextAttemptAt: new Date(0).toISOString() },
    finishedAt: new Date(Date.now() - 60000)
  })) })
  const waitingLast = await prisma.instanceTask.create({ data: {
    instanceId: fair.instance.id, hostId: fair.host.id, userId: fair.user.id, taskType: 'start', status: 'FAILED',
    operationEntry: RENEWAL_RESUME_ENTRY, replacementState: { ...(template.replacementState as any), nextAttemptAt: new Date(0).toISOString() },
    finishedAt: new Date(Date.now() - 3600000)
  } })
  await retryRenewalResumes()
  assert.equal((await prisma.instanceTask.findUniqueOrThrow({ where: { id: waitingLast.id } })).status, 'PENDING', 'oldest waiting resume must not starve behind repeatedly failing smaller IDs')
  await prisma.instanceTask.deleteMany({ where: { id: { in: [template.id, waitingLast.id, ...queued.map(task => task.id)] } } })
  await prisma.instance.update({ where: { id: fair.instance.id }, data: { autoRenew: false } })
  console.log('PASS retry batches prioritize longest waiting work rather than starving higher instance IDs')

  const invalid = await make(); await renew(invalid.instance)
  const invalidTask = await taskFor(invalid.instance.id)
  await prisma.instanceTask.update({ where: { id: invalidTask.id }, data: { status: 'FAILED', finishedAt: new Date(0),
    replacementState: { ...(invalidTask.replacementState as any), version: 99 } } })
  await retryRenewalResumes()
  assert.equal(((await taskFor(invalid.instance.id)).replacementState as any).terminal, true, 'malformed intent must not occupy every retry batch')
  assert.equal(starts.get(invalid.instance.incusId) ?? 0, 0); await assertPaidOnce(invalid.instance.id)
  console.log('PASS malformed paid start intent terminates without blocking the queue or recharging')

  for (const verified of [true, false]) {
    const replaced = await make()
    const history = await prisma.instanceTask.create({ data: { instanceId: replaced.instance.id, hostId: replaced.host.id,
      targetHostId: replaced.host.id, userId: replaced.user.id, taskType: verified ? 'replace_host' : 'recreate', status: 'COMPLETED',
      finishedAt: new Date(Date.now() - 8 * 86400000), replacementState: verified ? {
        targetHostIdentity: transferHostIdentity(replaced.host), targetIncusId: replaced.instance.incusId,
        targetUuid: replaced.guest.config['volatile.uuid'], targetCreatedAt: replaced.guest.created_at
      } : {} } })
    await cleanupOldTasks()
    assert.ok(await prisma.instanceTask.findUnique({ where: { id: history.id } }), 'live guest lifecycle identity evidence must survive seven-day cleanup')
    await renew(replaced.instance)
    assert.equal((await run(replaced.instance.id)).status, verified ? 'COMPLETED' : 'FAILED')
    assert.equal(starts.get(replaced.instance.incusId) ?? 0, verified ? 1 : 0); await assertPaidOnce(replaced.instance.id)
  }
  console.log('PASS lifecycle identity survives history cleanup; proven replacement resumes, unproven recreation never falls back to an old identity')

  const parallel = [await make(), await make()]
  for (const row of parallel) await renew(row.instance)
  const parallelResults = await Promise.all(parallel.map(row => run(row.instance.id)))
  assert.ok(parallelResults.every(task => task.status === 'COMPLETED'))
  for (const row of parallel) await assertPaidOnce(row.instance.id)
  console.log('PASS concurrent paid resumes with a two-connection DB pool do not borrow nested transaction connections')

  const asynchronous = await make(); await renew(asynchronous.instance); fault = 'async'
  assert.equal((await run(asynchronous.instance.id)).status, 'COMPLETED'); fault = ''
  assert.equal(starts.get(asynchronous.instance.incusId), 1); assert.equal(asynchronous.guest.status, 'Running')
  await assertPaidOnce(asynchronous.instance.id)
  console.log('PASS Incus asynchronous operation is awaited and actual Running is verified before completion')

  const rollback = await make()
  const { queueRenewalResume } = await import('../src/services/renewal-resume.js')
  await assert.rejects(prisma.$transaction(async tx => {
    await tx.user.update({ where: { id: rollback.user.id }, data: { balance: { decrement: 10 } } })
    await queueRenewalResume(tx, rollback.instance, rollback.host, new Date(Date.now() + 86400000), 1)
    throw new Error('rollback after enqueue')
  }), /rollback after enqueue/)
  assert.equal(await prisma.instanceTask.count({ where: { instanceId: rollback.instance.id } }), 0)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: rollback.user.id } })).balance), 100)
  await prisma.instance.update({ where: { id: rollback.instance.id }, data: { autoRenew: false } })
  console.log('PASS rollback after durable enqueue leaves neither a debit nor an automatic start task')

  const lost = await make(); await renew(lost.instance); fault = 'accepted-error'
  assert.equal((await run(lost.instance.id)).status, 'FAILED'); assert.equal(lost.guest.status, 'Running')
  assert.equal(starts.get(lost.instance.incusId), 1); fault = ''
  await due(lost.instance.id); assert.equal((await run(lost.instance.id)).status, 'COMPLETED')
  assert.equal(starts.get(lost.instance.incusId), 1); await assertPaidOnce(lost.instance.id)
  console.log('PASS lost accepted start receipt retries verification, not start or payment')

  const changedConfig = await make(); await renew(changedConfig.instance); fault = 'accepted-error'
  await run(changedConfig.instance.id); fault = ''
  ;(changedConfig.guest.config as Record<string, string>)['limits.memory'] = '256MiB'
  await due(changedConfig.instance.id)
  assert.equal((await run(changedConfig.instance.id)).status, 'FAILED')
  assert.equal(((await taskFor(changedConfig.instance.id)).replacementState as any).terminal, true)
  assert.equal(starts.get(changedConfig.instance.incusId), 1); await assertPaidOnce(changedConfig.instance.id)
  console.log('PASS configuration changes after a lost receipt are not adopted by a later retry')

  const restart = await make(); await renew(restart.instance)
  const claimed = await claimLightTask(restart.host.id, (await taskFor(restart.instance.id)).id); assert.ok(claimed)
  await prisma.instanceTask.update({ where: { id: claimed.id }, data: { startedAt: new Date(Date.now() - 600000) } })
  const stale = await taskFor(restart.instance.id)
  assert.equal(await failExpiredInstanceTaskAttempt(stale, 'fixture process stopped'), true)
  await retryRenewalResumes(); assert.equal((await run(restart.instance.id)).status, 'COMPLETED'); await assertPaidOnce(restart.instance.id)
  console.log('PASS abandoned claimed task recovers through existing timeout cleanup and patrol without new charge')

  const superseded = await make(); await renew(superseded.instance); fault = 'refused'
  assert.equal((await run(superseded.instance.id)).status, 'FAILED'); fault = ''
  const newer = await createInstanceTask({ instanceId: superseded.instance.id, hostId: superseded.host.id, userId: superseded.user.id, taskType: 'stop' })
  await prisma.instanceTask.update({ where: { id: newer.id }, data: { status: 'COMPLETED', finishedAt: new Date(Date.now() - 8 * 86400000) } })
  const original = await taskFor(superseded.instance.id)
  await prisma.instanceTask.update({ where: { id: original.id }, data: { finishedAt: new Date(Date.now() - 8 * 86400000) } })
  await cleanupOldTasks()
  assert.ok(await prisma.instanceTask.findUnique({ where: { id: newer.id } }), 'newer stop history retained while an old paid intent is retryable')
  assert.ok(await prisma.instanceTask.findUnique({ where: { id: original.id } }), 'paid intent retained for offline recovery')
  await due(superseded.instance.id)
  assert.equal((await run(superseded.instance.id)).status, 'FAILED')
  assert.equal((await taskFor(superseded.instance.id)).replacementState && ((await taskFor(superseded.instance.id)).replacementState as any).terminal, true)
  assert.equal(starts.get(superseded.instance.incusId), 1); await assertPaidOnce(superseded.instance.id)
  await cleanupOldTasks(); assert.equal(await prisma.instanceTask.findUnique({ where: { id: newer.id } }), null)
  console.log('PASS a later completed stop permanently supersedes a failed resume, including after task-history retention')

  for (const change of ['manual-stop', 'manual-suspend', 'delete', 'expired', 'owner', 'host', 'uuid', 'missing', 'privileged', 'ephemeral', 'unpinned', 'cancel', 'banned']) {
    const row = await make(); await renew(row.instance)
    if (change === 'manual-stop') {
      const task = await taskFor(row.instance.id); await cancelInstanceTask(task.id)
      await createInstanceTask({ instanceId: row.instance.id, hostId: row.host.id, userId: row.user.id, taskType: 'stop' })
      await retryRenewalResumes(); assert.equal((await taskFor(row.instance.id)).status, 'FAILED'); continue
    }
    if (change === 'manual-suspend') await prisma.instance.update({ where: { id: row.instance.id }, data: { status: 'suspended', suspendedBy: owner.id, suspendReason: 'manual' } })
    if (change === 'delete') await prisma.instance.update({ where: { id: row.instance.id }, data: { status: 'deleted', deletionBillingPending: true } })
    if (change === 'expired') await prisma.instance.update({ where: { id: row.instance.id }, data: { expiresAt: new Date(0) } })
    if (change === 'owner') await prisma.instance.update({ where: { id: row.instance.id }, data: { userId: owner.id } })
    if (change === 'host') await prisma.host.update({ where: { id: row.host.id }, data: { serverFingerprint: 'changed' } })
    if (change === 'uuid') row.guest.config['volatile.uuid'] = randomUUID()
    if (change === 'missing') {
      const task = await taskFor(row.instance.id)
      await prisma.instanceTask.update({ where: { id: task.id }, data: { replacementState: { ...(task.replacementState as any), uuid: null } } })
    }
    if (change === 'privileged') row.guest.config['security.privileged'] = 'true'
    if (change === 'ephemeral') row.guest.ephemeral = true
    if (change === 'unpinned') await prisma.host.update({ where: { id: row.host.id }, data: { serverCertificate: null, serverFingerprint: null } })
    if (change === 'banned') await prisma.user.update({ where: { id: row.user.id }, data: { status: 'banned' } })
    if (change === 'cancel') { await cancelInstanceTask((await taskFor(row.instance.id)).id); await retryRenewalResumes() }
    else {
      const result = await run(row.instance.id); assert.equal(result.status, 'FAILED', change)
      assert.equal((result.replacementState as any).terminal, true, change)
      await due(row.instance.id); assert.equal((await taskFor(row.instance.id)).status, 'FAILED', change)
    }
    assert.equal(starts.get(row.instance.incusId) ?? 0, 0, change); await assertPaidOnce(row.instance.id)
  }
  console.log('PASS newer stop, manual suspend, deletion, expiry, owner/host/UUID, missing identity, privilege, cancellation and banned account prevent automatic start')

  const offline = await make(); await renew(offline.instance)
  await prisma.host.update({ where: { id: offline.host.id }, data: { status: 'offline' } })
  assert.equal((await run(offline.instance.id)).status, 'FAILED'); assert.equal((await taskFor(offline.instance.id)).replacementState && ((await taskFor(offline.instance.id)).replacementState as any).attempts, 0)
  await prisma.host.update({ where: { id: offline.host.id }, data: { status: 'online' } }); await due(offline.instance.id)
  assert.equal((await run(offline.instance.id)).status, 'COMPLETED')
  const held = await make(); await renew(held.instance); await writeFile(join(root, 'recovery-hold.json'), '{}')
  assert.equal((await run(held.instance.id)).status, 'FAILED'); assert.equal(starts.get(held.instance.incusId) ?? 0, 0)
  await unlink(join(root, 'recovery-hold.json')); await due(held.instance.id); assert.equal((await run(held.instance.id)).status, 'COMPLETED')
  console.log('PASS offline host and recovery hold defer without exhausting execution budget, then resume original paid task')

  const inflight = await make(); await renew(inflight.instance); remoteBusy = inflight.instance.incusId
  assert.equal((await run(inflight.instance.id)).status, 'FAILED')
  assert.equal(starts.get(inflight.instance.incusId) ?? 0, 0)
  assert.equal(((await taskFor(inflight.instance.id)).replacementState as any).attempts, 0)
  remoteBusy = undefined; await due(inflight.instance.id)
  assert.equal((await run(inflight.instance.id)).status, 'COMPLETED'); await assertPaidOnce(inflight.instance.id)
  console.log('PASS an operation surviving a prior backend stops duplicate starts until the remote operation finishes')

  const locked = await make(); await renew(locked.instance)
  await holder.query('BEGIN'); await holder.query('SELECT id FROM instances WHERE id=$1 FOR UPDATE', [locked.instance.id])
  const lockPid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
  const lockTask = await taskFor(locked.instance.id)
  // Claim before the row lock wait in execution (using only task attempt fields).
  const startedAt = new Date()
  await prisma.instanceTask.update({ where: { id: lockTask.id }, data: { status: 'PROCESSING', startedAt } })
  const waiting = executeTask(lockTask.id, { startedAt, retryCount: lockTask.retryCount })
  try {
    await wait(async () => (await monitor.query('SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))', [lockPid])).rowCount! > 0, 'resume waited on actual instance row')
    await holder.query("UPDATE instances SET status='suspended', suspended_by=$1, suspend_reason='manual' WHERE id=$2", [owner.id, locked.instance.id])
  } finally { await holder.query('COMMIT') }
  await waiting; assert.equal(starts.get(locked.instance.incusId) ?? 0, 0); await assertPaidOnce(locked.instance.id)
  console.log('PASS real row-lock race: a manual suspension committed while start waits prevents remote write')

  const busy = await make(); await renew(busy.instance)
  const busyTask = await taskFor(busy.instance.id), busyClaim = await claimLightTask(busy.host.id, busyTask.id); assert.ok(busyClaim)
  await holder.query('BEGIN'); await holder.query('SELECT id FROM instances WHERE id=$1 FOR UPDATE', [busy.instance.id])
  try { await executeTask(busyTask.id, busyClaim) } finally { await holder.query('COMMIT') }
  const busyResult = await taskFor(busy.instance.id)
  assert.equal(busyResult.status, 'FAILED'); assert.equal((busyResult.replacementState as any).attempts, 0)
  assert.equal(starts.get(busy.instance.incusId) ?? 0, 0)
  await due(busy.instance.id); assert.equal((await run(busy.instance.id)).status, 'COMPLETED'); await assertPaidOnce(busy.instance.id)
  console.log('PASS actual PostgreSQL lock timeout defers without consuming the start budget, then resumes after lock release')

  for (const failure of ['refused', 'no-effect', 'last-receipt-lost']) {
    const retry = await make(); await renew(retry.instance)
    for (let n = 0; n < 6; n++) {
      fault = failure === 'last-receipt-lost' ? (n === 5 ? 'accepted-error' : 'refused') : failure
      if (n) await due(retry.instance.id)
      assert.equal((await run(retry.instance.id)).status, 'FAILED')
    }
    fault = ''; await due(retry.instance.id)
    const confirmed = await run(retry.instance.id)
    assert.equal(confirmed.status, failure === 'last-receipt-lost' ? 'COMPLETED' : 'FAILED')
    assert.equal((confirmed.replacementState as any).terminal, true)
    assert.equal(starts.get(retry.instance.incusId), 6); await assertPaidOnce(retry.instance.id)
    await due(retry.instance.id); assert.equal((await taskFor(retry.instance.id)).status, confirmed.status)
    await executeAutoRenew(retry.user.id); assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: retry.instance.id } }), 1)
  }
  console.log('PASS six rejected or ineffective starts stop further writes; final lost receipt is confirmed read-only, with no duplicate debit')
} finally {
  await holder.query('ROLLBACK').catch(() => {})
  await prisma.instance.deleteMany({ where: { hostId: { in: hostIds } } })
  await prisma.host.deleteMany({ where: { id: { in: hostIds } } })
  if (pkgId) await prisma.package.delete({ where: { id: pkgId } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  closeAllClients(); await holder.end(); await monitor.end(); await closePrismaDatabase()
  await new Promise<void>(resolve => server.close(() => resolve()))
}
