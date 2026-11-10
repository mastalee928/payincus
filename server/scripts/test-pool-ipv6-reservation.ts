import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Client } from 'pg'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
const interval = globalThis.setInterval
globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => { const timer = interval(...args); timer.unref(); return timer }) as typeof setInterval
try { await import('../src/lib/security.js') } finally { globalThis.setInterval = interval }
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { startProvisioning } = await import('../src/services/pool-orders.js')
const { getHostById } = await import('../src/db/hosts.js')
const holder = new Client({ connectionString: database.href }), monitor = new Client({ connectionString: database.href })
const tag = 'pool-ipv6-' + randomUUID(), hostIds: number[] = [], instanceIds: number[] = []
const random = Math.random
let userId = 0, pending: Promise<unknown> | undefined
try {
  await holder.connect(); await monitor.connect()
  userId = (await prisma.user.create({ data: { username: tag, passwordHash: 'fixture', balance: 100 } })).id
  for (const architecture of ['x86_64', 'aarch64']) {
    const hosts = await Promise.all([0, 1].map(index => prisma.host.create({ data: {
      name: tag + architecture + index, userId, url: 'https://127.0.0.1:1', singleTenant: true, architecture,
      cpuAllowanceMax: 200, memoryMax: 768, storageSize: 38, customerDiskGiB: 30,
      ipv6Subnet: '2001:db8:44::/126', ipv6Gateway: '2001:db8:44::1', ipv6ParentInterface: 'eth0'
    } })))
    hostIds.push(...hosts.map(host => host.id))
    const instances = await Promise.all(hosts.map(host => prisma.instance.create({ data: {
      name: tag + host.id, incusId: tag + host.id, hostId: host.id, userId, status: 'creating',
      dedicatedIpv4: true, ipv4: '10.10.0.2', cpu: 100, memory: 512, disk: 1024, image: 'debian/12', networkMode: 'nat'
    } })))
    instanceIds.push(...instances.map(instance => instance.id))
    const host = (await getHostById(hosts[0].id))!
    const entry = { instanceId: instances[0].id, host,
      item: { networkMode: 'nat', pkg: { id: null } }, planned: { incusId: instances[0].incusId }
    } as unknown as Parameters<typeof startProvisioning>[2]
    for (const scenario of ['collision-exhausted', 'collision-retry']) {
      let generated = 0
      Math.random = () => ++generated > 1 && scenario === 'collision-retry' ? 0.75 : 0
      await holder.query('BEGIN')
      await holder.query('SELECT pg_advisory_xact_lock(4119, hashtext($1))', ['2001:db8:44::2'])
      const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
      let settled = false
      // No system disk pool is registered, so even an available alternate
      // address rolls back preparation before any Incus/customer operation.
      const operation = startProvisioning(userId, '', entry).then(() => new Error('unexpected preparation success'), error => error)
      pending = operation.finally(() => { settled = true })
      const deadline = Date.now() + 3000
      while (!(await monitor.query('SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [pid])).rows.length) {
        assert.ok(!settled && Date.now() < deadline, 'actual pool preparation must wait on the shared IPv6 reservation lock')
        await delay(10)
      }
      await holder.query('INSERT INTO ip_addresses(address,type,is_primary,device,host_id,instance_id) VALUES ($1,$2,true,$3,$4,$5)',
        ['2001:db8:44::2', 'inet6', 'eth1', hosts[1].id, instances[1].id])
      await holder.query('COMMIT')
      const result = await pending; pending = undefined
      assert.ok(result instanceof Error)
      assert.equal(result.message, scenario === 'collision-exhausted' ? 'IPv6 address allocation failed' : 'System storage pool is unavailable')
      assert.equal(generated, scenario === 'collision-exhausted' ? 20 : 2)
      assert.equal(await prisma.ipAddress.count({ where: { instanceId: instances[0].id } }), 0, 'failed preparation leaves no new reservation')
      assert.equal(await prisma.ipAddress.count({ where: { instanceId: instances[1].id, address: '2001:db8:44::2' } }), 1, 'competing allocation stays intact')
      assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instances[0].id } })).networkMode, 'nat')
      await prisma.ipAddress.deleteMany({ where: { instanceId: instances[1].id } })
      console.log('PASS actual pool IPv6 preparation', architecture, scenario, 'shared lock, current conflict, bounded retry and rollback')
    }
    await prisma.ipAddress.create({ data: { address: '2001:db8:44::3', type: 'inet6', isPrimary: true, device: 'eth1', hostId: hosts[0].id, instanceId: instances[0].id } })
    Math.random = () => { throw new Error('existing IPv6 must be reused') }
    await assert.rejects(startProvisioning(userId, '', entry), /System storage pool is unavailable/)
    assert.equal(await prisma.ipAddress.count({ where: { instanceId: instances[0].id, address: '2001:db8:44::3' } }), 1)
    console.log('PASS actual pool IPv6 preparation', architecture, 'retained original reservation')
    await prisma.ipAddress.deleteMany({ where: { instanceId: instances[0].id } })
  }
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).balance.toString(), '100')
  assert.equal(await prisma.balanceLog.count({ where: { userId } }), 0)
} finally {
  Math.random = random
  await holder.query('ROLLBACK').catch(() => undefined); await pending
  await prisma.instance.deleteMany({ where: { id: { in: instanceIds } } })
  await prisma.host.deleteMany({ where: { id: { in: hostIds } } })
  if (userId) await prisma.user.delete({ where: { id: userId } })
  await holder.end(); await monitor.end(); await closePrismaDatabase()
}
