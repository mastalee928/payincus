import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import Fastify from 'fastify'
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
process.env.NODE_ENV = 'test'
const schedule = globalThis.setInterval
globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => { const timer = schedule(...args); timer.unref(); return timer }) as typeof setInterval
try { await import('../src/lib/security.js') } finally { globalThis.setInterval = schedule }
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: routes } = await import('../src/routes/instance-billing.js')
const { default: mailRoutes } = await import('../src/routes/mail.js')
const { default: publicRoutes } = await import('../src/routes/public-api.js')
const { hashPublicApiToken, getPublicApiTokenPrefix } = await import('../src/lib/public-api-auth.js')
const app = Fastify(), tag = 'renew-request-' + randomUUID(), oldFetch = globalThis.fetch
globalThis.fetch = async () => { throw Error('Unexpected external request') }
let actor = { id: 0, username: tag, role: 'user', sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }
app.decorate('authenticate', async (req: any) => { req.user = { ...actor } })
app.decorate('authenticateUser', async (req: any) => { req.user = { ...actor } })
app.decorate('requireAdmin', async (_req: any, reply: any) => reply.code(403).send())
await app.register(routes, { prefix: '/instances' }); await app.register(mailRoutes, { prefix: '/mail' }); await app.register(publicRoutes, { prefix: '/v1' })
if (process.argv[2] === '--partial') {
  actor = JSON.parse(process.env.REVIEW_ACTOR!)
  const { performRenewal } = await import('../src/db/billing-operations.js')
  const { renewalRequest } = await import('../src/db/renewal-requests.js')
  const ids = JSON.parse(process.argv[3]) as number[]
  const instance = await prisma.instance.findUniqueOrThrow({ where: { id: ids[0] } })
  await performRenewal(actor.id, instance, 1, undefined, actor, undefined, renewalRequest(process.argv[4], 'instance-batch', ids, 1))
  // Exit after one committed item, before the batch has produced an HTTP response.
  await app.close(); await closePrismaDatabase()
} else if (process.argv[2] === '--replay') {
  actor = JSON.parse(process.env.REVIEW_ACTOR!)
  const result = await app.inject({ method: 'POST', url: `/instances/${process.argv[3]}/renew`, headers: { 'idempotency-key': process.argv[4] }, payload: { months: 1 } })
  assert.equal(result.statusCode, 200, result.body); console.log(result.body)
  await app.close(); await closePrismaDatabase()
} else {
  let hostId = 0, packageId = 0, sourceId = 0, failure: unknown
  const userIds: number[] = []
  try {
    const buyer = await prisma.user.create({ data: { username: tag, passwordHash: 'fixture', balance: 200 } }); userIds.push(buyer.id)
    const other = await prisma.user.create({ data: { username: tag + '-other', passwordHash: 'fixture', balance: 200 } }); userIds.push(other.id)
    const owner = await prisma.user.create({ data: { username: tag + '-owner', passwordHash: 'fixture', role: 'admin' } }); userIds.push(owner.id)
    actor.id = buyer.id
    const host = await prisma.host.create({ data: { userId: owner.id, name: tag, url: 'https://127.0.0.1:1' } }); hostId = host.id
    const pkg = await prisma.package.create({ data: { userId: owner.id, name: tag, cpuMax: 100, memoryMax: 1024, diskMax: 2048 } }); packageId = pkg.id
    const plan = await prisma.packagePlan.create({ data: { packageId, name: tag, cpu: 100, memory: 1024, disk: 2048, price: 1000, billingCycle: 1,
      portLimit: 1, snapshotLimit: 0, backupLimit: 0, siteLimit: 0, trafficLimit: 0 } })
    const make = (userId = buyer.id) => prisma.instance.create({ data: { userId, hostId, packageId, packagePlanId: plan.id,
      name: tag, incusId: randomUUID(), image: 'fixture', cpu: 100, memory: 1024, disk: 2048, billingPrice: 10, billingCycle: 1,
      status: 'stopped', expiresAt: new Date(Date.now() + 86400000) } })
    const one = await make(), two = await make(), foreign = await make(other.id)
    const renew = (id: number, key: string | undefined, months = 1) => app.inject({ method: 'POST', url: `/instances/${id}/renew`, headers: key ? { 'idempotency-key': key } : {}, payload: { months } })
    const balance = async () => Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance)
    assert.equal((await renew(one.id, undefined)).statusCode, 400)
    assert.equal((await renew(one.id, 'short')).statusCode, 400)
    const key = randomUUID(), first = await renew(one.id, key)
    assert.equal(first.statusCode, 200, first.body)
    const receipt = first.json(), beforeReplay = await balance()
    assert.deepEqual((await renew(one.id, key)).json(), receipt)
    const child = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/test-review-renewal-idempotency.ts', '--replay', String(one.id), key],
      { env: { ...process.env, REVIEW_ACTOR: JSON.stringify(actor) }, encoding: 'utf8', timeout: 15000 })
    assert.deepEqual(JSON.parse(child.trim().split('\n').at(-1)!), receipt, 'fresh process returns durable result')
    assert.equal(await balance(), beforeReplay)
    assert.equal((await renew(one.id, key, 2)).statusCode, 409)
    assert.equal((await renew(two.id, key)).statusCode, 409)
    actor.id = other.id
    assert.equal((await renew(one.id, key)).statusCode, 403)
    assert.equal((await renew(foreign.id, key)).statusCode, 200, 'same key is isolated per account')
    actor.id = buyer.id
    await prisma.tokenInvalidation.create({ data: { userId: buyer.id, sessionId: actor.sid, invalidatedAt: actor.iat } })
    assert.equal((await renew(one.id, key)).statusCode, 403, 'replay still requires current session')
    await prisma.tokenInvalidation.deleteMany({ where: { userId: buyer.id } })
    const concurrentKey = randomUUID(), beforeConcurrent = await balance()
    const concurrent = await Promise.all(Array.from({ length: 6 }, () => renew(two.id, concurrentKey)))
    assert.ok(concurrent.every(result => result.statusCode === 200))
    assert.ok(concurrent.every(result => result.body === concurrent[0].body))
    assert.equal(await balance(), beforeConcurrent - 10)
    assert.equal((await renew(one.id, randomUUID())).statusCode, 200, 'new intent renews again')
    const batchKey = randomUUID(), batchBody = { instanceIds: [one.id, foreign.id], months: 1 }
    const batch = () => app.inject({ method: 'POST', url: '/instances/batch/renew', headers: { 'idempotency-key': batchKey }, payload: batchBody })
    const beforeBatch = await balance(), batchFirst = await batch()
    assert.equal(batchFirst.statusCode, 200, batchFirst.body); assert.equal(batchFirst.json().successCount, 1)
    assert.equal(await balance(), beforeBatch - 10)
    const partialKey = randomUUID(), partialIds = [one.id, two.id], beforePartial = await balance()
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/test-review-renewal-idempotency.ts', '--partial', JSON.stringify(partialIds), partialKey],
      { env: { ...process.env, REVIEW_ACTOR: JSON.stringify(actor) }, timeout: 15000 })
    assert.equal(await balance(), beforePartial - 10)
    const resumed = await app.inject({ method: 'POST', url: '/instances/batch/renew', headers: { 'idempotency-key': partialKey }, payload: { instanceIds: partialIds, months: 1 } })
    assert.equal(resumed.statusCode, 200, resumed.body); assert.equal(resumed.json().successCount, 2)
    assert.equal(await balance(), beforePartial - 20, 'resume commits only the unfinished batch item')
    assert.deepEqual((await batch()).json().results, batchFirst.json().results)
    assert.equal(await balance(), beforePartial - 20)
    const raw = 'pat_' + randomBytes(32).toString('base64url')
    await prisma.publicApiToken.create({ data: { userId: buyer.id, name: tag, tokenHash: hashPublicApiToken(raw), tokenPrefix: getPublicApiTokenPrefix(raw), scopes: ['services:billing'] } })
    const apiKey = randomUUID(), beforeApi = await balance()
    const publicRenew = () => app.inject({ method: 'POST', url: `/v1/services/${two.id}/renew`, headers: { authorization: `Bearer ${raw}`, 'idempotency-key': apiKey }, payload: { months: 1 } })
    const apiFirst = await publicRenew(); assert.equal(apiFirst.statusCode, 200, apiFirst.body)
    assert.deepEqual((await publicRenew()).json(), apiFirst.json()); assert.equal(await balance(), beforeApi - 10)
    const source = await prisma.mailSource.create({ data: { name: tag, code: tag, apiUrl: 'https://127.0.0.1:1', apiKey: 'fixture', smarterMailUrl: 'https://127.0.0.1:1' } }); sourceId = source.id
    const mailPlan = await prisma.mailPlan.create({ data: { sourceId, name: tag, domainLimit: 1, diskLimitGb: 1, billingCycle: 'monthly', price: 10 } })
    const sub = await prisma.mailSubscription.create({ data: { userId: buyer.id, sourceId, planId: mailPlan.id, domainLimit: 1, diskLimitGb: 1, expiresAt: new Date(Date.now() + 86400000) } })
    const mailKey = randomUUID(), beforeMail = await balance()
    const mail = () => app.inject({ method: 'POST', url: '/mail/subscription/renew', headers: { 'idempotency-key': mailKey }, payload: { months: 1, subscriptionId: sub.id } })
    const mailFirst = await mail(); assert.equal(mailFirst.statusCode, 200, mailFirst.body)
    assert.deepEqual((await mail()).json(), mailFirst.json()); assert.equal(await balance(), beforeMail - 10)
    const failureKey = randomUUID(), beforeFailure = await balance(), beforeInstance = await prisma.instance.findUniqueOrThrow({ where: { id: one.id } })
    const trigger = 'renew_receipt_' + randomUUID().replaceAll('-', '')
    await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = ${buyer.id} THEN RAISE EXCEPTION 'isolated renewal receipt failure'; END IF; RETURN NEW; END $$`)
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON renewal_requests FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
    try {
      const failed = await renew(one.id, failureKey)
      assert.equal(failed.statusCode, 400)
      assert.equal(await balance(), beforeFailure)
      assert.deepEqual(await prisma.instance.findUniqueOrThrow({ where: { id: one.id } }), beforeInstance)
      assert.equal(await prisma.renewalRequest.count({ where: { userId: buyer.id, requestKey: failureKey } }), 0)
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON renewal_requests`)
      await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
    }
    assert.equal((await renew(one.id, failureKey)).statusCode, 200, 'same key retries after rolled-back receipt failure')
    console.log('PASS durable renewal: required keys, same response across fresh process, concurrent replay, input/account/session isolation, new intent, batch partial success, PAT and mail')
  } catch (error) { failure = error }
  finally {
    await app.close(); globalThis.fetch = oldFetch
    await prisma.log.deleteMany({ where: { userId: { in: userIds } } })
    if (sourceId) await prisma.mailSource.delete({ where: { id: sourceId } })
    if (hostId) await prisma.instance.deleteMany({ where: { hostId } })
    if (packageId) await prisma.package.delete({ where: { id: packageId } })
    if (hostId) await prisma.host.delete({ where: { id: hostId } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }); await closePrismaDatabase()
  }
  if (failure) { console.error(failure); process.exitCode = 1 }
}
