/** Actual local PG queue, inventory and allocator; host kernel/SSH reports are fixtures. */
import assert from 'node:assert/strict'
import { randomUUID, randomInt } from 'node:crypto'
import Fastify from 'fastify'
const database = new URL(process.env.DATABASE_URL || '')
assert.equal(database.hostname, '127.0.0.1')
assert.ok(database.pathname.endsWith('_pool_test'))
const setIntervalBefore = globalThis.setInterval
globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => setIntervalBefore(...args).unref()) as typeof setInterval
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { hardenExistingHost } = await import('../src/services/security-hardening-queue.js')
const { prepareAutomaticHostMaintenance, hostMaintenanceDependencies } = await import('../src/services/host-security-maintenance.js')
const { finishSecureOnboarding } = await import('../src/services/onboarding-security-gate.js')
const { hardeningIdentityHash } = await import('../src/lib/hardening-identity.js')
const { hostMaintenanceBlocked } = await import('../src/lib/host-maintenance-gate.js')
const { dedicatedHostReadyWhere } = await import('../src/lib/host-resource-usage.js')
const { presetQuota } = await import('../src/lib/onboarding-resources.js')
const { SECURITY_HARDENING_ENABLED_KEY, SECURITY_HARDENING_REVISION } = await import('../src/lib/security-hardening.js')
const { selectAndReserveHostWithLock } = await import('../src/db/hosts.js')
const { poolInventory, publicPoolCatalog } = await import('../src/services/host-pool-prices.js')
const { default: inventoryRoutes } = await import('../src/routes/host-inventory.js')
globalThis.setInterval = setIntervalBefore
const prefix = 'hardening-stock-' + randomUUID().slice(0, 8)
const policy = await prisma.systemConfig.findUnique({ where: { key: SECURITY_HARDENING_ENABLED_KEY } })
const owner = await prisma.user.create({ data: { username: prefix, passwordHash: 'fixture', role: 'admin' } })
const batch = await prisma.hostOnboardingBatch.create({ data: { id: randomUUID(), name: prefix, accountLabel: prefix, createdById: owner.id, defaults: {} } })
const hostIds: number[] = [], groupIds: number[] = []
const app = Fastify()
app.decorate('authenticateAdmin', async (request: any, reply: any) => {
  if (request.headers['x-fixture-admin'] !== 'yes') return reply.code(403).send({ code: 'FORBIDDEN' })
  request.user = { id: owner.id, role: 'admin' }
})
await app.register(inventoryRoutes)
try {
  await prisma.systemConfig.upsert({ where: { key: SECURITY_HARDENING_ENABLED_KEY }, update: { value: 'true' }, create: { key: SECURITY_HARDENING_ENABLED_KEY, value: 'true' } })
  for (const [architecture, resourcePreset, pageSize] of [['x86_64', 'E2', 4096], ['aarch64', 'ARM2C', 65536]] as const) {
    const group = await prisma.hostMachineGroup.create({ data: { name: prefix + architecture } }); groupIds.push(group.id)
    const region = await prisma.hostRegionGroup.create({ data: { machineGroupId: group.id, name: prefix, countryCode: 'kr' } })
    const quota = presetQuota(resourcePreset)
    const pkg = await prisma.package.create({ data: { userId: owner.id, name: prefix + resourcePreset, hidden: true, cpuMax: quota.cpuAllowanceMax, memoryMax: quota.memoryMax, diskMax: 30720 } })
    const plan = await prisma.packagePlan.create({ data: { packageId: pkg.id, name: prefix, cpu: quota.cpuAllowanceMax, memory: quota.memoryMax, disk: 30720,
      portLimit: 0, snapshotLimit: 0, backupLimit: 0, siteLimit: 0, trafficLimit: 1024n, price: 100 } })
    const price = await prisma.hostPoolPrice.create({ data: { machineGroupId: group.id, regionGroupId: region.id, resourcePreset, diskGiB: 30, monthlyPrice: 100, shadowPlanId: plan.id } })
    let publicIp = ''
    do { publicIp = `198.18.${randomInt(1, 254)}.${randomInt(1, 254)}` }
    while (await prisma.hostOnboardingNode.findFirst({ where: { OR: [{ activePublicIp: publicIp }, { publicIp, deletedAt: null }] } }))
    const host = await prisma.host.create({ data: { userId: owner.id, name: prefix + resourcePreset, url: 'https://127.0.0.1:1',
      architecture, resourcePreset, machineGroupId: group.id, regionGroupId: region.id, singleTenant: true, isInstalled: true, status: 'online',
      customerDiskGiB: 30, storageSize: 38, cpuAllowanceMax: quota.cpuAllowanceMax, memoryMax: quota.memoryMax,
      certPath: 'fixture.crt', keyPath: 'fixture.key', serverCertificate: 'original-fixture-cert', serverFingerprint: 'original-fixture-pin',
      managementSshHost: '127.0.0.1', managementSshPort: 22, managementSshUser: 'root', natPublicIp: publicIp, natPortStart: 20000, natPortEnd: 20999,
      onboardingNode: { create: { batchId: batch.id, name: prefix + resourcePreset, publicIp,
        managementIp: '127.0.0.1', sshPort: 22, sshFingerprint: 'SHA256:fixture', nodePublicKey: 'A'.repeat(43) + '=', status: 'succeeded', credentialsExpireAt: new Date(0) } }
    }, include: { onboardingNode: { include: { batch: true } } } }); hostIds.push(host.id)
    await prisma.storagePool.create({ data: { hostId: host.id, name: 'fixture', driver: 'btrfs', purpose: 'instance_data' } })
    await prisma.hostAgent.create({ data: { hostId: host.id, agentId: randomUUID(), secretHash: 'fixture', secretEncrypted: 'fixture', enabled: true, lastSeenAt: new Date(),capabilities:['guest-network-protection-v1'],lastReport:{guestProtectionStatus:{applied:true,checkedAt:new Date().toISOString()}} } })
    const bootId = randomUUID(), requestId = randomUUID()
    const maintenance = { revision: 'host-maintenance-v1', requestId, identityHash: hardeningIdentityHash(host), bootId, prepareHash: 'b'.repeat(64),
      recipe: 'alpine-apparmor-grub-v1', architecture, phase: 'aborted', rebootIssued: false,
      startedAt: new Date(Date.now() - 24 * 60000).toISOString(), deadline: new Date(Date.now() - 4 * 60000).toISOString(), customers: [] }
    let active = false, inspections = 0, remoteWrites = 0
    const deps = { held: () => false, connect: async () => ({ request: async (method: string, path: string) => {
      assert.equal(method, 'GET'); assert.ok(path.startsWith('/1.0/instances?')); return []
    } } as any), host: async (_host: unknown, guests: unknown[], _update: boolean, allowed: () => Promise<void>) => {
      await allowed(); inspections++; assert.equal(guests.length, 0)
      return { apparmor: active, alpine: true, fixed: true, branch: '3.24', hostSshUpdated: false, guests: [], preflight: {
        architecture, bootId, pageSize, memoryAvailableKiB: 262144, memoryPressure: 0, rootAvailableBytes: 268435456, rootAvailableInodes: 1024,
        rootReadonly: false, packageBusy: false, apparmorKernelSupport: true, apparmorBootDisabled: !active, apparmorActive: active, bootloader: 'grub' as const } }
    }, customer: async () => { remoteWrites++; throw Error('empty host cannot have customer actions') } }
    const state = async () => (await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).securityHardening as any
    const due = async () => prisma.host.update({ where: { id: host.id }, data: { securityHardening: { ...await state(), nextCheckAt: new Date(0).toISOString() } } })
    const allocate = () => prisma.$transaction(tx => selectAndReserveHostWithLock(tx, { reservationOnly: true, hostId: host.id,
      poolMachineGroupId: group.id, poolRegionGroupId: region.id, poolResourcePreset: resourcePreset, poolDiskGiB: 30,
      cpu: quota.cpuAllowanceMax, memory: quota.memoryMax, disk: 30720 }))
    const stock = async (expected: number, label: string, assigned = false) => {
      const inventory = (await poolInventory()).find(row => row.machineGroupId === group.id && row.resourcePreset === resourcePreset)
      assert.equal(inventory?.idle, expected, architecture + ': ' + label + ' / inventory')
      const product = (await publicPoolCatalog()).regions.flatMap(row => row.products).find(row => row.id === price.id)
      assert.equal(product?.idle, expected, architecture + ': ' + label + ' / public catalog')
      const response = await app.inject({ method: 'GET', url: `/inventory?machineGroupId=${group.id}`, headers: { 'x-fixture-admin': 'yes' } })
      assert.equal(response.statusCode, 200)
      for (const secret of ['original-fixture-cert', 'original-fixture-pin', 'SHA256:fixture']) assert.ok(!response.body.includes(secret), 'stock identity checks never expose pins/certificates')
      assert.equal(response.json().hosts[0].stock, assigned ? 'assigned' : expected ? 'available' : 'unavailable', label + ' / administrator inventory')
      assert.equal((await allocate())?.id ?? null, expected ? host.id : null, label + ' / locked allocator')
    }
    await prisma.host.update({ where: { id: host.id }, data: { securityHardening: { revision: SECURITY_HARDENING_REVISION, status: 'retry', maintenance } } })
    assert.equal(hostMaintenanceBlocked({ maintenance }), false)
    await hardenExistingHost(host.id, deps)
    assert.equal((await state()).status, 'needs-maintenance')
    await stock(0, 'safe rollback does not grant stock while AppArmor is absent')
    // A corrected environment must be proven by the actual queue; never edit
    // the database to verified or remove the preserved rollback history.
    active = true; await due(); await hardenExistingHost(host.id, deps)
    assert.equal((await state()).status, 'verified'); assert.equal((await state()).phase, 'finished')
    assert.deepEqual((await state()).maintenance, maintenance)
    assert.equal(await prisma.host.count({ where: { id: host.id, ...dedicatedHostReadyWhere() } }), 1, architecture + ': complete reinspection after rollback must restore readiness')
    await stock(1, 'complete reinspection after rollback restores actual sales')
    const protectedReport = { guestProtectionStatus: { applied: true, checkedAt: new Date().toISOString() } }
    for (const lastReport of [{}, { guestProtectionStatus: { applied: false, checkedAt: new Date().toISOString() } },
      { guestProtectionStatus: { applied: true, checkedAt: new Date(0).toISOString() } },
      { guestProtectionStatus: { applied: true, checkedAt: new Date(Date.now() + 600000).toISOString() } }]) {
      await prisma.hostAgent.update({ where: { hostId: host.id }, data: { lastReport } })
      await stock(0, 'missing, failed, expired or future network protection cannot be sold')
    }
    await prisma.hostAgent.update({ where: { hostId: host.id }, data: { lastReport: protectedReport } })
    await stock(1, 'fresh protection automatically restores stock and allocation')
    const exhausted = { ...(await state()), maintenance: { ...maintenance, preparationRetries: 2 } }
    await prisma.host.update({ where: { id: host.id }, data: { securityHardening: exhausted } })
    await prepareAutomaticHostMaintenance(host.id, { ...hostMaintenanceDependencies, held: () => false,
      command: async () => { remoteWrites++; throw Error('verified host needs no further preparation') },
      connect: async () => { remoteWrites++; throw Error('verified host needs no further preparation') } })
    assert.equal((await state()).status, 'verified', 'historical exhausted preparation must not overwrite a newly proven healthy host')
    await stock(1, 'fresh success closes historical exhausted preparation')
    const verified = await state()
    await prisma.host.update({ where: { id: host.id }, data: { installPending: true } })
    await stock(0, 'an active host reinstall session cannot reuse a previous hardening receipt')
    await prisma.host.update({ where: { id: host.id }, data: { installPending: false } })
    await stock(1, 'ending the install session restores stock when all existing checks remain valid')
    const deleted = await prisma.instance.create({ data: { hostId: host.id, userId: owner.id, name: prefix + '-deleted', incusId: prefix + '-deleted', image: 'fixture/alpine', status: 'deleted', cpu: 200, memory: 768, disk: 30720 } })
    const receipt = await prisma.instanceTask.create({ data: { hostId: host.id, instanceId: deleted.id, userId: owner.id,
      taskType: 'recreate', status: 'FAILED', targetHostId: host.id, replacementState: { targetPhase: 'cleanup_pending', sourceHostId: host.id } } })
    await stock(0, 'deleted customer with unfinished reinstallation cleanup stays reserved everywhere')
    await prisma.instanceTask.update({ where: { id: receipt.id }, data: { replacementState: { targetPhase: 'cleaned', sourceHostId: host.id } } })
    await stock(1, 'confirmed cleanup releases stock without removing task history')
    await prisma.instance.delete({ where: { id: deleted.id } })
    await prisma.host.update({ where: { id: host.id }, data: { securityHardening: { ...verified, nextCheckAt: new Date(0).toISOString() } } })
    await stock(0, 'expired successful inspection cannot release stock')
    for (const maintenance of [
      { revision: 'host-maintenance-v1', phase: 'aborted', rebootIssued: false },
      { ...verified.maintenance, phase: 'aborted', rebootIssued: true }
    ]) {
      await prisma.host.update({ where: { id: host.id }, data: { securityHardening: { ...verified, maintenance } } })
      await stock(0, 'incomplete or inconsistent rollback history cannot become phantom stock')
    }
    await prisma.host.update({ where: { id: host.id }, data: { securityHardening: verified, serverFingerprint: 'changed-fixture-pin' } })
    await stock(0, 'a stale receipt after identity change is unavailable in every sales view')
    await prisma.host.update({ where: { id: host.id }, data: { serverFingerprint: host.serverFingerprint } })
    await prisma.instance.create({ data: { hostId: host.id, userId: owner.id, name: prefix + resourcePreset, incusId: prefix + resourcePreset,
      image: 'fixture/alpine', status: 'running', cpu: quota.cpuAllowanceMax, memory: quota.memoryMax, disk: 30720, rootPassword: 'fixture-original' } })
    await stock(0, 'occupied host never returns to sale', true)
    await prisma.instance.deleteMany({ where: { hostId: host.id } })
    for (const phase of ['prepared', 'waiting-boot', 'restoring', 'blocked']) {
      await prisma.host.update({ where: { id: host.id }, data: { securityHardening: { ...verified, maintenance: { ...maintenance, phase, rebootIssued: phase !== 'prepared' } } } })
      await stock(0, phase + ' cannot release stock')
    }
    await prisma.host.update({ where: { id: host.id }, data: { securityHardening: verified } })
    const leaseToken = randomUUID(), nodeId = host.onboardingNode!.id
    await prisma.hostOnboardingNode.update({ where: { id: nodeId }, data: { status: 'running', step: 'hardening', leaseToken, leaseUntil: new Date(Date.now() + 60000), credentialsEncrypted: 'fixture-retained' } })
    await due(); await hardenExistingHost(host.id, deps, { nodeId, leaseToken })
    await stock(0, 'new enrollment requires completion of its original lease')
    await finishSecureOnboarding(nodeId, leaseToken, host.id)
    await stock(1, 'new enrollment with complete defense becomes saleable')
    assert.equal((await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { id: nodeId } })).credentialsEncrypted, null)
    active = false
    await prisma.host.update({ where: { id: host.id }, data: { securityHardening: { revision: SECURITY_HARDENING_REVISION, status: 'retry' } } })
    await hardenExistingHost(host.id, deps)
    if (architecture === 'aarch64') {
      await prepareAutomaticHostMaintenance(host.id, { ...hostMaintenanceDependencies, held: () => false,
        command: async () => { remoteWrites++; throw Error('unaccepted architecture must not dispatch') },
        connect: async () => { remoteWrites++; throw Error('unaccepted architecture must not connect') } })
      assert.equal((await state()).diagnostic.reason, 'HARDENING_NATIVE_ACCEPTANCE_REQUIRED')
      assert.equal((await state()).maintenance, undefined)
    }
    await stock(0, 'missing defense never becomes saleable through an architecture exception')
    const finalHost = await prisma.host.findUniqueOrThrow({ where: { id: host.id } })
    for (const key of ['cpuUsed', 'memoryUsed', 'diskUsed', 'natPublicIp', 'architecture', 'resourcePreset', 'serverCertificate', 'serverFingerprint'] as const)
      assert.equal(finalHost[key], host[key], key + ' unchanged by saleability checks')
    assert.equal(remoteWrites, 0); assert.ok(inspections >= 4)
    console.log(`PASS ${architecture}/${pageSize}: actual queue -> inventory/catalog/admin -> locked allocator; rollback reinspection, occupied protection, new enrollment, native gate`)
  }
} finally {
  await app.close()
  await prisma.log.deleteMany({ where: { userId: owner.id } })
  await prisma.instance.deleteMany({ where: { hostId: { in: hostIds } } })
  await prisma.host.deleteMany({ where: { id: { in: hostIds } } })
  await prisma.hostOnboardingBatch.delete({ where: { id: batch.id } })
  await prisma.hostMachineGroup.deleteMany({ where: { id: { in: groupIds } } })
  await prisma.package.deleteMany({ where: { userId: owner.id } })
  await prisma.user.delete({ where: { id: owner.id } })
  if (policy) await prisma.systemConfig.update({ where: { key: policy.key }, data: { value: policy.value } })
  else await prisma.systemConfig.deleteMany({ where: { key: SECURITY_HARDENING_ENABLED_KEY } })
  await closePrismaDatabase()
}
