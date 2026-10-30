import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { persistResolvedInstanceNetworkAddresses } = await import('../src/lib/instance-network-sync.js')
const prefix = `persist-${randomUUID()}`
const owner = await prisma.user.create({ data: { username: prefix, passwordHash: 'unusable-fixture' } })
const other = await prisma.user.create({ data: { username: prefix + '-other', passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: owner.id, name: prefix, url: 'https://127.0.0.1:1' } })
const replacement = await prisma.host.create({ data: { userId: owner.id, name: prefix + '-replacement', url: 'https://127.0.0.1:2' } })
let constraint: string | undefined
let failure: unknown
try {
  for (const mode of ['host', 'incus', 'owner', 'version', 'address', 'host_connection', 'host_owner', 'pending', 'deleted', 'creating', 'transaction_failure', 'success', 'unchanged', 'concurrent']) {
    const instance = await prisma.instance.create({ data: { userId: owner.id, hostId: host.id, name: prefix, incusId: prefix + mode, image: 'fixture/debian',
      status: mode === 'creating' ? 'creating' : 'running', networkMode: 'nat_ipv6', cpu: 50, memory: 256, disk: 1024, ipv4: '10.10.1.10', ipv6: '2001:db8::10' } })
    const primary = await prisma.ipAddress.create({ data: { hostId: host.id, instanceId: instance.id, address: instance.ipv4!, type: 'inet4', isPrimary: true, device: 'eth0' } })
    const currentHost = await prisma.host.findUniqueOrThrow({ where: { id: host.id } })
    const observed = { ...instance, updatedAt: instance.updatedAt.toISOString(), hostOwnerId: currentHost.userId,
      hostConnectionIdentity: JSON.stringify([currentHost.url, currentHost.certPath, currentHost.keyPath, currentHost.serverCertificate, currentHost.serverFingerprint]) }
    const resolved = { ipv4: mode === 'unchanged' ? instance.ipv4 : '10.10.1.20', ipv6: mode === 'unchanged' ? instance.ipv6 : '2001:db8::20',
      ipv4Device: 'eth0', ipv6Device: 'eth1', configuredIpv6: null, observedIpv6: null }
    if (mode === 'host') await prisma.instance.update({ where: { id: instance.id }, data: { hostId: replacement.id } })
    if (mode === 'incus') await prisma.instance.update({ where: { id: instance.id }, data: { incusId: instance.incusId + '-new' } })
    if (mode === 'owner') await prisma.instance.update({ where: { id: instance.id }, data: { userId: other.id } })
    if (mode === 'version') await prisma.instance.update({ where: { id: instance.id }, data: { updatedAt: new Date(instance.updatedAt.getTime() + 1000) } })
    if (mode === 'address') await prisma.instance.update({ where: { id: instance.id }, data: { ipv4: '10.10.1.30' } })
    if (mode === 'host_connection') await prisma.host.update({ where: { id: host.id }, data: { url: 'https://127.0.0.1:3' } })
    if (mode === 'host_owner') await prisma.host.update({ where: { id: host.id }, data: { userId: other.id } })
    if (mode === 'pending') await prisma.instanceTask.create({ data: { instanceId: instance.id, userId: owner.id, hostId: host.id, taskType: 'rebuild' } })
    if (mode === 'deleted') await prisma.instance.update({ where: { id: instance.id }, data: { status: 'deleted' } })
    if (mode === 'transaction_failure') {
      constraint = `review_persist_${randomUUID().replaceAll('-', '')}`
      await prisma.$executeRawUnsafe(`ALTER TABLE ip_addresses ADD CONSTRAINT ${constraint} CHECK (instance_id <> ${instance.id} OR address <> '10.10.1.20') NOT VALID`)
    }
    const apply = () => persistResolvedInstanceNetworkAddresses(observed, resolved, { updateLastSyncedAt: true })
    const accepted = ['success', 'unchanged', 'concurrent'].includes(mode)
    if (accepted) {
      if (mode === 'concurrent') {
        const results = await Promise.allSettled([apply(), apply()])
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, 'only one concurrent observation consumes the generation')
      } else {
        const result = await apply()
        assert.equal(result.ipv4Changed, mode === 'success')
      }
      await assert.rejects(apply, 'even an unchanged observation consumes its generation')
    } else await assert.rejects(apply, `${mode}: stale/busy/failed observations must reject`)
    const current = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
    const changed = mode === 'success' || mode === 'concurrent'
    assert.equal(current.ipv4, changed ? '10.10.1.20' : mode === 'address' ? '10.10.1.30' : instance.ipv4)
    assert.equal(current.ipv6, changed ? '2001:db8::20' : instance.ipv6)
    assert.equal(current.lastSyncedAt !== null, accepted)
    if (mode === 'deleted') assert.equal(await prisma.ipAddress.count({ where: { instanceId: instance.id } }), 0)
    else assert.equal((await prisma.ipAddress.findUniqueOrThrow({ where: { id: primary.id } })).address, changed ? '10.10.1.20' : instance.ipv4)
    if (constraint) { await prisma.$executeRawUnsafe(`ALTER TABLE ip_addresses DROP CONSTRAINT ${constraint}`); constraint = undefined }
    await prisma.instance.delete({ where: { id: instance.id } })
    await prisma.host.update({ where: { id: host.id }, data: { url: host.url, userId: owner.id } })
    console.log(`PASS network persistence ${mode}`)
  }
  if (process.env.REVIEW_NETWORK_PERSISTENCE_INJECT_FAILURE === '1') {
    assert.fail('fixture intentional assertion failure after persistence checks')
  }
} catch (error) { failure = error } finally {
  if (constraint) await prisma.$executeRawUnsafe(`ALTER TABLE ip_addresses DROP CONSTRAINT ${constraint}`)
  await prisma.instance.deleteMany({ where: { name: prefix } })
  await prisma.host.deleteMany({ where: { id: { in: [host.id, replacement.id] } } })
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } }); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
console.log('PASS network persistence checks and database cleanup completed')
process.exit(0)
