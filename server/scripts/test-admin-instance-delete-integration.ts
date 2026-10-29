import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { createHash, randomUUID, X509Certificate } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep, basename } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:https'
const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
process.env.JWT_SECRET ||= 'local-delete-guard-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { default: hostRoutes } = await import('../src/routes/hosts.js')
const { default: instanceRoutes } = await import('../src/routes/instances.js')
const { default: destroyRoutes } = await import('../src/routes/instance-destroy.js')
const { default: adminBillingRoutes } = await import('../src/routes/admin-billing.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const prefix = `delete-test-${randomUUID().slice(0, 8)}`
const admin = await prisma.user.create({ data: { username: `${prefix}-admin`, passwordHash: 'unusable-fixture', role: 'admin' } })
const owner = await prisma.user.create({ data: { username: `${prefix}-owner`, passwordHash: 'unusable-fixture', hostingBalance: 100 } })
const buyer = await prisma.user.create({ data: { username: `${prefix}-buyer`, passwordHash: 'unusable-fixture', balance: 100, email: `${prefix}@example.test` } })
const pkg = await prisma.package.create({ data: { userId: owner.id, name: prefix, cpuMax: 100, memoryMax: 1024, diskMax: 2048 } })
const plan = await prisma.packagePlan.create({ data: { packageId: pkg.id, name: prefix, cpu: 100, memory: 1024, disk: 2048, trafficLimit: 1000000n, price: 1000,
  portLimit: 0, snapshotLimit: 0, backupLimit: 0, siteLimit: 0 } })
let sequence = 0
async function fixture() {
  const host = await prisma.host.create({ data: { userId: owner.id, name: `${prefix}-h${++sequence}`, url: 'https://127.0.0.1:1',
    status: 'online', cpuUsed: 100, memoryUsed: 1024, diskUsed: 2048 } })
  const now = new Date(), end = new Date(now.getTime() + 30 * 86400000)
  const instance = await prisma.instance.create({ data: { userId: buyer.id, hostId: host.id, packageId: pkg.id, packagePlanId: plan.id,
    name: `${prefix}-i${sequence}`, incusId: `${prefix}-i${sequence}`, image: 'fixture/debian', status: 'running', cpu: 100, memory: 1024, disk: 2048,
    expiresAt: end, billingPrice: 10, billingCycle: 1 } })
  await prisma.instanceBillingRecord.create({ data: { instanceId: instance.id, userId: buyer.id, type: 'newPurchase', amount: 10, months: 1, periodStart: now, periodEnd: end } })
  return { host, instance }
}
const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } })
app.decorate('authenticate', async (request: any, reply: any) => {
  const role = request.headers['x-test-role']
  if (!role) return reply.code(401).send({ code: 'UNAUTHORIZED' })
  const actor = role === 'admin' ? admin : role === 'owner' ? owner : buyer
  request.user = { id: actor.id, username: actor.username, role: actor.role, sid: `${prefix}-session`, iat: Math.floor(Date.now() / 1000) + 1 }
})
app.decorate('requireAdmin', async (request: any, reply: any) => { if (request.user.role !== 'admin') return reply.code(403).send({ code: 'FORBIDDEN' }) })
app.decorate('authenticateAdmin', async (request: any, reply: any) => { await app.authenticate(request, reply); if (!reply.sent) await app.requireAdmin(request, reply) })
app.decorate('authenticateUser', app.authenticate)
await app.register(hostRoutes, { prefix: '/hosts' })
await app.register(instanceRoutes, { prefix: '/instances' })
await app.register(destroyRoutes, { prefix: '/instances' })
await app.register(adminBillingRoutes)
for (const actor of [admin, owner, buyer]) await prisma.notificationChannel.create({ data: { userId: actor.id, type: 'webhook', name: 'Verification fixture', enabled: true, config: { url: 'https://invalid.example.test' } } })
const remove = (hostId: number, ids: number[], role: string, refund: boolean, databaseOnly = true) => app.inject({ method: 'DELETE',
  url: `/hosts/${hostId}/instances/batch`, headers: { 'x-test-role': role }, payload: { instanceIds: ids, refund, databaseOnly } })
