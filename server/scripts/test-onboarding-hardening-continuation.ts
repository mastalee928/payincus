/** Real local PG schedulers, maintenance and sales gates; remote host/boot are fixtures. */
import assert from 'node:assert/strict'
import { randomUUID, randomInt } from 'node:crypto'
const database = new URL(process.env.DATABASE_URL || '')
assert.equal(database.hostname, '127.0.0.1')
assert.ok(database.pathname.endsWith('_pool_test'))
const interval = globalThis.setInterval
globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => interval(...args).unref()) as typeof setInterval
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { claimHostOnboardingNode, continueHostOnboardingHardening } = await import('../src/workers/hostOnboardingWorker.js')
const { hardenExistingHost, processSecurityHardeningQueue } = await import('../src/services/security-hardening-queue.js')
const { prepareAutomaticHostMaintenance, resumeAutomaticHostMaintenance, hostMaintenanceDependencies } = await import('../src/services/host-security-maintenance.js')
const { finishSecureOnboarding } = await import('../src/services/onboarding-security-gate.js')
const { hardeningIdentityHash } = await import('../src/lib/hardening-identity.js')
const { hardeningPublicView } = await import('../src/lib/hardening-view.js')
const { hostMaintenanceBlocked } = await import('../src/lib/host-maintenance-gate.js')
const { SECURITY_HARDENING_ENABLED_KEY, SECURITY_HARDENING_REVISION } = await import('../src/lib/security-hardening.js')
const { presetQuota } = await import('../src/lib/onboarding-resources.js')
const { selectAndReserveHostWithLock } = await import('../src/db/hosts.js')
const { poolInventory, publicPoolCatalog } = await import('../src/services/host-pool-prices.js')
globalThis.setInterval = interval

const prefix = 'onboarding-continuation-' + randomUUID().slice(0, 8)
const policy = await prisma.systemConfig.findUnique({ where: { key: SECURITY_HARDENING_ENABLED_KEY } })
const owner = await prisma.user.create({ data: { username: prefix, passwordHash: 'fixture', role: 'admin' } })
const batch = await prisma.hostOnboardingBatch.create({ data: { id: randomUUID(), name: prefix, accountLabel: prefix, createdById: owner.id, defaults: {} } })
const hosts: number[] = [], groups: number[] = []
type Remote = { architecture: 'x86_64' | 'aarch64'; bootId: string; originalBoot: string; phase: string; active: boolean; reboots: number; requests: string[]; commands: string[]; losePrepare: boolean; loseReboot: boolean }
const remotes = new Map<number, Remote>()
const state = async (id: number) => (await prisma.host.findUniqueOrThrow({ where: { id } })).securityHardening as any
const due = async (id: number) => prisma.host.update({ where: { id }, data: { securityHardening: { ...await state(id), nextCheckAt: new Date(0).toISOString() } } })
const preflight = (remote: Remote) => ({ architecture: remote.architecture, bootId: remote.bootId, pageSize: remote.architecture === 'aarch64' ? 65536 : 4096,
  memoryAvailableKiB: 400000, memoryPressure: 0, rootAvailableBytes: 1073741824, rootAvailableInodes: 4096, rootReadonly: false, packageBusy: false,
  apparmorKernelSupport: true, apparmorBootDisabled: !remote.active, apparmorActive: remote.active, bootloader: 'grub' as const })
