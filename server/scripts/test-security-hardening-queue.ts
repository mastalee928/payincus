import { protectedAgentFixture } from './fixtures/guest-protection.js'
import assert from 'node:assert/strict'
import { randomUUID, randomInt, createHash } from 'node:crypto'
import Fastify from 'fastify'
import { Prisma } from '@prisma/client'
import type { AutomaticSshTarget } from '../src/services/alpine-ssh-maintenance.js'
const url = new URL(process.env.DATABASE_URL || '')
assert.equal(url.hostname, '127.0.0.1')
assert.ok(url.pathname.endsWith('_pool_test'))
process.env.ENCRYPTION_KEY = 'security-hardening-isolated-fixture'
const originalSetInterval=globalThis.setInterval
globalThis.setInterval=((...args:Parameters<typeof setInterval>)=>originalSetInterval(...args).unref()) as typeof setInterval
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { hardenExistingHost,processSecurityHardeningQueue } = await import('../src/services/security-hardening-queue.js')
const { maintainAlpineCustomerSsh } = await import('../src/services/alpine-ssh-maintenance.js')
const { encryptSensitiveData } = await import('../src/lib/security.js')
const { SECURITY_HARDENING_ENABLED_KEY, SECURITY_HARDENING_REVISION } = await import('../src/lib/security-hardening.js')
const { default: routes } = await import('../src/routes/security-hardening.js')
const { finishSecureOnboarding } = await import('../src/services/onboarding-security-gate.js')
const { dedicatedHostReadyWhere } = await import('../src/lib/host-resource-usage.js')
const { assertHostNotMaintaining, HostMaintenanceError } = await import('../src/lib/host-maintenance-gate.js')
const { INSTANCE_OPERATION_LOCK_NAMESPACE } = await import('../src/db/advisory-locks.js')
globalThis.setInterval=originalSetInterval
const prefix = `hardening-${randomUUID().slice(0, 8)}`
const originalPolicy = await prisma.systemConfig.findUnique({ where: { key: SECURITY_HARDENING_ENABLED_KEY } })
await prisma.systemConfig.upsert({ where: { key: SECURITY_HARDENING_ENABLED_KEY }, update: { value: 'true' }, create: { key: SECURITY_HARDENING_ENABLED_KEY, value: 'true' } })
const admin = await prisma.user.create({ data: { username: prefix + '-admin', passwordHash: 'fixture', role: 'admin' } })
const buyer = await prisma.user.create({ data: { username: prefix + '-buyer', passwordHash: 'fixture', balance: 71 } })
const batch = await prisma.hostOnboardingBatch.create({ data: { id: randomUUID(), name: prefix, createdById: admin.id, accountLabel: prefix, defaults: {} } })
const ip = `192.0.2.${randomInt(24, 220)}`, managementIp = `10.253.211.${randomInt(24, 220)}`
const host = await prisma.host.create({ data: { userId: admin.id, name: prefix, url: `https://${managementIp}:8443`,
  isInstalled: true, singleTenant: true, status: 'online', natPublicIp: ip, managementSshHost: managementIp,
  managementSshPort: 22, managementSshUser: 'root', serverCertificate: 'fixture-pinned-certificate', serverFingerprint: 'fixture-fingerprint',
  cpuAllowanceMax: 200, memoryMax: 768, customerDiskGiB: 30,
  onboardingNode: { create: { batchId: batch.id, name: prefix, publicIp: ip, managementIp,
    sshPort: 22, sshFingerprint: 'SHA256:original', nodePublicKey: 'A'.repeat(43) + '=', status: 'succeeded', credentialsExpireAt: new Date(0) } } } })
const uuid = randomUUID(), attempt = randomUUID()
const instance = await prisma.instance.create({ data: { userId: buyer.id, hostId: host.id, name: prefix, incusId: prefix,
  status: 'running', image: 'images:alpine/3.22/cloud', dedicatedIpv4: true, dedicatedNetworkReady: true,
  cpu: 100, memory: 256, disk: 1024, rootPassword: 'opaque-original-password', ipv4: '10.10.0.2', billingPrice: 9, expiresAt: new Date('2030-01-01'),
  snapshottedSpecs: { kept: 'original', managedCleanup: { uuid, attempt, endpointHash: createHash('sha256').update(host.url).digest('hex') } } } })
let guestWrites = 0, hostCalls = 0, connections = 0, failCustomer = false, unsafe = false, runtimeUnsafe = false, apparmor = false, held = false, changed = false, vm = false
const preflight = { architecture: 'aarch64', bootId: uuid, pageSize: 65536, memoryAvailableKiB: 262144, memoryPressure: 0,
  rootAvailableBytes: 268435456, rootAvailableInodes: 1024, rootReadonly: false, packageBusy: false,
  apparmorKernelSupport:true,apparmorBootDisabled:false,apparmorActive:false,bootloader:'grub' as const }