// This existing deletion/ledger matrix seeds only its own isolated grant. The
// actual email send/claim path is separately exercised by destroy-email-verification.
async function destroyPayload(ids: number[]) {
  const normalized = [...ids].sort((a, b) => a - b)
  const resourceType = 'destroy-email:v1:' + createHash('sha256').update(JSON.stringify([buyer.id, `${prefix}-session`, buyer.email, normalized])).digest('hex')
  await prisma.operationVerification.deleteMany({ where: { userId: buyer.id, resourceType } })
  await prisma.operationVerification.create({ data: { userId: buyer.id, operationType: 'delete_instance', channel: 'email', resourceType,
    resourceId: ids.length === 1 ? ids[0] : null, code: 'sha256:' + createHash('sha256').update('654321').digest('hex'), expiresAt: new Date(Date.now() + 60_000) } })
  return { emailCode: '654321' }
}
try {
  const direct = await fixture()
  const directBefore = Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance)
  const adminDelete = await app.inject({ method: 'DELETE', url: `/instances/${direct.instance.id}`, headers: { 'x-test-role': 'admin' }, payload: {} })
  assert.equal(adminDelete.statusCode, 500, 'administrator reaches the actual remote deletion attempt without secondary verification')
  assert.notEqual(adminDelete.json().code, 'VERIFICATION_REQUIRED')
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), directBefore)
  assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: direct.instance.id, type: 'refund' } }), 0)
  const ownerDelete = await app.inject({ method: 'DELETE', url: `/instances/${direct.instance.id}`, headers: { 'x-test-role': 'owner' }, payload: {} })
  assert.equal(ownerDelete.statusCode, 403, 'host owner secondary verification remains required')
  assert.equal(ownerDelete.json().code, 'VERIFICATION_REQUIRED')
  await prisma.instance.update({ where: { id: direct.instance.id }, data: { packagePlanId: null } })
  const customerDelete = await app.inject({ method: 'DELETE', url: `/instances/${direct.instance.id}`, headers: { 'x-test-role': 'buyer' }, payload: {} })
  assert.equal(customerDelete.statusCode, 403, 'customer secondary verification remains required')
  assert.equal(customerDelete.json().code, 'DESTROY_EMAIL_VERIFICATION_REQUIRED')
  const denied = await fixture()
  assert.equal((await remove(denied.host.id, [denied.instance.id], 'buyer', false)).statusCode, 403)
  assert.equal((await remove(denied.host.id, [denied.instance.id], 'owner', false)).statusCode, 403, 'a hosted owner cannot waive customer refunds')
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: denied.instance.id } })).status, 'running')

  const without = await fixture()
  const balanceBefore = Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance)
  const noRefund = await remove(without.host.id, [without.instance.id], 'admin', false)
  assert.equal(noRefund.statusCode, 200)
  assert.equal(noRefund.json().successCount, 1)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), balanceBefore)
  assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: without.instance.id, type: 'refund' } }), 0)
  const released = await prisma.host.findUniqueOrThrow({ where: { id: without.host.id } })
  assert.deepEqual([released.cpuUsed, released.memoryUsed, released.diskUsed], [0, 0, 0])
  assert.equal(released.poolFaulted, true, 'record-only deletion holds the remote host from resale')
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: without.instance.id } })).deletionBillingPending, false)
  assert.equal((await remove(without.host.id, [without.instance.id], 'admin', false)).statusCode, 400)

  const paid = await fixture()
  const paidBefore = Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance)
  const attempts = await Promise.all([remove(paid.host.id, [paid.instance.id], 'admin', true), remove(paid.host.id, [paid.instance.id], 'admin', true)])
  assert.equal(attempts.reduce((sum, response) => sum + (response.json().successCount || 0), 0), 1, 'concurrent requests cannot finalize twice')
  const refunds = await prisma.instanceBillingRecord.findMany({ where: { instanceId: paid.instance.id, type: 'refund' } })
  assert.equal(refunds.length, 1)
  assert.ok(Number(refunds[0].amount) > 9 && Number(refunds[0].amount) <= 10)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), paidBefore + Number(refunds[0].amount))
  assert.equal((await remove(paid.host.id, [paid.instance.id], 'admin', true)).statusCode, 400)
  assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: paid.instance.id, type: 'refund' } }), 1)

  const offline = await fixture()
  const offlineBefore = Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance)
  assert.equal((await remove(offline.host.id, [offline.instance.id], 'admin', true, false)).statusCode, 502, 'full deletion cannot succeed without remote confirmation')
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: offline.instance.id } })).status, 'running')
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: offline.host.id } })).cpuUsed, 100)
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), offlineBefore)

  // Real HTTP/TLS and PostgreSQL, with only the Incus process/disk boundary simulated.
  const tlsRoot = await mkdtemp(join(tmpdir(), 'payincus-delete-https-'))
  const certificatePath = join(tlsRoot, 'client.crt'), keyPath = join(tlsRoot, 'client.key')
  execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-keyout', keyPath, '-out', certificatePath], { stdio: 'pipe', windowsHide: true })
  const certificate = await readFile(certificatePath, 'utf8')
  const remoteStates = new Map<string, string>(), remoteCalls: string[] = []
  const remoteConfig = new Map<string, Record<string, string>>()
  let rejectDeletion = false
  let keepDeleted = false
  let beforeRemoteDelete: (() => Promise<void>) | undefined
  const server = createServer({ key: await readFile(keyPath), cert: certificate, ca: certificate,
    requestCert: true, rejectUnauthorized: true }, async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk
    const url = new URL(request.url || '/', 'https://localhost')
    remoteCalls.push(`${request.method} ${url.pathname}`)
    const send = (metadata: unknown, code = 200) => {
      response.writeHead(code, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ type: code === 200 ? 'sync' : 'error', metadata,
        error: code === 200 ? '' : code === 404 ? 'Instance not found' : 'Isolated deletion failure' }))
    }
    if (url.pathname === '/1.0') return send({ api_version: '1.0' })
    if (url.pathname === '/1.0/operations') return send({})
    if (url.pathname.includes('/forwards') || url.pathname.endsWith('/snapshots') || url.pathname.endsWith('/backups')) return send([])
    const match = /^\/1\.0\/instances\/([^/]+)(\/state)?$/.exec(url.pathname)
    if (!match || !remoteStates.has(match[1]!)) return send({}, 404)
    const name = match[1]!
    if (request.method === 'GET' && match[2]) return send({ status: remoteStates.get(name) })
    if (request.method === 'GET') return send({ name, status: remoteStates.get(name), devices: {}, config: remoteConfig.get(name) || {} })
    if (request.method === 'PUT' && match[2]) {
      assert.equal(JSON.parse(body).action, 'stop'); remoteStates.set(name, 'Stopped'); return send({})
    }
    if (request.method === 'DELETE') {
      if (rejectDeletion || remoteStates.get(name) !== 'Stopped') return send({}, 503)
      if (beforeRemoteDelete) { const hook = beforeRemoteDelete; beforeRemoteDelete = undefined; await hook() }
      if (!keepDeleted) remoteStates.delete(name); return send({})
    }
    return send({}, 404)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const endpoint = server.address(); assert.ok(endpoint && typeof endpoint === 'object')
  const endpointPort = endpoint.port
  async function runningErrorFixture() {
    const value = await fixture()
    await prisma.host.update({ where: { id: value.host.id }, data: { url: `https://127.0.0.1:${endpointPort}`,
      certPath: certificatePath, keyPath, serverCertificate: certificate, serverFingerprint: new X509Certificate(certificate).fingerprint256 } })
    await prisma.instance.update({ where: { id: value.instance.id }, data: { status: 'error' } })
    remoteStates.set(value.instance.incusId, 'Running')
    return value
  }
  async function pendingCleanupFixture() {
    const value = await runningErrorFixture()
    const attempt = randomUUID()
    remoteConfig.set(value.instance.incusId, { 'user.payincus.provisioning-attempt': attempt, 'volatile.uuid': randomUUID() })
    await prisma.instance.update({ where: { id: value.instance.id }, data: { provisioningCleanupPending: true,
      snapshottedSpecs: { managedCleanup: { attempt, endpointHash: createHash('sha256').update(`https://127.0.0.1:${endpointPort}`).digest('hex') } } } })
    await prisma.publicIpv4Address.create({ data: { hostId: value.host.id, instanceId: value.instance.id,
      address: '192.0.2.30', status: 'assigned', prefixLength: 24, gateway: '192.0.2.1' } })
    return value
  }
  try {
    const ledgerSnapshot = async () => ({
      buyer: (await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance.toFixed(2),
      hosting: (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).hostingBalance.toFixed(2),
      aff: (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).affBalance.toFixed(2),
      balanceLogs: await prisma.balanceLog.count({ where: { userId: { in: [buyer.id, owner.id, admin.id] } } }),
      billingRecords: await prisma.instanceBillingRecord.count({ where: { userId: { in: [buyer.id, owner.id, admin.id] } } }),
      hostingLogs: await prisma.hostingBalanceLog.count({ where: { userId: { in: [buyer.id, owner.id, admin.id] } } }),
      affLogs: await prisma.affLog.count({ where: { userId: { in: [buyer.id, owner.id, admin.id] } } })
    })
    const assertNoRefundPreview = (preview: any) => {
      assert.deepEqual(preview.refund, {
        remainingDays: 0, remainingValue: 0, feeRate: 0, feeAmount: 0, refundAmount: 0,
        destroyCount: preview.refund.destroyCount, maxRefundable: 0
      })
    }
    const assertDeleted = async (value: Awaited<ReturnType<typeof fixture>>) => {
      assert.equal(remoteStates.has(value.instance.incusId), false, 'remote guest must be deleted')
      assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: value.instance.id } })).status, 'deleted')
      const host = await prisma.host.findUniqueOrThrow({ where: { id: value.host.id } })
      assert.deepEqual([host.cpuUsed, host.memoryUsed, host.diskUsed], [0, 0, 0], 'only confirmed deletion releases inventory')
      const audit = await prisma.userDestroyRecord.findFirst({ where: { instanceId: value.instance.id } })
      if (value.instance.packagePlanId) {
        assert.ok(audit)
        assert.equal(Number(audit.refundAmount), 0)
        assert.equal(Number(audit.feeAmount), 0)
      }
    }
    for (const entry of ['user', 'user_batch', 'admin', 'admin_batch']) {
      for (const failure of ['missing_identity', 'wrong_attempt', 'wrong_endpoint', 'unconfirmed']) {
        const value = await pendingCleanupFixture()
        if (failure === 'missing_identity') await prisma.instance.update({ where: { id: value.instance.id }, data: { snapshottedSpecs: {} } })
        if (failure === 'wrong_attempt') remoteConfig.get(value.instance.incusId)!['user.payincus.provisioning-attempt'] = randomUUID()
        if (failure === 'wrong_endpoint') {
          const row = await prisma.instance.findUniqueOrThrow({ where: { id: value.instance.id } })
          const specs = row.snapshottedSpecs as any; specs.managedCleanup.endpointHash = 'different-endpoint'
          await prisma.instance.update({ where: { id: value.instance.id }, data: { snapshottedSpecs: specs } })
        }
        keepDeleted = failure === 'unconfirmed'
        const before = await ledgerSnapshot(), callCount = remoteCalls.length
        const result = entry === 'user' ? await app.inject({ method: 'POST', url: `/instances/${value.instance.id}/destroy?feeWaiver=error`, headers: { 'x-test-role': 'buyer' }, payload: await destroyPayload([value.instance.id]) })
          : entry === 'user_batch' ? await app.inject({ method: 'POST', url: '/instances/batch/destroy', headers: { 'x-test-role': 'buyer' }, payload: { instanceIds: [value.instance.id], ...await destroyPayload([value.instance.id]) } })
          : entry === 'admin' ? await app.inject({ method: 'DELETE', url: `/instances/${value.instance.id}`, headers: { 'x-test-role': 'admin' }, payload: {} })
          : await remove(value.host.id, [value.instance.id], 'admin', false, false)
        if (entry.includes('batch')) assert.equal(result.json().successCount, 0, result.body)
        else assert.ok(result.statusCode >= 400, result.body)
        const current = await prisma.instance.findUniqueOrThrow({ where: { id: value.instance.id } })
        assert.equal(current.status, 'error'); assert.equal(current.provisioningCleanupPending, true)
        assert.equal((await prisma.publicIpv4Address.findFirstOrThrow({ where: { hostId: value.host.id } })).status, 'assigned')
        assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: value.host.id } })).cpuUsed, 100)
        assert.deepEqual(await ledgerSnapshot(), before)
        assert.equal(remoteStates.has(value.instance.incusId), true)
        if (failure !== 'unconfirmed') assert.equal(remoteCalls.slice(callCount).filter(call => call.startsWith('PUT ') || call.startsWith('DELETE ')).length, 0)
        keepDeleted = false
      }
    }
    const legacyPending = await pendingCleanupFixture()
    const beforeLegacy = await ledgerSnapshot(), legacyCalls = remoteCalls.length
    for (const databaseOnly of [false, true]) {
      const result = await app.inject({ method: 'POST', url: `/api/admin/instances/${legacyPending.instance.id}/delete-and-refund`,
        headers: { 'x-test-role': 'admin' }, payload: { refundType: 'full', reason: 'fixture cleanup', databaseOnly } })
      assert.equal(result.statusCode, 409, result.body)
      assert.equal(result.json().code, 'PROVISIONING_CLEANUP_PENDING')
    }
    assert.deepEqual(await ledgerSnapshot(), beforeLegacy); assert.equal(remoteCalls.length, legacyCalls)
    assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: legacyPending.instance.id } })).status, 'error')
    const recordOnly = await pendingCleanupFixture()
    const recordOnlyCalls = remoteCalls.length
    const recordOnlyResult = await remove(recordOnly.host.id, [recordOnly.instance.id], 'admin', false, true)
    assert.equal(recordOnlyResult.json().successCount, 1, recordOnlyResult.body)
    assert.equal(remoteCalls.length, recordOnlyCalls, 'record-only cleanup must not touch Incus')
    assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: recordOnly.instance.id } })).provisioningCleanupPending, true)
    assert.equal((await prisma.publicIpv4Address.findFirstOrThrow({ where: { hostId: recordOnly.host.id } })).status, 'assigned')
    assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: recordOnly.host.id } })).poolFaulted, true)
    for (const mode of ['pending', 'paid', 'error', 'error-waiver', 'free']) {
      const value = mode === 'pending' ? await pendingCleanupFixture() : await runningErrorFixture()
      if (mode === 'paid' || mode === 'free') {
        await prisma.instance.update({ where: { id: value.instance.id }, data: {
          status: 'stopped', ...(mode === 'free' ? { packagePlanId: null } : {})
        } })
        remoteStates.set(value.instance.incusId, 'Stopped')
        if (mode === 'free') value.instance.packagePlanId = null
      }
      const query = mode === 'error-waiver' ? '?feeWaiver=error' : ''
      const before = await ledgerSnapshot()
      const preview = await app.inject({ method: 'GET', url: `/instances/${value.instance.id}/destroy-info${query}`, headers: { 'x-test-role': 'buyer' } })
      assert.equal(preview.statusCode, 200, preview.body)
      assertNoRefundPreview(preview.json())
      const deleted = await app.inject({ method: 'POST', url: `/instances/${value.instance.id}/destroy${query}`, headers: { 'x-test-role': 'buyer' }, payload: await destroyPayload([value.instance.id]) })
      assert.equal(deleted.statusCode, 200, deleted.body)
      assert.equal(deleted.json().refundAmount, 0)
      assert.equal(deleted.json().feeAmount, 0)
      assert.deepEqual(await ledgerSnapshot(), before, `${mode}: destroy must not write any money ledger`)
      await assertDeleted(value)
      if (mode === 'pending') {
        assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: value.instance.id } })).provisioningCleanupPending, false, 'confirmed manual deletion must finalize pending creation cleanup')
        assert.equal((await prisma.publicIpv4Address.findFirstOrThrow({ where: { hostId: value.host.id } })).status, 'free')
      }
      assert.equal((await app.inject({ method: 'POST', url: `/instances/${value.instance.id}/destroy${query}`, headers: { 'x-test-role': 'buyer' }, payload: await destroyPayload([value.instance.id]) })).statusCode, 400)
      assert.deepEqual(await ledgerSnapshot(), before, 'duplicate destruction must not affect money')
    }
    const userBatch = [await pendingCleanupFixture(), await runningErrorFixture()]
    await prisma.instance.update({ where: { id: userBatch[0]!.instance.id }, data: { status: 'stopped' } })
    remoteStates.set(userBatch[0]!.instance.incusId, 'Stopped')
    const ids = userBatch.map(value => value.instance.id)
    const beforeUserBatch = await ledgerSnapshot()
    const batchPreview = await app.inject({ method: 'POST', url: '/instances/batch/destroy-info', headers: { 'x-test-role': 'buyer' }, payload: { instanceIds: ids } })
    assert.equal(batchPreview.statusCode, 200, batchPreview.body)
    batchPreview.json().items.forEach(assertNoRefundPreview)
    const userBatchResponse = await app.inject({ method: 'POST', url: '/instances/batch/destroy', headers: { 'x-test-role': 'buyer' }, payload: { instanceIds: ids, ...await destroyPayload(ids) } })
    assert.equal(userBatchResponse.statusCode, 200, userBatchResponse.body)
    assert.equal(userBatchResponse.json().successCount, 2, userBatchResponse.body)
    assert.equal(userBatchResponse.json().results.length, 2, 'duplicate IDs must not run twice')
    for (const result of userBatchResponse.json().results) assert.deepEqual([result.refundAmount, result.feeAmount], [0, 0])
    assert.deepEqual(await ledgerSnapshot(), beforeUserBatch)
    for (const value of userBatch) await assertDeleted(value)
    assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: userBatch[0]!.instance.id } })).provisioningCleanupPending, false)
    assert.equal((await prisma.publicIpv4Address.findFirstOrThrow({ where: { hostId: userBatch[0]!.host.id } })).status, 'free')

    const single = await pendingCleanupFixture()
    const beforeSingle = Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance)
    const response = await app.inject({ method: 'DELETE', url: `/instances/${single.instance.id}`, headers: { 'x-test-role': 'admin' }, payload: {} })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(remoteStates.has(single.instance.incusId), false)
    assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), beforeSingle)
    assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: single.instance.id, type: 'refund' } }), 0)
    assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: single.instance.id } })).provisioningCleanupPending, false)
    assert.equal((await prisma.publicIpv4Address.findFirstOrThrow({ where: { hostId: single.host.id } })).status, 'free')

    for (const refund of [false, true]) {
      const batch = await pendingCleanupFixture()
      const beforeBatch = Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance)
      const response = await remove(batch.host.id, [batch.instance.id], 'admin', refund, false)
      assert.equal(response.json().successCount, 1, response.body)
      assert.equal(remoteStates.has(batch.instance.incusId), false)
      const records = await prisma.instanceBillingRecord.findMany({ where: { instanceId: batch.instance.id, type: 'refund' } })
      assert.equal(records.length, refund ? 1 : 0)
      assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance),
        beforeBatch + records.reduce((sum, record) => sum + Math.abs(Number(record.amount)), 0))
      const finalHost = await prisma.host.findUniqueOrThrow({ where: { id: batch.host.id } })
      assert.deepEqual([finalHost.cpuUsed, finalHost.memoryUsed, finalHost.diskUsed], [0, 0, 0])
      assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: batch.instance.id } })).provisioningCleanupPending, false)
      assert.equal((await prisma.publicIpv4Address.findFirstOrThrow({ where: { hostId: batch.host.id } })).status, 'free')
    }

    const refunded = await runningErrorFixture()
    await prisma.instanceBillingRecord.create({ data: { instanceId: refunded.instance.id, userId: buyer.id,
      type: 'refund', amount: -10, months: 0, periodStart: new Date(), periodEnd: new Date(), remark: '实例创建失败自动退款：独立测试' } })
    const beforeRefunded = Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance)
    const quote = await app.inject({ method: 'GET', url: `/instances/${refunded.instance.id}/destroy-info?feeWaiver=error`, headers: { 'x-test-role': 'buyer' } })
    assert.equal(quote.json().refund.refundAmount, 0)
    const destroyed = await app.inject({ method: 'POST', url: `/instances/${refunded.instance.id}/destroy?feeWaiver=error`, headers: { 'x-test-role': 'buyer' }, payload: await destroyPayload([refunded.instance.id]) })
    assert.equal(destroyed.statusCode, 200, destroyed.body)
    assert.equal(destroyed.json().refundAmount, 0)
    assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), beforeRefunded)
    assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: refunded.instance.id, type: 'refund' } }), 1)
    assert.equal((await app.inject({ method: 'POST', url: `/instances/${refunded.instance.id}/destroy?feeWaiver=error`, headers: { 'x-test-role': 'buyer' }, payload: await destroyPayload([refunded.instance.id]) })).statusCode, 400)

    const interleaved = await runningErrorFixture()
    const beforeInterleaved = Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance)
    beforeRemoteDelete = async () => {
      const { compensateFailedInstancePurchase } = await import('../src/db/instance-provisioning-compensation.js')
      const late = await compensateFailedInstancePurchase(interleaved.instance.id, buyer.id, interleaved.host.id)
      assert.equal(late.reason, 'instance_deleted', 'late compensation must defer to destroy claim')
      const { advisoryTransactionLock, USER_BALANCE_LOCK_NAMESPACE } = await import('../src/db/advisory-locks.js')
      await prisma.$transaction(async tx => {
        await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, buyer.id)
        await tx.user.update({ where: { id: buyer.id }, data: { balance: { increment: 10 } } })
        await tx.instanceBillingRecord.create({ data: { instanceId: interleaved.instance.id, userId: buyer.id,
          type: 'refund', amount: -10, months: 0, periodStart: new Date(), periodEnd: new Date(), remark: 'In-flight refund completed after quote' } })
      })
    }
    const interleavedDestroy = await app.inject({ method: 'POST', url: `/instances/${interleaved.instance.id}/destroy?feeWaiver=error`, headers: { 'x-test-role': 'buyer' }, payload: await destroyPayload([interleaved.instance.id]) })
    assert.equal(interleavedDestroy.statusCode, 200, interleavedDestroy.body)
    assert.equal(interleavedDestroy.json().refundAmount, 0, 'user destroy never refunds even when another refund finishes concurrently')
    assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), beforeInterleaved + 10)
    assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: interleaved.instance.id, type: 'refund' } }), 1)

    const failed = await runningErrorFixture(); rejectDeletion = true
    const beforeFailed = Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance)
    const refused = await remove(failed.host.id, [failed.instance.id], 'admin', true, false)
    assert.equal(refused.json().successCount, 0)
    assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: failed.instance.id } })).status, 'error')
    assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: failed.host.id } })).cpuUsed, 100)
    assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), beforeFailed)
    assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: failed.instance.id, type: 'refund' } }), 0)
    const failedLedgers = await ledgerSnapshot()
    const failedAuditCount = await prisma.userDestroyRecord.count({ where: { instanceId: failed.instance.id } })
    const userFailed = await app.inject({ method: 'POST', url: `/instances/${failed.instance.id}/destroy?feeWaiver=error`, headers: { 'x-test-role': 'buyer' }, payload: await destroyPayload([failed.instance.id]) })
    assert.equal(userFailed.statusCode, 500, userFailed.body)
    const batchFailed = await app.inject({ method: 'POST', url: '/instances/batch/destroy', headers: { 'x-test-role': 'buyer' }, payload: { instanceIds: [failed.instance.id], ...await destroyPayload([failed.instance.id]) } })
    assert.equal(batchFailed.json().successCount, 0, batchFailed.body)
    assert.equal(remoteStates.has(failed.instance.incusId), true)
    assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: failed.instance.id } })).status, 'error')
    assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: failed.host.id } })).cpuUsed, 100)
    assert.deepEqual(await ledgerSnapshot(), failedLedgers, 'failed destruction cannot affect ledgers')
    assert.equal(await prisma.userDestroyRecord.count({ where: { instanceId: failed.instance.id } }), failedAuditCount)
    assert.ok(remoteCalls.some(call => call.startsWith('PUT ')) && remoteCalls.some(call => call.startsWith('DELETE ')))
    console.log('PASS actual TLS Incus boundary: single/batch paid, error and free user destruction has zero refunds and zero ledger writes; administrator refund choices and failed-delete protection preserved')
  } finally {
    await closeAllClients()
    await new Promise<void>(resolve => server.close(() => resolve()))
    assert.ok(resolve(tlsRoot).startsWith(resolve(tmpdir()) + sep) && basename(tlsRoot).startsWith('payincus-delete-https-'),
      'Only remove this test-owned temporary TLS directory')
    await rm(tlsRoot, { recursive: true, force: true })
  }
  console.log('PASS administrator deletion: refund/no-refund, role isolation, concurrent replay, records-only hold and full-delete connection failure')
} finally { await app.close(); await closeAllClients(); await closePrismaDatabase() }
process.exit(0)
