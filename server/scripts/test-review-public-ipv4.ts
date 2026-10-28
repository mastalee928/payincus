import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use isolated local *_pool_test PostgreSQL')
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { reservePublicIpv4ForInstance, releasePublicIpv4ForInstance } = await import('../src/db/public-ipv4.js')
const prefix = `ipv4-${randomUUID()}`
const user = await prisma.user.create({ data: { username: prefix, passwordHash: 'unusable-fixture' } })
const host = await prisma.host.create({ data: { userId: user.id, name: prefix, url: 'https://127.0.0.1:1' } })
try {
  const instances = await Promise.all([1, 2].map(id => prisma.instance.create({ data: { userId: user.id, hostId: host.id, incusId: `${prefix}-${id}`, name: prefix, image: 'fixture/debian', cpu: 50, memory: 256, disk: 1024 } })))
  const pool = await prisma.publicIpv4Pool.create({ data: { hostId: host.id, name: prefix, gateway: '192.0.2.1', prefixLength: 24, dns: ['192.0.2.53'] } })
  const reserve = (instanceId: number) => prisma.$transaction(tx => reservePublicIpv4ForInstance(tx, { hostId: host.id, instanceId }))
  const standalone = await prisma.publicIpv4Address.create({ data: { hostId: host.id, address: '192.0.2.10', gateway: '192.0.2.1', prefixLength: 24 } })
  assert.equal((await reserve(instances[0]!.id))?.address, standalone.address, 'standalone address with no joined pool must be lockable')
  assert.equal(await reserve(instances[1]!.id), null)
  await prisma.$transaction(tx => releasePublicIpv4ForInstance(tx, instances[0]!.id))
  await prisma.publicIpv4Address.delete({ where: { id: standalone.id } })
  const joined = await prisma.publicIpv4Address.create({ data: { hostId: host.id, poolId: pool.id, address: '192.0.2.11', prefixLength: 24 } })
  const assignment = await reserve(instances[0]!.id)
  assert.equal(assignment?.gateway, pool.gateway)
  assert.deepEqual(assignment?.dns, ['192.0.2.53'])
  await prisma.$transaction(tx => releasePublicIpv4ForInstance(tx, instances[0]!.id))
  await prisma.publicIpv4Pool.update({ where: { id: pool.id }, data: { enabled: false } })
  assert.equal(await reserve(instances[0]!.id), null, 'disabled pools are excluded')
  await prisma.publicIpv4Pool.update({ where: { id: pool.id }, data: { enabled: true } })
  let acquired!: () => void, release!: () => void
  const ready = new Promise<void>(resolve => { acquired = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const first = prisma.$transaction(async tx => {
    const value = await reservePublicIpv4ForInstance(tx, { hostId: host.id, instanceId: instances[0]!.id })
    acquired(); await gate; return value
  }, { timeout: 10000 })
  try {
    await ready
    assert.equal(await reserve(instances[1]!.id), null, 'concurrent reservation skips the locked last address')
  } finally { release(); await first }
  assert.equal((await prisma.publicIpv4Address.findUniqueOrThrow({ where: { id: joined.id } })).instanceId, instances[0]!.id)
  await prisma.$transaction(tx => releasePublicIpv4ForInstance(tx, instances[0]!.id))
  await assert.rejects(prisma.$transaction(async tx => { await reservePublicIpv4ForInstance(tx, { hostId: host.id, instanceId: instances[1]!.id }); throw Error('fixture rollback') }), /fixture rollback/)
  assert.equal((await prisma.publicIpv4Address.findUniqueOrThrow({ where: { id: joined.id } })).status, 'free')
  await prisma.publicIpv4Address.delete({ where: { id: joined.id } })
  const invalid = await prisma.publicIpv4Address.create({ data: { hostId: host.id, address: '192.0.2.12', prefixLength: 24 } })
  assert.equal(await reserve(instances[0]!.id), null)
  assert.equal((await prisma.publicIpv4Address.findUniqueOrThrow({ where: { id: invalid.id } })).status, 'disabled', 'missing gateway remains excluded')
  console.log('PASS public IPv4: standalone/joined pool, DNS fallback, disabled/missing gateway, concurrent last address, transaction rollback and release')
} finally {
  await prisma.publicIpv4Address.deleteMany({ where: { hostId: host.id } })
  await prisma.instance.deleteMany({ where: { hostId: host.id } })
  await prisma.host.delete({ where: { id: host.id } }); await prisma.user.delete({ where: { id: user.id } }); await closePrismaDatabase()
}
