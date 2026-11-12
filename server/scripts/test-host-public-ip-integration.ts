import { protectedAgentFixture } from './fixtures/guest-protection.js'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { once } from 'node:events'
import ssh2 from 'ssh2'
import Fastify from 'fastify'
import { mock } from 'node:test'

const database = new URL(process.env.DATABASE_URL || '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) && database.pathname.endsWith('_pool_test'), 'Use an isolated local *_pool_test database')
process.env.JWT_SECRET ||= 'public-ip-integration-only'
const { prisma, closePrismaDatabase } = await import('../src/db/prisma.js')
const { syncHostPublicIp, scanHostPublicIps } = await import('../src/services/host-public-ip-sync.js')
const { applyCustomerInstanceView } = await import('../src/lib/customer-instance-view.js')
const { PublicIpSyncError, verifyPublicSshIdentity } = await import('../src/lib/host-public-ip.js')
const { getPoolOrderResult } = await import('../src/services/pool-orders.js')
const { getHostById } = await import('../src/db/hosts.js')
const { getInstancesPaginated, getHostsPaginated } = await import('../src/db/pagination.js')
const { dedicatedHostReadyWhere } = await import('../src/lib/host-resource-usage.js')
const { default: routes } = await import('../src/routes/host-inventory.js')

const prefix = `ip-test-${randomUUID().slice(0, 8)}`
const owner = await prisma.user.create({ data: { username: `${prefix}-admin`, passwordHash: 'unusable-test-hash', role: 'admin' } })
const buyer = await prisma.user.create({ data: { username: `${prefix}-buyer`, passwordHash: 'unusable-test-hash', balance: 123 } })
const batchId = randomUUID()
await prisma.hostOnboardingBatch.create({ data: { id: batchId, createdById: owner.id, name: prefix, accountLabel: 'test', defaults: {} } })
let sequence = 0
async function makeHost() {
  const seq = ++sequence
  return prisma.host.create({ data: {
    userId: owner.id, name: `${prefix}-${seq}`, url: `https://10.253.240.${seq + 1}:8443`, status: 'online', isInstalled: true, certPath: 'fixture.crt', keyPath: 'fixture.key',
    singleTenant: true, resourcePreset: 'E2', architecture: 'x86_64', cpuAllowanceMax: 200, memoryMax: 768, storageSize: 34, customerDiskGiB: 30,
    natPublicIp: `8.8.8.${seq}`, natBindIp: '10.0.0.13', natPortStart: 1, natPortEnd: 65535,
    serverCertificate: 'isolated-fake-certificate', serverFingerprint: 'isolated-fake-pin', managementSshHost: `10.253.240.${seq + 1}`,
    portProtocol: 'tcp', portProtocolApplied: 'tcp', portProtocolRevision: 1, portProtocolAppliedRevision: 1,
    storagePools: { create: { name: 'default', driver: 'dir', purpose: 'instance_data' } },
    agent: { create: { ...protectedAgentFixture(['ingress-port-protocol-v1']) } },
    onboardingNode: { create: { batchId, name: `${prefix}-${seq}`, publicIp: `8.8.8.${seq}`, managementIp: `10.253.240.${seq + 1}`,
      sshPort: 2200, sshFingerprint: 'SHA256:host-fixture', status: 'succeeded', credentialsExpireAt: new Date(0) } }
  }, include: { onboardingNode: true } })
}
const app = Fastify()
app.decorate('authenticateAdmin', async (request: any, reply: any) => {
  if (request.headers['x-test-role'] !== 'admin') return reply.code(403).send({ code: 'FORBIDDEN' })
  request.user = { id: owner.id, username: owner.username, role: 'admin' }
})
await app.register(routes)
let failure: unknown
try {
  const host = await makeHost()
  let candidate = '8.8.4.4', bind = '10.0.0.13', handshake = Math.floor(Date.now() / 1000)
  let remoteInstances: Array<{ name: string; status: string; project: string }> = []
  let forwards: Array<{ listen_address: string; description: string; config: { target_address: string }; ports: unknown[] }> = []
  let identityError = false, connections = 0, extraAddresses: string[] = []
  const writes: string[] = []
  const verifications: Array<{ host: string; port: number; fingerprints: string[] }> = []
  const client: any = { withMaintenanceDatabase(){return this}, request: async (method: string, path: string, body?: any, _timeout?: number, signal?: AbortSignal) => {
    assert.ok(signal, 'network requests have an actual abort signal')
    if (method === 'GET') {
      if (path === '/1.0/networks?recursion=1') return [{ name: 'eth0', type: 'physical', managed: false }, { name: 'incusbr0', type: 'bridge', managed: true }]
      if (path === '/1.0/networks/eth0/state') return { state: 'up', addresses: [bind, ...extraAddresses].map(address => ({ family: 'inet', scope: 'global', address })) }
      if (path === '/1.0/instances?recursion=1&all-projects=true') return structuredClone(remoteInstances)
      if (path === '/1.0/networks/incusbr0/forwards?recursion=1') return structuredClone(forwards)
    }
    if (path.startsWith('/1.0/networks/incusbr0/forwards')) {
      writes.push(`${method} ${path}`)
      if (method === 'POST') { forwards.push(structuredClone(body)); return {} }
      const address = decodeURIComponent(path.split('/').pop()!)
      if (method === 'PUT') { Object.assign(forwards.find(row => row.listen_address === address)!, body); return {} }
      if (method === 'DELETE') { forwards = forwards.filter(row => row.listen_address !== address); return {} }
    }
    throw new Error(`Unexpected network request: ${method} ${path}`)
  } }
  const deps = {
    peers: async () => [{ nodeId: host.onboardingNode!.id, managementIp: host.onboardingNode!.managementIp!, publicIp: candidate, lastHandshakeAt: handshake }],
    connect: async () => { connections++; return client },
    fingerprints: async () => ['SHA256:customer-fixture'],
    verify: async (address: string, port: number, fingerprints: string[]) => {
      verifications.push({ host: address, port, fingerprints })
      if (identityError) throw new PublicIpSyncError('IP_IDENTITY_MISMATCH')
    }
  }
  for (const [method, path, payload] of [
    ['GET', `/inventory/${host.id}/public-ip`, undefined],
    ['POST', `/inventory/${host.id}/public-ip/sync`, {}]
  ] as const) {
    const response = await app.inject({ method, url: path, headers: { 'x-test-role': 'user' }, payload })
    assert.equal(response.statusCode, 403, 'ordinary customers cannot inspect management or change public addresses')
  }
  const invalid = await app.inject({ method: 'POST', url: `/inventory/${host.id}/public-ip/sync`, headers: { 'x-test-role': 'admin' },
    payload: { settings: { mode: 'manual', publicIp: '169.254.169.254' } } })
  assert.equal(invalid.json().code, 'IP_SETTINGS_INVALID', 'manual input cannot probe link-local or private services')

  const emptyResult = await syncHostPublicIp(host.id, {}, deps)
  assert.equal(emptyResult.status, 'synced')
  assert.equal(emptyResult.currentIp, candidate)
  assert.equal(emptyResult.blocked, false)
  assert.deepEqual(verifications[0], { host: candidate, port: 2200, fingerprints: ['SHA256:host-fixture'] }, 'empty hosts verify their pinned management SSH identity')
  assert.equal(writes.length, 0, 'empty host reconciliation must not create a customer or forwarding')
  const initial = await prisma.host.findUniqueOrThrow({ where: { id: host.id }, include: { onboardingNode: true } })
  assert.equal(initial.url, host.url)
  assert.equal(initial.managementSshHost, host.managementSshHost)
  assert.equal(initial.onboardingNode!.activePublicIp, candidate, 'DB effective index follows verified host IP')
  assert.equal(initial.onboardingNode!.publicIp, host.onboardingNode!.publicIp, 'the original onboarding address remains historical evidence')

  const beforeMaintenanceIp=await prisma.host.findUniqueOrThrow({where:{id:host.id}})
  const beforeMaintenanceCalls={connections,writes:writes.length,verifications:verifications.length}
  await prisma.host.update({where:{id:host.id},data:{securityHardening:{maintenance:{phase:'waiting-boot'}}}})
  handshake=0
  const duringMaintenance=await syncHostPublicIp(host.id,{force:true},deps)
  assert.equal(duringMaintenance.error,beforeMaintenanceIp.publicIpSync&&typeof beforeMaintenanceIp.publicIpSync==='object'?
    (beforeMaintenanceIp.publicIpSync as any).error:null,'a planned reboot is not converted into a new IP failure')
  const heldIp=await prisma.host.findUniqueOrThrow({where:{id:host.id}})
  assert.deepEqual(heldIp.publicIpSync,beforeMaintenanceIp.publicIpSync,'original IP receipt is retained during maintenance')
  assert.equal(heldIp.publicIpSyncBlocked,false)
  assert.deepEqual({connections,writes:writes.length,verifications:verifications.length},beforeMaintenanceCalls)
  await assert.rejects(syncHostPublicIp(host.id,{settings:{mode:'manual',publicIp:'9.9.9.8'}},deps),/IP_SYNC_BUSY/)
  await prisma.host.update({where:{id:host.id},data:{publicIpSyncBlocked:true}})
  await syncHostPublicIp(host.id,{},deps)
  assert.equal((await prisma.host.findUniqueOrThrow({where:{id:host.id}})).publicIpSyncBlocked,true,'an existing IP protection is never cleared by maintenance')
  await prisma.host.update({where:{id:host.id},data:{securityHardening:(await import('@prisma/client')).Prisma.DbNull,publicIpSyncBlocked:false}})
  handshake=Math.floor(Date.now()/1000)
  assert.equal((await syncHostPublicIp(host.id,{},deps)).status,'synced','the same IP reconciliation resumes after maintenance')

  // Real row-lock race: a scan selected a host before maintenance registration,
  // then observes the durable fence after waiting for the registration commit.
  let registered!:()=>void,releaseRegistration!:()=>void
  const registrationReady=new Promise<void>(resolve=>{registered=resolve}),registrationGate=new Promise<void>(resolve=>{releaseRegistration=resolve})
  const registrar=prisma.$transaction(async tx=>{
    await tx.host.update({where:{id:host.id},data:{securityHardening:{maintenance:{phase:'prepared'}}}})
    registered();await registrationGate
  },{timeout:10000})
  await registrationReady
  const callsBeforeRace=connections,racingScan=syncHostPublicIp(host.id,{},deps)
  try {
    let waiting=false
    for(let i=0;i<100;i++) {
      const rows=await prisma.$queryRaw<Array<{waiting:boolean}>>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%hosts%FOR UPDATE%') AS waiting`
      if(rows[0]?.waiting){waiting=true;break}
      await new Promise(resolve=>setTimeout(resolve,20))
    }
    assert.ok(waiting,'observed actual IP reconciliation host-row lock wait')
  }finally{releaseRegistration()}
  await registrar;await racingScan
  assert.equal(connections,callsBeforeRace,'maintenance registered while waiting prevents late scan calls')
  await prisma.host.update({where:{id:host.id},data:{securityHardening:(await import('@prisma/client')).Prisma.DbNull}})

  const orderId = randomUUID()
  await prisma.poolOrder.create({ data: { id: orderId, userId: buyer.id, requestHash: 'test-only', totalCents: 100 } })
  const instance = await prisma.instance.create({ data: { userId: buyer.id, hostId: host.id, incusId: `${prefix}-customer`, name: 'customer-kept', status: 'running',
    image: 'images:alpine/3.21', cpu: 200, memory: 768, disk: 30720, ipv4: '10.10.1.2', dedicatedIpv4: true, dedicatedNetworkReady: true,
    billingPrice: 1, expiresAt: new Date('2030-01-01T00:00:00Z'), purchaseBatchId: orderId, autoRenew: false } })
  remoteInstances = [{ name: instance.incusId, status: 'Running', project: 'default' }]
  const ownerDescription = `payincus-dedicated:${instance.incusId}`
  forwards = [{ listen_address: bind, description: ownerDescription, config: { target_address: instance.ipv4! }, ports: [] },
    { listen_address: '10.0.0.99', description: 'unrelated-rule', config: { target_address: '10.10.1.99' }, ports: [] }]
  candidate = '1.1.1.1'; bind = '10.0.0.85'; identityError = true
  const failed = await syncHostPublicIp(host.id, {}, deps)
  assert.equal(failed.error, 'IP_IDENTITY_MISMATCH')
  assert.equal(failed.blocked, true)
  assert.equal(failed.currentIp, candidate, 'authenticated discovery displays the new address separately from ingress confirmation')
  assert.equal(failed.confirmedIp, emptyResult.currentIp, 'unverified ingress is never committed as the confirmed address')
  assert.equal(failed.currentBindIp, '10.0.0.13')
  assert.ok(forwards.some(row => row.listen_address === '10.0.0.13'), 'the previous owned binding stays until verification succeeds')
  assert.equal((await getHostById(host.id))!.public_ip_sync_blocked, true, 'detail mapper preserves the pending-address flag')
  assert.ok((await getHostsPaginated({ userId: owner.id, search: candidate })).items.some(row => row.id === host.id), 'node search finds the observed address before public verification')
  const inventorySearch = await app.inject({ method: 'GET', url: '/inventory?search=' + candidate, headers: { 'x-test-role': 'admin' } })
  assert.equal(inventorySearch.statusCode, 200)
  assert.ok(inventorySearch.json().hosts.some((row: any) => row.id === host.id && row.publicIp === candidate && row.publicIpSync.blocked), 'inventory search and current address use the same authenticated observation')
  const listed = await getInstancesPaginated({ userId: buyer.id })
  assert.equal((listed.items[0] as any).public_ip_sync_blocked, true, 'list mapper preserves the pending-address flag')
  for (const admin of [false, true]) {
    const displayed: Record<string, any> = { natPublicIp: emptyResult.currentIp, ipv4: instance.ipv4, host: { ip_address: host.managementSshHost } }
    applyCustomerInstanceView(displayed, listed.items[0] as any, admin)
    assert.equal(displayed.observedPublicIp, candidate); assert.equal(displayed.publicIpUpdating, true)
    if (!admin) { assert.equal(displayed.ipv4, null); assert.equal(displayed.natPublicIp, null, 'pending IP is display-only, never a connection credential') }
  }
  assert.equal((await getPoolOrderResult(buyer.id, orderId))!.instances[0]!.host, null, 'completed order pages hide a stale address too')
  identityError = false
  const retried = await syncHostPublicIp(host.id, {}, deps)
  assert.equal(retried.status, 'synced')
  assert.equal(retried.blocked, false)
  assert.equal(retried.currentIp, candidate)
  assert.equal(retried.currentBindIp, bind)
  assert.equal(writes.filter(row => row.startsWith('POST')).length, 1, 'lost verification can retry without duplicate forward creation')
  assert.deepEqual(forwards.map(row => row.listen_address).sort(), ['10.0.0.85', '10.0.0.99'])
  assert.equal((await getPoolOrderResult(buyer.id, orderId))!.instances[0]!.host, candidate)
  assert.deepEqual(await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } }), instance, 'IP changes do not rewrite the instance, credentials, price or expiry')
  assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), 123)

  // OCI replaces the public-IP object on the same VNIC/private address.
  const beforeOciInstance = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
  const beforeOciWrites = writes.length, beforeOciBind = bind
  handshake = 0
  const disconnected = await syncHostPublicIp(host.id, {}, deps)
  assert.equal(disconnected.error, 'IP_MANAGEMENT_OFFLINE'); assert.equal(disconnected.blocked, true)
  assert.equal(writes.length, beforeOciWrites, 'no public IP never rewrites private forwarding')
  handshake = Math.floor(Date.now() / 1000); candidate = '1.1.1.2'
  const reattached = await syncHostPublicIp(host.id, {}, deps)
  assert.equal(reattached.status, 'synced'); assert.equal(reattached.currentBindIp, beforeOciBind)
  assert.equal(writes.length, beforeOciWrites, 'same OCI private IP preserves all existing forwarding')
  assert.deepEqual(await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } }), beforeOciInstance)
  const unknownEndpoint = await syncHostPublicIp(host.id, { peers: [{ nodeId: host.onboardingNode!.id, managementIp: host.onboardingNode!.managementIp!, publicIp: null, lastHandshakeAt: handshake }] }, deps)
  assert.equal(unknownEndpoint.error, 'IP_PUBLIC_UNDETECTED'); assert.equal(unknownEndpoint.status, 'pending'); assert.equal(unknownEndpoint.blocked, true)
  assert.equal((await syncHostPublicIp(host.id, {}, deps)).status, 'synced')

  const beforeStale = connections
  handshake -= 500
  assert.equal((await syncHostPublicIp(host.id, { force: true }, deps)).error, 'IP_MANAGEMENT_OFFLINE')
  assert.equal(connections, beforeStale, 'stale WireGuard endpoints cannot trigger remote mutations')
  handshake = Math.floor(Date.now() / 1000)
  identityError = true
  const rejectedManual = await syncHostPublicIp(host.id, { settings: { mode: 'manual', publicIp: '9.9.9.8' } }, deps)
  assert.equal(rejectedManual.observedIp, candidate, 'unverified manual input cannot become authenticated observation')
  identityError = false
  const manual = await syncHostPublicIp(host.id, { settings: { mode: 'manual', publicIp: '9.9.9.9', sshPort: 2222 } }, deps)
  assert.equal(manual.currentIp, '9.9.9.9')
  assert.equal(verifications.at(-1)!.port, 2222, 'changed customer SSH ports are supported without storing their password')
  candidate = '1.0.0.1'
  assert.equal((await syncHostPublicIp(host.id, {}, deps)).currentIp, '9.9.9.9', 'manual ingress remains stable when egress is different')

  await prisma.instance.update({ where: { id: instance.id }, data: { status: 'stopped' } })
  remoteInstances[0]!.status = 'Stopped'
  const stopped = await syncHostPublicIp(host.id, { settings: { mode: 'auto' } }, deps)
  assert.equal(stopped.error, 'IP_INSTANCE_STOPPED')
  assert.equal(stopped.blocked, true)
  assert.equal(stopped.currentIp, candidate)
  assert.equal(stopped.confirmedIp, '9.9.9.9')
  const stoppedSnapshot = await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } })
  const writesBeforeStopped = writes.length
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.equal((await syncHostPublicIp(host.id, {}, deps)).error, 'IP_INSTANCE_STOPPED')
  }
  assert.deepEqual(await prisma.instance.findUniqueOrThrow({ where: { id: instance.id } }), stoppedSnapshot, 'stopped guest, billing and identity stay unchanged')
  assert.equal(writes.length, writesBeforeStopped, 'stopped guests receive no network or startup mutations')
  await prisma.instance.update({ where: { id: instance.id }, data: { status: 'running' } })
  remoteInstances[0]!.status = 'Running'
  assert.equal((await syncHostPublicIp(host.id, {}, deps)).currentIp, candidate, 'starting later resumes a persisted pending address')

  const busyTask = await prisma.instanceTask.create({ data: { instanceId: instance.id, userId: buyer.id, hostId: host.id, taskType: 'restart', status: 'PENDING' } })
  candidate = '1.0.0.2'
  const beforeBusy = writes.length
  assert.equal((await syncHostPublicIp(host.id, {}, deps)).error, 'IP_INSTANCE_BUSY')
  assert.equal(writes.length, beforeBusy, 'in-flight instance operations are not disturbed')
  await prisma.instanceTask.update({ where: { id: busyTask.id }, data: { status: 'COMPLETED' } })
  assert.equal((await syncHostPublicIp(host.id, {}, deps)).status, 'synced')

  const { onboardingAddressConflict } = await import('../src/services/onboarding-conflicts.js')
  assert.equal(await onboardingAddressConflict(host.onboardingNode!.publicIp), null, 'historical onboarding IP no longer blocks a different host')
  assert.equal((await onboardingAddressConflict(candidate))?.code, 'HOST_IP_ALREADY_REGISTERED')
  const reused = await prisma.hostOnboardingNode.create({ data: { batchId, name: `${prefix}-reused`, publicIp: host.onboardingNode!.publicIp,
    credentialsExpireAt: new Date(0), status: 'queued' } })
  assert.equal(reused.activePublicIp, host.onboardingNode!.publicIp)
  assert.equal((await onboardingAddressConflict(host.onboardingNode!.publicIp))?.code, 'HOST_IP_ONBOARDING')
  await prisma.hostOnboardingNode.update({ where: { id: reused.id }, data: { deletedAt: new Date() } })
  assert.equal(await onboardingAddressConflict(host.onboardingNode!.publicIp), null)

  const beforeQuarantine = writes.length
  candidate = '1.0.0.9'
  await prisma.host.update({ where: { id: host.id }, data: { poolFaulted: true } })
  const quarantined = await syncHostPublicIp(host.id, {}, deps)
  assert.equal(quarantined.error, 'IP_HOST_QUARANTINED'); assert.equal(quarantined.currentIp, candidate)
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).poolFaulted, true)
  assert.equal(writes.length, beforeQuarantine, 'address discovery must not unquarantine or change customer networking')
  await prisma.host.update({ where: { id: host.id }, data: { poolFaulted: false } })
  assert.equal((await syncHostPublicIp(host.id, {}, deps)).status, 'synced')

  const other = await makeHost()
  candidate = other.natPublicIp!
  assert.equal((await syncHostPublicIp(host.id, {}, deps)).error, 'IP_ALREADY_ASSIGNED')
  candidate = '1.0.0.3'; bind = '10.0.0.86'; extraAddresses = ['10.0.0.87']
  assert.equal((await syncHostPublicIp(host.id, {}, deps)).error, 'IP_BIND_AMBIGUOUS')
  extraAddresses = []
  forwards.push({ listen_address: bind, description: 'other-owner', config: { target_address: '10.10.1.99' }, ports: [] })
  assert.equal((await syncHostPublicIp(host.id, {}, deps)).status, 'failed')
  assert.equal(forwards.find(row => row.listen_address === bind)!.description, 'other-owner', 'owned-address conflicts are never overwritten')
  forwards = forwards.filter(row => row.listen_address !== bind)

  let entered!: () => void, release!: () => void
  const reached = new Promise<void>(resolve => { entered = resolve })
  const barrier = new Promise<void>(resolve => { release = resolve })
  const gated = { ...deps, verify: async (...args: Parameters<typeof deps.verify>) => { await deps.verify(...args); entered(); await barrier } }
  const first = syncHostPublicIp(host.id, {}, gated)
  await reached
  assert.equal(syncHostPublicIp(host.id, {}, gated), first, 'duplicate requests join the same reconciliation')
  await assert.rejects(syncHostPublicIp(host.id, { settings: { mode: 'auto' } }, gated), /IP_SYNC_BUSY/)
  release()
  assert.equal((await first).status, 'synced')
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: host.id } })).ipAddress, candidate, 'node address follows the verified public IP')

  // Actual SSH key exchange over isolated loopback sockets: OCI gives B the
  // address previously used by A, without giving B any of A's identities.
  const pairA = ssh2.utils.generateKeyPairSync('ed25519'), pairB = ssh2.utils.generateKeyPairSync('ed25519')
  const fingerprint = (key: string) => {
    const parsed = ssh2.utils.parseKey(key)
    assert.ok(!(parsed instanceof Error) && !Array.isArray(parsed))
    return 'SHA256:' + createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '')
  }
  const keyA = fingerprint(pairA.private), keyB = fingerprint(pairB.private)
  assert.notEqual(keyA, keyB)
  let authenticationAttempts = 0, commands = 0
  const connectionsA = new Set<ssh2.Connection>(), connectionsB = new Set<ssh2.Connection>()
  const sshServer = (key: string, connections: Set<ssh2.Connection>) => new ssh2.Server({ hostKeys: [key] }, connection => {
    connections.add(connection); connection.on('close', () => connections.delete(connection)); connection.on('error', () => {})
    connection.on('authentication', context => { if (context.method !== 'none') authenticationAttempts++; context.reject() })
    connection.on('session', () => { commands++ })
  })
  const sshA = sshServer(pairA.private, connectionsA), sshB = sshServer(pairB.private, connectionsB)
  sshA.listen(0, '127.0.0.1'); await once(sshA, 'listening')
  sshB.listen(0, '127.0.0.1'); await once(sshB, 'listening')
  const portA = (sshA.address() as { port: number }).port, portB = (sshB.address() as { port: number }).port
  const originalConnect = ssh2.Client.prototype.connect
  let oldIpTarget: 'A' | 'B' = 'A'
  const routeSsh = mock.method(ssh2.Client.prototype, 'connect', function (this: ssh2.Client, options: ssh2.ConnectConfig) {
    assert.ok(['1.1.1.1', '1.1.1.2', '1.1.1.3'].includes(options.host!))
    assert.equal(options.port, 22)
    const targetA = options.host === '1.1.1.2' || (options.host === '1.1.1.1' && oldIpTarget === 'A')
    return originalConnect.call(this, { ...options, host: '127.0.0.1', port: targetA ? portA : portB })
  })
  try {
    const [a, b] = await Promise.all([makeHost(), makeHost()])
    for (const [row, ip, key, label] of [[a, '1.1.1.1', keyA, 'A'], [b, '1.1.1.3', keyB, 'B']] as const) {
      await prisma.host.update({ where: { id: row.id }, data: { natPublicIp: ip, ipAddress: ip, location: 'same-region',
        serverCertificate: `isolated-${label}-certificate`, serverFingerprint: `isolated-${label}-pin`,
        onboardingNode: { update: { publicIp: ip, sshFingerprint: key, sshPort: 22 } } } })
    }
    const customers = await Promise.all([a, b].map((row, i) => prisma.instance.create({ data: {
      userId: buyer.id, hostId: row.id, incusId: `${prefix}-reuse-${i}`, name: `customer-${i}`, status: 'running',
      image: 'images:alpine/3.21', cpu: 200, memory: 768, disk: 30720, ipv4: `10.10.2.${i + 2}`, dedicatedIpv4: true, dedicatedNetworkReady: true,
      billingPrice: i + 2, expiresAt: new Date('2030-02-01T00:00:00Z'), purchaseBatchId: orderId, autoRenew: true
    } })))
    const addresses = new Map([[a.id, '1.1.1.1'], [b.id, '1.1.1.3']])
    const packets: Array<{ hostId: number; ip: string; keys: string[] }> = []
    const reuseWrites: string[] = []
    const forwardsByHost = new Map([a, b].map((row, i) => [row.id, [{ listen_address: '10.0.0.13',
      description: `payincus-dedicated:${customers[i]!.incusId}`, config: { target_address: customers[i]!.ipv4! }, ports: [] }]]))
    const clientsByHost = new Map([a, b].map((row, i) => [row.id, { withMaintenanceDatabase(){return this}, request: async (method: string, path: string) => {
      assert.equal(method, 'GET', 'OCI public remapping must never rewrite unchanged private forwards')
      if (path === '/1.0/networks?recursion=1') return [{ name: 'eth0', type: 'physical', managed: false }]
      if (path.endsWith('/state')) return { state: 'up', addresses: [{ family: 'inet', scope: 'global', address: '10.0.0.13' }] }
      if (path === '/1.0/instances?recursion=1&all-projects=true') return [{ name: customers[i]!.incusId, status: 'Running', project: 'default' }]
      if (path === '/1.0/networks/incusbr0/forwards?recursion=1') return structuredClone(forwardsByHost.get(row.id))
      reuseWrites.push(method + ' ' + path); throw Error('Unexpected OCI mutation')
    } } as any]))
    let unreachable = false
    const reuseDeps = {
      peers: async () => [a, b].map(row => ({ nodeId: row.onboardingNode!.id, managementIp: row.onboardingNode!.managementIp!,
        publicIp: addresses.get(row.id)!, lastHandshakeAt: Math.floor(Date.now() / 1000) })),
      connect: async (row: any) => {
        const label = row.id === a.id ? 'A' : 'B'
        assert.equal(row.serverCertificate, `isolated-${label}-certificate`); assert.equal(row.serverFingerprint, `isolated-${label}-pin`)
        assert.equal(row.managementSshHost, (row.id === a.id ? a : b).managementSshHost)
        return clientsByHost.get(row.id)!
      },
      fingerprints: async (remote: any, name: string) => {
        const index = clientsByHost.get(a.id) === remote || Object.getPrototypeOf(remote) === clientsByHost.get(a.id) ? 0 : 1
        assert.equal(name, customers[index]!.incusId)
        return [index === 0 ? keyA : keyB]
      },
      verify: async (...args: Parameters<typeof verifyPublicSshIdentity>) => {
        packets.push({ hostId: args[2].includes(keyA) ? a.id : b.id, ip: args[0], keys: args[2] })
        if (unreachable) throw new PublicIpSyncError('IP_SSH_UNREACHABLE')
        return verifyPublicSshIdentity(...args)
      }
    }
    assert.equal((await syncHostPublicIp(a.id, {}, reuseDeps)).status, 'synced')
    assert.equal((await syncHostPublicIp(b.id, {}, reuseDeps)).status, 'synced')
    const originals = await prisma.host.findMany({ where: { id: { in: [a.id, b.id] } }, include: { agent: true, onboardingNode: true } })
    const forwardSnapshot = structuredClone([...forwardsByHost])
    const beforeReuseBalance = Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance)
    // B arrives before A's database confirmation catches up. Do not steal A's
    // reservation, probe with A's key, or make any customer/network mutation.
    addresses.set(a.id, '1.1.1.2'); addresses.set(b.id, '1.1.1.1'); oldIpTarget = 'B'
    const packetCount = packets.length
    for (const delay of [60000, 120000]) {
      const startedAt = Date.now(), conflict = await syncHostPublicIp(b.id, {}, reuseDeps)
      assert.equal(conflict.error, 'IP_ALREADY_ASSIGNED'); assert.equal(conflict.blocked, true)
      assert.equal(conflict.confirmedIp, '1.1.1.3'); assert.ok(Date.parse(conflict.nextCheckAt!) >= startedAt + delay)
      assert.equal(packets.length, packetCount, 'another current owner prevents public probing/writes')
    }
    assert.equal((await syncHostPublicIp(a.id, {}, reuseDeps)).confirmedIp, '1.1.1.2')
    // Automatic scanner honors persisted backoff. Only B is due when the former
    // owner has safely committed its new address; no manual retry is needed.
    const deferred = await prisma.host.findMany({ where: { id: { not: b.id } }, select: { id: true, publicIpSync: true } })
    for (const row of deferred) await prisma.host.update({ where: { id: row.id }, data: {
      publicIpSync: { ...(row.publicIpSync as object || {}), nextCheckAt: new Date(Date.now() + 3600000).toISOString() }
    } })
    assert.equal(((await prisma.host.findUniqueOrThrow({ where: { id: a.id } })).publicIpSync as any).observedIp, '1.1.1.2', 'deferring A must preserve its actual observed identity/address state')
    const expireB = async () => {
      const row = await prisma.host.findUniqueOrThrow({ where: { id: b.id } })
      await prisma.host.update({ where: { id: b.id }, data: { publicIpSync: { ...(row.publicIpSync as object), nextCheckAt: new Date(0).toISOString() } } })
    }
    unreachable = true; await expireB()
    const failedAt = Date.now(); await scanHostPublicIps(reuseDeps)
    let state = (await prisma.host.findUniqueOrThrow({ where: { id: b.id } })).publicIpSync as any
    assert.equal(state.status, 'pending'); assert.equal(state.error, 'IP_SSH_UNREACHABLE'); assert.equal(state.retryAttempts, 1)
    assert.ok(Date.parse(state.nextCheckAt) >= failedAt + 60000)
    const notDue = packets.length; await scanHostPublicIps(reuseDeps)
    assert.equal(packets.length, notDue, 'scanner never retries before persisted nextCheckAt')
    await expireB(); await scanHostPublicIps(reuseDeps)
    state = (await prisma.host.findUniqueOrThrow({ where: { id: b.id } })).publicIpSync as any
    assert.equal(state.retryAttempts, 2); assert.equal(state.status, 'pending')
    assert.ok(Date.parse(state.nextCheckAt) >= failedAt + 120000)
    // A's SSH service at B's new address is a real mismatch, never accepted.
    unreachable = false; oldIpTarget = 'A'; await expireB(); await scanHostPublicIps(reuseDeps)
    state = (await prisma.host.findUniqueOrThrow({ where: { id: b.id } })).publicIpSync as any
    assert.equal(state.error, 'IP_IDENTITY_MISMATCH'); assert.equal(state.status, 'failed')
    assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: b.id } })).natPublicIp, '1.1.1.3')
    oldIpTarget = 'B'; await expireB(); await scanHostPublicIps(reuseDeps)
    const finalB = await prisma.host.findUniqueOrThrow({ where: { id: b.id }, include: { agent: true, onboardingNode: true } })
    assert.equal(finalB.natPublicIp, '1.1.1.1'); assert.equal(finalB.onboardingNode!.activePublicIp, '1.1.1.1')
    assert.equal((finalB.publicIpSync as any).status, 'synced'); assert.equal((finalB.publicIpSync as any).retryAttempts, 0)
    assert.equal((finalB.publicIpSync as any).error, null); assert.equal(finalB.publicIpSyncBlocked, false)
    assert.deepEqual(packets.at(-1), { hostId: b.id, ip: '1.1.1.1', keys: [keyB] }, 'B uses its own guest key, never A history')
    assert.equal(await prisma.hostOnboardingNode.count({ where: { activePublicIp: '1.1.1.1' } }), 1)
    assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: a.id } })).natPublicIp, '1.1.1.2')
    assert.equal((await onboardingAddressConflict('1.1.1.1'))!.host!.id, b.id)
    assert.equal((await onboardingAddressConflict('1.1.1.2'))!.host!.id, a.id)
    const inventoryReused = await app.inject({ method: 'GET', url: '/inventory?search=1.1.1.1', headers: { 'x-test-role': 'admin' } })
    assert.equal(inventoryReused.statusCode, 200)
    assert.deepEqual(inventoryReused.json().hosts.map((row: any) => [row.id, row.publicIp]), [[b.id, '1.1.1.1']], 'current IP search cannot return A from historical onboarding input')
    assert.deepEqual((await getHostsPaginated({ userId: owner.id, search: '1.1.1.1' })).items.map(row => row.id), [b.id])
    const customerRows = await getInstancesPaginated({ userId: buyer.id })
    for (const [customer, ip] of [[customers[0]!, '1.1.1.2'], [customers[1]!, '1.1.1.1']] as const) {
      const source = customerRows.items.find(row => row.id === customer.id)!
      const display: Record<string, any> = { natPublicIp: ip, ipv4: customer.ipv4 }
      applyCustomerInstanceView(display, source as any, false)
      assert.equal(display.ipv4, ip); assert.equal(display.observedPublicIp, ip); assert.equal(display.publicIpUpdating, false)
    }
    assert.deepEqual(await prisma.instance.findMany({ where: { id: { in: customers.map(row => row.id) } }, orderBy: { id: 'asc' } }), [...customers].sort((x, y) => x.id - y.id))
    assert.equal(Number((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance), beforeReuseBalance)
    for (const row of originals) {
      const final = await prisma.host.findUniqueOrThrow({ where: { id: row.id }, include: { agent: true, onboardingNode: true } })
      for (const field of ['url', 'managementSshHost', 'serverCertificate', 'serverFingerprint', 'name', 'location'] as const) assert.equal(final[field], row[field])
      assert.deepEqual(final.agent, row.agent); assert.equal(final.onboardingNode!.sshFingerprint, row.onboardingNode!.sshFingerprint)
      assert.equal(final.onboardingNode!.publicIp, row.onboardingNode!.publicIp)
    }
    assert.deepEqual([...forwardsByHost], forwardSnapshot); assert.equal(reuseWrites.length, 0)
    assert.equal(authenticationAttempts, 0); assert.equal(commands, 0)
    console.log('PASS OCI recycled 1.1.1.1: A->1.1.1.2, B->1.1.1.1; actual distinct SSH handshakes; delayed owner + automatic backoff/resume; wrong key rejected; identity/forward/customer/billing preserved')
  } finally {
    routeSsh.mock.restore()
    for (const connection of [...connectionsA, ...connectionsB]) connection.end()
    await Promise.all([new Promise<void>(resolve => sshA.close(() => resolve())), new Promise<void>(resolve => sshB.close(() => resolve()))])
  }

  // Cross-host contenders share an address lock; only one may claim it.
  const competitors = await Promise.all([makeHost(), makeHost()])
  const competingDeps = { ...deps, peers: async () => competitors.map(row => ({ nodeId: row.onboardingNode!.id, managementIp: row.onboardingNode!.managementIp!, publicIp: '4.2.2.2', lastHandshakeAt: Math.floor(Date.now() / 1000) })),
    connect: async () => ({ withMaintenanceDatabase(){return this}, request: async (method: string, path: string) => {
      assert.equal(method, 'GET')
      if (path.includes('networks?')) return [{ name: 'eth0', type: 'physical', managed: false }]
      if (path.includes('/state')) return { state: 'up', addresses: [{ family: 'inet', scope: 'global', address: '10.0.0.13' }] }
      return []
    } } as any), verify: async () => {} }
  const contested = await Promise.all(competitors.map(row => syncHostPublicIp(row.id, {}, competingDeps)))
  assert.equal(contested.filter(row => row.status === 'synced').length, 1)
  assert.equal(contested.filter(row => row.error === 'IP_ALREADY_ASSIGNED').length, 1)
  assert.equal(await prisma.hostOnboardingNode.count({ where: { activePublicIp: '4.2.2.2' } }), 1)

  // A slow first host cannot prevent other addresses making progress.
  const scanHosts = await Promise.all(Array.from({ length: 7 }, () => makeHost()))
  await prisma.host.updateMany({ where: { id: { notIn: scanHosts.map(row => row.id) } }, data: { publicIpSync: { nextCheckAt: new Date(Date.now() + 120000).toISOString() } } })
  let active = 0, peak = 0, peerReads = 0, finished = 0, releaseSlow!: () => void, slowEntered!: () => void
  const slowBarrier = new Promise<void>(resolve => { releaseSlow = resolve })
  const enteredSlow = new Promise<void>(resolve => { slowEntered = resolve })
  // Hold the initial wave explicitly: fast mock responses are not evidence
  // that a four-worker scanner actually reaches its concurrency limit.
  let releaseWave!: () => void
  const firstWave = new Promise<void>(resolve => { releaseWave = resolve })
  const waveDeadline = setTimeout(() => releaseWave(), 2000)
  let elapsed = 0
  const realNow = Date.now.bind(Date), clock = mock.method(Date, 'now', () => realNow() + elapsed)
  const scanning = scanHostPublicIps({ ...competingDeps,
    peers: async () => { peerReads++; return scanHosts.map(row => ({ nodeId: row.onboardingNode!.id, managementIp: row.onboardingNode!.managementIp!, publicIp: row.natPublicIp!, lastHandshakeAt: Math.floor(Date.now() / 1000) })) },
    connect: async (row: any) => { active++; peak = Math.max(peak, active); if (active === 4) { clearTimeout(waveDeadline); releaseWave() } await firstWave; if (row.id === scanHosts[0]!.id) { slowEntered(); await slowBarrier } return competingDeps.connect() },
    verify: async () => { active--; finished++; if (finished === 3) elapsed = 31000 }
  })
  await enteredSlow
  const until = realNow() + 10000
  while (finished < 6 && realNow() < until) await new Promise(resolve => setTimeout(resolve, 20))
  try { assert.equal(finished, 6, 'the other six hosts finish while the first host waits') } finally { releaseSlow(); await scanning; clock.mock.restore() }
  assert.equal(peak, 4); assert.equal(peerReads, 2, 'long scans refresh the authenticated peer snapshot')
  await scanHostPublicIps({ ...competingDeps, peers: async () => { throw Error('a not-due host must not be scanned') } })
  assert.equal(active, 0)

  await prisma.host.update({ where: { id: other.id }, data: { publicIpSyncBlocked: true } })
  assert.equal(await prisma.host.count({ where: { ...dedicatedHostReadyWhere(), id: other.id } }), 0, 'pending-address hosts are excluded from inventory allocation')
  await assert.rejects(prisma.instance.create({ data: { userId: buyer.id, hostId: other.id, name: 'blocked-allocation', incusId: `${prefix}-blocked`,
    image: 'images:alpine/3.21', status: 'creating', cpu: 200, memory: 768, disk: 30720 } }), /HOST_PUBLIC_IP_PENDING/, 'DB guard rejects stale-catalog allocations')
  await assert.rejects(prisma.instanceTask.create({ data: { instanceId: instance.id, userId: buyer.id, hostId: other.id, targetHostId: other.id, taskType: 'replace_host' } }), /HOST_PUBLIC_IP_PENDING/, 'replacement cannot reserve a host with an unverified IP')
  console.log('Host IP integration: authorization, real DB allocation guards, discovery, public+private changes, identity failure, retry, ownership, offline/busy states, custom ports, concurrency and billing preservation passed')
} catch (error) { failure = error }
finally {
  await app.close()
  await prisma.instance.deleteMany({ where: { userId: buyer.id } })
  await prisma.host.deleteMany({ where: { userId: owner.id } })
  await prisma.hostOnboardingBatch.delete({ where: { id: batchId } })
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, buyer.id] } } })
  await closePrismaDatabase()
}
if (failure) console.error(failure)
process.exit(failure ? 1 : 0)