let allowHostUpdate = false
let mutateAfterCustomer = false
let releaseHost: (() => void) | undefined, hostEntered: (() => void) | undefined
const client = { baseUrl: host.url, request: async (method: string, path: string) => {
  assert.equal(method, 'GET', 'Inspection makes no Incus mutation')
  if (path === '/1.0/networks/incusbr0') return { config: { 'user.payincus.guest-guard': `v1:${'a'.repeat(64)}:${Date.now()}` } }
  if (path.startsWith('/1.0/instances?')) return [{ name: prefix, project: 'default' }]
  if (path.endsWith('/state')) return { pid: 100, status: 'Running' }
  return { name: prefix, type: vm ? 'virtual-machine' : 'container', profiles: [], config: { 'volatile.uuid': changed ? randomUUID() : uuid,
    'security.privileged': unsafe ? 'true' : 'false', 'user.payincus.provisioning-attempt': attempt }, devices: { root: { type: 'disk', path: '/', pool: 'fixture' } } }
} } as any
const deps = {
  held: () => held,
  connect: async () => { connections++; return client },
  host: async (_target: unknown, guests: Array<{ instanceId: number; pid: number }>, allowUpdate: boolean, allowed: () => Promise<void>) => {
    hostCalls++; allowHostUpdate = allowUpdate; if (allowUpdate) await allowed()
    if (hostEntered) { hostEntered(); await new Promise<void>(resolve => { releaseHost = resolve }); hostEntered = undefined }
    return { alpine: true, fixed: true, branch: '3.22', apparmor, hostSshUpdated: false, preflight,
      guests: guests.map(guest => ({ ...guest, uidMap: runtimeUnsafe ? '0 0 65536' : '0 1000000 1000000000', gidMap: '0 1000000 1000000000', seccomp: 2, apparmor: apparmor ? 'incus-fixture (enforce)' : 'unconfined' })) }
  },
  customer: async (id: number, actorId: number, _deps?: unknown, _session?: unknown, automatic?: boolean, expected?: AutomaticSshTarget) => {
    assert.equal(id, instance.id); assert.equal(actorId, admin.id); assert.equal(automatic, true)
    assert.equal(expected?.hostId, host.id); assert.equal(expected?.uuid, uuid); assert.equal(expected?.attempt, attempt)
    if (failCustomer) throw new Error('ALPINE_SSH_UPDATE_FAILED')
    if (expected?.inspectOnly) return { instanceId:id,status:'already-fixed' as const,passwordLoginPreserved:true as const }
    if (mutateAfterCustomer) await prisma.instance.update({ where: { id }, data: { snapshottedSpecs: { ...(instance.snapshottedSpecs as object), managedCleanup: { uuid: randomUUID(), attempt, endpointHash: expected!.endpointHash } } } })
    guestWrites++; return { instanceId: id, status: 'verified' as const, passwordLoginPreserved: true as const }
  }
}
const state = async () => (await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).securityHardening as any
const due = async () => { await prisma.host.update({ where: { id: host.id }, data: { securityHardening: { revision: SECURITY_HARDENING_REVISION, nextCheckAt: new Date(0).toISOString() } } }) }
try {
  await hardenExistingHost(host.id, deps)
  assert.equal((await state()).status, 'needs-maintenance')
  assert.equal((await state()).host.apparmor.reason, 'HARDENING_APPARMOR_REQUIRED')
  assert.equal((await state()).instances[0].ssh.status, 'verified')
  assert.equal(guestWrites, 1)
  await hardenExistingHost(host.id, deps); assert.equal(guestWrites, 1, 'recent receipt prevents duplicate work')
  for (const [change,reason] of [[{status:'offline'},'HARDENING_OFFLINE'], [{poolFaulted:true},'HARDENING_HOST_QUARANTINED'],
    [{publicIpSyncBlocked:true},'HARDENING_PUBLIC_IP_PENDING'], [{installPending:true},'HARDENING_INSTALL_PENDING']] as const) {
    const before={connections,hostCalls,guestWrites}
    await due(); await prisma.host.update({where:{id:host.id},data:change}); await hardenExistingHost(host.id,deps)
    assert.equal((await state()).diagnostic.reason,reason)
    assert.equal((await state()).diagnostic.phase,'authority')
    assert.equal((await state()).diagnostic.action,'wait')
    assert.deepEqual({connections,hostCalls,guestWrites},before,'waiting fences prohibit all remote actions')
    await prisma.host.update({where:{id:host.id},data:{status:'online',poolFaulted:false,publicIpSyncBlocked:false,installPending:false}})
  }
  await due(); apparmor = true; failCustomer = true
  await hardenExistingHost(host.id, deps)
  assert.equal((await state()).status, 'retry'); assert.equal((await state()).instances[0].ssh.reason, 'ALPINE_SSH_UPDATE_FAILED')
  await due(); failCustomer = false; await hardenExistingHost(host.id, deps)
  assert.equal((await state()).status, 'verified'); assert.ok(!(await state()).leaseToken)
  assert.equal((await state()).phase,'finished'); assert.equal((await state()).environment.architecture,'aarch64')
  const order = await prisma.poolOrder.create({ data: { id: randomUUID(), userId: buyer.id, requestHash: prefix, totalCents: 900 } })
  const admission = { ...await state(), nextCheckAt: new Date(0).toISOString() }
  await prisma.host.update({ where: { id: host.id }, data: { securityHardening: admission } })
  await prisma.instance.update({ where: { id: instance.id }, data: { status: 'creating', purchaseBatchId: order.id } })
  const beforeDelivery = { connections, hostCalls, guestWrites }
  await hardenExistingHost(host.id, deps)
  assert.deepEqual(await state(), admission, 'periodic hardening must not invalidate the receipt of an in-flight pool delivery')
  assert.deepEqual({ connections, hostCalls, guestWrites }, beforeDelivery)
  await prisma.instance.update({ where: { id: instance.id }, data: { status: 'running', purchaseBatchId: null } })
  await prisma.poolOrder.delete({ where: { id: order.id } })
  await hardenExistingHost(host.id, deps)
  assert.equal((await state()).status, 'verified')
  assert.ok(hostCalls > beforeDelivery.hostCalls, 'the due check resumes naturally after delivery')
  await prisma.host.update({ where: { id:host.id },data:{ securityHardening:{ revision:SECURITY_HARDENING_REVISION,
    phase:'host-inspection',status:'retry',leaseToken:randomUUID(),nextCheckAt:new Date(0).toISOString() } } })
  await hardenExistingHost(host.id,deps)
  assert.equal(allowHostUpdate,false,'interrupted lease performs a read-only host pass before further writes')
  assert.equal((await state()).status,'verified')
  const beforeMaintenance=await state(),maintenanceIntent={revision:'host-maintenance-v1',requestId:randomUUID(),phase:'waiting-boot'}
  await prisma.host.update({where:{id:host.id},data:{securityHardening:{...beforeMaintenance,maintenance:maintenanceIntent,nextCheckAt:new Date(0).toISOString()}}})
  await assert.rejects(assertHostNotMaintaining(host.id),HostMaintenanceError)
  const writesBeforeMaintenance=guestWrites
  await hardenExistingHost(host.id,deps)
  assert.deepEqual((await state()).maintenance,maintenanceIntent,'queue preserves unfinished maintenance across retries')
  assert.equal(guestWrites,writesBeforeMaintenance)
  const maintenanceStartedAt=Date.now()
  const validMaintenance={revision:'host-maintenance-v1',requestId:randomUUID(),identityHash:'a'.repeat(64),bootId:uuid,
    prepareHash:'b'.repeat(64),recipe:'alpine-apparmor-grub-v1',architecture:'x86_64',phase:'waiting-boot',rebootIssued:true,
    startedAt:new Date(maintenanceStartedAt).toISOString(),deadline:new Date(maintenanceStartedAt+20*60000).toISOString(),customers:[]}
  await prisma.host.update({where:{id:host.id},data:{securityHardening:{...beforeMaintenance,maintenance:validMaintenance,nextCheckAt:new Date(0).toISOString()}}})
  const resumed:number[]=[],beforePriority={connections,hostCalls,guestWrites}
  await processSecurityHardeningQueue(deps,()=>false,{resume:async id=>{resumed.push(id)}})
  assert.deepEqual(resumed,[host.id],'due durable maintenance resumes before scanning later inventory')
  assert.deepEqual({connections,hostCalls,guestWrites},beforePriority,'active maintenance does not spend its deadline inspecting other hosts')
  await prisma.host.update({where:{id:host.id},data:{securityHardening:{...beforeMaintenance,maintenance:validMaintenance,nextCheckAt:new Date(Date.now()+30000).toISOString()}}})
  await processSecurityHardeningQueue(deps,()=>false,{resume:async id=>{resumed.push(id)}})
  assert.deepEqual(resumed,[host.id],'waiting maintenance retains the batch fence without early resumption or scans')
  assert.deepEqual({connections,hostCalls,guestWrites},beforePriority)
  await prisma.host.update({where:{id:host.id},data:{securityHardening:{...beforeMaintenance,status:'retry',maintenance:{...validMaintenance,phase:'verified'},nextCheckAt:new Date(0).toISOString()}}})
  await processSecurityHardeningQueue(deps,()=>false,{resume:async id=>{resumed.push(id)}})
  assert.equal((await state()).status,'verified','completed recovery receives its full inspection before another host starts')
  assert.equal((await state()).maintenance.phase,'verified')
  assert.equal(connections,beforePriority.connections+1)
  assert.deepEqual(resumed,[host.id],'terminal proof is inspected rather than rebooted or resumed again')
  await prisma.host.update({where:{id:host.id},data:{securityHardening:beforeMaintenance}})
  const beforeResource = guestWrites
  await due(); preflight.memoryAvailableKiB = 1; await hardenExistingHost(host.id,deps)
  assert.equal((await state()).diagnostic.reason,'HARDENING_MEMORY_LOW'); assert.equal(guestWrites,beforeResource)
  preflight.memoryAvailableKiB = 262144
  await due(); vm = true; await hardenExistingHost(host.id,deps)
  assert.equal((await state()).instances[0].isolation.reason,'HARDENING_VM_RUNTIME_UNVERIFIED')
  assert.equal(guestWrites,beforeResource); assert.equal(allowHostUpdate,false); vm = false
  const beforeUnsafe = guestWrites
  await due(); unsafe = true; await hardenExistingHost(host.id, deps)
  assert.equal((await state()).status, 'needs-maintenance'); assert.equal(guestWrites, beforeUnsafe)
  assert.equal((await state()).instances[0].isolation.reason, 'CUSTOMER_PRIVILEGE_FORBIDDEN')
  assert.equal(allowHostUpdate, false)
  unsafe = false; runtimeUnsafe = true; await due(); await hardenExistingHost(host.id, deps)
  assert.equal((await state()).instances[0].isolation.reason, 'HARDENING_GUEST_RUNTIME_UNSAFE'); assert.equal(guestWrites, beforeUnsafe)
  runtimeUnsafe = false
  unsafe = false; await due(); changed = true; await hardenExistingHost(host.id, deps)
  assert.equal((await state()).status, 'needs-maintenance'); assert.equal(guestWrites, beforeUnsafe)
  changed = false; await due()
  const task = await prisma.instanceTask.create({ data: { instanceId: instance.id, hostId: host.id, userId: buyer.id, taskType: 'stop', status: 'PENDING' } })
  const calls = hostCalls
  await hardenExistingHost(host.id, deps); assert.equal((await state()).error, 'HARDENING_BUSY'); assert.equal(hostCalls, calls)
  await prisma.instanceTask.delete({ where: { id: task.id } })
  await prisma.host.update({ where: { id: host.id }, data: { securityHardening: { revision: 'customer-hardening-v1',
    status: 'retry', error: 'HARDENING_BUSY', updateAttempts: 6, nextCheckAt: new Date(0).toISOString() } } })
  const writesBeforeRevision = guestWrites
  apparmor=false
  await hardenExistingHost(host.id, deps)
  assert.equal((await state()).error,'HARDENING_RETRY_EXHAUSTED')
  assert.equal(guestWrites,writesBeforeRevision,'revision/temporary waits do not renew an exhausted write budget')
  apparmor=true
  await due(); held = true; await hardenExistingHost(host.id, deps)
  assert.equal((await state()).nextCheckAt, new Date(0).toISOString()); held = false
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
  await hardenExistingHost(host.id, deps); assert.equal((await state()).error, 'HARDENING_ADMIN_REQUIRED'); assert.equal(guestWrites, beforeUnsafe)
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
  await due(); await prisma.systemConfig.update({ where: { key: SECURITY_HARDENING_ENABLED_KEY }, data: { value: 'false' } })
  const beforeDisabled = connections
  await hardenExistingHost(host.id, deps); assert.equal((await state()).error, 'HARDENING_DISABLED'); assert.equal(connections, beforeDisabled)
  await prisma.systemConfig.update({ where: { key: SECURITY_HARDENING_ENABLED_KEY }, data: { value: 'true' } })
  await due()
  let ready!: () => void, release!: () => void
  const locked = new Promise<void>(resolve => { ready = resolve }), gate = new Promise<void>(resolve => { release = resolve })
  const blocker = prisma.$transaction(async tx => { await tx.$queryRaw`SELECT pg_advisory_xact_lock(${INSTANCE_OPERATION_LOCK_NAMESPACE}, ${instance.id})::text`; ready(); await gate })
  await locked; await hardenExistingHost(host.id, deps); release(); await blocker
  assert.equal((await state()).error, 'HARDENING_BUSY')
  await due()
  const entered = new Promise<void>(resolve => { hostEntered = resolve })
  const first = hardenExistingHost(host.id, deps); await entered
  const second = hardenExistingHost(host.id, deps)
  releaseHost!(); await Promise.all([first, second])
  assert.equal((await state()).status, 'verified', 'two claims share one lease and do not overwrite final receipt')
  await due()
  let releaseReceipt!:()=>void
  let receiptBlocker!:Promise<void>
  const receiptGate=new Promise<void>(resolve=>{releaseReceipt=resolve})
  const beforeReceiptWrites=guestWrites
  try {
    await hardenExistingHost(host.id,{...deps,customer:async(...args:Parameters<typeof deps.customer>)=>{
      const result=await deps.customer(...args)
      let entered!:()=>void
      const acquired=new Promise<void>(resolve=>{entered=resolve})
      receiptBlocker=prisma.$transaction(async tx=>{
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${INSTANCE_OPERATION_LOCK_NAMESPACE}, ${instance.id})::text`
        entered();await receiptGate
      },{timeout:15000})
      await acquired
      return result
    }})
    const pendingReceipt=await state()
    assert.equal(pendingReceipt.status,'retry','a concurrent lifecycle owner prevents granting verified status')
    assert.equal(pendingReceipt.phase,'receipt','receipt contention is durably distinguished from unfinished SSH work')
    assert.equal(pendingReceipt.diagnostic.reason,'HARDENING_BUSY')
    assert.ok(pendingReceipt.leaseToken,'unknown final result retains the read-only recovery fence')
    assert.ok(Date.parse(pendingReceipt.nextCheckAt)>Date.now()&&Date.parse(pendingReceipt.nextCheckAt)<=Date.now()+40000,'receipt contention retries promptly rather than leaving the ten-minute claim')
    assert.equal(guestWrites,beforeReceiptWrites+1)
  }finally{releaseReceipt();await receiptBlocker}
  await prisma.host.update({where:{id:host.id},data:{securityHardening:{...await state(),nextCheckAt:new Date(0).toISOString()}}})
  await hardenExistingHost(host.id,deps)
  assert.equal((await state()).status,'verified')
  assert.equal(guestWrites,beforeReceiptWrites+1,'receipt contention recovers by inspection without repeating the customer update')
  await due()
  let transientBlocker!:Promise<void>
  await hardenExistingHost(host.id,{...deps,customer:async(...args:Parameters<typeof deps.customer>)=>{
    const result=await deps.customer(...args)
    let acquired!:()=>void
    const entered=new Promise<void>(resolve=>{acquired=resolve})
    transientBlocker=prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${INSTANCE_OPERATION_LOCK_NAMESPACE}, ${instance.id})::text`
      acquired();await new Promise(resolve=>setTimeout(resolve,250))
    },{timeout:5000})
    await entered
    return result
  }})
  await transientBlocker
  assert.equal((await state()).status,'verified','a short real traffic/lifecycle lane conflict is awaited within the final receipt budget')
  assert.ok(!(await state()).leaseToken)
  for (const [change, reason] of [[{ status: 'offline' }, 'HARDENING_OFFLINE'],
    [{ installPending: true }, 'HARDENING_INSTALL_PENDING']] as const) {
    await due()
    await hardenExistingHost(host.id, { ...deps, customer: async (...args: Parameters<typeof deps.customer>) => {
      const result = await deps.customer(...args)
      await prisma.host.update({ where: { id: host.id }, data: change })
      return result
    } })
    assert.notEqual((await state()).status, 'verified', 'new host readiness invalidates the previous successful probe')
    assert.equal((await state()).diagnostic.reason, reason)
    await prisma.host.update({ where: { id: host.id }, data: { status: 'online', installPending: false } })
  }
  await due()
  await hardenExistingHost(host.id, { ...deps, customer: async (...args: Parameters<typeof deps.customer>) => {
    const result = await deps.customer(...args)
    await prisma.systemConfig.update({ where: { key: SECURITY_HARDENING_ENABLED_KEY }, data: { value: 'false' } })
    return result
  } })
  assert.notEqual((await state()).status, 'verified', 'policy revocation before receipt cannot grant success')
  assert.equal((await state()).diagnostic.reason, 'HARDENING_DISABLED')
  await prisma.systemConfig.update({ where: { key: SECURITY_HARDENING_ENABLED_KEY }, data: { value: 'true' } })
  await due()
  const concurrentMaintenance = { ...validMaintenance, phase: 'waiting-boot' }
  await hardenExistingHost(host.id, { ...deps, customer: async (...args: Parameters<typeof deps.customer>) => {
    const result = await deps.customer(...args)
    await prisma.host.update({ where: { id: host.id }, data: { securityHardening: { ...await state(), maintenance: concurrentMaintenance } } })
    return result
  } })
  assert.deepEqual((await state()).maintenance, concurrentMaintenance, 'final receipt must preserve a newer durable maintenance intent')
  assert.notEqual((await state()).status, 'verified')
  for (const change of [{ deletionIntent: { phase: 'requested' } }, { expiresAt: new Date(0) }]) {
    await due()
    await hardenExistingHost(host.id, { ...deps, customer: async (...args: Parameters<typeof deps.customer>) => {
      const result = await deps.customer(...args)
      await prisma.instance.update({ where: { id: instance.id }, data: change })
      return result
    } })
    assert.notEqual((await state()).status, 'verified', 'a newer deletion/expiry invalidates the previous customer receipt')
    assert.equal((await state()).diagnostic.phase, 'receipt')
    await prisma.instance.update({ where: { id: instance.id }, data: { deletionIntent: Prisma.DbNull, expiresAt: instance.expiresAt } })
  }
  await due()
  let newestTask: number | undefined
  try {
    await hardenExistingHost(host.id, { ...deps, customer: async (...args: Parameters<typeof deps.customer>) => {
      const result = await deps.customer(...args)
      newestTask = (await prisma.instanceTask.create({ data: { instanceId: instance.id, hostId: host.id, userId: buyer.id,
        taskType: 'stop', status: 'PENDING' } })).id
      return result
    } })
    assert.notEqual((await state()).status, 'verified', 'a newer queued stop must be retained without claiming a settled customer receipt')
    assert.equal((await state()).diagnostic.reason, 'HARDENING_BUSY')
    assert.equal((await prisma.instanceTask.findUniqueOrThrow({ where: { id: newestTask } })).status, 'PENDING')
  } finally { if (newestTask) await prisma.instanceTask.delete({ where: { id: newestTask } }) }
  await prisma.host.update({ where: { id: host.id }, data: { securityHardening: { revision: SECURITY_HARDENING_REVISION,
    updateAttempts: 3, nextCheckAt: new Date(0).toISOString() } } })
  await hardenExistingHost(host.id, { ...deps, customer: async (...args: Parameters<typeof deps.customer>) => {
    const result = await deps.customer(...args)
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'user' } })
    return result
  } })
  assert.notEqual((await state()).status, 'verified', 'revoked current administrator invalidates the final result')
  assert.equal((await state()).diagnostic.reason, 'HARDENING_ADMIN_REQUIRED')
  assert.equal((await state()).updateAttempts, 3, 'rejected final authority cannot reset the finite update budget')
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
  await prisma.host.update({ where: { id: host.id }, data: { securityHardening: { revision: SECURITY_HARDENING_REVISION, status: 'retry', error: 'ALPINE_SSH_UPDATE_FAILED', attempts: 6, updateAttempts: 6, nextCheckAt: new Date(0).toISOString() } } })
  const beforeExhausted = guestWrites
  apparmor=false
  await hardenExistingHost(host.id, deps)
  assert.equal((await state()).error, 'HARDENING_RETRY_EXHAUSTED'); assert.equal((await state()).status, 'needs-maintenance')
  assert.equal(allowHostUpdate, false); assert.equal(guestWrites, beforeExhausted)
  const exhausted = await state()
  await prisma.host.update({ where: { id: host.id }, data: { securityHardening: { ...exhausted, nextCheckAt: new Date(0).toISOString() } } })
  await hardenExistingHost(host.id, deps); assert.equal(guestWrites, beforeExhausted, 'maintenance interval does not renew exhausted update permission')
  apparmor=true
  await due(); await hardenExistingHost(host.id, deps)
  // A current enrollment lease is host-only, and completion independently
  // checks identity/receipt/Agent/current authority after hardening returns.
  const enrolledNode = await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { hostId: host.id } })
  const onboardingLease = randomUUID()
  await prisma.hostAgent.create({ data: { hostId: host.id, ...protectedAgentFixture() } })
  await prisma.instance.update({ where: { id: instance.id }, data: { status: 'deleted' } })
  const realRequest = client.request
  client.request = async (method: string, path: string) => path.startsWith('/1.0/instances?') ? [] : realRequest(method,path)
  await prisma.hostOnboardingNode.update({ where: { id: enrolledNode.id }, data: { status:'running',step:'hardening',
    leaseToken:onboardingLease,leaseUntil:new Date(Date.now()+60000),credentialsEncrypted:'encrypted-retained' } })
  await due()
  await assert.rejects(finishSecureOnboarding(enrolledNode.id,onboardingLease,host.id),/ONBOARDING_PENDING/)
  assert.equal((await prisma.hostOnboardingNode.findUniqueOrThrow({where:{id:enrolledNode.id}})).credentialsEncrypted,'encrypted-retained')
  await hardenExistingHost(host.id,deps,{nodeId:enrolledNode.id,leaseToken:onboardingLease})
  assert.equal((await state()).status,'verified')
  assert.equal(await prisma.host.count({where:{id:host.id,...dedicatedHostReadyWhere()}}),0,'a running enrollment is never saleable')
  await assert.rejects(finishSecureOnboarding(enrolledNode.id,randomUUID(),host.id),/WORKER_INTERRUPTED/)
  await prisma.host.update({where:{id:host.id},data:{serverFingerprint:'changed-fixture-pin'}})
  await assert.rejects(finishSecureOnboarding(enrolledNode.id,onboardingLease,host.id),/ONBOARDING_PENDING/)
  await prisma.host.update({where:{id:host.id},data:{serverFingerprint:host.serverFingerprint}})
  for(const change of [{poolFaulted:true},{publicIpSyncBlocked:true},{singleTenant:false}]) {
    await prisma.host.update({where:{id:host.id},data:change})
    await assert.rejects(finishSecureOnboarding(enrolledNode.id,onboardingLease,host.id),/ONBOARDING_PENDING/,
      'a newer host fault or allocation mode invalidates earlier hardening success')
    assert.equal((await prisma.hostOnboardingNode.findUniqueOrThrow({where:{id:enrolledNode.id}})).credentialsEncrypted,'encrypted-retained')
    await prisma.host.update({where:{id:host.id},data:{poolFaulted:false,publicIpSyncBlocked:false,singleTenant:true}})
  }
  await finishSecureOnboarding(enrolledNode.id,onboardingLease,host.id)
  assert.equal((await prisma.hostOnboardingNode.findUniqueOrThrow({where:{id:enrolledNode.id}})).status,'succeeded')
  assert.equal((await prisma.hostOnboardingNode.findUniqueOrThrow({where:{id:enrolledNode.id}})).credentialsEncrypted,null)
  client.request=realRequest
  await prisma.instance.update({where:{id:instance.id},data:{status:'running'}})
  await due();await hardenExistingHost(host.id,deps)
  await due(); mutateAfterCustomer = true; await hardenExistingHost(host.id, deps)
  assert.equal((await state()).status, 'needs-maintenance'); assert.equal((await state()).diagnostic.phase,'receipt')
  assert.ok(!(await state()).leaseToken, 'changed customer binding rejects old success and records a bounded failure')
  mutateAfterCustomer = false
  await prisma.instance.update({ where: { id: instance.id }, data: { snapshottedSpecs: instance.snapshottedSpecs as any } })
  await due(); await hardenExistingHost(host.id, deps)
  const record = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
  for (const key of ['incusId', 'userId', 'hostId', 'rootPassword', 'status', 'billingPrice', 'expiresAt', 'ipv4', 'cpu', 'memory', 'disk', 'snapshottedSpecs'] as const) assert.deepEqual(record[key], instance[key], key + ' unchanged')
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), 71)
  // Exercise the actual customer maintenance automatic entry, not only the queue adapter.
  const node = await prisma.hostOnboardingNode.findUniqueOrThrow({ where: { hostId: host.id } })
  const expected: AutomaticSshTarget = { hostId: host.id, incusId: prefix, uuid, attempt, endpointHash: createHash('sha256').update(host.url).digest('hex'),
    url: host.url, serverCertificate: host.serverCertificate, serverFingerprint: host.serverFingerprint, nodeId: node.id,
    nodePublicKey: node.nodePublicKey, sshFingerprint: node.sshFingerprint, managementSshHost: host.managementSshHost,
    managementSshPort: host.managementSshPort, managementSshUser: host.managementSshUser }
  let automaticUpdates = 0
  const maintenance = { connect: async () => client, inspect: async () => ({ alpine: true, fixed: true, fingerprints: ['SHA256:original'] }),
    preflight: async () => {},
    update: async () => { automaticUpdates++ }, hold: async () => ({ verify: async () => {}, close: () => {} }), login: async () => {} }
  await prisma.instance.update({ where: { id: instance.id }, data: { rootPassword: encryptSensitiveData('original-fixture-password') } })
  assert.equal((await maintainAlpineCustomerSsh(instance.id, admin.id, maintenance, undefined, true, expected)).status, 'already-fixed')
  let shortReady!:()=>void
  const shortAcquired=new Promise<void>(resolve=>{shortReady=resolve})
  const shortCustomerLock=prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${INSTANCE_OPERATION_LOCK_NAMESPACE}, ${instance.id})::text`
    shortReady();await new Promise(resolve=>setTimeout(resolve,250))
  },{timeout:5000})
  await shortAcquired
  assert.equal((await maintainAlpineCustomerSsh(instance.id,admin.id,maintenance,undefined,true,{...expected,inspectOnly:true})).status,'already-fixed','automatic SSH inspection waits through a short real observer lock')
  await shortCustomerLock
  let longReady!:()=>void,longRelease!:()=>void
  const longAcquired=new Promise<void>(resolve=>{longReady=resolve}),longGate=new Promise<void>(resolve=>{longRelease=resolve})
  const longCustomerLock=prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${INSTANCE_OPERATION_LOCK_NAMESPACE}, ${instance.id})::text`
    longReady();await longGate
  },{timeout:10000})
  await longAcquired
  try{await assert.rejects(maintainAlpineCustomerSsh(instance.id,admin.id,maintenance,undefined,true,{...expected,inspectOnly:true}),/INSTANCE_BUSY/)}
  finally{longRelease();await longCustomerLock}
  assert.equal(automaticUpdates, 0,'already-patched listener is verified without another write')
  await assert.rejects(maintainAlpineCustomerSsh(instance.id, admin.id, maintenance, undefined, true, { ...expected, uuid: randomUUID() }), /IDENTITY_CHANGED/)
  await assert.rejects(maintainAlpineCustomerSsh(instance.id, admin.id, maintenance, undefined, true, { ...expected, hostId: host.id+1 }), /IDENTITY_CHANGED/)
  await prisma.systemConfig.update({ where: { key: SECURITY_HARDENING_ENABLED_KEY }, data: { value: 'false' } })
  await assert.rejects(maintainAlpineCustomerSsh(instance.id, admin.id, maintenance, undefined, true, expected), /ADMIN_REQUIRED/)
  await prisma.systemConfig.update({ where: { key: SECURITY_HARDENING_ENABLED_KEY }, data: { value: 'true' } })
  assert.equal(automaticUpdates, 0, 'changed expected target and disabled policy make no customer update')
  await assert.rejects(maintainAlpineCustomerSsh(instance.id, admin.id, { ...maintenance, inspect:async()=>({alpine:true,fixed:false,fingerprints:['SHA256:original']}),preflight: async () => {
    throw new Error('HARDENING_MEMORY_LOW')
  } }, undefined, true, expected), /HARDENING_MEMORY_LOW/)
  assert.equal(automaticUpdates,0,'customer resource gate rejects before an update')
  assert.equal((await maintainAlpineCustomerSsh(instance.id,admin.id,maintenance,undefined,true,{ ...expected,inspectOnly:true })).status,'already-fixed')
  assert.equal(automaticUpdates,0,'read-only recovery verifies a completed patch without another remote update')
  await assert.rejects(maintainAlpineCustomerSsh(instance.id,admin.id,{ ...maintenance,inspect:async()=>({ alpine:true,fixed:false,fingerprints:['SHA256:original'] }) },
    undefined,true,{ ...expected,inspectOnly:true }),/PATCH_REQUIRED/)
  assert.equal(automaticUpdates,0,'read-only recovery cannot retry an unverified patch immediately')
  const app = Fastify(); app.decorate('authenticateAdmin', async (request, reply) => {
    if (request.headers['x-fixture-admin'] !== 'yes') reply.code(403).send({ error: 'forbidden' })
  }); await app.register(routes, { prefix: '/hosts' })
  try {
    const path = `/hosts/${host.id}/security-hardening`
    assert.equal((await app.inject({ method: 'GET', url: path })).statusCode, 403)
    const response = await app.inject({ method: 'GET', url: path, headers: { 'x-fixture-admin': 'yes' } })
    assert.equal(response.statusCode, 200); assert.equal(response.json().status, 'verified'); assert.ok(!response.body.includes('opaque-original-password'))
    assert.equal(response.json().environment.architecture,'aarch64'); assert.ok(!response.body.includes('leaseToken'))
    const originalState = await state()
    await prisma.host.update({ where:{id:host.id},data:{securityHardening:{...originalState,leaseToken:'hidden-lease',
      secret:'secret-should-never-be-spread',diagnostic:{phase:'host-inspection',reason:'private remote payload',nextAction:'private action'},
      environment:{...preflight,privateOutput:'private evidence'}}} })
    const redacted=await app.inject({method:'GET',url:path,headers:{'x-fixture-admin':'yes'}})
    assert.equal(redacted.statusCode,200)
    for (const text of ['hidden-lease','secret-should-never-be-spread','private remote payload','private action','private evidence']) assert.ok(!redacted.body.includes(text),text)
    await prisma.host.update({where:{id:host.id},data:{securityHardening:originalState}})
    assert.equal((await app.inject({ method: 'GET', url: '/hosts/1e2/security-hardening', headers: { 'x-fixture-admin': 'yes' } })).statusCode, 400)
  } finally { await app.close() }
  console.log('PASS automatic hardening PG: durable receipts, partial AppArmor, patch failure/retry, exact original identity, unsafe zero customer writes, active task/real lock, recovery/admin/disabled fences, concurrent lease and unchanged customer/password/network/billing')
} finally {
  releaseHost?.()
  await prisma.log.deleteMany({ where: { OR: [{ userId: admin.id }, { instanceId: instance.id }] } })
  await prisma.instance.delete({ where: { id: instance.id } }); await prisma.host.delete({ where: { id: host.id } })
  await prisma.hostOnboardingBatch.delete({ where: { id: batch.id } }); await prisma.user.deleteMany({ where: { id: { in: [admin.id, buyer.id] } } })
  if (originalPolicy) await prisma.systemConfig.update({ where: { key: SECURITY_HARDENING_ENABLED_KEY }, data: { value: originalPolicy.value } })
  else await prisma.systemConfig.delete({ where: { key: SECURITY_HARDENING_ENABLED_KEY } })
  await closePrismaDatabase()
}
