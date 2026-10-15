import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mock } from 'node:test'
import Fastify from 'fastify'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
process.env.JWT_SECRET ||= 'push-integration-test-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { invalidateCachedConfigs } = await import('../src/lib/config-cache.js')
const { default: adminRoutes } = await import('../src/routes/admin-instance-push.js')
const { default: userRoutes } = await import('../src/routes/transfers.js')
const { createAdminInstancePush, AdminInstancePushError } = await import('../src/services/admin-instance-push.js')
const { createTransferWithFee, executeTransfer } = await import('../src/db/transfers.js')
const { IncusClient } = await import('../src/lib/incus/incus-client.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')

// Keep real routes, transactions, fees and ownership checks; only replace the remote host boundary.
let connectionFails = false
mock.method(IncusClient.prototype, 'connect', async function (this: InstanceType<typeof IncusClient>) {
  if (connectionFails) throw new Error('Test host unavailable')
  this.connected = true
  return {}
})
const remoteRequests = mock.method(IncusClient.prototype, 'request', async () => {
  throw new Error('Dedicated transfers must not rename or change network forwards')
})

const prefix = `push-test-${randomUUID().slice(0, 8)}`
const userIds: number[] = []
const hostIds: number[] = []
const instanceIds: number[] = []
const previousFee = await prisma.systemConfig.findUnique({ where: { key: 'transfer_fee' } })
const app = Fastify()
app.decorate('authenticateAdmin', async (request: any, reply: any) => {
  const user = await prisma.user.findUnique({ where: { id: Number(request.headers['x-test-user']) || 0 } })
  if (!user || user.role !== 'admin' || user.status !== 'active') return reply.code(403).send({ code: 'FORBIDDEN' })
  request.user = { id: user.id, username: user.username, role: user.role }
})
app.decorate('authenticateUser', async (request: any, reply: any) => {
  const user = await prisma.user.findUnique({ where: { id: Number(request.headers['x-test-user']) || 0 } })
  if (!user || user.role !== 'user' || user.status !== 'active') return reply.code(403).send({ code: 'FORBIDDEN' })
  request.user = { id: user.id, username: user.username, role: user.role }
})
await app.register(adminRoutes, { prefix: '/admin-push' })
await app.register(userRoutes, { prefix: '/transfers' })
const headers = (id: number) => ({ 'x-test-user': String(id) })
async function makeUser(label: string, role: 'admin' | 'user' = 'user', status: 'active' | 'banned' = 'active') {
  const user = await prisma.user.create({ data: { username: `${prefix}-${label}`, passwordHash: 'unusable-test-hash', role, status, balance: 100 } })
  userIds.push(user.id)
  return user
}
async function balance(id: number) { return Number((await prisma.user.findUniqueOrThrow({ where: { id } })).balance) }
async function setFee(value: string) {
  await prisma.systemConfig.upsert({ where: { key: 'transfer_fee' }, update: { value }, create: { key: 'transfer_fee', value, type: 'number' } })
  invalidateCachedConfigs(['transfer_fee'])
}
let failure: unknown
try {
  await setFee('2.5')
  const admin = await makeUser('admin', 'admin')
  const owner = await makeUser('owner')
  const target = await makeUser('target')
  const stranger = await makeUser('stranger')
  const banned = await makeUser('banned', 'user', 'banned')
  async function makeHost() {
    const host = await prisma.host.create({ data: { userId: admin.id, name: `${prefix}-internal-host-${hostIds.length}`, url: 'https://127.0.0.1:1',
      status: 'online', singleTenant: true, transferEnabled: true, natPublicIp: `192.0.2.${41 + hostIds.length}`, natBindIp: '10.0.0.41',
      resourcePreset: 'E2', cpuAllowanceMax: 200, memoryMax: 768, storageSize: 34, customerDiskGiB: 30 } })
    hostIds.push(host.id)
    return host
  }
  const host = await makeHost()
  async function makeInstance(label: string, dedicatedIpv4 = true) {
    const targetHost = instanceIds.length === 0 ? host : await makeHost()
    const instance = await prisma.instance.create({ data: { userId: owner.id, hostId: targetHost.id, name: `${prefix}-${label}`,
      incusId: `${prefix}-${label}`, status: 'running', image: 'images:debian/13', cpu: 200, memory: 768, disk: 30720,
      dedicatedIpv4, dedicatedNetworkReady: dedicatedIpv4, ipv4: '10.10.0.2', ipv6: '2001:db8::41', billingPrice: 3.5,
      expiresAt: new Date('2030-01-01T00:00:00Z'), autoRenew: true } })
    instanceIds.push(instance.id)
    return instance
  }
  const instance = await makeInstance('accept')
  const payload = { targetUsername: target.username, expectedOwnerId: owner.id, expectedFee: 2.5, acknowledge: true }
  const adminPost = (body: object = payload) => app.inject({ method: 'POST', url: `/admin-push/${instance.id}`, headers: headers(admin.id), payload: body })
  async function expectError(body: object, code: string, status: number) {
    const response = await adminPost(body)
    assert.equal(response.statusCode, status, response.body)
    assert.equal(response.json().code, code)
    assert.equal(await prisma.instanceTransfer.count({ where: { instanceId: instance.id } }), 0)
    assert.equal(await balance(owner.id), 100)
  }

  for (const id of [0, owner.id, target.id]) {
    for (const [method, url, body] of [
      ['GET', `/admin-push/${instance.id}`, undefined],
      ['GET', `/admin-push/${instance.id}/target?username=${target.username}`, undefined],
      ['POST', `/admin-push/${instance.id}`, payload]
    ] as const) assert.equal((await app.inject({ method, url, headers: headers(id), payload: body })).statusCode, 403)
  }
  await assert.rejects(createAdminInstancePush(instance.id, owner.id, payload), error => error instanceof AdminInstancePushError && error.code === 'FORBIDDEN')
  const preview = await app.inject({ method: 'GET', url: `/admin-push/${instance.id}`, headers: headers(admin.id) })
  assert.equal(preview.statusCode, 200)
  assert.equal(preview.headers['cache-control'], 'no-store')
  assert.deepEqual(preview.json().owner, { id: owner.id, username: owner.username, balance: 100 })
  assert.equal(preview.json().instance.ip, host.natPublicIp)
  assert.equal(preview.json().canCreate, true)
  for (const id of ['0', '1.2', '9007199254740992']) {
    assert.equal((await app.inject({ method: 'GET', url: `/admin-push/${id}`, headers: headers(admin.id) })).statusCode, 400)
  }
  await expectError({ ...payload, acknowledge: false }, 'TRANSFER_CONFIRMATION_REQUIRED', 400)
  await expectError({ ...payload, expectedOwnerId: stranger.id }, 'TRANSFER_SOURCE_CHANGED', 409)
  await expectError({ ...payload, expectedFee: 0 }, 'TRANSFER_FEE_CHANGED', 409)
  await expectError({ ...payload, targetUsername: `${prefix}-missing` }, 'USER_NOT_FOUND', 404)
  await expectError({ ...payload, targetUsername: owner.username }, 'TRANSFER_TO_SELF', 400)
  for (const recipient of [banned, admin]) await expectError({ ...payload, targetUsername: recipient.username }, 'TRANSFER_TARGET_UNAVAILABLE', 400)
  await expectError({ ...payload, remark: 'x'.repeat(201) }, 'INVALID_PARAMS', 400)
  await prisma.user.update({ where: { id: owner.id }, data: { balance: 1 } })
  assert.equal((await adminPost()).json().code, 'TRANSFER_UNAVAILABLE')
  await prisma.user.update({ where: { id: owner.id }, data: { balance: 100 } })

  for (const data of [{ poolFaulted: true }, { publicIpSyncBlocked: true }, { transferEnabled: false }]) {
    await prisma.host.update({ where: { id: host.id }, data })
    await expectError(payload, 'TRANSFER_UNAVAILABLE', 409)
    await prisma.host.update({ where: { id: host.id }, data: { poolFaulted: false, publicIpSyncBlocked: false, transferEnabled: true } })
  }
  const workflow = await prisma.instanceTask.create({ data: { instanceId: instance.id, userId: owner.id, hostId: host.id, taskType: 'rebuild' } })
  await expectError(payload, 'TRANSFER_UNAVAILABLE', 409)
  await prisma.instanceTask.update({ where: { id: workflow.id }, data: { status: 'COMPLETED' } })
  const restore = await prisma.restoreTask.create({ data: { instanceId: instance.id, userId: owner.id, hostId: host.id,
    originalInstanceName: instance.name, originalIncusId: instance.incusId } })
  await expectError(payload, 'TRANSFER_UNAVAILABLE', 409)
  await prisma.restoreTask.update({ where: { id: restore.id }, data: { status: 'COMPLETED' } })
  const storage = await prisma.storageConfig.create({ data: { userId: owner.id, name: prefix, type: 'SFTP', host: '127.0.0.1' } })
  const upload = await prisma.backupUploadTask.create({ data: { userId: owner.id, instanceId: instance.id, backupId: 0, hostId: host.id, storageConfigId: storage.id } })
  await expectError(payload, 'TRANSFER_UNAVAILABLE', 409)
  await prisma.backupUploadTask.update({ where: { id: upload.id }, data: { status: 'COMPLETED' } })

  const channel = await prisma.notificationChannel.create({ data: { userId: admin.id, type: 'email', name: prefix, config: { email: 'test@example.invalid' } } })
  await expectError(payload, 'VERIFICATION_REQUIRED', 403)
  await prisma.operationVerification.create({ data: { userId: admin.id, operationType: 'transfer_instance', resourceId: instance.id,
    channel: 'email', code: 'unused-test-code', verified: true, verifiedAt: new Date(), expiresAt: new Date(Date.now() + 60000) } })
  const created = await adminPost()
  assert.equal(created.statusCode, 201, created.body)
  const transferId = created.json().transfer.id
  const pending = await prisma.instanceTransfer.findUniqueOrThrow({ where: { id: transferId } })
  assert.deepEqual([pending.fromUserId, pending.toUserId, pending.status], [owner.id, target.id, 'pending'])
  assert.equal((pending.snapshot as any).initiatedByAdminId, admin.id)
  assert.equal((pending.snapshot as any).hostName, '')
  assert.equal((pending.snapshot as any).ipv4, host.natPublicIp)
  assert.equal(await balance(owner.id), 97.5)
  assert.equal(await balance(admin.id), 100)
  assert.equal(await balance(target.id), 100)
  assert.equal(await prisma.operationVerification.count({ where: { userId: admin.id } }), 0)
  assert.equal(await prisma.log.count({ where: { userId: admin.id, instanceId: instance.id, action: 'transfer.admin_create' } }), 1)
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).userId, owner.id, 'creating a request must not transfer ownership')
  assert.equal((await adminPost()).statusCode, 409)
  await prisma.notificationChannel.delete({ where: { id: channel.id } })

  const cancels = await Promise.all([0, 1].map(() => app.inject({ method: 'POST', url: `/transfers/${transferId}/cancel`, headers: headers(owner.id) })))
  assert.equal(cancels.filter(response => response.statusCode === 200).length, 1)
  assert.equal(await balance(owner.id), 100, 'concurrent cancellation refunds only once')

  const duplicates = await Promise.all([0, 1].map(() => adminPost()))
  assert.equal(duplicates.filter(response => response.statusCode === 201).length, 1, duplicates.map(response => response.body).join('\n'))
  assert.equal(await balance(owner.id), 97.5, 'concurrent creation charges the owner only once')
  const nextId = duplicates.find(response => response.statusCode === 201)!.json().transfer.id
  assert.equal((await app.inject({ method: 'POST', url: `/transfers/${nextId}/accept`, headers: headers(stranger.id) })).statusCode, 403)
  connectionFails = true
  const offline = await app.inject({ method: 'POST', url: `/transfers/${nextId}/accept`, headers: headers(target.id) })
  assert.equal(offline.json().code, 'HOST_UNAVAILABLE')
  assert.equal((await prisma.instanceTransfer.findUniqueOrThrow({ where: { id: nextId } })).status, 'pending')
  assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).userId, owner.id)
  connectionFails = false

  await prisma.instanceTransfer.update({ where: { id: nextId }, data: { status: 'processing' } })
  await assert.rejects(executeTransfer(nextId, instance.id, stranger.id, target.id, instance.name, instance.incusId, instance.incusId), /TRANSFER_SOURCE_CHANGED/)
  await assert.rejects(executeTransfer(nextId, instance.id, owner.id, target.id, instance.name, `${instance.incusId}-wrong`, instance.incusId), /TRANSFER_INVALID_STATUS/)
  await prisma.user.update({ where: { id: target.id }, data: { status: 'banned' } })
  await assert.rejects(executeTransfer(nextId, instance.id, owner.id, target.id, instance.name, instance.incusId, instance.incusId), /TRANSFER_TO_BANNED/)
  await prisma.user.update({ where: { id: target.id }, data: { status: 'active' } })
  await prisma.restoreTask.update({ where: { id: restore.id }, data: { status: 'PROCESSING' } })
  await assert.rejects(executeTransfer(nextId, instance.id, owner.id, target.id, instance.name, instance.incusId, instance.incusId), /TRANSFER_INSTANCE_BUSY/)
  await prisma.restoreTask.update({ where: { id: restore.id }, data: { status: 'COMPLETED' } })
  assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: instance.id } }), 0, 'failed execution has no billing side effects')
  await prisma.instanceTransfer.update({ where: { id: nextId }, data: { status: 'pending' } })
  const accepts = await Promise.all([0, 1].map(() => app.inject({ method: 'POST', url: `/transfers/${nextId}/accept`, headers: headers(target.id) })))
  assert.equal(accepts.filter(response => response.statusCode === 200).length, 1, accepts.map(response => response.body).join('\n'))
  const accepted = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
  assert.equal(accepted.userId, target.id)
  assert.equal(accepted.autoRenew, false)
  for (const key of ['incusId', 'hostId', 'status', 'ipv4', 'ipv6', 'dedicatedIpv4', 'dedicatedNetworkReady', 'billingPrice', 'expiresAt'] as const) {
    assert.deepEqual(accepted[key], instance[key], `${key} must remain unchanged on dedicated transfer`)
  }
  assert.equal(await prisma.instanceBillingRecord.count({ where: { instanceId: instance.id, userId: owner.id, type: 'transfer_fee' } }), 1)
  assert.equal(remoteRequests.mock.callCount(), 0, 'no dedicated network mutation or remote rename')

  const pushedInstance = await makeInstance('push')
  const userCreate = await app.inject({ method: 'POST', url: `/transfers/instances/${pushedInstance.id}/transfer`, headers: headers(owner.id), payload: { targetUsername: target.username } })
  assert.equal(userCreate.statusCode, 200, userCreate.body)
  const pushed = await app.inject({ method: 'POST', url: `/transfers/${userCreate.json().transfer.id}/push`, headers: headers(owner.id) })
  assert.equal(pushed.statusCode, 200, pushed.body)
  const pushResult = await prisma.instance.findUniqueOrThrow({ where: { id: pushedInstance.id } })
  assert.equal(pushResult.userId, target.id)
  assert.equal(pushResult.incusId, pushedInstance.incusId)
  assert.equal(remoteRequests.mock.callCount(), 0)

  const shared = await makeInstance('shared', false)
  const sharedCreate = await app.inject({ method: 'POST', url: `/transfers/instances/${shared.id}/transfer`, headers: headers(owner.id), payload: { targetUsername: target.username } })
  assert.equal(sharedCreate.statusCode, 200, sharedCreate.body)
  const sharedAccept = await app.inject({ method: 'POST', url: `/transfers/${sharedCreate.json().transfer.id}/accept`, headers: headers(target.id) })
  assert.equal(sharedAccept.json().code, 'INSTANCE_MUST_BE_STOPPED', 'shared instances keep the existing stopped-state contract')

  const snapshot = pending.snapshot as any
  await assert.rejects(createTransferWithFee({ instanceId: shared.id, fromUserId: stranger.id, toUserId: target.id, snapshot, fee: 2.5, instanceName: shared.name }), /TRANSFER_SOURCE_CHANGED/)
  const feeInstance = await makeInstance('fee')
  await setFee('4')
  await assert.rejects(createTransferWithFee({ instanceId: feeInstance.id, fromUserId: owner.id, toUserId: target.id, snapshot, fee: 2.5,
    instanceName: feeInstance.name, adminActorId: admin.id }), /TRANSFER_FEE_CHANGED/, 'fees are rechecked inside the creation transaction')
  assert.equal(await prisma.instanceTransfer.count({ where: { instanceId: feeInstance.id } }), 0)
  console.log('Admin/user PUSH integration passed: authorization, verification, invalid/stale input, tasks, fees, duplicate requests, cancellation refund, host failure, owner recheck, dedicated accept/push, billing/network preservation and shared-instance stop requirement')
} catch (error) { failure = error }
finally {
  await app.close()
  await closeAllClients()
  mock.restoreAll()
  await prisma.restoreTask.deleteMany({ where: { instanceId: { in: instanceIds } } })
  await prisma.log.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.instance.deleteMany({ where: { id: { in: instanceIds } } })
  await prisma.host.deleteMany({ where: { id: { in: hostIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  if (previousFee) await prisma.systemConfig.update({ where: { key: 'transfer_fee' }, data: { value: previousFee.value } })
  else await prisma.systemConfig.deleteMany({ where: { key: 'transfer_fee' } })
  invalidateCachedConfigs(['transfer_fee'])
  await closePrismaDatabase()
}
if (failure) console.error(failure)
process.exit(failure ? 1 : 0)