const connect = async () => ({ request: async (method: string, path: string) => {
  assert.equal(method, 'GET', 'empty enrollment must not mutate a customer')
  if (path.startsWith('/1.0/operations')) return {}
  assert.ok(path.startsWith('/1.0/instances?')); return []
} } as any)
const inspect = async (host: any, guests: unknown[], _update: boolean, allowed: () => Promise<void>) => {
  await allowed(); assert.equal(guests.length, 0)
  const remote = remotes.get(host.id)!
  return { apparmor: remote.active, alpine: true, fixed: true, branch: '3.22', hostSshUpdated: false, guests: [], preflight: preflight(remote) }
}
const security = { held: () => false, connect, host: inspect, customer: async () => { throw Error('unexpected customer mutation') } }
const maintenance = { ...hostMaintenanceDependencies, held: () => false, connect, inspect, invalidate: async () => {},
  // Explicit fixture acceptance exercises ARM scheduling, never production native acceptance.
  accepted: (recipe: string, arch: string) => recipe === 'alpine-apparmor-grub-v1' && ['x86_64', 'aarch64'].includes(arch),
  command: async (host: any, operation: any) => {
    const r = remotes.get(host.id)!
    assert.equal(operation.identityHash, hardeningIdentityHash(host))
    r.commands.push(operation.action); r.requests.push(operation.requestId)
    if (operation.action === 'prepare') {
      r.phase = 'prepared'
      if (r.losePrepare) { r.losePrepare = false; throw Error('HARDENING_REMOTE_RESULT_UNKNOWN') }
    } else if (operation.action === 'rollback') {
      assert.equal(r.bootId, operation.bootId); assert.ok(['preparing', 'prepared'].includes(r.phase)); r.phase = 'rolled-back'
    } else if (operation.action === 'reboot') {
      assert.equal(r.bootId, operation.bootId)
      if (r.phase === 'prepared') { r.phase = 'reboot-intent'; r.reboots++ }
      if (r.loseReboot) { r.loseReboot = false; throw Error('HARDENING_REMOTE_RESULT_UNKNOWN') }
    } else if (operation.action === 'restore-customers') {
      assert.notEqual(r.bootId, operation.bootId); assert.ok(r.active); r.phase = 'customers-restored'
    } else assert.equal(operation.action, 'status')
    return { ...operation, nodeId: host.onboardingNode.id, prepareHash: 'c'.repeat(64), originalBootId: operation.bootId, bootId: r.bootId, phase: r.phase }
  } }
