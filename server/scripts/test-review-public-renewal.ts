import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Client } from 'pg'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { hashPublicApiToken, getPublicApiTokenPrefix } = await import('../src/lib/public-api-auth.js')
const { default: routes } = await import('../src/routes/public-api.js')
const app = Fastify(), holder = new Client({ connectionString: database.href }), monitor = new Client({ connectionString: database.href })
const tag = 'public-renew-' + randomUUID(), userIds: number[] = []
let hostId: number | undefined, packageId: number | undefined, appId: number | undefined, failure: unknown
let pending: Promise<unknown> | undefined
try {
  await holder.connect(); await monitor.connect(); await app.register(routes, { prefix: '/v1' })
  const buyer = await prisma.user.create({ data: { username: tag, passwordHash: 'fixture', balance: 100 } }); userIds.push(buyer.id)
  const owner = await prisma.user.create({ data: { username: tag + '-owner', passwordHash: 'fixture', role: 'admin' } }); userIds.push(owner.id)
  const host = await prisma.host.create({ data: { userId: owner.id, name: tag, url: 'https://127.0.0.1:1' } }); hostId = host.id
  const pkg = await prisma.package.create({ data: { userId: owner.id, name: tag, cpuMax: 100, memoryMax: 1024, diskMax: 2048 } }); packageId = pkg.id
  const plan = await prisma.packagePlan.create({ data: { packageId: pkg.id, name: tag, cpu: 100, memory: 1024, disk: 2048,
    portLimit: 1, snapshotLimit: 0, backupLimit: 0, siteLimit: 0, trafficLimit: 0, price: 1000, billingCycle: 1 } })
  const oauthApp = await prisma.oAuthClientApp.create({ data: { name: tag, clientId: tag, clientSecretHash: 'fixture', scopes: ['services:billing'], createdByUserId: owner.id } }); appId = oauthApp.id
  const grant = await prisma.oAuthGrant.create({ data: { appId: oauthApp.id, userId: buyer.id, scopes: ['services:billing'] } })
  for (const source of ['api_token', 'oauth_access_token'] as const) {
    for (const mode of ['revoked', 'expired', 'scope', ...(source === 'oauth_access_token' ? ['app-disabled', 'grant-revoked'] : []), 'allowed']) {
      await prisma.oAuthClientApp.update({ where: { id: oauthApp.id }, data: { enabled: true } })
      await prisma.oAuthGrant.update({ where: { id: grant.id }, data: { revokedAt: null } })
      const raw = `${source === 'api_token' ? 'pat_' : 'poa_'}${randomBytes(32).toString('base64url')}`
      const data = { userId: buyer.id, tokenHash: hashPublicApiToken(raw), tokenPrefix: getPublicApiTokenPrefix(raw), scopes: ['services:billing'], expiresAt: new Date(Date.now() + 60000) }
      const token = source === 'api_token' ? await prisma.publicApiToken.create({ data: { ...data, name: tag } })
        : await prisma.oAuthAccessToken.create({ data: { ...data, appId: oauthApp.id, grantId: grant.id } })
      const instance = await prisma.instance.create({ data: { userId: buyer.id, hostId: host.id, packageId: pkg.id, packagePlanId: plan.id,
        name: tag + mode, incusId: randomUUID(), image: 'fixture', cpu: 100, memory: 1024, disk: 2048,
        billingPrice: 10, billingCycle: 1, expiresAt: new Date(Date.now() + 86400000), status: 'stopped' } })
      const before = Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance)
      await holder.query('BEGIN'); await holder.query('SELECT id FROM instances WHERE id=$1 FOR UPDATE', [instance.id])
      const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
      const operation = app.inject({ method: 'POST', url: `/v1/services/${instance.id}/renew`, headers: { authorization: `Bearer ${raw}`, 'idempotency-key': randomUUID() }, payload: { months: 1 } }).then(value => value)
      pending = operation
      try {
        const deadline = Date.now() + 3000
        while (!(await monitor.query('SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))', [pid])).rows.length) {
          assert.ok(Date.now() < deadline, 'renewal must reach the real instance lock before credential change'); await delay(10)
        }
        if (mode === 'app-disabled') await prisma.oAuthClientApp.update({ where: { id: oauthApp.id }, data: { enabled: false } })
        else if (mode === 'grant-revoked') await prisma.oAuthGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } })
        else if (mode !== 'allowed') {
          const change = mode === 'revoked' ? { revokedAt: new Date() } : mode === 'expired' ? { expiresAt: new Date(0) } : { scopes: [] }
          if (source === 'api_token') await prisma.publicApiToken.update({ where: { id: token.id }, data: change })
          else await prisma.oAuthAccessToken.update({ where: { id: token.id }, data: change })
        }
      } finally { await holder.query('COMMIT') }
      const response = await operation; pending = undefined
      const after = Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance)
      console.log('Public renewal credential race:', source, mode, 'status:', response.statusCode, 'debit:', before - after)
      assert.equal(response.statusCode, mode === 'allowed' ? 200 : 403)
      assert.equal(after, before - (mode === 'allowed' ? 10 : 0))
      assert.equal(await prisma.balanceLog.count({ where: { instanceId: instance.id } }), mode === 'allowed' ? 1 : 0)
      assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: instance.id } }), mode === 'allowed' ? 1 : 0)
      if (mode !== 'allowed') assert.deepEqual(await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } }), instance)
    }
  }
} catch (error) { failure = error }
finally {
  await holder.query('ROLLBACK').catch(() => undefined); await pending
  await app.close()
  await prisma.log.deleteMany({ where: { userId: { in: userIds } } })
  if (hostId) await prisma.instance.deleteMany({ where: { hostId } })
  if (packageId) await prisma.package.delete({ where: { id: packageId } })
  if (hostId) await prisma.host.delete({ where: { id: hostId } })
  if (appId) await prisma.oAuthClientApp.delete({ where: { id: appId } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await holder.end(); await monitor.end(); await closePrismaDatabase()
}
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
