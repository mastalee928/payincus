import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
const directory = await mkdtemp(join(tmpdir(), 'source-recovery-'))
process.env.PLATFORM_BACKUP_STATE_DIR = directory
process.env.NODE_ENV = 'test'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { recoverFailedReplacement, recoverFailedReplacementSources } = await import('../src/services/host-replacement-recovery.js')
const { inspectHostRecovery } = await import('../src/services/host-pool-recovery.js')
const { PORT_PROTOCOL_CAPABILITY } = await import('../src/services/host-port-protocol.js')
const { transferHostIdentity } = await import('../src/lib/transfer-host-identity.js')
const { customerIpv6View } = await import('../src/lib/host-public-ipv6.js')
const tag = 'source-recovery-' + randomUUID().slice(0, 8)
const admin = await prisma.user.create({ data: { username: tag, role: 'admin', passwordHash: 'fixture' } })
const buyer = await prisma.user.create({ data: { username: tag + '-buyer', passwordHash: 'fixture', balance: 123 } })
const hostIds: number[] = []
let calls: string[] = [], fault = ''
const records = new Map<number, { guest: any; forwards: any[]; addresses: string[] }>()
const connect: any = async (host: { id: number }) => ({ request: async (method: string, path: string) => {
  calls.push(method + ' ' + path); assert.equal(method, 'GET', 'source recovery cannot mutate the customer or its network')
  if (fault === 'offline') throw Error('fixture disconnected')
  const record = records.get(host.id)!, guest = structuredClone(record.guest)
  if (fault === 'wrong-created') guest.created_at = new Date().toISOString()
  if (fault === 'wrong-uuid') guest.config['volatile.uuid'] = 'unknown'
  if (fault === 'stopped') guest.status = 'Stopped'
  if (path.startsWith('/1.0/instances?')) return [guest]
  if (path === '/1.0/projects?recursion=1') return [{ name: 'default' }]
  if (path === '/1.0/networks?recursion=1') return [{ name: 'incusbr0', managed: true, type: 'bridge' }]
  if (path === '/1.0/operations?recursion=1') return { running: [] }
  if (path === '/1.0/storage-pools?recursion=1') return [{ name: 'default', status: 'Created' }]
  if (path.includes('/volumes?')) return [{ name: guest.name, type: 'container' }]
  if (path.includes('/forwards?')) return fault === 'missing-forward' ? record.forwards.slice(1) : record.forwards
  if (path.endsWith('/state')) return { network: { eth0: { addresses: (fault === 'missing-address' ? [] : record.addresses).map(address => ({ address })) } } }
  if (path === '/1.0/instances/' + guest.name) {
    if (fault === 'uuid-changed') guest.config['volatile.uuid'] = randomUUID()
    return guest
  }
  throw Error('Unexpected fixture path ' + path)
} })
async function fixture(legacy = false) {
  fault = ''; calls = []
  const name = tag + '-' + randomUUID().slice(0, 6)
  const host = await prisma.host.create({ data: { userId: admin.id, name, url: 'https://127.0.0.1:1', certPath: 'fixture.crt', keyPath: 'fixture.key',
    serverCertificate: 'pinned-certificate-fixture', serverFingerprint: 'pinned-fingerprint-fixture',
    status: 'online', singleTenant: true, isInstalled: true, instanceType: 'container', resourcePreset: 'E2', customerDiskGiB: 30,
    architecture: 'x86_64', cpuAllowanceMax: 200, memoryMax: 768, storageSize: 34, natPublicIp: '192.0.2.3', natBindIp: '10.0.0.3', natPortStart: 1, natPortEnd: 65535,
    portProtocol: 'tcp', portProtocolApplied: 'tcp', portProtocolRevision: 1, portProtocolAppliedRevision: 1,
    agent: { create: { agentId: name, enabled: true, secretHash: 'fixture', secretEncrypted: 'fixture', lastSeenAt: new Date(), capabilities: [PORT_PROTOCOL_CAPABILITY] } },
    storagePools: { create: { name: 'default', driver: 'dir', purpose: 'instance_data' } }
  } }); hostIds.push(host.id)
  const ipv6 = { version: 1, hostId: host.id, instanceName: name, primary: '2603:c020:802a:cc00::3', status: 'pending', error: 'IPV6_HOST_QUARANTINED',
    configured: true, checkedAt: new Date().toISOString(), mappings: [{ publicIp: '2603:c020:802a:cc00::3', privateIp: 'fd00::3', fallbackIp: 'fd00::4', ready: true }] }
  const instance = await prisma.instance.create({ data: { hostId: host.id, userId: buyer.id, name, incusId: name, image: 'fixture', status: 'running',
    cpu: 200, memory: 768, disk: 30720, storagePoolName: 'default', dedicatedIpv4: true, dedicatedNetworkReady: false, ipv4: '10.10.1.240', dedicatedIpv6: ipv6,
    billingPrice: 3, expiresAt: new Date('2030-01-01'), rootPassword: 'preserve-fixture' } })
  const createdAt = new Date(Date.now() - 60000), finishedAt = new Date(Date.now() - 30000)
  await prisma.instanceTask.create({ data: { instanceId: instance.id, hostId: host.id, targetHostId: host.id, userId: admin.id,
    taskType: 'replace_host', status: 'COMPLETED', createdAt, finishedAt, replacementState: { stage: 'delivered', targetIncusId: name } } })
  const task = await prisma.instanceTask.create({ data: { instanceId: instance.id, hostId: host.id, userId: admin.id,
    taskType: 'replace_host', status: 'FAILED', finishedAt: new Date(), replacementState: { stage: 'cleaned', sourceHostId: host.id,
      sourceIncusId: name, ...(legacy ? {} : { sourceHostIdentity: transferHostIdentity(host) }) } } })
  await prisma.host.update({ where: { id: host.id }, data: { poolFaulted: true } })
  records.set(host.id, { guest: { name, status: 'Running', project: 'default', created_at: new Date(Date.now() - 45000).toISOString(), config: { 'volatile.uuid': randomUUID() } },
    addresses: ['10.10.1.240', 'fd00::3', 'fd00::4'], forwards: [
      { listen_address: '10.0.0.3', description: 'payincus-dedicated:' + name, config: { target_address: '10.10.1.240' } },
      { listen_address: '2603:c020:802a:cc00::3', description: 'payincus-dedicated:' + name, config: { target_address: 'fd00::4' },
        ports: ['tcp', 'udp'].map(protocol => ({ protocol, listen_port: '1-65535', target_address: 'fd00::3', snat: true })) }
    ] })
  return { host, instance, task }
}
try {
  const first = await fixture(true)
  const counters = await prisma.host.findUniqueOrThrow({ where: { id: first.host.id } })
  const ordinary = await inspectHostRecovery(first.host.id, connect)
  assert.equal(ordinary.canRecover, false); assert.ok(ordinary.blockers.includes('assigned-not-ready'), 'normal recovery retains readiness requirement')
  await recoverFailedReplacementSources(connect)
  const state = (await prisma.instanceTask.findUniqueOrThrow({ where: { id: first.task.id } })).replacementState as any
  assert.equal(state.sourceRecovery?.status, 'done', JSON.stringify(state.sourceRecovery))
  assert.equal(state.sourceHostIdentity, transferHostIdentity(first.host), 'legacy v1.7.9 task adopts only established host trust after real delivery checks')
  const recovered = await prisma.instance.findUniqueOrThrow({ where: { id: first.instance.id } })
  assert.deepEqual(recovered, { ...first.instance, dedicatedNetworkReady: true, updatedAt: recovered.updatedAt })
  const ready = await prisma.host.findUniqueOrThrow({ where: { id: first.host.id } })
  assert.equal(ready.poolFaulted, false)
  assert.deepEqual([ready.cpuUsed, ready.memoryUsed, ready.diskUsed], [counters.cpuUsed, counters.memoryUsed, counters.diskUsed])
  assert.equal((await inspectHostRecovery(first.host.id, connect)).mode, 'preserve')
  assert.equal(state.sourceRecovery.status, 'done')
  assert.deepEqual(customerIpv6View(recovered.dedicatedIpv6, { hostId: recovered.hostId, instanceName: recovered.incusId, networkReady: recovered.dedicatedNetworkReady })?.addresses, ['2603:c020:802a:cc00::3'])
  assert.equal(await prisma.balanceLog.count({ where: { userId: buyer.id } }), 0)
  console.log('PASS historical delivered-then-failed move recovered by queue; exact customer row, billing, disk and inventory preserved; only Incus GETs')

  const untrustedLegacy = await fixture(true)
  await prisma.host.update({ where: { id: untrustedLegacy.host.id }, data: { serverFingerprint: null } })
  await recoverFailedReplacement(untrustedLegacy.task.id, connect)
  assert.equal(calls.length, 0, 'legacy adoption without original pinned trust never contacts a replacement host')
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: untrustedLegacy.instance.id } })).dedicatedNetworkReady, false)

  const failedTarget = await fixture()
  const originalState = failedTarget.task.replacementState as Record<string, unknown>
  await prisma.instanceTask.update({ where: { id: failedTarget.task.id }, data: { replacementState: {
    ...originalState, targetIncusId: 'failed-target', targetCleanupVerified: false
  } } })
  await recoverFailedReplacement(failedTarget.task.id, connect)
  assert.equal(calls.length, 0, 'source recovery waits until target cleanup is verified')
  await prisma.instanceTask.update({ where: { id: failedTarget.task.id }, data: { replacementState: {
    ...originalState, targetIncusId: 'failed-target', targetCleanupVerified: true
  } } })
  await recoverFailedReplacement(failedTarget.task.id, connect)
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: failedTarget.instance.id } })).dedicatedNetworkReady, true)
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: failedTarget.host.id } })).poolFaulted, false)
  console.log('PASS source recovery continues only after failed target cleanup receipt, with no customer mutation')

  for (const mode of ['offline', 'wrong-created', 'wrong-uuid', 'stopped', 'missing-forward', 'missing-address', 'uuid-changed', 'later-task', 'host-changed', 'revoked-admin', 'hold']) {
    const value = await fixture(); fault = mode
    if (mode === 'later-task') await prisma.instanceTask.create({ data: { instanceId: value.instance.id, hostId: value.host.id, userId: admin.id, taskType: 'stop', status: 'COMPLETED' } })
    if (mode === 'host-changed') await prisma.host.update({ where: { id: value.host.id }, data: { url: 'https://127.0.0.1:2' } })
    if (mode === 'revoked-admin') await prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
    if (mode === 'hold') await writeFile(join(directory, 'recovery-hold.json'), '{}')
    await recoverFailedReplacement(value.task.id, connect)
    assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: value.instance.id } })).dedicatedNetworkReady, false, mode)
    assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: value.host.id } })).poolFaulted, true, mode)
    if (mode === 'offline') {
      const count = calls.length
      await recoverFailedReplacement(value.task.id, connect); assert.equal(calls.length, count, 'retry backoff prevents repeated remote work')
      const latest = (await prisma.instanceTask.findUniqueOrThrow({ where: { id: value.task.id } })).replacementState as any
      await prisma.instanceTask.update({ where: { id: value.task.id }, data: { replacementState: { ...latest, sourceRecovery: { ...latest.sourceRecovery, nextAttemptAt: new Date(0).toISOString() } } } })
      fault = ''; await recoverFailedReplacement(value.task.id, connect)
      assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: value.host.id } })).poolFaulted, false)
    }
    if (['host-changed', 'revoked-admin', 'later-task'].includes(mode)) {
      const saved = (await prisma.instanceTask.findUniqueOrThrow({ where: { id: value.task.id } })).replacementState as any
      assert.ok(saved.sourceRecovery.error.startsWith('SOURCE_'), 'protected recovery records its exact reason')
      assert.ok(saved.sourceRecovery.nextAttemptAt, 'protected recovery remains automatically scheduled')
    }
    if (mode === 'hold') await rm(join(directory, 'recovery-hold.json'))
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
  }
  console.log('PASS source identity/network/authority/task/restore protections; disconnect resumes after persistent backoff')
} finally {
  await prisma.instance.deleteMany({ where: { userId: buyer.id } })
  await prisma.host.deleteMany({ where: { id: { in: hostIds } } })
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, buyer.id] } } })
  await closePrismaDatabase(); await rm(directory, { recursive: true, force: true })
}
process.exit(0)