async function create(architecture: 'x86_64' | 'aarch64') {
  const resourcePreset = architecture === 'x86_64' ? 'E2' : 'ARM2C', quota = presetQuota(resourcePreset)
  const group = await prisma.hostMachineGroup.create({ data: { name: prefix + hosts.length } }); groups.push(group.id)
  const region = await prisma.hostRegionGroup.create({ data: { machineGroupId: group.id, name: prefix, countryCode: 'kr' } })
  const pkg = await prisma.package.create({ data: { userId: owner.id, name: prefix + hosts.length, hidden: true,
    cpuMax: quota.cpuAllowanceMax, memoryMax: quota.memoryMax, diskMax: 30720 } })
  const plan = await prisma.packagePlan.create({ data: { packageId: pkg.id, name: prefix, cpu: quota.cpuAllowanceMax, memory: quota.memoryMax, disk: 30720,
    portLimit: 0, snapshotLimit: 0, backupLimit: 0, siteLimit: 0, trafficLimit: 1024n, price: 100 } })
  const price = await prisma.hostPoolPrice.create({ data: { machineGroupId: group.id, regionGroupId: region.id, resourcePreset, diskGiB: 30, monthlyPrice: 100, shadowPlanId: plan.id } })
  let publicIp = ''
  do { publicIp = `198.18.${randomInt(1, 254)}.${randomInt(1, 254)}` }
  while (await prisma.hostOnboardingNode.findFirst({ where: { OR: [{ activePublicIp: publicIp }, { publicIp, deletedAt: null }] } }))
  const host = await prisma.host.create({ data: { userId: owner.id, name: prefix + hosts.length, url: 'https://127.0.0.1:1',
    architecture, resourcePreset, machineGroupId: group.id, regionGroupId: region.id, singleTenant: true, isInstalled: true, status: 'online',
    customerDiskGiB: 30, storageSize: 38, cpuAllowanceMax: quota.cpuAllowanceMax, memoryMax: quota.memoryMax,
    certPath: 'fixture.crt', keyPath: 'fixture.key', serverCertificate: 'fixture-original-cert', serverFingerprint: 'fixture-original-pin',
    managementSshHost: '127.0.0.1', managementSshPort: 22, managementSshUser: 'root', natPublicIp: publicIp, natPortStart: 1, natPortEnd: 65535,
    onboardingNode: { create: { batchId: batch.id, name: prefix + hosts.length, publicIp, managementIp: '127.0.0.1', sshPort: 22,
      sshFingerprint: 'SHA256:fixture-original', nodePublicKey: 'A'.repeat(43) + '=', status: 'queued', step: 'hardening', credentialsExpireAt: new Date(0) } }
  }, include: { onboardingNode: { include: { batch: true } } } }); hosts.push(host.id)
  await prisma.storagePool.create({ data: { hostId: host.id, name: 'fixture', driver: 'btrfs', purpose: 'instance_data' } })
  await prisma.hostAgent.create({ data: { hostId: host.id, agentId: randomUUID(), secretHash: 'fixture', secretEncrypted: 'fixture', enabled: true, lastSeenAt: new Date(), capabilities:['guest-network-protection-v1'],lastReport:{guestProtectionStatus:{applied:true,checkedAt:new Date().toISOString()}} } })
  const bootId = randomUUID()
  remotes.set(host.id, { architecture, bootId, originalBoot: bootId, phase: 'preparing', active: false, reboots: 0, commands: [], requests: [], losePrepare: false, loseReboot: false })
  await prisma.host.update({ where: { id: host.id }, data: { securityHardening: { revision: SECURITY_HARDENING_REVISION, status: 'retry', nextCheckAt: new Date(0).toISOString() } } })
  const stock = async (expected: number) => {
    assert.equal((await poolInventory()).find(row => row.machineGroupId === group.id)?.idle, expected, 'actual inventory')
    assert.equal((await publicPoolCatalog()).regions.flatMap(row => row.products).find(row => row.id === price.id)?.idle, expected, 'public product stock')
    const selected = await prisma.$transaction(tx => selectAndReserveHostWithLock(tx, { reservationOnly: true, hostId: host.id,
      poolMachineGroupId: group.id, poolRegionGroupId: region.id, poolResourcePreset: resourcePreset, poolDiskGiB: 30,
      cpu: quota.cpuAllowanceMax, memory: quota.memoryMax, disk: 30720 }))
    assert.equal(selected?.id ?? null, expected ? host.id : null, 'actual locked sales allocator')
  }
  return { ...host, stock }
}
async function cycle(id: number) {
  const node = await claimHostOnboardingNode()
  assert.equal(node?.hostId, id, 'the durable maintenance owner must be claimed first')
  const lease = { nodeId: node!.id, leaseToken: node!.leaseToken! }
  try {
    await continueHostOnboardingHardening(node!.id, lease.leaseToken, id, () => false, {
      resume: (hostId, _deps, enrollment) => resumeAutomaticHostMaintenance(hostId, maintenance, enrollment),
      harden: (hostId, _deps, enrollment) => hardenExistingHost(hostId, security, enrollment),
      prepare: (hostId, _deps, enrollment) => prepareAutomaticHostMaintenance(hostId, maintenance, enrollment),
      finish: finishSecureOnboarding
    })
  } catch (error) {
    assert.match(String(error), /HARDENING_/)
    await prisma.hostOnboardingNode.updateMany({ where: { id: node!.id, leaseToken: lease.leaseToken }, data: {
      status: 'queued', errorCode: (error as Error).message, leaseToken: null, leaseUntil: null } })
  }
}
try {
  assert.equal(await prisma.hostOnboardingNode.count({ where: { deletedAt: null, status: { in: ['queued', 'running'] } } }), 0, 'isolated DB must have no active onboarding')
  await prisma.systemConfig.upsert({ where: { key: SECURITY_HARDENING_ENABLED_KEY }, update: { value: 'true' }, create: { key: SECURITY_HARDENING_ENABLED_KEY, value: 'true' } })
  const second = await create('aarch64'), first = await create('x86_64')
  const originalRequest = randomUUID(), remote = remotes.get(first.id)!
  // Exact old failure shape: queued without lease, expired preparation, unchanged identity, no reboot.
  await prisma.host.update({ where: { id: first.id }, data: { securityHardening: {
    revision: SECURITY_HARDENING_REVISION, status: 'retry', identityHash: hardeningIdentityHash(first), nextCheckAt: new Date(0).toISOString(),
    environment: preflight(remote), host: { preflight: { status: 'verified' }, ssh: { status: 'verified' }, apparmor: { status: 'needs-maintenance' } },
    diagnostic: { phase: 'host-inspection', reason: 'HARDENING_APPARMOR_REQUIRED', action: 'blocked' },
    maintenance: { revision: 'host-maintenance-v1', requestId: originalRequest, identityHash: hardeningIdentityHash(first),
      bootId: remote.originalBoot, prepareHash: 'c'.repeat(64), recipe: 'alpine-apparmor-grub-v1', architecture: 'x86_64',
      phase: 'blocked', error: 'HARDENING_IDENTITY_MISSING', rebootIssued: false, startedAt: new Date(Date.now() - 25 * 60000).toISOString(),
      deadline: new Date(Date.now() - 5 * 60000).toISOString(), customers: [] }
  } } })
  const before = await state(first.id)
  for (let i = 0; i < 3; i++) await processSecurityHardeningQueue(security, () => false, { resume: id => resumeAutomaticHostMaintenance(id, maintenance) })
  await hardenExistingHost(first.id, security)
  await prepareAutomaticHostMaintenance(first.id, maintenance)
  await resumeAutomaticHostMaintenance(first.id, maintenance)
  assert.deepEqual(await state(first.id), before, 'ordinary sweeps must not replace enrollment authority or continually postpone its due time')
  assert.equal(remote.commands.length, 0)
  console.log('PASS queued expired enrollment is not hijacked or postponed by periodic inspection')
  const view = hardeningPublicView(before)
  assert.equal(view.status, 'needs-maintenance', 'blocked is not advertised as active automatic retry')
  assert.equal(view.diagnostic?.reason, 'HARDENING_IDENTITY_MISSING', 'current maintenance failure supersedes the old initial AppArmor diagnosis')
  await first.stock(0); await second.stock(0)
  await cycle(first.id)
  assert.equal(remote.commands[0], 'status'); assert.equal(remote.commands[1], 'rollback')
  assert.equal((await state(first.id)).maintenance.requestId, originalRequest)
  assert.equal((await state(first.id)).maintenance.preparationRetries, 1)
  assert.equal(remote.reboots, 1)
  assert.equal((await state(first.id)).maintenance.phase, 'waiting-boot')
  await first.stock(0)
  // A lost process lease cannot be reused; the valid newly claimed owner proceeds.
  await due(first.id)
  const lost = await claimHostOnboardingNode()
  assert.equal(lost?.hostId, first.id)
  assert.equal(await claimHostOnboardingNode().then(node => node?.id === lost?.id), false)
  await prisma.hostOnboardingNode.update({ where: { id: lost!.id }, data: { leaseUntil: new Date(Date.now() - 60000) } })
  const recovered = await claimHostOnboardingNode()
  assert.equal(recovered?.id, lost!.id); assert.notEqual(recovered?.leaseToken, lost!.leaseToken)
  const commandsBefore = remote.commands.length
  const beforeStale = await state(first.id)
  await resumeAutomaticHostMaintenance(first.id, maintenance, { nodeId: lost!.id, leaseToken: lost!.leaseToken! })
  await hardenExistingHost(first.id, security, { nodeId: lost!.id, leaseToken: lost!.leaseToken! })
  await prepareAutomaticHostMaintenance(first.id, maintenance, { nodeId: lost!.id, leaseToken: lost!.leaseToken! })
  assert.equal(remote.commands.length, commandsBefore, 'stale execution has no remote authority')
  assert.deepEqual(await state(first.id), beforeStale, 'stale worker cannot corrupt the new owner schedule')
  await prisma.hostOnboardingNode.update({ where: { id: recovered!.id }, data: { status: 'queued', leaseToken: null, leaseUntil: null } })
  // Any second slot claimed above is returned to the queue like an interrupted worker.
  await prisma.hostOnboardingNode.updateMany({ where: { batchId: batch.id, status: 'running' }, data: { status: 'queued', leaseToken: null, leaseUntil: null } })
  remote.active = true; remote.bootId = randomUUID()
  await prisma.hostAgent.update({ where: { hostId: first.id }, data: { lastSeenAt: new Date(), lastReport: { metrics: { bootId: remote.bootId },guestProtectionStatus:{applied:true,checkedAt:new Date().toISOString()} } } })
  await due(first.id); await cycle(first.id)
  assert.equal((await state(first.id)).status, 'verified'); assert.equal((await state(first.id)).maintenance.phase, 'verified')
  assert.equal((await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { hostId: first.id } })).status, 'succeeded')
  assert.equal(remote.reboots, 1); assert.equal(new Set(remote.requests).size, 1)
  await first.stock(1)
  console.log('PASS original expired request -> checked rollback -> bounded retry -> one reboot -> full receipt -> saleable inventory and allocation')
  await due(second.id); await cycle(second.id)
  assert.equal(remotes.get(second.id)!.reboots, 1, 'next enrollment advances after the first completes')
  const r2 = remotes.get(second.id)!
  r2.active = true; r2.bootId = randomUUID()
  await prisma.hostAgent.update({ where: { hostId: second.id }, data: { lastSeenAt: new Date(), lastReport: { metrics: { bootId: r2.bootId },guestProtectionStatus:{applied:true,checkedAt:new Date().toISOString()} } } })
  await due(second.id); await cycle(second.id)
  await second.stock(1); await first.stock(1)
  assert.equal(hostMaintenanceBlocked(await state(second.id)), false)
  console.log('PASS AMD64/ARM64 independent boot fixtures complete sequentially; production native acceptance is unchanged')

  // Crash after full hardening but before finish: a 24h health interval is not
  // an enrollment completion interval. Test both fresh and 31s-old queue times.
  const healthyReceipt = await state(first.id)
  await prisma.hostOnboardingNode.update({ where: { hostId: first.id }, data: { status: 'queued', step: 'hardening', completedAt: null } })
  assert.equal(await claimHostOnboardingNode(), null, 'fresh completion failure must not hot-loop every worker tick')
  await prisma.hostOnboardingNode.update({ where: { hostId: first.id }, data: { updatedAt: new Date(Date.now() - 31000) } })
  // An unrelated recent host update must not keep postponing the node.
  await prisma.host.update({ where: { id: first.id }, data: { status: 'online' } })
  await first.stock(0)
  await cycle(first.id)
  assert.deepEqual(await state(first.id), healthyReceipt, 'completion consumes current proof without redoing a healthy host inspection')
  await first.stock(1)
  assert.equal(remote.reboots, 1)
  console.log('PASS crash between full proof and enrollment finish resumes after 30s, not the 24h inspection interval')
  // A FAILED rebuild may still own a source/target even if the customer row
  // is deleted. Onboarding must agree with inventory about that occupancy.
  for (const target of [first, second]) {
    const customer = await prisma.instance.create({ data: { userId: owner.id, hostId: target.id, name: prefix + '-deleted', incusId: randomUUID(),
      image: 'alpine/3.22', status: 'deleted', cpu: 100, memory: 256, disk: 10240 } })
    const task = await prisma.instanceTask.create({ data: { userId: owner.id, hostId: target.id, instanceId: customer.id, taskType: 'recreate', status: 'FAILED',
      replacementState: { targetPhase: 'cleanup_pending', sourceHostId: target.id } } })
    const node = await prisma.hostOnboardingNode.update({ where: { hostId: target.id }, data: { status: 'running', step: 'hardening',
      leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 60000), errorCode: 'HARDENING_BUSY' } })
    await assert.rejects(finishSecureOnboarding(node.id, node.leaseToken!, target.id), /HARDENING_BUSY/)
    assert.equal((await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { id: node.id } })).status, 'running')
    await target.stock(0)
    await prisma.instanceTask.update({ where: { id: task.id }, data: { status: 'COMPLETED', replacementState: { targetPhase: 'cleaned' } } })
    let delayedCompletion: Promise<unknown> | undefined
    const completionDeadline = Date.now() + 2000
    await prisma.hostOnboardingNode.update({ where: { id: node.id }, data: { leaseUntil: new Date(completionDeadline) } })
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${owner.id} FOR UPDATE`
      delayedCompletion = assert.rejects(finishSecureOnboarding(node.id, node.leaseToken!, target.id), /WORKER_INTERRUPTED/)
      let authorityBlocked = false
      for (let attempt = 0; attempt < 30; attempt++) {
        const waiting = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE '%users%FOR SHARE'`
        if (Number(waiting[0].count) > 0) { authorityBlocked = true; break }
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      assert.equal(authorityBlocked, true, 'completion passed its initial lease check and waited for current authority')
      await new Promise(resolve => setTimeout(resolve, Math.max(0, completionDeadline - Date.now() + 50)))
    })
    await delayedCompletion
    assert.equal((await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { id: node.id } })).status, 'running', 'lease expiry while waiting for authority cannot publish completion')
    await prisma.hostOnboardingNode.update({ where: { id: node.id }, data: { leaseUntil: new Date(Date.now() + 60000) } })
    await finishSecureOnboarding(node.id, node.leaseToken!, target.id)
    const completed = await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { id: node.id } })
    assert.equal(completed.status, 'succeeded'); assert.equal(completed.errorCode, null)
    await target.stock(1)
    await prisma.instance.delete({ where: { id: customer.id } })
  }
  console.log('PASS both architectures reject FAILED cleanup occupancy and expired completion leases; finish after cleanup receipt and clear stale errors')
} finally {
  await prisma.log.deleteMany({ where: { userId: owner.id } })
  await prisma.host.deleteMany({ where: { id: { in: hosts } } })
  await prisma.hostOnboardingBatch.delete({ where: { id: batch.id } })
  await prisma.hostMachineGroup.deleteMany({ where: { id: { in: groups } } })
  await prisma.package.deleteMany({ where: { userId: owner.id } })
  await prisma.user.delete({ where: { id: owner.id } })
  if (policy) await prisma.systemConfig.update({ where: { key: policy.key }, data: { value: policy.value } })
  else await prisma.systemConfig.deleteMany({ where: { key: SECURITY_HARDENING_ENABLED_KEY } })
  await closePrismaDatabase()
}
