import { protectedAgentFixture } from './fixtures/guest-protection.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use isolated local *_pool_test PostgreSQL')
const root = await mkdtemp(join(tmpdir(), 'pool-cleanup-'))
process.env.NODE_ENV = 'test'
process.env.PLATFORM_BACKUP_STATE_DIR = root
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { IncusApiError } = await import('../src/lib/incus/incus-client.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const { poolCleanupRecord, processPoolCleanup, processPoolCleanupQueue, readPoolCleanup, queueDeletedPoolHost, retryPoolCleanup } = await import('../src/services/host-pool-cleanup.js')
const { deleteInstance } = await import('../src/lib/incus/incus-instances.js')
const { dedicatedHostReadyWhere, HOST_OCCUPIED_INSTANCE_WHERE } = await import('../src/lib/host-resource-usage.js')
const { PORT_PROTOCOL_CAPABILITY } = await import('../src/services/host-port-protocol.js')
const prefix = `autoclean-${randomUUID().slice(0, 8)}`
const owner = await prisma.user.create({ data: { username: prefix, role: 'admin', passwordHash: 'test-only' } })
let currentHost = 0, remote: any[] = [], forwards: any[] = [], volumes: any[] = [], calls: string[] = []
let mode = ''
const connect = async (host: { id: number }) => {
  if (host.id !== currentHost) throw Error('other isolated fixture host is unavailable')
  return ({ request: async (method: string, path: string, body?: any) => {
  calls.push(`${method} ${path}`)
  if (mode === 'offline') throw Error('fixture offline')
  if (method !== 'GET') {
    assert.ok(await prisma.log.count({ where: { action: 'host.pool.cleanup_start', content: { contains: `(#${currentHost})` } } }), 'durable audit before mutation')
    assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: currentHost } })).poolFaulted, true)
  }
  if (path.startsWith('/1.0/instances?')) return structuredClone(remote)
  if (path === '/1.0/projects?recursion=1') return [{ name: 'default' }]
  if (path === '/1.0/networks?recursion=1') return [{ name: 'incusbr0', type: 'bridge', managed: true }]
  if (path === '/1.0/operations?recursion=1') return { running: mode === 'busy' ? [{ id: 'busy' }] : [] }
  if (path === '/1.0/storage-pools?recursion=1') return [{ name: 'default', status: 'Created' }]
  if (path.includes('/volumes?')) return structuredClone(volumes)
  if (path.includes('/forwards?')) return structuredClone(forwards)
  if (method === 'DELETE' && path.includes('/forwards/')) {
    if (mode === 'forward-failure') throw Error('fixture forward failure')
    forwards = forwards.filter(row => !path.endsWith(encodeURIComponent(row.listen_address)))
    return {}
  }
  const name = decodeURIComponent(path.replace('/1.0/instances/', '').replace(/\/state$/, ''))
  const found = remote.find(row => row.name === name)
  if (!found) throw new IncusApiError('Instance not found', 404, path)
  if (method === 'GET') {
    if (mode === 'uuid-reused' && calls.filter(call => call === `GET /1.0/instances/${name}`).length === 1) found.config['volatile.uuid'] = randomUUID()
    return structuredClone(found)
  }
  if (method === 'PUT') {
    assert.equal(body.action, 'stop'); assert.equal(body.force, true)
    if (mode !== 'stop-noop') found.status = 'Stopped'
    return {}
  }
  if (method === 'DELETE') {
    assert.equal(found.status, 'Stopped')
    if (mode !== 'delete-noop') remote = remote.filter(row => row !== found)
    if (!['disk-left', 'delete-noop'].includes(mode)) volumes = []
    if (mode === 'delete-accepted-error') throw Error('response lost after accepted deletion')
    return {}
  }
  throw Error('Unexpected fixture endpoint')
} }) as any
}

