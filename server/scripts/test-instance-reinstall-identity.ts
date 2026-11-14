import assert from 'node:assert/strict'
import {Prisma}from'@prisma/client'
import { createHash, randomUUID, X509Certificate } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost'].includes(database.hostname) && database.pathname.endsWith('_pool_test'))
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { createInstanceTask, getInstanceTaskById } = await import('../src/db/instance-tasks.js')
const { selectAndReserveHostWithLock } = await import('../src/db/hosts.js')
const { executeTask, reconcileInterruptedRebuilds } = await import('../src/workers/instanceTaskWorker.js')
const { allocateAndReserveNatIpv4, createIpAddress, isIpAddressExists, reserveInstanceTaskIpv6 } = await import('../src/db/ip-addresses.js')
const { createPortMapping, createPortMappingsBatch, allocatePorts, suggestAvailablePorts } = await import('../src/db/port-mappings.js')
const { transferHostIdentity } = await import('../src/lib/transfer-host-identity.js')
const { registeredGuestIdentity } = await import('../src/lib/registered-guest-identity.js')
const { reconcileInterruptedReinstalls, reconcileExpiredRebuild } = await import('../src/services/instance-reinstall-identity.js')
const { assertRebuildBootReady } = await import('../src/lib/instance-rebuild-state.js')
const { requestInstanceDeletion } = await import('../src/services/instance-deletion.js')
const { encryptSensitiveData } = await import('../src/lib/security.js')
const { reconcilePoolInstanceResources } = await import('../src/services/pool-resource-reconciliation.js')
const { incusCompatibilityPermit }=await import('../src/services/incus-compatibility.js')
const { closeAllClients } = await import('../src/lib/incus/incus-pool.js')
const tag = 'reinstall-' + randomUUID().slice(0, 8), root = await mkdtemp(join(tmpdir(), tag))
const keyPath = join(root, 'key.pem'), certPath = join(root, 'cert.pem')
execFileSync(process.env.REVIEW_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=fixture',
  '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath], { stdio: 'pipe', windowsHide: true })
const cert = await readFile(certPath), guests = new Map<string, any>(), calls: string[] = []
let mode = '', taskId = 0, originalName = '', createCount = 0
const rebuildOperation = '/1.0/operations/' + randomUUID()
const remote = createServer({ key: await readFile(keyPath), cert, ca: cert, requestCert: true, rejectUnauthorized: true }, async (req, res) => {
  const ok = (metadata: unknown = {}) => { res.end(JSON.stringify({ type: 'sync', metadata })) }
  const fail = (status: number, error: string) => { res.statusCode = status; res.end(JSON.stringify({ type: 'error', error })) }
  res.setHeader('content-type', 'application/json')
  try {
    assert.ok((req.socket as any).authorized)
    const path = req.url!, method = req.method!
    calls.push(`${method} ${path}`)
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = raw ? JSON.parse(raw) : {}
    if (path === '/1.0') return ok({ api_version: '1.0' })
    if (path === '/1.0/operations?recursion=1') return ok(mode === 'expired-busy' ? { running: [{ id: randomUUID(), status: 'Running', resources: { instances: [`/1.0/instances/${originalName}`] } }] } : mode === 'expired-malformed' ? { running: ['unreadable'] } : {})
    if (path.startsWith(rebuildOperation + '/wait')) {
      if (mode === 'failed-operation') return ok({ status: 'Failure', status_code: 400, err: 'image download failed' })
      return fail(500, 'fixture lost operation waiter')
    }
    if (path === rebuildOperation) {
      if (mode.startsWith('expired-') && mode !== 'expired-success') return fail(404, 'Operation not found')
      if (mode === 'failed-receipt' || mode === 'failed-envelope') return ok({ status: 'Failure', status_code: 400, err: 'image download failed' })
      return ok({ status: 'Success', status_code: 200 })
    }
    if (path.startsWith('/1.0/images/aliases/')) return ok({ target: 'fixture' })
    if (path.startsWith('/1.0/images/')) return ok({ properties: { os: 'Debian' } })
    if (path.startsWith('/1.0/storage-pools?')) return ok([{ name: 'fixture' }])
    if (path.includes('/volumes?')) return ok([])
    if (path.startsWith('/1.0/networks')) return ok([])
    if (path === '/1.0/instances' && method === 'POST') {
      const saved = (await prisma.instanceTask.findUniqueOrThrow({ where: { id: taskId } })).replacementState as any
      assert.equal(saved.targetAttempt || saved.cloneAttempt, body.config['user.payincus.provisioning-attempt'], 'attempt is durable before create')
      assert.equal(saved.targetIncusId, body.name); createCount++
      const source = body.source?.type === 'copy' ? guests.get(body.source.source) : null
      guests.set(body.name, { name: body.name, type: body.type || source?.type, config: { ...source?.config, ...body.config, 'volatile.uuid': randomUUID() },
        devices: body.devices || source?.devices, profiles: body.profiles || source?.profiles, created_at: new Date().toISOString(), status: 'Stopped' })
      if (mode === 'actor-revoked') await prisma.user.update({ where: { id: owner.id }, data: { status: 'banned' } })
      if (mode === 'late-cancel') await prisma.instanceTask.update({ where: { id: taskId }, data: { status: 'FAILED', error: 'fixture cancellation' } })
      if (mode === 'lost-response' || mode === 'cleanup-refused') return fail(500, 'fixture lost create response')
      if (mode === 'alien-target') guests.get(body.name).config['user.payincus.provisioning-attempt'] = randomUUID()
      return ok()
    }
    const match = path.match(/^\/1.0\/instances\/([^/?]+)(.*)$/)
    if (!match) return fail(404, 'unsupported fixture endpoint')
    const name = decodeURIComponent(match[1]), suffix = match[2], guest = guests.get(name)
    if (!guest) return fail(404, 'not found')
    if (suffix.startsWith('/snapshots')) return ok([])
    if (suffix.startsWith('/files?')) return ok()
    if (suffix === '/rebuild') {
      assert.equal(guest.config['security.privileged'], 'false')
      if (mode === 'lost-response') return fail(500, 'fixture rebuild response lost')
      if (mode === 'lost-waiter' || mode === 'retired-completed' || mode.startsWith('expired-') || mode.startsWith('failed-')) { res.end(JSON.stringify({ type: 'async', operation: rebuildOperation })); return }
      return ok()
    }
    if (suffix === '/state') {
      if (method === 'PUT') guest.status = body.action === 'start' ? 'Running' : 'Stopped'
      return ok({ status: guest.status, network: { eth0: { addresses: [{ family: 'inet', scope: 'global', address: guest.devices?.eth0?.['ipv4.address'] || '10.10.1.5' }] } } })
    }
    if (suffix) return fail(404, 'unsupported fixture suffix')
    if (method === 'DELETE') {
      if (mode === 'cleanup-refused' && name !== originalName) return fail(500, 'fixture cleanup refused')
      guests.delete(name); return ok()
    }
    if (method === 'PATCH') { guest.config = { ...guest.config, ...body.config }; guest.devices = { ...guest.devices, ...body.devices }; return ok() }
    if (method === 'PUT') { guests.set(name, { ...guest, ...body }); return ok() }
    res.setHeader('ETag', '"fixture-resource-etag"')
    return ok(guest)
  } catch (error) { fail(500, error instanceof Error ? error.message : 'fixture failure') }
})
await new Promise<void>(resolve => remote.listen(0, '127.0.0.1', resolve))
const owner = await prisma.user.create({ data: { username: tag, passwordHash: 'unusable-test-only' } })
const host = await prisma.host.create({ data: { userId: owner.id, name: tag, url: `https://127.0.0.1:${(remote.address() as any).port}`,
  certPath, keyPath, serverCertificate: cert.toString(), serverFingerprint: new X509Certificate(cert).fingerprint256,
  status: 'online', architecture: 'x86_64', cpuAllowanceMax: 400, memoryMax: 4096, storageSize: 100 } })
await prisma.storagePool.create({ data: { hostId: host.id, name: 'fixture', driver: 'dir', purpose: 'instance_data' } })
const image = await prisma.systemImage.create({ data: { name: tag, icon: 'debian', remoteAlias: `${tag}/debian`, architecture: 'x86_64', instanceType: 'container' } })
const targetHost = await prisma.host.create({ data: { userId: owner.id, name: tag + '-target', url: host.url, certPath, keyPath,
  serverCertificate: cert.toString(), serverFingerprint: host.serverFingerprint, status: 'online', architecture: 'x86_64',
  cpuAllowanceMax: 400, memoryMax: 4096, storageSize: 100 } })
await prisma.storagePool.create({ data: { hostId: targetHost.id, name: 'fixture', driver: 'dir', purpose: 'instance_data' } })
const pkg = await prisma.package.create({ data: { userId: owner.id, name: tag, cpuMax: 100, memoryMax: 256, diskMax: 1024,
  packageHosts: { create: [{ hostId: host.id }, { hostId: targetHost.id }] } } })
const sshKey = await prisma.sshKey.create({ data: { userId: owner.id, name: tag, publicKey: 'ssh-ed25519 fixture-only', fingerprint: tag } })
const ids: number[] = []
try {
  for (const architecture of ['x86_64', 'aarch64']) {
  const currentHost = await prisma.host.update({ where: { id: host.id }, data: { architecture } })
  await prisma.systemImage.update({ where: { id: image.id }, data: { architecture } })
  await prisma.host.update({ where: { id: targetHost.id }, data: { architecture } })
  for (const taskType of ['rebuild', 'recreate', 'clone', 'change_host'] as const) for (const scenario of ['success', 'unknown-original', 'wrong-uuid', 'wrong-type', 'lost-response', 'cleanup-refused', 'alien-target', 'actor-revoked', 'late-cancel', 'lost-waiter', 'legacy-marker', 'dual-stack', 'running-source', 'vm-macs', 'public-ipv4', 'public-vm', 'failed-operation', 'failed-envelope', 'expired-missing', 'expired-busy', 'expired-success', 'expired-malformed', 'expired-wrong-uuid', 'retired-completed']) {
    if ((scenario.startsWith('expired-') || scenario.startsWith('failed-') || scenario === 'retired-completed') && taskType !== 'rebuild') continue
    if (process.env.REVIEW_REINSTALL_SCOPE === 'pool-cleanup' && (taskType !== 'recreate' || scenario !== 'cleanup-refused')) continue
    if (['public-ipv4', 'public-vm'].includes(scenario) && !['rebuild', 'recreate'].includes(taskType)) continue
    if (['lost-waiter', 'legacy-marker'].includes(scenario) && taskType !== 'rebuild' || scenario === 'dual-stack' && taskType !== 'clone') continue
    if (scenario === 'running-source' && taskType !== 'change_host') continue
    if (scenario === 'vm-macs' && taskType !== 'rebuild') continue
    const vmScenario = ['vm-macs', 'public-vm'].includes(scenario)
    const publicScenario = ['public-ipv4', 'public-vm'].includes(scenario)
    await prisma.package.update({ where: { id: pkg.id }, data: { instanceType: vmScenario ? 'vm' : 'container' } })
    await prisma.systemImage.update({ where: { id: image.id }, data: { instanceType: vmScenario ? 'vm' : 'container' } })
    await prisma.host.updateMany({ where: { id: { in: [host.id, targetHost.id] } }, data: { instanceType: 'both' } })
    if (['actor-revoked', 'late-cancel'].includes(scenario) && !['clone', 'change_host'].includes(taskType)) continue
    if (taskType === 'rebuild' && ['cleanup-refused', 'alien-target'].includes(scenario)) continue
    mode = scenario; guests.clear(); calls.length = 0; createCount = 0
    // Each scenario discards its fixture guests below; reset only these two
    // dedicated fixture hosts, not the application's cleanup behavior.
    await prisma.host.updateMany({ where: { id: { in: [host.id, targetHost.id] } }, data: { cpuUsed: 0, memoryUsed: 0, diskUsed: 0 } })
    originalName = `${tag}-${taskType}-${scenario}`
    const uuid = randomUUID(), attempt = randomUUID(), createdAt = new Date().toISOString()
    guests.set(originalName, { name: originalName, type: scenario === 'wrong-type' ? 'virtual-machine' : 'container',
      config: { 'volatile.uuid': scenario === 'wrong-uuid' ? randomUUID() : uuid, 'user.payincus.provisioning-attempt': attempt, 'security.privileged': 'false' },
      devices: {root:{type:'disk',path:'/',pool:'fixture',size:'1024MB'}}, profiles: [], status: 'Stopped', created_at: createdAt })
    if (scenario === 'running-source') guests.get(originalName).status = 'Running'
    if (vmScenario) {
      guests.get(originalName).type = 'virtual-machine'
      guests.get(originalName).devices.eth0 = { type: 'nic', nictype: 'bridged', parent: 'incusbr0', name: 'eth0', hwaddr: '00:16:3e:11:22:33' }
    }
    if (scenario === 'legacy-marker') delete guests.get(originalName).config['user.payincus.provisioning-attempt']
    if (scenario === 'dual-stack') {
      await prisma.host.update({ where: { id: host.id }, data: { natPortStart: 32000, natPortEnd: 32020 } })
      guests.get(originalName).devices = {
        eth0: { type: 'nic', nictype: 'bridged', parent: 'incusbr0', name: 'eth0', 'ipv4.address': '10.10.2.200' },
        proxy: { type: 'proxy', listen: 'tcp:192.0.2.5:32000', connect: 'tcp:0.0.0.0:22', nat: 'true' },
        'proxy-v6': { type: 'proxy', listen: 'tcp:[2001:db8::5]:32000', connect: 'tcp:0.0.0.0:22' }
      }
    }
    const instance = await prisma.instance.create({ data: { name: originalName, incusId: originalName, userId: owner.id, hostId: host.id,
      cpu: 100, memory: vmScenario ? 1024 : 256, disk: 1024, image: image.remoteAlias, status: 'stopped', networkMode: publicScenario ? 'public_ipv4' : scenario === 'dual-stack' ? 'nat_ipv6_nat' : 'nat', ipv4: publicScenario ? `192.0.2.${ids.length + 10}` : `10.10.2.${ids.length + 10}`,
      expiresAt: taskType === 'clone' ? null : new Date(Date.now() + 86400000), billingPrice: taskType === 'clone' ? null : 15, autoRenew: true,
      packageId: pkg.id, rootPassword: encryptSensitiveData('isolated-password'),
      snapshottedSpecs: scenario === 'unknown-original' ? {} : { retained: 'billing-spec',
        ...(scenario === 'legacy-marker' ? {} : { managedCleanup: { uuid, attempt, endpointHash: createHash('sha256').update(host.url).digest('hex') } }), recoveryIdentity: { uuid, createdAt } } } })
    ids.push(instance.id)
    if (taskType === 'rebuild' && scenario === 'success') {
      const {hostMaintenanceBlocked}=await import('../src/lib/host-maintenance-gate.js')
      const cleanHost=await prisma.host.findUniqueOrThrow({where:{id:host.id}})
      const hash='a'.repeat(64)
      await prisma.host.update({where:{id:host.id},data:{singleTenant:true}})
      const rawAgent=await prisma.hostAgent.create({data:{hostId:host.id,agentId:'agt_'+randomUUID().replaceAll('-',''),secretHash:'test-hash',secretEncrypted:'fixture-secret',enabled:true,capabilities:['incus-sysinfo-compat-v1'],lastReport:{hostProvisioningStatus:{incusCompat:'needed',compatHash:hash}}}})
      const permit=await incusCompatibilityPermit(rawAgent)
      assert.ok(permit,'idle original guest receives daemon reload permit')
      assert.equal(hostMaintenanceBlocked((await prisma.host.findUniqueOrThrow({where:{id:host.id}})).securityHardening),true)
      await assert.rejects(createInstanceTask({instanceId:instance.id,hostId:host.id,userId:owner.id,taskType:'start'}))
      const repeat=await incusCompatibilityPermit(rawAgent)
      assert.equal(repeat?.requestId,permit.requestId,'same fence is resumed')
      const remoteReads=calls.length
      const interrupted=await incusCompatibilityPermit({...rawAgent,lastReport:{hostProvisioningStatus:{incusCompat:'pending',compatHash:hash,compatRequest:permit.requestId}}})
      assert.equal(interrupted?.requestId,permit.requestId,'interrupted local daemon receives its original recovery permit')
      assert.equal(calls.length,remoteReads,'recovery permit does not wait for the daemon that Agent must recover')
      assert.equal(await incusCompatibilityPermit({...rawAgent,lastReport:{hostProvisioningStatus:{incusCompat:'pending',compatHash:hash,compatRequest:randomUUID()}}}),null,'another reload request cannot resume this fence')
      await incusCompatibilityPermit({...rawAgent,lastReport:{hostProvisioningStatus:{incusCompat:'verified',compatHash:hash,compatRequest:permit.requestId}}})
      assert.equal(hostMaintenanceBlocked((await prisma.host.findUniqueOrThrow({where:{id:host.id}})).securityHardening),false)
      const nextHash='b'.repeat(64)
      const nextPermit=await incusCompatibilityPermit({...rawAgent,lastReport:{hostProvisioningStatus:{incusCompat:'needed',compatHash:nextHash,compatRequest:permit.requestId}}})
      assert.equal(nextPermit?.requestId,permit.requestId,'verified original authority carries the next fixed binary generation')
      assert.equal(hostMaintenanceBlocked((await prisma.host.findUniqueOrThrow({where:{id:host.id}})).securityHardening),true)
      await incusCompatibilityPermit({...rawAgent,lastReport:{hostProvisioningStatus:{incusCompat:'verified',compatHash:nextHash,compatRequest:permit.requestId}}})
      assert.equal(hostMaintenanceBlocked((await prisma.host.findUniqueOrThrow({where:{id:host.id}})).securityHardening),false)
      await prisma.hostAgent.delete({where:{id:rawAgent.id}})
      await prisma.host.update({where:{id:host.id},data:{singleTenant:cleanHost.singleTenant,securityHardening:cleanHost.securityHardening===null?Prisma.DbNull:cleanHost.securityHardening}})
      const savedHost = await prisma.host.findUniqueOrThrow({ where: { id: host.id } })
      await prisma.host.update({ where: { id: host.id }, data: { singleTenant: true } })
      await prisma.instance.update({ where: { id: instance.id }, data: { dedicatedIpv4: true } })
      const guest = guests.get(originalName)
      guest.config['limits.memory'] = `${instance.memory}MB`
      guest.devices.root = { type: 'disk', path: '/', pool: 'fixture', size: `${instance.disk}MB` }
      assert.equal(await reconcilePoolInstanceResources(instance.id), true)
      assert.equal(guest.config['limits.memory'], `${instance.memory}MiB`)
      assert.equal(guest.devices.root.size, `${instance.disk}MiB`)
      assert.equal(guest.status, 'Stopped')
      const writes = calls.filter(call => call.startsWith('PATCH ')).length
      assert.equal(await reconcilePoolInstanceResources(instance.id), true)
      assert.equal(calls.filter(call => call.startsWith('PATCH ')).length, writes)
      const oldSpecs=instance.snapshottedSpecs
      await prisma.instance.update({where:{id:instance.id},data:{snapshottedSpecs:{managedCleanup:{uuid,attempt,endpointHash:createHash('sha256').update(host.url).digest('hex')}}}})
      guest.config['limits.memory']=`${instance.memory}MB`;guest.devices.root.size=`${instance.disk}MB`
      assert.equal(await reconcilePoolInstanceResources(instance.id),true,'early UUID and enrolled endpoint proof without creation time is sufficient for exact quota repair')
      assert.equal(guest.config['limits.memory'],`${instance.memory}MiB`)
      guest.config['limits.memory']=`${instance.memory}MB`;guest.devices.root.size=`${instance.disk}MB`
      await prisma.instance.update({where:{id:instance.id},data:{snapshottedSpecs:{managedCleanup:{uuid,endpointHash:'wrong-endpoint'}}}})
      assert.equal(await reconcilePoolInstanceResources(instance.id),false,'missing creation time cannot accept another endpoint')
      await prisma.instance.update({where:{id:instance.id},data:{snapshottedSpecs:oldSpecs as any}})
      guest.config['limits.memory']=`${instance.memory}MiB`;guest.devices.root.size=`${instance.disk}MiB`
      await prisma.instance.update({ where: { id: instance.id }, data: { dedicatedIpv4: false } })
      await prisma.host.update({ where: { id: host.id }, data: { singleTenant: savedHost.singleTenant } })
    }
    if (!guests.get(originalName).devices.eth0) guests.get(originalName).devices.eth0 = {
      type: 'nic', nictype: 'bridged', parent: 'incusbr0', name: 'eth0', 'ipv4.address': instance.ipv4
    }
    else guests.get(originalName).devices.eth0['ipv4.address'] = instance.ipv4
    if (publicScenario) {
      guests.get(originalName).devices.eth0 = { type: 'nic', nictype: 'routed', parent: 'ens3', name: 'eth0',
        'ipv4.address': instance.ipv4, ...(vmScenario ? { hwaddr: '00:16:3e:11:22:33' } : {}) }
      await prisma.publicIpv4Address.create({ data: { hostId: host.id, instanceId: instance.id, address: instance.ipv4!,
        status: 'assigned', prefixLength: 24, gateway: '192.0.2.1', dns: ['9.9.9.9'] } })
    }
    if (scenario === 'dual-stack') await prisma.portMapping.create({ data: { instanceId: instance.id, hostId: host.id,
      protocol: 'tcp', publicPort: 32000, privatePort: 22, systemManaged: true } })
    if (taskType === 'clone' && scenario === 'success') {
      await prisma.instance.update({ where: { id: instance.id }, data: { billingPrice: 15, expiresAt: new Date(Date.now() + 86400000) } })
      await assert.rejects(createInstanceTask({ instanceId: instance.id, hostId: host.id, userId: owner.id, taskType: 'clone',
        sensitiveAuthorization: { actor: { id: owner.id, sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }, entry: 'user',
          expectedOwnerId: owner.id, expectedIncusId: instance.incusId, expectedHostIdentity: transferHostIdentity(host) } }),
        (error: any) => error.code === 'PAID_INSTANCE_CLONE_REQUIRES_PURCHASE')
      assert.equal(await prisma.instanceTask.count({ where: { instanceId: instance.id } }), 0)
      await prisma.instance.update({ where: { id: instance.id }, data: { billingPrice: null, expiresAt: null } })
    }
    const admission = await createInstanceTask({ instanceId: instance.id, hostId: taskType === 'change_host' ? targetHost.id : host.id,
      targetHostId: taskType === 'change_host' ? targetHost.id : undefined, sshKeyId: sshKey.id, userId: owner.id, taskType, imageAlias: image.remoteAlias,
      sensitiveAuthorization: { actor: { id: owner.id, sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }, entry: 'host',
        expectedOwnerId: owner.id, expectedIncusId: instance.incusId, expectedHostIdentity: transferHostIdentity(host) } })
    let task = await prisma.instanceTask.update({ where: { id: admission.id }, data: { status: 'PROCESSING', startedAt: new Date() } })
    taskId = task.id
    if (taskType === 'rebuild' && scenario === 'success') {
      const { advisoryTransactionLock, INSTANCE_OPERATION_LOCK_NAMESPACE } = await import('../src/db/advisory-locks.js')
      let locked!: () => void, release!: () => void
      const ready = new Promise<void>(resolve => { locked = resolve }), gate = new Promise<void>(resolve => { release = resolve })
      const holder = prisma.$transaction(async tx => { await advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instance.id); locked(); await gate }, { timeout: 15000 })
      await ready
      const beforeCalls = calls.length
      try { await executeTask(task.id, task) } finally { release(); await holder }
      const waiting = await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
      assert.equal(waiting.status, 'PENDING', 'a patrol taking the operation lock after claim must requeue, not fail the accepted rebuild')
      assert.equal(waiting.operationIdentity, task.operationIdentity, 'the original user consent is retained for revalidation')
      assert.equal(waiting.startedAt, null)
      assert.equal(calls.length, beforeCalls, 'busy admission cannot write or rebuild the remote guest')
      task = await prisma.instanceTask.update({ where: { id: task.id }, data: { status: 'PROCESSING', startedAt: new Date() } })
    }
    await executeTask(task.id, task)
    if (scenario === 'lost-waiter' || scenario === 'failed-receipt') {
      const waiting = await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
      assert.equal((waiting.replacementState as any).rebuildOperation, rebuildOperation)
      await prisma.instanceTask.update({ where: { id: task.id }, data: { replacementState: { ...(waiting.replacementState as any), rebuildNextAt: '2000-01-01T00:00:00.000Z' } } })
      const beforeMaintenance = await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
      await prisma.host.update({ where: { id: host.id }, data: { securityHardening: { maintenance: { phase: 'preparing' } } } })
      const beforeCalls = calls.length
      await reconcileInterruptedRebuilds()
      assert.equal(calls.length, beforeCalls, 'maintenance blocks remote resume before claiming its budget')
      assert.deepEqual((await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })).replacementState, beforeMaintenance.replacementState)
      await prisma.host.update({ where: { id: host.id }, data: { securityHardening: (await import('@prisma/client')).Prisma.DbNull } })
      await reconcileInterruptedRebuilds()
      assert.equal(calls.filter(call => call === `POST /1.0/instances/${originalName}/rebuild`).length, 1)
    }
    if (scenario.startsWith('expired-')) {
      const stale = await prisma.instanceTask.update({ where: { id: task.id }, data: { startedAt: new Date(Date.now() - 31 * 60000) } })
      if (scenario === 'expired-wrong-uuid') guests.get(originalName).config['volatile.uuid'] = randomUUID()
      const beforeWrites = calls.filter(call => !call.startsWith('GET ')).length
      if (['expired-busy', 'expired-malformed'].includes(scenario)) await assert.rejects(reconcileExpiredRebuild(stale), /INSTANCE_OPERATION_STILL_RUNNING|INCUS_OPERATIONS_UNVERIFIED/)
      else assert.equal(await reconcileExpiredRebuild(stale), scenario === 'expired-missing')
      assert.equal(calls.filter(call => !call.startsWith('GET ')).length, beforeWrites, 'receipt reconciliation must not write, restart or repeat rebuild')
    }
    if (scenario === 'retired-completed') {
      const saved = await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
      const retired = await prisma.instanceTask.update({ where: { id: task.id }, data: { imageAlias: 'images:debian/11/cloud',
        replacementState: { ...(saved.replacementState as any), rebuildCompleted: true } } })
      guests.get(originalName).status = 'Running'
      guests.get(originalName).ephemeral = true
      assert.equal(await reconcileExpiredRebuild(retired), false, 'ephemeral retired guest must not be stopped or deleted by settlement')
      guests.get(originalName).ephemeral = false
      guests.get(originalName).status = 'Running'
      const writes = calls.filter(call => !call.startsWith('GET ')).length
      assert.equal(await reconcileExpiredRebuild(retired), true, 'retired failed initialization settles after original stopped identity and no in-flight operation proof')
      assert.equal(calls.filter(call => !call.startsWith('GET ')).length, writes + 1, 'only original persistent guest receives one stop')
      assert.equal(guests.get(originalName).status, 'Stopped')
      assert.equal(await reconcileExpiredRebuild(retired), false, 'settlement is idempotent')
    }
    if (['clone', 'change_host'].includes(taskType) && scenario === 'lost-response') await reconcileInterruptedReinstalls()
    const result = await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
    const row = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
    assert.equal(Number(row.billingPrice), taskType === 'clone' ? 0 : 15); assert.equal(row.expiresAt?.getTime(), instance.expiresAt?.getTime()); assert.equal(row.autoRenew, true)
    if (scenario.startsWith('failed-') || scenario === 'expired-missing' || scenario === 'retired-completed') {
      assert.equal(result.status, 'FAILED', result.error || '')
      assert.equal((result.replacementState as any).targetPhase, 'rebuild_failed')
      assert.ok(!(result.replacementState as any).pendingRootPassword)
      assert.equal(row.status, 'stopped'); assert.equal(row.rootPassword, instance.rootPassword)
      await assert.rejects(assertRebuildBootReady(prisma, instance.id), /重新选择镜像重装/)
      assert.equal(calls.filter(call => call === `POST /1.0/instances/${originalName}/rebuild`).length, 1)
      const next = await createInstanceTask({ instanceId: instance.id, hostId: host.id, sshKeyId: sshKey.id, userId: owner.id,
        taskType: 'rebuild', imageAlias: image.remoteAlias, sensitiveAuthorization: {
          actor: { id: owner.id, sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }, entry: 'user', expectedOwnerId: owner.id,
          expectedIncusId: instance.incusId, expectedHostIdentity: transferHostIdentity(currentHost) } })
      const retry = await prisma.instanceTask.update({ where: { id: next.id }, data: { status: 'PROCESSING', startedAt: new Date() } })
      mode = 'success'; taskId = retry.id
      await executeTask(retry.id, retry)
      assert.equal((await prisma.instanceTask.findUniqueOrThrow({ where: { id: retry.id } })).status, 'COMPLETED', 'fresh user consent recovers failed rebuild')
      assert.equal((await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })).status, 'FAILED', 'original failure history stays intact')
      await assertRebuildBootReady(prisma, instance.id)
      const restored = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
      assert.equal(restored.status, 'running'); assert.equal(restored.expiresAt?.getTime(), instance.expiresAt?.getTime())
      assert.equal(Number(restored.billingPrice), Number(instance.billingPrice))
    } else if (scenario.startsWith('expired-')) {
      assert.equal(result.status, 'PROCESSING'); assert.ok((result.replacementState as any).pendingRootPassword)
    } else if (['actor-revoked', 'late-cancel'].includes(scenario)) {
      assert.equal(row.hostId, instance.hostId); assert.equal(row.incusId, instance.incusId)
      assert.notEqual(result.status, 'COMPLETED')
      assert.equal(calls.filter(call => call.startsWith('PUT ') || call.startsWith('DELETE ')).length, 0)
      await prisma.user.update({ where: { id: owner.id }, data: { status: 'active' } })
    } else if (['success', 'lost-waiter', 'legacy-marker', 'dual-stack', 'running-source', 'vm-macs', 'public-ipv4', 'public-vm'].includes(scenario)) {
      assert.equal(result.status, 'COMPLETED', result.error || '')
      assert.equal(result.error, null, 'successful reconciliation clears its old transient error')
      if (scenario === 'running-source') {
        assert.ok(calls.indexOf(`PUT /1.0/instances/${originalName}/state`) >= 0)
        assert.ok(calls.indexOf(`PUT /1.0/instances/${originalName}/state`) < calls.indexOf(`DELETE /1.0/instances/${originalName}`))
      }
      const delivered = taskType === 'clone' ? await prisma.instance.findUniqueOrThrow({ where: { id: result.newInstanceId! } }) : row
      const guest = guests.get(delivered.incusId)
      if (publicScenario) {
        assert.equal(delivered.ipv4, instance.ipv4)
        assert.equal(guest.devices.eth0.nictype, 'routed')
        assert.equal(guest.devices.eth0['ipv4.address'], instance.ipv4)
        assert.ok(guest.config['user.network-config'].includes(`${instance.ipv4}/24`))
        assert.ok(guest.config['user.network-config'].includes('192.0.2.1'))
        assert.ok(guest.config['user.network-config'].includes('9.9.9.9'))
        assert.ok(!guest.config['user.network-config'].includes('10.10.0.1'))
        assert.equal((await prisma.publicIpv4Address.findUniqueOrThrow({ where: { instanceId: instance.id } })).status, 'assigned')
      }
      if (scenario === 'vm-macs') {
        assert.equal(guest.devices.eth0.hwaddr, '00:16:3e:11:22:33')
        assert.ok(guest.config['user.network-config'].includes('macaddress: "00:16:3e:11:22:33"'))
      }
      assert.deepEqual(await registeredGuestIdentity(prisma, delivered, taskType === 'change_host' ? targetHost : currentHost), { uuid: guest.config['volatile.uuid'], createdAt: guest.created_at })
      if (scenario !== 'legacy-marker') assert.equal((delivered.snapshottedSpecs as any).managedCleanup.attempt, guest.config['user.payincus.provisioning-attempt'])
      if (scenario === 'dual-stack') {
        const mappings = await prisma.portMapping.findMany({ where: { instanceId: delivered.id } })
        assert.equal(mappings.length, 1); assert.equal(mappings[0].systemManaged, true)
        assert.equal(guest.devices.proxy.listen, `tcp:192.0.2.5:${mappings[0].publicPort}`)
        assert.equal(guest.devices['proxy-v6'].listen, `tcp:[2001:db8::5]:${mappings[0].publicPort}`)
        assert.equal(guest.devices.proxy.nat, 'true'); assert.equal(guest.devices['proxy-v6'].nat, undefined)
        assert.ok(!guest.devices.eth1, 'shared IPv6 must not allocate a routed NIC')
        assert.ok(!guest.config['user.network-config'].includes('macaddress'), 'container configuration matches names')
      }
      if (taskType !== 'clone') {
        // A process may be lost after the identity switch, before task completion.
        await prisma.instanceTask.update({ where: { id: result.id }, data: { status: 'FAILED' } })
        assert.deepEqual(await registeredGuestIdentity(prisma, delivered, taskType === 'change_host' ? targetHost : currentHost),
          { uuid: guest.config['volatile.uuid'], createdAt: guest.created_at })
      }
      if (taskType !== 'clone') {
        assert.equal((row.snapshottedSpecs as any).retained, 'billing-spec'); assert.equal(row.status, 'running')
        if (!vmScenario) assert.ok(calls.indexOf(`DELETE /1.0/instances/${row.incusId}/files?path=/etc/cloud/cloud-init.disabled`) < calls.indexOf(`PUT /1.0/instances/${row.incusId}/state`))
      } else { assert.equal(delivered.status, 'stopped'); await prisma.instance.delete({ where: { id: delivered.id } }) }
    } else if (['unknown-original', 'wrong-uuid', 'wrong-type'].includes(scenario)) {
      assert.equal(result.status, 'FAILED'); assert.match(result.error!, /REINSTALL_ORIGINAL_IDENTITY|GUEST_DELIVERY_SOURCE_IDENTITY/)
      assert.equal(calls.filter(call => !call.startsWith('GET ')).length, 0)
    } else if (taskType === 'rebuild' && scenario === 'lost-response') {
      assert.equal(result.status, 'PROCESSING'); assert.equal(result.progress, 'manual_intervention'); assert.equal((result.replacementState as any).targetPhase, 'rebuild_uncertain')
      assert.ok((result.replacementState as any).pendingRootPassword)
      assert.ok(!JSON.stringify(await getInstanceTaskById(result.id)).includes('pendingRootPassword'))
      assert.equal(row.rootPassword, instance.rootPassword, 'uncertain result must not advertise an unconfirmed password')
      assert.equal(guests.size, 1)
    } else {
      assert.equal(result.status, scenario === 'lost-response' ? 'FAILED' : 'PROCESSING'); assert.equal(createCount, 1)
      const state = result.replacementState as any
      const remainingOriginal = taskType === 'recreate' ? 0 : 1
      if (scenario === 'lost-response') { assert.equal(guests.size, remainingOriginal); assert.equal(state.targetPhase, 'cleaned') }
      else {
        assert.equal(guests.size, remainingOriginal + 1); assert.equal(state.targetPhase, 'cleanup_pending')
        assert.ok(row.ipv4, 'unconfirmed cleanup must retain its reserved replacement IPv4')
        if (taskType === 'clone' && scenario === 'cleanup-refused') {
          await prisma.host.update({ where: { id: host.id }, data: { natPortStart: 32000, natPortEnd: 32020 } })
          // Simulate an interruption after address preparation (the create-
          // response failure above happens before the normal allocation step).
          const receiptAddress = await allocateAndReserveNatIpv4(host.id)
          assert.ok(receiptAddress)
          const currentReceipt = await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
          await prisma.instanceTask.update({ where: { id: task.id }, data: { replacementState: {
            ...(currentReceipt.replacementState as any), targetIpv4: receiptAddress,
            targetPorts: [{ protocol: 'tcp', publicPort: 32019, privatePort: 22 }]
          } } })
          await assert.rejects(createPortMapping({ hostId: host.id, instanceId: instance.id, protocol: 'tcp', publicPort: 32019, privatePort: 80 }), /PORT_RESERVED_BY_CREATION/)
          await assert.rejects(createPortMappingsBatch([
            { hostId: host.id, instanceId: instance.id, protocol: 'tcp', publicPort: 32018, privatePort: 80 },
            { hostId: host.id, instanceId: instance.id, protocol: 'tcp', publicPort: 32019, privatePort: 80 }
          ]), /PORT_RESERVED_BY_CREATION/)
          assert.ok(!(await allocatePorts(host.id, 100, 'tcp')).includes(32019))
          assert.ok(!(await suggestAvailablePorts(host.id, 100, 'udp', [], true)).includes(32019))
          assert.ok((await suggestAvailablePorts(host.id, 100, 'udp')).includes(32019), 'TCP hold must not consume the independent UDP port')
          assert.equal(await prisma.portMapping.count({ where: { instanceId: instance.id } }), 0)
          const heldIpv6 = `2001:db8::${task.id.toString(16)}`
          const pending = (await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })).replacementState as any
          await prisma.instanceTask.update({ where: { id: task.id }, data: { replacementState: { ...pending, targetPhase: 'creating' } } })
          assert.equal(await reserveInstanceTaskIpv6(task.id, heldIpv6), true)
          assert.equal(await reserveInstanceTaskIpv6(task.id, heldIpv6), true, 'the same original reservation is idempotent')
          assert.equal(await isIpAddressExists(heldIpv6), true)
          assert.equal(await isIpAddressExists(heldIpv6.toUpperCase()), true, 'IPv6 textual aliases must see the same pending hold')
          const competing = await prisma.instanceTask.create({ data: { taskType: 'clone', hostId: targetHost.id, instanceId: instance.id,
            userId: owner.id, status: 'PROCESSING', replacementState: { targetPhase: 'reserved' } } })
          try {
            assert.equal(await reserveInstanceTaskIpv6(competing.id, heldIpv6), false, 'another task and host cannot reuse pending IPv6')
            await assert.rejects(createIpAddress({ hostId: host.id, instanceId: instance.id, address: heldIpv6, type: 'inet6', isPrimary: true, device: 'eth1' }), /IP_ADDRESS_ALREADY_EXISTS/)
            await assert.rejects(createIpAddress({ hostId: host.id, instanceId: instance.id, address: heldIpv6.toUpperCase(), type: 'inet6', isPrimary: true, device: 'eth1' }), /IP_ADDRESS_ALREADY_EXISTS/)
          } finally { await prisma.instanceTask.delete({ where: { id: competing.id } }) }
          await prisma.instanceTask.update({ where: { id: task.id }, data: { replacementState: { ...pending, targetIpv6: heldIpv6 } } })
          await prisma.natIpv4Reservation.updateMany({ where: { hostId: host.id }, data: { expiresAt: new Date(0) } })
          const random = Math.random
          try {
            // Force selection of the held address if it incorrectly re-enters the free set.
            const { listNatIpv4Pool } = await import('../src/lib/ip-calculator.js')
            const candidates = listNatIpv4Pool().filter(ip => ip !== instance.ipv4)
            Math.random = () => (candidates.indexOf(receiptAddress) + 0.1) / candidates.length
            assert.notEqual(await allocateAndReserveNatIpv4(host.id), receiptAddress)
          } finally { Math.random = random }
        }
        assert.equal(await prisma.instance.count({ where: { hostId: host.id, ipv4: row.ipv4 } }), 1)
        if (scenario === 'alien-target') assert.equal(calls.filter(call => call === `DELETE /1.0/instances/${state.targetIncusId}`).length, 0)
        if (taskType !== 'recreate') {
          const available = await prisma.$transaction(tx => selectAndReserveHostWithLock(tx, { hostId: taskType === 'clone' ? host.id : targetHost.id,
            cpu: 1, memory: 1, disk: 1, reservationOnly: true, packageId: pkg.id }))
          assert.equal(available, null, 'unconfirmed residue fences allocation even with free counters')
        }
        if (scenario === 'cleanup-refused') {
          if (taskType === 'recreate') {
            // Historical failed receipts still own their remote remainder.
            // Deletion must not mark the original deleted before its cleanup
            // coordinator can finish and verify the old attempt.
            await prisma.instanceTask.update({ where: { id: task.id }, data: { status: 'FAILED' } })
            const beforeDelete = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
            await assert.rejects(requestInstanceDeletion(beforeDelete, { id: owner.id, sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }, { mode: 'host', deferRemote: true }), /DELETE_WORKFLOW_BUSY/)
            assert.deepEqual(await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } }), beforeDelete)
          }
          const beforeBusy = await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
          await reconcileInterruptedReinstalls(id => id === task.id)
          assert.deepEqual((await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })).replacementState, beforeBusy.replacementState)
          mode = 'recovered'
          await reconcileInterruptedReinstalls()
          const recovered = await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
          assert.equal(recovered.status, 'FAILED', recovered.error || ''); assert.equal((recovered.replacementState as any).targetPhase, 'cleaned')
          assert.equal(guests.size, remainingOriginal); assert.equal(createCount, 1, 'restart reconciliation must not create twice')
          if (taskType === 'recreate') {
            const cleaned = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
            const count = calls.length
            await requestInstanceDeletion(cleaned, { id: owner.id, sid: tag, iat: Math.floor(Date.now() / 1000) + 1 }, { mode: 'host', deferRemote: true })
            assert.equal((await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })).status, 'deleted', 'verified cleanup permits the subsequent deletion')
            assert.equal(calls.length, count, 'deferred deletion performs no extra remote action')
          }
          if (taskType === 'clone') assert.equal(await isIpAddressExists(`2001:db8::${task.id.toString(16)}`), false, 'confirmed cleanup releases the IPv6 receipt')
        }
        if (scenario === 'alien-target') {
          for (let remaining = 0; remaining < 6; remaining++) {
            const prior = await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
            await prisma.instanceTask.update({ where: { id: task.id }, data: { replacementState: { ...(prior.replacementState as any), cleanupNextAt: '2000-01-01T00:00:00.000Z' } } })
            await reconcileInterruptedReinstalls()
          }
          const exhausted = await prisma.instanceTask.findUniqueOrThrow({ where: { id: task.id } })
          assert.equal((exhausted.replacementState as any).cleanupAttempts, 6); assert.equal(exhausted.progress, 'cleanup_pending')
          const count = calls.length; await reconcileInterruptedReinstalls(); assert.equal(calls.length, count)
        }
      }
    }
    console.log(`PASS ${architecture}/${taskType}/${scenario}: original identity, durable attempt, final identity and billing preserved`)
    await prisma.instanceTask.deleteMany({ where: { instanceId: instance.id } })
    await prisma.instance.delete({ where: { id: instance.id } })
  }
  }
} finally {
  await closeAllClients()
  await new Promise<void>(resolve => remote.close(() => resolve()))
  await prisma.instanceTask.deleteMany({ where: { instanceId: { in: ids } } })
  await prisma.instance.deleteMany({ where: { id: { in: ids } } })
  await prisma.package.delete({ where: { id: pkg.id } }); await prisma.host.delete({ where: { id: targetHost.id } })
  await prisma.host.delete({ where: { id: host.id } }); await prisma.systemImage.delete({ where: { id: image.id } })
  await prisma.user.delete({ where: { id: owner.id } }); await closePrismaDatabase()
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes(tag))
  await rm(root, { recursive: true, force: true })
}
console.log('PASS fixture cleanup complete; no native Incus or production operation')
process.exit(0)