async function fixture() {
  mode = ''; calls = []
  const name = `${prefix}-${randomUUID().slice(0, 8)}`
  const host = await prisma.host.create({ data: { userId: owner.id, name, url: 'https://127.0.0.1:1', status: 'online', poolFaulted: true,
    serverCertificate: 'fixture-original-cert', serverFingerprint: 'fixture-original-pin',
    singleTenant: true, isInstalled: true, certPath: 'fixture.crt', keyPath: 'fixture.key', instanceType: 'container', natPublicIp: '192.0.2.4', natBindIp: '10.0.0.4',
    resourcePreset: 'E2', customerDiskGiB: 30, architecture: 'x86_64', cpuAllowanceMax: 200, memoryMax: 768, storageSize: 34,
    cpuUsed: 200, memoryUsed: 768, diskUsed: 30720, natPortStart: 20000, natPortEnd: 30000,
    portProtocol: 'tcp', portProtocolRevision: 1, portProtocolApplied: 'tcp', portProtocolAppliedRevision: 1,
    agent: { create: { ...protectedAgentFixture([PORT_PROTOCOL_CAPABILITY]) } },
    storagePools: { create: { name: 'default', driver: 'lvm', purpose: 'instance_data', config: { 'volume.block.filesystem': 'btrfs' } } } } })
  currentHost = host.id
  remote = [{ name, status: 'Running', created_at: '2020-01-01T00:00:00Z', project: 'default', config: { 'volatile.uuid': randomUUID() } }]
  volumes = [{ name, type: 'container' }, { name: `${name}/saved`, type: 'container' }]
  forwards = ['10.0.0.4', '2001:db8::4'].map(listen_address => ({ listen_address, description: `payincus-dedicated:${name}`, config: {} }))
  await prisma.host.update({ where: { id: host.id }, data: { poolCleanup: poolCleanupRecord(host, name, owner.id, new Date(), 1) } })
  return host
}
async function elapsedBackoff(hostId: number) {
  const state = readPoolCleanup((await prisma.host.findUniqueOrThrow({ where: { id: hostId } })).poolCleanup)!
  await prisma.host.update({ where: { id: hostId }, data: { poolCleanup: { ...state, nextAttemptAt: new Date(0).toISOString() } as any } })
}
async function scanCurrentHost() {
  const before = calls.length
  for (let round = 0; round < 20 && calls.length === before; round++) await processPoolCleanupQueue(connect)
}
const mutations = () => calls.filter(call => !call.startsWith('GET'))
try {
  const h = await fixture()
  await Promise.all([processPoolCleanup(h.id, connect), processPoolCleanup(h.id, connect)])
  assert.equal(readPoolCleanup((await prisma.host.findUniqueOrThrow({ where: { id: h.id } })).poolCleanup)?.status, 'done')
  assert.equal(mutations().filter(call => call.startsWith('PUT')).length, 1)
  assert.equal(remote.length + volumes.length + forwards.length, 0)
  const reclaimed = await prisma.host.findUniqueOrThrow({ where: { id: h.id } })
  assert.deepEqual([reclaimed.poolFaulted, reclaimed.cpuUsed, reclaimed.memoryUsed, reclaimed.diskUsed], [false, 0, 0, 0])
  assert.equal(await prisma.host.count({ where: { ...dedicatedHostReadyWhere(), id: h.id, instances: { none: HOST_OCCUPIED_INSTANCE_WHERE } } }), 1)
  console.log('PASS running source, disk/snapshot and dual forwards reclaimed; concurrent execution once; inventory eligible')

  for (const fault of ['stop-noop', 'delete-noop', 'disk-left', 'forward-failure', 'delete-accepted-error', 'offline', 'busy']) {
    const host = await fixture(); mode = fault
    await processPoolCleanup(host.id, connect)
    assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).poolFaulted, true, fault)
    assert.equal(readPoolCleanup((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).poolCleanup)?.status, 'retry', fault)
    const audit = await prisma.log.findFirstOrThrow({ where: { action: 'host.pool.cleanup_retry', content: { contains: `(#${host.id})` } } })
    assert.ok(audit.content.includes(host.name) && audit.content.includes('下次自动重试'), 'failure history includes machine, step and persisted next retry')
    if (fault === 'delete-noop') assert.equal(forwards.length, 2, 'never remove forwards while the old guest still exists')
    if (fault === 'disk-left') {
      await elapsedBackoff(host.id)
      await processPoolCleanup(host.id, connect)
      assert.equal(readPoolCleanup((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).poolCleanup)?.status, 'retry', 'known system volume still disappearing remains retryable')
    }
    const count = calls.length
    await processPoolCleanup(host.id, connect)
    assert.equal(calls.length, count, 'persisted backoff applies after a new invocation')
    mode = ''; if (fault === 'disk-left') volumes = []
    await elapsedBackoff(host.id)
    await processPoolCleanup(host.id, connect)
    assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).poolFaulted, false, fault)
    console.log(`PASS ${fault}: holds inventory, respects backoff, resumes remaining steps`)
  }
  for (const fault of ['uuid-reused', 'new-name', 'unknown-volume', 'unknown-forward', 'host-changed', 'revoked', 'assigned']) {
    const host = await fixture(); mode = fault
    if (fault === 'new-name') remote[0].created_at = '2099-01-01T00:00:00Z'
    if (fault === 'unknown-volume') volumes.push({ name: 'customer-data', type: 'custom' })
    if (fault === 'unknown-forward') forwards[0].description = 'someone-else'
    if (fault === 'host-changed') await prisma.host.update({ where: { id: host.id }, data: { url: 'https://127.0.0.1:2' } })
    if (fault === 'revoked') await prisma.user.update({ where: { id: owner.id }, data: { role: 'user' } })
    if (fault === 'assigned') {
      // Existing customer on a quarantined host is represented by an already-held instance.
      await prisma.host.update({ where: { id: host.id }, data: { poolFaulted: false } })
      await prisma.instance.create({ data: { hostId: host.id, userId: owner.id, name: host.name, incusId: host.name, image: 'fixture', status: 'running', cpu: 200, memory: 768, disk: 30720 } })
      await prisma.host.update({ where: { id: host.id }, data: { poolFaulted: true } })
    }
    await processPoolCleanup(host.id, connect)
    assert.equal(readPoolCleanup((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).poolCleanup)?.status, 'blocked', fault)
    assert.equal(mutations().length, 0, fault)
    await prisma.user.update({ where: { id: owner.id }, data: { role: 'admin' } })
    if (fault === 'revoked') {
      await elapsedBackoff(host.id); await scanCurrentHost()
      assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).poolFaulted, false, 'restored authority automatically resumes without retry endpoint')
    }
    console.log(`PASS ${fault}: zero destructive calls`)
  }
  const held = await fixture()
  await writeFile(join(root, 'recovery-hold.json'), '{}')
  await processPoolCleanup(held.id, connect)
  assert.equal(calls.length, 0)
  await rm(join(root, 'recovery-hold.json'))
  console.log('PASS platform recovery hold prevents all cleanup')

  const empty = await fixture()
  await prisma.host.update({ where: { id: empty.id }, data: { poolFaulted: false } })
  const gone = await prisma.instance.create({ data: { hostId: empty.id, userId: owner.id, name: empty.name, incusId: empty.name,
    image: 'fixture', status: 'running', cpu: 200, memory: 768, disk: 30720 } })
  await prisma.instance.update({ where: { id: gone.id }, data: { status: 'deleted' } })
  await prisma.host.update({ where: { id: empty.id }, data: { poolCleanup: (await import('@prisma/client')).Prisma.DbNull } })
  remote = []; volumes = []; forwards = []; calls = []
  await queueDeletedPoolHost(gone.id)
  await processPoolCleanup(empty.id, connect)
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: empty.id } })).poolFaulted, false)
  assert.equal(mutations().length, 0, 'ordinary deletion recovery is read-only')
  console.log('PASS ordinary deletion automatically verifies and releases empty host without repeating deletion')

  // Old delivered tasks are adopted, while records-only deletion is never adopted.
  await prisma.host.updateMany({ where: { userId: owner.id }, data: { poolFaulted: false } })
  const manual = await fixture()
  await prisma.host.update({ where: { id: manual.id }, data: { poolCleanup: { version: 1, kind: 'manual', reason: 'database_only' } } })
  const target = await fixture()
  await prisma.host.update({ where: { id: target.id }, data: { poolFaulted: false } })
  const delivered = await prisma.instance.create({ data: { hostId: target.id, userId: owner.id, name: target.name, incusId: target.name,
    image: 'fixture', status: 'running', cpu: 200, memory: 768, disk: 30720 } })
  const legacy = await fixture()
  await prisma.host.update({ where: { id: legacy.id }, data: { poolCleanup: (await import('@prisma/client')).Prisma.DbNull } })
  for (const source of [manual, legacy]) await prisma.instanceTask.create({ data: { instanceId: delivered.id, hostId: target.id,
    targetHostId: target.id, userId: owner.id, taskType: 'replace_host', status: 'COMPLETED', replacementState: {
      sourceHostId: source.id, sourceIncusId: source.name, targetIncusId: target.name, stage: 'delivered'
    } } })
  mode = 'offline'
  await scanCurrentHost()
  assert.equal(readPoolCleanup((await prisma.host.findUniqueOrThrow({ where: { id: legacy.id } })).poolCleanup)?.status, 'retry')
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: manual.id } })).poolCleanup?.['kind'], 'manual')
  await prisma.instanceTask.deleteMany({ where: { instanceId: delivered.id } })
  mode = ''; calls = []
  await elapsedBackoff(legacy.id)
  await scanCurrentHost()
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: legacy.id } })).poolFaulted, false)
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: delivered.id } })).hostId, target.id)
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: manual.id } })).poolFaulted, true)
  const manualDeleted = await prisma.instance.create({ data: { hostId: manual.id, userId: owner.id, name: 'manual-deleted', incusId: 'manual-deleted', status: 'deleted', cpu: 1, memory: 1, disk: 1, image: 'images:debian/13' } })
  await queueDeletedPoolHost(manualDeleted.id)
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: manual.id } })).poolCleanup?.['kind'], 'manual', 'deletion bookkeeping cannot replace records-only retention policy')
  console.log('PASS legacy running residue adopted; deleting task history does not lose cleanup; records-only host untouched')

  for (const fault of ['', 'offline', 'delete-accepted-error', 'before-task', 'after-task', 'marker-changed', 'readonly-residue', 'readonly-empty']) {
    await prisma.host.updateMany({ where: { userId: owner.id }, data: { poolFaulted: false } })
    const failedTarget = await fixture()
    const createdAt = new Date(Date.now() - 60000), finishedAt = new Date(Date.now() - 1000)
    remote[0].created_at = new Date(Date.now() - 30000).toISOString()
    remote[0].config['user.payincus.replacement'] = 'original-attempt'
    if (fault === 'before-task') remote[0].created_at = '2020-01-01T00:00:00Z'
    if (fault === 'after-task') remote[0].created_at = new Date().toISOString()
    if (fault === 'marker-changed') remote[0].config['user.payincus.replacement'] = 'other-attempt'
    await prisma.host.update({ where: { id: failedTarget.id }, data: { poolCleanup: (await import('@prisma/client')).Prisma.DbNull } })
    const failedTask = await prisma.instanceTask.create({ data: { instanceId: delivered.id, hostId: failedTarget.id, targetHostId: failedTarget.id,
      userId: owner.id, taskType: 'replace_host', status: 'FAILED', createdAt, finishedAt, replacementState: {
        sourceHostId: target.id, sourceIncusId: target.name, targetIncusId: failedTarget.name, stage: 'cleanup_pending',
        ...(fault === 'marker-changed' ? { targetMarker: 'original-attempt' } : {}),
        ...(fault.startsWith('readonly') ? { targetCleanupReadOnly: true } : {})
      } } })
    const sourceBefore = await prisma.instance.findUniqueOrThrow({ where: { id: delivered.id } })
    mode = fault
    if (fault === 'readonly-empty') { remote = []; volumes = []; forwards = [] }
    await scanCurrentHost()
    const state = readPoolCleanup((await prisma.host.findUniqueOrThrow({ where: { id: failedTarget.id } })).poolCleanup)!
    assert.equal(state.kind, fault.startsWith('readonly') ? 'verify_empty' : 'failed_target')
    if (['before-task', 'after-task', 'marker-changed', 'readonly-residue'].includes(fault)) {
      assert.equal(state.status, 'blocked'); assert.equal(mutations().length, 0)
    } else {
      if (fault && fault !== 'readonly-empty') {
        assert.equal(state.status, 'retry')
        mode = ''; await elapsedBackoff(failedTarget.id); await scanCurrentHost()
      }
      assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: failedTarget.id } })).poolFaulted, false)
      assert.equal(remote.length + volumes.length + forwards.length, 0)
      const completed = (await prisma.instanceTask.findUniqueOrThrow({ where: { id: failedTask.id } })).replacementState as any
      assert.equal(completed.stage, 'cleaned'); assert.equal(completed.targetCleanupVerified, true)
      if (fault === 'readonly-empty') assert.equal(mutations().length, 0)
    }
    assert.deepEqual(await prisma.instance.findUniqueOrThrow({ where: { id: delivered.id } }), sourceBefore)
    await prisma.instanceTask.delete({ where: { id: failedTask.id } })
    console.log(`PASS failed target ${fault || 'running'}: automatic cleanup bounded by creation evidence; source unchanged`)
  }

  await prisma.host.updateMany({ where: { userId: owner.id }, data: { poolFaulted: false } })
  const automaticEmpty = await fixture()
  await prisma.host.update({ where: { id: automaticEmpty.id }, data: { poolCleanup: (await import('@prisma/client')).Prisma.DbNull } })
  remote = []; volumes = []; forwards = []; calls = []; mode = ''
  await scanCurrentHost()
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: automaticEmpty.id } })).poolFaulted, false)
  assert.equal(mutations().length, 0)
  console.log('PASS quarantined empty host recovered automatically without browser action or remote mutation')

  for (const fault of ['empty', 'offline', 'unknown-volume', 'old-guest', 'identity-changed', 'superseded']) {
    await prisma.host.updateMany({ where: { userId: owner.id }, data: { poolFaulted: false } })
    const host = await fixture()
    await processPoolCleanup(host.id, connect)
    const completed = readPoolCleanup((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).poolCleanup)!
    assert.equal(completed.status, 'done')
    await prisma.host.update({ where: { id: host.id }, data: { poolFaulted: true,
      ...(fault === 'superseded' ? { poolCleanup: { ...completed, recoverySupersededBy: 'fixture-recovery' } as any } : {}) } })
    calls = []; mode = fault === 'offline' ? 'offline' : ''
    if (fault === 'unknown-volume') volumes = [{ name: 'customer-data', type: 'custom' }]
    if (fault === 'old-guest') remote = [{ name: host.name, status: 'Running', created_at: completed.createdAt,
      project: 'default', config: { 'volatile.uuid': completed.uuid } }]
    if (fault === 'identity-changed') await prisma.host.update({ where: { id: host.id }, data: { url: 'https://127.0.0.1:2' } })
    await scanCurrentHost()
    const refreshed = await prisma.host.findUniqueOrThrow({ where: { id: host.id } })
    const state = readPoolCleanup(refreshed.poolCleanup)!
    assert.equal(mutations().length, 0, 'completed deletion authority cannot be replayed')
    if (fault === 'superseded') {
      assert.equal(state.revision, completed.revision); assert.equal(refreshed.poolFaulted, true)
      continue
    }
    assert.notEqual(state.revision, completed.revision)
    assert.equal(state.hostIdentity, completed.hostIdentity)
    assert.equal(state.kind, 'verify_empty'); assert.equal(state.name, '')
    for (const field of ['taskId', 'uuid', 'createdAt', 'marker']) assert.equal((state as any)[field], undefined)
    assert.equal(refreshed.poolFaulted, fault !== 'empty')
    if (fault === 'offline') {
      assert.equal(state.status, 'retry')
      const count = calls.length
      await processPoolCleanup(host.id, connect)
      assert.equal(calls.length, count, 'restart retains read-only recovery backoff')
      mode = ''; await elapsedBackoff(host.id); await scanCurrentHost()
      assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).poolFaulted, false)
    }
    console.log(`PASS completed cleanup / later quarantine ${fault}: fresh inspection retains trust and never replays deletion`)
  }
  await prisma.host.updateMany({ where: { userId: owner.id }, data: { poolFaulted: false } })
  const concurrent = await fixture()
  await processPoolCleanup(concurrent.id, connect)
  const prior = readPoolCleanup((await prisma.host.findUniqueOrThrow({ where: { id: concurrent.id } })).poolCleanup)!
  await prisma.host.update({ where: { id: concurrent.id }, data: { poolFaulted: true } })
  calls = []
  await Promise.all([scanCurrentHost(), retryPoolCleanup(concurrent.id, owner.id)])
  await processPoolCleanup(concurrent.id, connect)
  const final = readPoolCleanup((await prisma.host.findUniqueOrThrow({ where: { id: concurrent.id } })).poolCleanup)!
  assert.equal(final.status, 'done'); assert.notEqual(final.revision, prior.revision)
  assert.equal(final.hostIdentity, prior.hostIdentity); assert.equal(mutations().length, 0)
  console.log('PASS concurrent scanner and retry preserve a fresh inspection and finish without deletion')

  const request = async (method: string, path: string) => {
    if (method === 'DELETE') throw new IncusApiError('operation not found', 404, '/1.0/operations/other')
    throw Error('must not proceed')
  }
  await assert.rejects(deleteInstance({ request } as any, 'old'), /operation not found/)
  console.log('PASS unrelated not-found errors cannot authorize inventory release')
} finally {
  await prisma.instance.deleteMany({ where: { userId: owner.id } })
  await prisma.host.deleteMany({ where: { userId: owner.id } })
  await prisma.log.deleteMany({ where: { userId: owner.id } })
  await prisma.user.delete({ where: { id: owner.id } })
  await closeAllClients()
  await closePrismaDatabase()
  await rm(root, { recursive: true, force: true })
}
process.exit(0)
